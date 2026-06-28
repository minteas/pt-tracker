/**
 * GET /api/daily?date=YYYY-MM-DD
 * → 指定日（JST）の承認済み予約を返す
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const date = req.nextUrl.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date (YYYY-MM-DD) required" }, { status: 400 });
  }

  // JST の 1日分を UTC に変換
  const from = new Date(`${date}T00:00:00+09:00`).toISOString();
  const to   = new Date(`${date}T23:59:59+09:00`).toISOString();

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("bookings")
    .select("id, customer_name, customer_memo, trainer, start_at, duration_minutes, consumed, consumed_at, price")
    .eq("status", "approved")
    .gte("start_at", from)
    .lte("start_at", to)
    .order("start_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ bookings: data ?? [] });
}
