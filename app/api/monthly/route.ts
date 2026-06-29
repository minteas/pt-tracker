/**
 * GET /api/monthly?ym=YYYY-MM
 * → 指定月の consumed_sessions から消化数・合計金額を返す
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

  const from = `${ym}-01`;
  const to   = `${ny}-${String(nm).padStart(2, "0")}-01`;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("consumed_sessions")
    .select("price, trainer")
    .gte("session_date", from)
    .lt("session_date", to);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = data ?? [];
  const totalCount   = rows.length;
  const totalRevenue = rows.reduce((s, r) => s + (r.price ?? 0), 0);

  const byTrainer: Record<string, { count: number; revenue: number }> = {};
  for (const row of rows) {
    const t = row.trainer ?? "unknown";
    if (!byTrainer[t]) byTrainer[t] = { count: 0, revenue: 0 };
    byTrainer[t].count++;
    byTrainer[t].revenue += row.price ?? 0;
  }

  return NextResponse.json({ totalCount, totalRevenue, byTrainer });
}
