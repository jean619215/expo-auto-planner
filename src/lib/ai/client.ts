import "server-only";

import Anthropic from "@anthropic-ai/sdk";

// ⚠️ Server-only:ANTHROPIC_API_KEY 絕不可進 client bundle。
// 模型與單次呼叫扣點數由 env var 控制,可不改程式碼調整。

export const AI_MODEL = process.env.AI_MODEL ?? "claude-sonnet-5";

export const AI_CHAT_COST = Number.parseInt(
  process.env.AI_CHAT_COST ?? "10",
  10
);

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY 環境變數");
  }
  return new Anthropic({ apiKey });
}
