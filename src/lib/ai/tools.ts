import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

// Tool 定義:模型只回傳 tool call,實際執行在前端(套用到 PlanEditor state)。
// schema 對齊 src/lib/venue/plan.ts / furniture.ts 型別;id 由前端生成,schema 不含 id。
// 全部 strict(structured outputs 保證參數合法);structured outputs 不支援
// min/max 數值約束,範圍寫在 description,超界由前端既有 clamp 邏輯處理。

const POINT_SCHEMA = {
  type: "object" as const,
  properties: {
    x: { type: "number" as const, description: "公尺,0-200" },
    y: { type: "number" as const, description: "公尺,0-200" },
  },
  required: ["x", "y"],
  additionalProperties: false,
};

export const AI_TOOLS: Anthropic.Tool[] = [
  {
    name: "generate_plan",
    description:
      "產出完整場地配置,覆蓋現有內容。用於:解析參考圖、引導問答收齊需求後的首次生成。修改既有配置時不要用這個,改用增量工具。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        floor: {
          type: "array",
          description: "地板多邊形頂點(至少3點,依序連線),座標 0-200 公尺、0.5 對齊",
          items: POINT_SCHEMA,
        },
        walls: {
          type: "array",
          description: "牆段列表(可為空)",
          items: {
            type: "object",
            properties: {
              start: POINT_SCHEMA,
              end: POINT_SCHEMA,
            },
            required: ["start", "end"],
            additionalProperties: false,
          },
        },
        columns: {
          type: "array",
          description: "柱子列表(可為空),w/h 公尺(預設 0.5)",
          items: {
            type: "object",
            properties: {
              center: POINT_SCHEMA,
              w: { type: "number", description: "公尺,>0" },
              h: { type: "number", description: "公尺,>0" },
            },
            required: ["center", "w", "h"],
            additionalProperties: false,
          },
        },
        furniture: {
          type: "array",
          description: "家具列表(可為空)",
          items: {
            type: "object",
            properties: {
              code: {
                type: "string",
                description:
                  "家具目錄代碼。可用代碼與其名稱、尺寸列在使用者訊息附帶的目前配置 JSON 的 catalogue 欄位,只能從那裡面選;不在目錄裡的代碼會被拒絕。",
              },
              center: POINT_SCHEMA,
              rotationDeg: {
                type: "number",
                description: "旋轉角度 0-359,0 為不旋轉",
              },
            },
            required: ["code", "center", "rotationDeg"],
            additionalProperties: false,
          },
        },
      },
      required: ["floor", "walls", "columns", "furniture"],
      additionalProperties: false,
    },
  },
  {
    name: "add_furniture",
    // 尺寸不寫在 description 裡:尺寸的唯一來源是目錄,寫在這裡會變成第二份
    // 會過期的數字。目錄本身透過每輪的目前配置附錄送進去(見 AiPanel)。
    description:
      "新增一件家具到指定位置。尺寸由目錄代碼決定,不可指定。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description:
            "家具目錄代碼。可用代碼與其名稱、尺寸列在使用者訊息附帶的目前配置 JSON 的 catalogue 欄位,只能從那裡面選;不在目錄裡的代碼會被拒絕。",
        },
        center: POINT_SCHEMA,
        rotationDeg: { type: "number", description: "旋轉角度 0-359" },
      },
      required: ["code", "center", "rotationDeg"],
      additionalProperties: false,
    },
  },
  {
    name: "move_item",
    description:
      "移動一個既有物件到新位置。index 是使用者訊息附帶的目前配置 JSON 中,該類型陣列的索引(0 起算)。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        itemType: { type: "string", enum: ["wall", "column", "furniture"] },
        index: { type: "integer", description: "目前配置中該類型陣列的索引" },
        center: {
          ...POINT_SCHEMA,
          description: "新位置。牆段以中點平移(前端計算兩端點)。",
        },
      },
      required: ["itemType", "index", "center"],
      additionalProperties: false,
    },
  },
  {
    name: "remove_item",
    description: "刪除一個既有物件。index 同 move_item 規則。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        itemType: { type: "string", enum: ["wall", "column", "furniture"] },
        index: { type: "integer" },
      },
      required: ["itemType", "index"],
      additionalProperties: false,
    },
  },
  {
    name: "resize_floor",
    description: "重設地板多邊形形狀(至少3個頂點)。只改地板,不動其他物件。",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "新地板頂點,座標 0-200 公尺、0.5 對齊",
          items: POINT_SCHEMA,
        },
      },
      required: ["points"],
      additionalProperties: false,
    },
  },
];
