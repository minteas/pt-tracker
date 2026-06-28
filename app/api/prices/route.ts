/**
 * GET  /api/prices → 全顧客単価を { prices: { [name]: price } } で返す
 * POST /api/prices → 顧客単価を upsert
 *   Body: { customer_name: string, price: number }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
}

export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = getSupabase();
  const { data, error } = await supabase.from("customer_prices").select("customer_name, price");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const prices: Record<string, number> = {};
  for (const row of data ?? []) prices[row.customer_name] = row.price;

  return NextResponse.json({ prices });
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { customer_name, price } = (await req.json()) as { customer_name: string; price: number };
  if (!customer_name || typeof price !== "number" || price < 0) {
    return NextResponse.json({ error: "invalid params" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from("customer_prices")
    .upsert({ customer_name, price, updated_at: new Date().toISOString() }, { onConflict: "customer_name" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
