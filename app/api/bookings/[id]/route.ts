/**
 * PATCH /api/bookings/:id
 * { action: "consume", price: number } → consumed=true, consumed_at=now(), price=<値>
 * { action: "unconsume" }              → consumed=false, consumed_at=null, price=null
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function checkAuth(req: NextRequest): boolean {
  return req.headers.get("x-admin-password") === process.env.ADMIN_PASSWORD;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!checkAuth(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = (await req.json()) as { action: "consume" | "unconsume"; price?: number };
  const supabase = getSupabase();

  if (body.action === "consume") {
    const price = typeof body.price === "number" ? body.price : null;
    const { error } = await supabase
      .from("bookings")
      .update({ consumed: true, consumed_at: new Date().toISOString(), price })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  } else if (body.action === "unconsume") {
    const { error } = await supabase
      .from("bookings")
      .update({ consumed: false, consumed_at: null, price: null })
      .eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  } else {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
