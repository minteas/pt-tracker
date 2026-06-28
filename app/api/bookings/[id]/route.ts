/**
 * PATCH /api/bookings/:id   (id = event_uid)
 * { action: "consume", price: number, customer_name, trainer, session_date }
 *   → consumed_sessions に upsert
 * { action: "unconsume" }
 *   → consumed_sessions から削除
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
  const body = await req.json() as {
    action: "consume" | "unconsume";
    price?: number;
    customer_name?: string;
    trainer?: string;
    session_date?: string;
    start_at?: string;
  };

  const supabase = getSupabase();

  if (body.action === "consume") {
    const { error } = await supabase
      .from("consumed_sessions")
      .upsert({
        event_uid:     id,
        customer_name: body.customer_name ?? "",
        trainer:       body.trainer ?? "",
        session_date:  body.session_date ?? new Date().toISOString().slice(0, 10),
        start_at:      body.start_at ?? new Date().toISOString(),
        price:         typeof body.price === "number" ? body.price : null,
        consumed_at:   new Date().toISOString(),
      }, { onConflict: "event_uid" });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  } else if (body.action === "unconsume") {
    const { error } = await supabase
      .from("consumed_sessions")
      .delete()
      .eq("event_uid", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  } else {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
