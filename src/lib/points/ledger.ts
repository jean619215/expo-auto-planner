import "server-only";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// ⚠️ Server-only:內部使用 service_role admin client,絕不可被 client component
// import。點數扣除的共用資料層 — API route 呼叫,route 自己負責身分驗證。
//
// 已知取捨:餘額檢查與扣點寫入非同一 transaction,極端併發下同一使用者可能
// 短暫透支(兩個請求同時通過餘額檢查)。目前為單人操作情境,接受此風險;
// 若未來需要嚴格保證,改為 DB function(SELECT ... FOR UPDATE + INSERT)一次完成。

export type DeductReason = "ai_usage";

export interface DeductParams {
  userId: string;
  /** 要扣除的點數,正整數。寫入 ledger 為 -amount。 */
  amount: number;
  reason: DeductReason;
  /** 冪等鍵(unique constraint 擋重複扣點),慣例: ai:{request_id} */
  refId: string;
}

export type DeductResult =
  | { ok: true }
  | { ok: false; error: "insufficient_balance" | "duplicate" };

const UNIQUE_VIOLATION = "23505";

/**
 * 取得使用者點數餘額(SUM(delta),與 GET /api/points/balance 同語意)。
 * 差異:balance route 走 user-context client + RLS;此處為 admin client +
 * 明確 userId,供 server 端業務邏輯使用。
 */
export async function getBalance(userId: string): Promise<number> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from("point_transactions")
    .select("delta")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`getBalance 查詢失敗: ${error.code} ${error.message}`);
  }
  return data.reduce((sum, t) => sum + t.delta, 0);
}

/**
 * 扣點。餘額不足或 refId 重複時不寫入並回傳對應錯誤;其他 DB 錯誤 throw。
 */
export async function deductPoints(params: DeductParams): Promise<DeductResult> {
  const { userId, amount, reason, refId } = params;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`deductPoints: amount 必須為正整數,收到 ${amount}`);
  }

  const balance = await getBalance(userId);
  if (balance < amount) {
    return { ok: false, error: "insufficient_balance" };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from("point_transactions").insert({
    user_id: userId,
    delta: -amount,
    reason,
    ref_id: refId,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { ok: false, error: "duplicate" };
    }
    throw new Error(`deductPoints 寫入失敗: ${error.code} ${error.message}`);
  }
  return { ok: true };
}
