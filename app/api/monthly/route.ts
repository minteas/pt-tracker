/**
 * GET /api/monthly?ym=YYYY-MM
 * → 指定月（JST）の消化済み予約の件数・合計金額を返す
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ym = req.nextUrl.searchParams.get("ym");
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    return NextResponse.json({ error: "ym (YYYY-MM) required" }, { status: 400 });
  }

  const [y, m] = ym.split("-").map(Number);
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;

  const from = new Date(`${ym}-01T00:00:00+09:00`).toISOString();
  const to   = new Date(`${ny}-${String(nm).padStart(2, "0")}-01T00:00:00+09:00`).toISOString();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("price, customer_name, trainer")
    .eq("consumed", true)
    .gte("start_at", from)
    .lt("start_at", to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const totalCount   = (data ?? []).length;
  const totalRevenue = (data ?? []).reduce((s, b) => s + (b.price ?? 0), 0);

  return NextResponse.json({ totalCount, totalRevenue });
}
