// 純函式:把 AiPanel 面板的 turns(含最新一則)轉成送給 /api/ai/chat 的
// messages 陣列。舊輪(除陣列最後一個元素外)在此瘦身:
//   - user text block  → 還原成不含 [目前配置] 附錄的 displayText
//   - user image block → 換成固定 placeholder text block
//   - tool_result block → 原樣保留
//   - assistant 訊息    → 原樣保留(content 只會是 text / tool_use)
// 最新一則訊息(陣列最後一個元素)原樣送出,不做任何轉換。
//
// 只操作既有本地 state 衍生資料,不引入外部輸入;不 import
// src/lib/ai/(server-only)或 src/lib/supabase/admin.ts。
//
// PRIOR_IMAGE_PLACEHOLDER 亦被 src/app/api/ai/chat/route.ts(server)import,
// 作為對話落庫時圖片 block 佔位符字串的單一事實來源 — 本模組必須維持
// isomorphic,新增程式碼不得引入 server-only 模組或瀏覽器 API。

import type Anthropic from "@anthropic-ai/sdk";

export const PRIOR_IMAGE_PLACEHOLDER = "[使用者先前提供了參考圖]";
export const CONFIG_APPENDIX_HEADER = "[目前配置]";

export interface PanelTurn {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
  displayText?: string;
}

interface ApiMessage {
  role: "user" | "assistant";
  content: Anthropic.ContentBlockParam[];
}

/**
 * 瘦身單一舊輪 user 訊息的 content。
 *
 * 已知極端邊界(接受,見 architect-plan.md Architecture Notes):使用者
 * 「真的輸入字面文字 (圖片) 且同輪附圖」時,依 AC6 規則,該輪的 text
 * block 會被丟棄(與純圖片輪在 displayText 上無法區分 — `displayText =
 * trimmed || "(圖片)"` 資訊已合流)。影響僅止於該舊輪送給模型的歷史少一句
 * 「(圖片)」,畫面顯示不受影響。
 */
function slimOldUserContent(turn: PanelTurn): Anthropic.ContentBlockParam[] {
  const hasImage = turn.content.some((block) => block.type === "image");
  const isImageOnlyTurn = hasImage && turn.displayText === "(圖片)";

  const result: Anthropic.ContentBlockParam[] = [];
  for (const block of turn.content) {
    if (block.type === "tool_result") {
      result.push(block);
    } else if (block.type === "image") {
      result.push({ type: "text", text: PRIOR_IMAGE_PLACEHOLDER });
    } else if (block.type === "text") {
      if (isImageOnlyTurn) continue;
      result.push({ type: "text", text: turn.displayText ?? "" });
    } else {
      // 防禦性 fallthrough:理論上不存在其他 block type,原樣保留不丟資料。
      result.push(block);
    }
  }
  return result;
}

export function toApiMessages(turns: PanelTurn[]): ApiMessage[] {
  return turns.map((turn, index) => {
    const isLatest = index === turns.length - 1;
    if (isLatest || turn.role === "assistant") {
      return { role: turn.role, content: turn.content };
    }
    return { role: turn.role, content: slimOldUserContent(turn) };
  });
}
