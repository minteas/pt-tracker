/**
 * GET /api/daily?date=YYYY-MM-DD
 * → 指定日（JST）の iCloud カレンダーイベントを返す
 *   + consumed_sessions と突き合わせて消化済みフラグを付加
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchEvents } from "@/lib/icloud";
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

  const from = new Date(`${date}T00:00:00+09:00`);
  const to   = new Date(`${date}T23:59:59+09:00`);

  const gymUrl  = process.env.GYM_CALENDAR_URL;
  const gym2Url = process.env.GYM2_CALENDAR_URL;
  if (!gymUrl || !gym2Url) {
    return NextResponse.json({ error: "GYM_CALENDAR_URL / GYM2_CALENDAR_URL not set" }, { status: 500 });
  }

  // iCloud から両カレンダーを並列取得
  const [gymEvents, gym2Events] = await Promise.all([
    fetchEvents(gymUrl,  from, to).catch(() => []),
    fetchEvents(gym2Url, from, to).catch(() => []),
  ]);

  // consumed_sessions を取得して uid → record のマップを作る
  const supabase = getSupabase();
  const uids = [
    ...gymEvents.map(e => e.uid),
    ...gym2Events.map(e => e.uid),
  ];

  let consumedMap: Record<string, { price: number | null; consumed_at: string }> = {};
  if (uids.length > 0) {
    const { data } = await supabase
      .from("consumed_sessions")
      .select("event_uid, price, consumed_at")
      .in("event_uid", uids);
    for (const row of data ?? []) {
      consumedMap[row.event_uid] = { price: row.price, consumed_at: row.consumed_at };
    }
  }

  // レスポンス用に整形
  const format = (events: typeof gymEvents, trainer: string) =>
    events.map(e => ({
      id:               e.uid,
      customer_name:    e.summary,
      trainer,
      start_at:         e.start.toISOString(),
      duration_minutes: e.durationMinutes,
      consumed:         !!consumedMap[e.uid],
      consumed_at:      consumedMap[e.uid]?.consumed_at ?? null,
      price:            consumedMap[e.uid]?.price ?? null,
    }));

  const bookings = [
    ...format(gymEvents,  "GYM"),
    ...format(gym2Events, "GYM2"),
  ].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return NextResponse.json({ bookings });
}
