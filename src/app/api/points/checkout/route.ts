import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { findPackage } from "@/lib/points/packages";
import { getPaymentProvider } from "@/lib/points/provider";

const NOT_LOGGED_IN_ERROR = "請先登入";
const SERVER_ERROR = "伺服器錯誤";
const INVALID_JSON_ERROR = "請求格式錯誤";
const INVALID_PACKAGE_ERROR = "無效的點數方案";

export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: NOT_LOGGED_IN_ERROR }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: INVALID_JSON_ERROR }, { status: 400 });
  }

  const packageId =
    typeof body === "object" && body !== null && "packageId" in body
      ? (body as { packageId: unknown }).packageId
      : null;

  if (typeof packageId !== "string") {
    return Response.json({ error: INVALID_PACKAGE_ERROR }, { status: 400 });
  }

  const pkg = findPackage(packageId);
  if (!pkg) {
    return Response.json({ error: INVALID_PACKAGE_ERROR }, { status: 400 });
  }

  const { name: providerName, provider } = getPaymentProvider();

  // 訂單寫入走 admin client:point_orders 沒有 authenticated 的 insert policy
  // (fail-closed),建單一律由 server 端定價快照,金額/點數不信任 client。
  const admin = createSupabaseAdminClient();
  const { data: order, error: orderError } = await admin
    .from("point_orders")
    .insert({
      user_id: userData.user.id,
      package_id: pkg.id,
      amount_twd: pkg.amountTwd,
      points: pkg.points,
      provider: providerName,
    })
    .select("id")
    .single();

  if (orderError || !order) {
    console.error(
      "POST /api/points/checkout 建單失敗",
      orderError?.code,
      orderError?.message
    );
    return Response.json({ error: SERVER_ERROR }, { status: 500 });
  }

  const { redirectUrl } = provider.createCheckout({
    orderId: order.id,
    amountTwd: pkg.amountTwd,
    points: pkg.points,
    packageName: pkg.name,
  });

  return Response.json({ orderId: order.id, redirectUrl }, { status: 200 });
}
