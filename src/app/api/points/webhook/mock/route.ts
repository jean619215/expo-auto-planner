import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getPaymentProvider } from "@/lib/points/provider";

// ⚠️ 此路由在 src/proxy.ts 的 PUBLIC_API_PATHS 上(金流商 server-to-server
// 呼叫,不帶使用者 cookie),簽章驗證是唯一守門 — 驗簽失敗一律拒絕,
// 且任何錯誤訊息都不得洩漏訂單是否存在等內部狀態。
//
// idempotency:發點的 ref_id = `order:{orderId}` 有 unique constraint,
// webhook 重送時 insert 會撞 23505,視為已處理過,回 200 讓金流商停止重送。

const OK_RESPONSE = { ok: true };
const REJECTED_ERROR = "invalid webhook";
const UNIQUE_VIOLATION = "23505";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: REJECTED_ERROR }, { status: 400 });
  }

  const { provider } = getPaymentProvider();
  const result = provider.verifyWebhook(payload);
  if (!result.ok) {
    return Response.json({ error: REJECTED_ERROR }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: order, error: orderError } = await admin
    .from("point_orders")
    .select("id, user_id, points, status")
    .eq("id", result.orderId)
    .maybeSingle();

  if (orderError) {
    console.error(
      "POST /api/points/webhook/mock 查單失敗",
      orderError.code,
      orderError.message
    );
    return Response.json({ error: "server error" }, { status: 500 });
  }

  // 簽章有效但查無此單:對外仍回拒絕,不區分「不存在」與「驗簽失敗」。
  if (!order) {
    return Response.json({ error: REJECTED_ERROR }, { status: 400 });
  }

  if (order.status === "paid") {
    return Response.json(OK_RESPONSE, { status: 200 });
  }

  // 先寫 ledger(unique ref_id 擋重複),再標記訂單。若兩步之間中斷,
  // 訂單會停在 pending 但點數已入帳;金流商重送 webhook 時 insert 撞
  // unique → 走 23505 分支補標 paid,狀態自我修復。
  const { error: ledgerError } = await admin.from("point_transactions").insert({
    user_id: order.user_id,
    delta: order.points,
    reason: "purchase",
    ref_id: `order:${order.id}`,
  });

  if (ledgerError && ledgerError.code !== UNIQUE_VIOLATION) {
    console.error(
      "POST /api/points/webhook/mock 發點失敗",
      ledgerError.code,
      ledgerError.message
    );
    return Response.json({ error: "server error" }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("point_orders")
    .update({
      status: "paid",
      provider_txn_id: result.providerTxnId,
      paid_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("status", "pending");

  if (updateError) {
    console.error(
      "POST /api/points/webhook/mock 更新訂單失敗",
      updateError.code,
      updateError.message
    );
    // 點數已入帳(或早已入帳),讓金流商重送以修復訂單狀態。
    return Response.json({ error: "server error" }, { status: 500 });
  }

  return Response.json(OK_RESPONSE, { status: 200 });
}
