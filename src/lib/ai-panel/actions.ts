// Client-side AI 面板動作型別 + tool_use 解析。
//
// 對齊 src/lib/ai/tools.ts(server-only,5 支 tool 的 input schema),但刻意
// 不 import 該檔 — 它掛了 "server-only",client 端 import 會直接編譯失敗。
// 型別以手動方式與 schema 保持同步。

export interface AiPoint {
  x: number;
  y: number;
}

export type FurnitureKind = "table" | "chair" | "cabinet";
export type AiItemType = "wall" | "column" | "furniture";

export interface GeneratePlanInput {
  floor: AiPoint[];
  walls: { start: AiPoint; end: AiPoint }[];
  columns: { center: AiPoint; w: number; h: number }[];
  furniture: { kind: FurnitureKind; center: AiPoint; rotationDeg: number }[];
}

export interface AddFurnitureInput {
  kind: FurnitureKind;
  center: AiPoint;
  rotationDeg: number;
}

export interface MoveItemInput {
  itemType: AiItemType;
  index: number;
  center: AiPoint;
}

export interface RemoveItemInput {
  itemType: AiItemType;
  index: number;
}

export interface ResizeFloorInput {
  points: AiPoint[];
}

export type AiAction =
  | { type: "generate_plan"; toolUseId: string; input: GeneratePlanInput }
  | { type: "add_furniture"; toolUseId: string; input: AddFurnitureInput }
  | { type: "move_item"; toolUseId: string; input: MoveItemInput }
  | { type: "remove_item"; toolUseId: string; input: RemoveItemInput }
  | { type: "resize_floor"; toolUseId: string; input: ResizeFloorInput };

export interface AiActionResult {
  toolUseId: string;
  ok: boolean;
  /** 中文摘要:成功時的動作描述,或跳過原因。同時作為 tool_result content 回傳給模型。 */
  message: string;
}

// 只取用得到的最小 shape,不 import SDK 型別到這個判斷式(避免對回應格式
// 過度耦合) — 呼叫端(AiPanel)在需要完整型別時用 SDK 的 type-only import。
interface RawToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

function isToolUseBlock(block: unknown): block is RawToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_use" &&
    typeof (block as { id?: unknown }).id === "string" &&
    typeof (block as { name?: unknown }).name === "string"
  );
}

/** 從助理回應的 content blocks 中取出並型別標記 tool_use blocks。 */
export function parseToolUse(content: unknown[]): AiAction[] {
  const actions: AiAction[] = [];
  for (const block of content) {
    if (!isToolUseBlock(block)) continue;
    const { id, name, input } = block;
    switch (name) {
      case "generate_plan":
        actions.push({
          type: "generate_plan",
          toolUseId: id,
          input: input as GeneratePlanInput,
        });
        break;
      case "add_furniture":
        actions.push({
          type: "add_furniture",
          toolUseId: id,
          input: input as AddFurnitureInput,
        });
        break;
      case "move_item":
        actions.push({
          type: "move_item",
          toolUseId: id,
          input: input as MoveItemInput,
        });
        break;
      case "remove_item":
        actions.push({
          type: "remove_item",
          toolUseId: id,
          input: input as RemoveItemInput,
        });
        break;
      case "resize_floor":
        actions.push({
          type: "resize_floor",
          toolUseId: id,
          input: input as ResizeFloorInput,
        });
        break;
      default:
        // 未知 tool 名稱(理論上不會發生,schema 由後端固定) — 忽略。
        break;
    }
  }
  return actions;
}
