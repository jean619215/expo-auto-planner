import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createAnthropicClient, AI_MODEL, AI_CHAT_COST } from "@/lib/ai/client";
import { SYSTEM_PROMPT } from "@/lib/ai/system";
import { AI_TOOLS } from "@/lib/ai/tools";
import { deductPoints, getBalance } from "@/lib/points/ledger";

const NOT_LOGGED_IN_ERROR = "請先登入";
const INVALID_BODY_ERROR = "請求格式錯誤";
const INSUFFICIENT_ERROR = "點數不足";
const UPSTREAM_ERROR = "AI 服務暫時無法回應,請稍後再試";
const SERVER_ERROR = "伺服器錯誤";

// 請求大小上限(含 base64 圖片)
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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
