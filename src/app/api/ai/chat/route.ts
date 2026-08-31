import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient, AI_MODEL, AI_CHAT_COST } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system";
import { AI_TOOLS } from "@/lib/ai/tools";
import { deductPoints, getBalance, refundPoints } from "@/lib/points/ledger";
import { PRIOR_IMAGE_PLACEHOLDER } from "@/lib/ai-panel/messages";

const NOT_LOGGED_IN_ERROR = "請先登入";
const INVALID_BODY_ERROR = "請求格式錯誤";
const PLAN_NOT_FOUND_ERROR = "找不到存檔";
const INSUFFICIENT_ERROR = "可用次數不足";
const UPSTREAM_ERROR = "AI 服務暫時無法回應,請稍後再試";
const SERVER_ERROR = "伺服器錯誤";

// 請求大小上限(含 base64 圖片)
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 扣點在模型呼叫前(避免併發下的透支),但**上游失敗會退點**。
//
// 原本的取捨是「失敗不退,log 供人工補償」,理由是退點需要另一套冪等機制。
// 那個理由後來不成立了:`refund` reason 進了 DB,而扣點的 refId 是每次請求
// 新生的 uuid,`refund:{refId}` 天然唯一 —— unique constraint 就是完整的
// 冪等機制。
//
// 促成改動的是一次真實事故(2026-08-28):Vercel 上 AI 設定有問題,使用者
// 連送三次,每次扣 10 點、每次回 502,次數從 3 歸零而一張圖都沒產出。
// 設定類錯誤現在更早擋下(見下方 createAnthropicClient 的位置),真正的
// 上游失敗則退點。

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }
  const userId = userData.user.id;

  // 先看 content-length 擋明顯超大的請求(避免整包讀進記憶體才發現超限);
  // 讀完後再以實際 byte 數複核(header 可缺漏或造假)。
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
  }

  // 只取 messages;client 傳來的 system 等其他欄位一律忽略(系統提示僅後端注入)。
  const messages =
    typeof body === "object" && body !== null && "messages" in body
      ? (body as { messages: unknown }).messages
      : null;
  if (!Array.isArray(messages) || messages.length === 0 || !isValidRoles(messages)) {
    return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
  }

  // planId 為選填:undefined/null 視為未帶,走現況路徑(零新增查詢)。帶值時
  // 必須是合法 uuid 格式,且驗證所有權(admin client 無 RLS,.eq("user_id")
  // 為安全關鍵)——此段必須在 deductPoints 之前,確保 404 情境零扣點。
  const rawPlanId =
    typeof body === "object" && body !== null && "planId" in body
      ? (body as { planId: unknown }).planId
      : undefined;
  let planId: string | undefined;
  if (rawPlanId !== undefined && rawPlanId !== null) {
    if (typeof rawPlanId !== "string" || !UUID_RE.test(rawPlanId)) {
      return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
    }
    planId = rawPlanId;
  }

  const admin = createSupabaseAdminClient();
  if (planId) {
    const { data: plan, error: planError } = await admin
      .from("venue_plans")
      .select("id")
      .eq("id", planId)
      .eq("user_id", userId) // ★ admin client 無 RLS,此過濾為安全關鍵
      .maybeSingle();
    if (planError) {
      console.error("POST /api/ai/chat 存檔查詢失敗", planError.code, planError.message);
      return Response.json({ error: SERVER_ERROR }, { status: 500 });
    }
    if (!plan) {
      return Response.json({ error: PLAN_NOT_FOUND_ERROR }, { status: 404 });
    }
  }

  // 設定類錯誤(缺 ANTHROPIC_API_KEY)必須在扣點**之前**就擋掉。
  //
  // 這行原本在扣點之後、與模型呼叫寫在同一個 try 裡,結果是:金鑰沒設時每一次
  // 送出都扣 10 點然後回 502,使用者眼睜睜看著次數歸零而一次服務都沒得到。
  // 實際發生過(2026-08-28,Vercel 上 3 次 → 0 次)。這不是機率問題,是站方
  // 設定錯誤時的**必然**行為,所以檢查要前移,而不是靠退點善後。
  let anthropic: Anthropic;
  try {
    anthropic = createAnthropicClient();
  } catch (err) {
    console.error(
      "POST /api/ai/chat 缺少 AI 設定(未扣點)",
      err instanceof Error ? err.message : String(err),
    );
    return Response.json({ error: UPSTREAM_ERROR }, { status: 502 });
  }

  const refId = `ai:${crypto.randomUUID()}`;
  let deduction;
  try {
    deduction = await deductPoints({
      userId,
      amount: AI_CHAT_COST,
      reason: "ai_usage",
      refId,
    });
  } catch (err) {
    console.error("POST /api/ai/chat 扣點失敗", refId, err instanceof Error ? err.message : err);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }
  if (!deduction.ok) {
    if (deduction.error === "insufficient_balance") {
      const balance = await safeBalance(userId);
      return Response.json({ error: INSUFFICIENT_ERROR, balance }, { status: 402 });
    }
    console.error("POST /api/ai/chat 扣點異常", deduction.error, refId);
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  let response: Anthropic.Message;
  try {
    response = await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: AI_TOOLS,
      messages: messages as Anthropic.MessageParam[],
    });
  } catch (err) {
    // 已扣點但沒有交付服務 —— **退點**。
    //
    // 冪等鍵是 refund:{refId},而 refId 每次請求都是新的 uuid,所以一筆扣點
    // 只可能被退一次;unique constraint 就是完整的冪等機制,不需要另外一套。
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    const refunded = await safeRefund(userId, refId);
    console.error(
      "POST /api/ai/chat 上游呼叫失敗",
      JSON.stringify({
        userId,
        refId,
        status,
        refunded,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    // client 造成的上游 400(訊息格式/壞圖等)回 400 讓前端知道是請求問題,
    // 其餘(限流/過載/伺服器錯)一律 502。
    if (err instanceof Anthropic.BadRequestError) {
      return Response.json({ error: INVALID_BODY_ERROR }, { status: 400 });
    }
    return Response.json({ error: UPSTREAM_ERROR }, { status: 502 });
  }

  console.log(
    "ai_usage",
    JSON.stringify({
      userId,
      refId,
      model: AI_MODEL,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    })
  );

  if (planId) {
    try {
      await persistConversation(admin, planId, messages[messages.length - 1], response.content);
    } catch (err) {
      // 落庫失敗僅 log,絕不改變 response(見檔頭取捨)。log 不含對話內容。
      console.error(
        "POST /api/ai/chat 落庫失敗",
        JSON.stringify({ planId, refId, error: err instanceof Error ? err.message : String(err) })
      );
    }
  }

  // 模型已回應(已付費)— 餘額查詢失敗不可丟棄整包回應,balance 以 null 降級。
  const balance = await safeBalance(userId);
  return Response.json(
    {
      content: response.content,
      stopReason: response.stop_reason,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
      },
      balance,
    },
    { status: 200 }
  );
}

/**
 * 退點,且**不讓退點失敗蓋掉原本的錯誤**。
 *
 * 使用者此刻要看到的是「AI 呼叫失敗」,不是「退點時 DB 也出問題」。退不成
 * 就記進 log 讓人補 —— 那是原本整條路徑的行為,現在縮小成只在這個角落。
 */
async function safeRefund(userId: string, refId: string): Promise<string> {
  try {
    const result = await refundPoints({
      userId,
      amount: AI_CHAT_COST,
      reason: "refund",
      deductedRefId: refId,
    });
    return result.ok ? "refunded" : result.error;
  } catch (err) {
    console.error(
      "POST /api/ai/chat 退點失敗(需人工補償)",
      JSON.stringify({ userId, refId, error: err instanceof Error ? err.message : String(err) }),
    );
    return "failed";
  }
}

async function safeBalance(userId: string): Promise<number | null> {
  try {
    return await getBalance(userId);
  } catch (err) {
    console.error("POST /api/ai/chat 餘額查詢失敗", err instanceof Error ? err.message : err);
    return null;
  }
}

function isValidRoles(messages: unknown[]): boolean {
  return messages.every(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      "role" in m &&
      ((m as { role: unknown }).role === "user" ||
        (m as { role: unknown }).role === "assistant")
  );
}

// 逐一替換 user 訊息 content 內的每個 image block 為固定佔位符 text block
// (不合併);其餘 block(text/tool_result/未知型別)原樣保留。content 非陣列
// (理論不發生,Anthropic 允許 string)則原樣存,不轉換。
function replaceImageBlocks(content: unknown): unknown {
  if (!Array.isArray(content)) {
    return content;
  }
  return content.map((block) =>
    typeof block === "object" && block !== null && (block as { type?: unknown }).type === "image"
      ? { type: "text", text: PRIOR_IMAGE_PLACEHOLDER }
      : block
  );
}

// find-or-create 對話列 + 增量寫入本輪 user/assistant 兩則訊息。整段在呼叫端
// try/catch 內,任一步 throw 由外層統一 log,不影響已組好的 response。
async function persistConversation(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  planId: string,
  lastUserMessage: unknown,
  assistantContent: unknown
): Promise<void> {
  const { data: conversation, error: upsertError } = await admin
    .from("ai_conversations")
    .upsert({ plan_id: planId }, { onConflict: "plan_id", ignoreDuplicates: false })
    .select("id")
    .single();
  if (upsertError) {
    throw upsertError;
  }

  const userContent =
    typeof lastUserMessage === "object" && lastUserMessage !== null && "content" in lastUserMessage
      ? replaceImageBlocks((lastUserMessage as { content: unknown }).content)
      : null;

  const { error: insertError } = await admin.from("ai_messages").insert([
    { conversation_id: conversation.id, role: "user", content: userContent },
    { conversation_id: conversation.id, role: "assistant", content: assistantContent },
  ]);
  if (insertError) {
    throw insertError;
  }
}
