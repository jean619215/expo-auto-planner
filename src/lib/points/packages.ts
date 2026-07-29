// 服務方案定義。Phase 1 寫死在程式碼;之後若要後台可調再搬進 DB。
// 訂單建立時會把 amount/points 快照進 point_orders,所以調整這裡不影響歷史訂單。
//
// ⚠️ 銷售型態:對外一律是「軟體服務方案(買斷一定次數的 AI 規劃生成)」,
// 不是點數儲值 — 金流商不承作點數/儲值/預付卡性質商品。前台文案不得出現
// 「點數 / 儲值 / 加值 / 代幣」,一律用「方案 / 可用次數 / 使用額度」。
// 內部 ledger(point_transactions.delta)維持不變,只是顯示層改稱「次數」。

export interface ServicePlan {
  /** 穩定 id — 已寫進 point_orders.package_id,不可更名。 */
  id: string;
  name: string;
  /** 內部額度單位(= ledger delta)。1 次 AI 規劃扣 USAGE_UNIT_COST。 */
  points: number;
  /** 內含加贈額度(顯示用,points 已含)。 */
  bonusPoints: number;
  amountTwd: number;
  /** 對外顯示的可用次數 = points / USAGE_UNIT_COST。 */
  usageCount: number;
  /** 商品規格說明 — 金流審核會看這段是否具體。 */
  description: string;
}

// 單次 AI 規劃生成消耗的內部額度。必須與 env AI_CHAT_COST 一致
// (src/lib/ai/client.ts,server-only,不能在此 import)。改動時兩邊同步。
export const USAGE_UNIT_COST = 10;

export const SERVICE_PLANS: ServicePlan[] = [
  {
    id: "basic",
    name: "標準方案",
    points: 100,
    bonusPoints: 0,
    amountTwd: 100,
    usageCount: 10,
    description: "含 10 次 AI 場地平面規劃生成，適合單場展覽試用。",
  },
  {
    id: "plus",
    name: "專業方案",
    points: 550,
    bonusPoints: 50,
    amountTwd: 500,
    usageCount: 55,
    description:
      "含 55 次 AI 場地平面規劃生成（含加贈 5 次），適合常態性佈展需求。",
  },
  {
    id: "mega",
    name: "旗艦方案",
    points: 1200,
    bonusPoints: 200,
    amountTwd: 1000,
    usageCount: 120,
    description:
      "含 120 次 AI 場地平面規劃生成（含加贈 20 次），適合多場次或團隊使用。",
  },
];

export function findPackage(id: string): ServicePlan | undefined {
  return SERVICE_PLANS.find((p) => p.id === id);
}

/** 內部額度換算成對外顯示的可用次數(無條件捨去)。 */
export function toUsageCount(points: number): number {
  return Math.floor(points / USAGE_UNIT_COST);
}
