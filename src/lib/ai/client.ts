import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import { USAGE_UNIT_COST } from "@/lib/points/packages";

// ⚠️ Server-only:ANTHROPIC_API_KEY 絕不可進 client bundle。
// 模型與單次呼叫扣點數由 env var 控制,可不改程式碼調整。

export const AI_MODEL = process.env.AI_MODEL ?? "claude-sonnet-5";

export const AI_CHAT_COST = Number.parseInt(
  process.env.AI_CHAT_COST ?? "10",
  10
);

// 顯示層(/pricing、/shop、mock-checkout)用 USAGE_UNIT_COST 把內部額度換算成
// 對外的「可用次數」,而扣款用這裡的 AI_CHAT_COST。兩者分裂會讓公開商品頁標錯
// 「買 N 次」— 那是金流審核與消費爭議的正面戰場,所以寧可開機期就炸掉。
if (AI_CHAT_COST !== USAGE_UNIT_COST) {
  throw new Error(
    `AI_CHAT_COST(${AI_CHAT_COST}) 與 USAGE_UNIT_COST(${USAGE_UNIT_COST}) 不一致:` +
      "調整單次扣抵時必須同步 src/lib/points/packages.ts 的 USAGE_UNIT_COST 與各方案 usageCount。"
  );
}

export function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("缺少 ANTHROPIC_API_KEY 環境變數");
  }
  return new Anthropic({ apiKey });
}
