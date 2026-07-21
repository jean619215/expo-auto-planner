import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient, AI_MODEL, AI_CHAT_COST } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system";
import { AI_TOOLS } from "@/lib/ai/tools";
import { deductPoints, getBalance } from "@/lib/points/ledger";
import { PRIOR_IMAGE_PLACEHOLDER } from "@/lib/ai-panel/messages";

const NOT_LOGGED_IN_ERROR = "請先登入";
const INVALID_BODY_ERROR = "請求格式錯誤";
const PLAN_NOT_FOUND_ERROR = "找不到存檔";
const INSUFFICIENT_ERROR = "點數不足";
const UPSTREAM_ERROR = "AI 服務暫時無法回應,請稍後再試";
const SERVER_ERROR = "伺服器錯誤";

// 請求大小上限(含 base64 圖片)
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 取捨(phase 1):扣點在模型呼叫前;上游失敗回 502 但不退點,usage log 供
// 人工補償。退點需要另一套冪等機制,等有實際需求再做。

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
    const anthropic = createAnthropicClient();
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
    // 已扣點但未取得回應 — 不退點(見檔頭取捨),log 供補償。
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    console.error(
      "POST /api/ai/chat 上游呼叫失敗",
      JSON.stringify({ userId, refId, status, error: err instanceof Error ? err.message : String(err) })
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
