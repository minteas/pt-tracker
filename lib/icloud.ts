/**
 * lib/icloud.ts
 *
 * iCloud CalDAV への接続・カレンダー情報取得ユーティリティ
 *
 * 【プライバシー設計】
 * お客様には「空き時間」のみ見せる設計のため、
 * イベントから取得するのは start（開始）と end（終了）だけ。
 * タイトル・メモ等は一切取り込まない。
 */

import { RRule, RRuleSet } from "rrule";

const CALDAV_HOST = "https://caldav.icloud.com";

// ─────────────────────────────────────────
// 共通ユーティリティ
// ─────────────────────────────────────────

/** Basic認証ヘッダーを生成する（関数内で env を読む） */
function buildAuthHeader(): string {
  const id = process.env.APPLE_ID;
  const pw = process.env.APPLE_APP_PASSWORD;
  if (!id || !pw) {
    throw new Error(
      `環境変数が未設定です。\nAPPLE_ID="${id}", APPLE_APP_PASSWORD="${pw ? "(設定済み)" : "(未設定)"}"`
    );
  }
  return "Basic " + Buffer.from(`${id}:${pw}`).toString("base64");
}

/** PROPFIND リクエストを送信してXMLを返す */
async function propfind(url: string, depth: string, body: string): Promise<string> {
  const fullUrl = url.startsWith("http") ? url : `${CALDAV_HOST}${url}`;

  const res = await fetch(fullUrl, {
    method: "PROPFIND",
    headers: {
      Authorization: buildAuthHeader(),
      "Content-Type": "application/xml; charset=utf-8",
      "Depth": depth,
      "User-Agent": "CalDAVClient/1.0",
    },
    body,
    redirect: "follow",
  });

  const text = await res.text();
  if (res.status !== 207 && !res.ok) {
    throw new Error(`PROPFINDエラー (${res.status}): ${fullUrl}\n${text.substring(0, 300)}`);
  }
  return text;
}

/**
 * REPORT リクエストを送信してXMLを返す
 *
 * REPORT とは：
 *   CalDAV で「指定した条件のイベントデータをください」と問い合わせる特殊なHTTPメソッド。
 *   PROPFINDがプロパティ情報を取るのに対し、REPORTはイベントの中身（iCal形式）を取得する。
 */
async function report(url: string, body: string): Promise<string> {
  const res = await fetch(url, {
    method: "REPORT",
    headers: {
      Authorization: buildAuthHeader(),
      "Content-Type": "application/xml; charset=utf-8",
      "Depth": "1",
      "User-Agent": "CalDAVClient/1.0",
    },
    body,
    redirect: "follow",
  });

  const text = await res.text();
  if (res.status !== 207 && !res.ok) {
    throw new Error(`REPORTエラー (${res.status}): ${url}\n${text.substring(0, 300)}`);
  }
  return text;
}

/** XMLから指定タグ内の <href> 値を抽出する */
function extractHref(xml: string, parentTag: string): string | null {
  const regex = new RegExp(
    `<[\\w-]*:?${parentTag}[^>]*>[\\s\\S]*?<[\\w-]*:?href[^>]*>([^<]+)<\\/[\\w-]*:?href>`,
    "i"
  );
  const m = xml.match(regex);
  return m ? m[1].trim() : null;
}

// ─────────────────────────────────────────
// カレンダー接続（カレンダー一覧取得）
// ─────────────────────────────────────────

export interface Calendar {
  displayName: string;
  url: string;
}

/** iCloudのCalDAVサーバーに接続してカレンダー一覧を返す */
export async function fetchCalendars(): Promise<Calendar[]> {
  // Step 1: principal URL取得
  const xml1 = await propfind(
    `${CALDAV_HOST}/`,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:current-user-principal/></d:prop></d:propfind>`
  );
  const principalUrl = extractHref(xml1, "current-user-principal");
  if (!principalUrl) throw new Error("principal URLが取得できませんでした");

  // Step 2: calendar-home-set URL取得
  const fullPrincipalUrl = principalUrl.startsWith("http")
    ? principalUrl
    : `${CALDAV_HOST}${principalUrl}`;
  const xml2 = await propfind(
    fullPrincipalUrl,
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`
  );
  const homeUrl = extractHref(xml2, "calendar-home-set");
  if (!homeUrl) throw new Error("calendar-home-set URLが取得できませんでした");

  // Step 3: カレンダー一覧取得
  const fullHomeUrl = homeUrl.startsWith("http") ? homeUrl : `${CALDAV_HOST}${homeUrl}`;
  const xml3 = await propfind(
    fullHomeUrl,
    "1",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:cs="http://calendarserver.org/ns/" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/></d:prop></d:propfind>`
  );

  const blocks = xml3.match(/<[^:]*:?response[\s\S]*?<\/[^:]*:?response>/gi) ?? [];
  const calendars: Calendar[] = [];
  for (const block of blocks) {
    if (!/calendar/i.test(block)) continue;
    const hrefMatch = block.match(/<[^:]*:?href>([^<]+)<\/[^:]*:?href>/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1].trim();
    if (url.endsWith("/calendars/")) continue;
    const nameMatch = block.match(/<[^:]*:?displayname[^>]*>([^<]*)<\/[^:]*:?displayname>/i);
    calendars.push({ url, displayName: nameMatch?.[1].trim() || "(名前なし)" });
  }
  return calendars;
}

// ─────────────────────────────────────────
// イベント取得（空き枠計算用）
// ─────────────────────────────────────────

/**
 * イベントの開始・終了時刻のみを表すデータ型
 *
 * 【プライバシー設計】
 * タイトル・参加者・メモ等は一切含めない。
 * 空き枠計算に必要な start と end だけ持つ。
 */
export interface BusySlot {
  start: Date;
  end: Date;
}

/**
 * iCal形式の日時文字列を Date オブジェクトに変換する
 *
 * iCalの日時形式（例）:
 *   "20260616T083000Z"                     → UTC指定（末尾Z）
 *   "DTSTART;TZID=Asia/Tokyo:20260616T083000" → タイムゾーン付き
 *   "20260616"                              → 終日イベント
 *
 * 【注意】
 * new Date("2026-06-16T08:30:00") は実行環境のローカルタイムで解釈される。
 * iCloudの予定は TZID=Asia/Tokyo で保存されているため、
 * "+09:00" を付けて明示的にJSTとして解釈させる。
 * こうすることで Date オブジェクトは常に正確なUTC値を持つ。
 */
function parseICalDate(dtStr: string, tzid?: string): Date {
  // 終日イベント（YYYYMMDD形式）→ JST 0:00 として扱う
  if (dtStr.length === 8) {
    return new Date(
      `${dtStr.slice(0, 4)}-${dtStr.slice(4, 6)}-${dtStr.slice(6, 8)}T00:00:00+09:00`
    );
  }

  // "20260616T083000" → "2026-06-16T08:30:00" に変換
  const iso =
    `${dtStr.slice(0, 4)}-${dtStr.slice(4, 6)}-${dtStr.slice(6, 8)}` +
    `T${dtStr.slice(9, 11)}:${dtStr.slice(11, 13)}:${dtStr.slice(13, 15)}`;

  // UTC指定（末尾Z）
  if (dtStr.endsWith("Z")) {
    return new Date(iso + "Z");
  }

  // TZID付き → JST（+09:00）として明示的に解釈
  // new Date("...+09:00") はJSがJST→UTCに正しく変換する
  if (tzid) {
    return new Date(iso + "+09:00");
  }

  // タイムゾーン不明 → UTC として扱う（安全側に倒す）
  return new Date(iso + "Z");
}

/**
 * Date を rrule 用の UTC 文字列に変換する（"YYYYMMDDTHHMMSSZ" 形式）
 */
function toRRuleUTCString(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * real UTC → fake UTC（+9h）
 * between() の範囲指定に使う: JST 壁時計範囲を naive UTC として表現する
 */
function toFakeUTC(realUTC: Date): Date {
  return new Date(realUTC.getTime() + JST_OFFSET_MS);
}

/**
 * fake UTC → real UTC（-9h）
 * rrule が返した naive occurrences を本物の UTC に戻す
 */
function fromFakeUTC(fakeUTC: Date): Date {
  return new Date(fakeUTC.getTime() - JST_OFFSET_MS);
}

/**
 * iCal の DTSTART 生値（val）から「naive JST 壁時計」を Date.UTC() で作る。
 *
 * 【なぜ naive か】
 * rrule は UTC Date を受け取り、BYDAY など曜日指定を UTC 基準で評価する。
 * JST（UTC+9）の 火曜08:00 は UTC では 月曜23:00 になるため、
 * parseICalDate() が返す本物の UTC をそのまま渡すと曜日が1日ずれる。
 *
 * 解決策：DTSTART の年月日時分秒を「そのまま」Date.UTC() で Date 化する。
 * これにより rrule は JST 壁時計の曜日で正しく展開する。
 * 結果を fromFakeUTC() で本物の UTC に戻せば完成。
 *
 * - TZID=Asia/Tokyo / floating → 壁時計をそのまま naive UTC に
 * - UTC (末尾 Z)               → +9h して JST 壁時計に直してから naive UTC に
 */
function toNaiveJST(val: string, tzid?: string): Date {
  // 終日イベント（YYYYMMDD）
  if (val.length === 8) {
    return new Date(Date.UTC(
      parseInt(val.slice(0, 4)),
      parseInt(val.slice(4, 6)) - 1,
      parseInt(val.slice(6, 8)),
      0, 0, 0
    ));
  }

  const y   = parseInt(val.slice(0, 4));
  const mo  = parseInt(val.slice(4, 6)) - 1;
  const d   = parseInt(val.slice(6, 8));
  const h   = parseInt(val.slice(9, 11));
  const min = parseInt(val.slice(11, 13));
  const s   = val.length >= 15 ? parseInt(val.slice(13, 15)) : 0;

  if (val.endsWith("Z")) {
    // UTC → JST壁時計（+9h）→ naive UTC として Date 化
    const utcMs = Date.UTC(y, mo, d, h, min, s);
    return new Date(utcMs + JST_OFFSET_MS);
  }

  // TZID=Asia/Tokyo または floating → 壁時計をそのまま naive UTC として Date 化
  return new Date(Date.UTC(y, mo, d, h, min, s));
}

/**
 * iCal の DTSTART/DTEND プロパティ行から TZID と値文字列を抽出する
 *
 * 対応形式:
 *   DTSTART;TZID=Asia/Tokyo:20260616T080000  → { tzid: "Asia/Tokyo", val: "20260616T080000" }
 *   DTSTART;VALUE=DATE:20260616              → { tzid: undefined,    val: "20260616" }
 *   DTSTART:20260616T080000Z                 → { tzid: undefined,    val: "20260616T080000Z" }
 */
function extractDtProp(
  block: string,
  propName: "DTSTART" | "DTEND"
): { tzid: string | undefined; val: string } | null {
  // TZID付き
  const tzidMatch = block.match(
    new RegExp(`${propName};TZID=([^:]+):([^\\r\\n]+)`)
  );
  if (tzidMatch) return { tzid: tzidMatch[1], val: tzidMatch[2].trim() };

  // VALUE=DATE または素の形式
  const plainMatch = block.match(
    new RegExp(`${propName}(?:;[^:]*)?:([^\\r\\n]+)`)
  );
  if (plainMatch) return { tzid: undefined, val: plainMatch[1].trim() };

  return null;
}

/**
 * iCal形式テキストからDTSTARTとDTENDを抽出して BusySlot[] を返す
 *
 * 【繰り返し予定（RRULE）の扱い】
 * RRULE がある場合は rrule ライブラリで展開し、
 * 取得期間（from〜to）内に発生する全回をブロック枠として登録する。
 * EXDATE（除外日）も正しく処理する。
 *
 * 【なぜタイトルを取らないか】
 * お客様画面では「空き時間」のみ表示するため、
 * 予約者名などのプライバシー情報は不要かつ取り込むべきでない。
 */
function parseICalToBusySlots(
  icalText: string,
  from: Date,
  to: Date
): BusySlot[] {
  const slots: BusySlot[] = [];

  // VEVENT ブロックを1件ずつ処理
  const eventBlocks = icalText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];

  for (const block of eventBlocks) {
    try {
      // ── DTSTART / DTEND を抽出 ────────────────────────────────────
      const startProp = extractDtProp(block, "DTSTART");
      const endProp   = extractDtProp(block, "DTEND");
      if (!startProp || !endProp) continue;

      const startDate = parseICalDate(startProp.val, startProp.tzid);
      const endDate   = parseICalDate(endProp.val,   endProp.tzid);
      const durationMs = endDate.getTime() - startDate.getTime();

      // ── RRULE なし → 単発イベントとして1件 push ────────────────────
      if (!/^RRULE:/m.test(block)) {
        slots.push({ start: startDate, end: endDate });
        continue;
      }

      // ── RRULE あり → rrule ライブラリで期間内の全回を展開 ──────────
      const rruleLineMatch = block.match(/^RRULE:([^\r\n]+)/m);
      if (!rruleLineMatch) continue;

      const rruleSet = new RRuleSet();

      // RRule を構築
      // 【重要】dtstart は DTSTART 生値から直接 naive JST を作って渡す。
      // parseICalDate() は本物の UTC を返すため、BYDAY の曜日評価がずれる。
      // toNaiveJST() は年月日時分秒をそのまま "UTC" の Date として扱うので
      // rrule が正しい曜日・時刻で展開する。
      // 例: 火曜08:00 JST (TZID=Asia/Tokyo:20240305T080000)
      //     → naive: new Date(Date.UTC(2024,2,5,8,0,0)) = "火曜08:00Z"  ✓
      const naiveStart = toNaiveJST(startProp.val, startProp.tzid);
      const rule = RRule.fromString(
        `DTSTART:${toRRuleUTCString(naiveStart)}\nRRULE:${rruleLineMatch[1].trim()}`
      );
      rruleSet.rrule(rule);

      // EXDATE（除外日）を全て naive JST に変換して登録する
      // 形式例:
      //   EXDATE;TZID=Asia/Tokyo:20240318T080000
      //   EXDATE;TZID=Asia/Tokyo:20240318T080000,20240325T080000
      //   EXDATE:20240318T080000Z
      const exdateMatches = [
        ...block.matchAll(/^EXDATE(?:;TZID=([^:]+))?(?:;[^:]*)?:([^\r\n]+)/gm),
      ];
      for (const m of exdateMatches) {
        const exTzid = m[1]; // TZID（なければ undefined）
        const exVals = m[2].split(",");
        for (const exVal of exVals) {
          try {
            rruleSet.exdate(toNaiveJST(exVal.trim(), exTzid));
          } catch {
            // 無視
          }
        }
      }

      // 取得期間内に発生する全回の開始時刻を取得
      // between() の範囲も naive JST（= toFakeUTC）で渡す
      const naiveFrom = toFakeUTC(from);
      const naiveTo   = toFakeUTC(to);
      const naiveOccs = rruleSet.between(naiveFrom, naiveTo, true);

      // naive JST → 本物の UTC に戻してから push
      for (const naiveOcc of naiveOccs) {
        const realStart = fromFakeUTC(naiveOcc);
        slots.push({
          start: realStart,
          end:   new Date(realStart.getTime() + durationMs),
        });
      }
    } catch {
      // 1件のパースエラーで全体を止めない
    }
  }

  return slots;
}

/**
 * 指定カレンダーの指定期間内のイベント（開始・終了時刻のみ）を取得する
 *
 * @param calendarUrl  カレンダーのフルURL（例: https://p66-caldav.icloud.com:443/8144009294/calendars/xxx/）
 * @param from         取得開始日時
 * @param to           取得終了日時
 * @returns            BusySlot[] = 埋まっている時間帯の配列
 */
export async function fetchBusySlots(
  calendarUrl: string,
  from: Date,
  to: Date
): Promise<BusySlot[]> {
  // iCalの日時形式（UTC）に変換するヘルパー
  const toICalUtc = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  // REPORT リクエスト（calendar-query）で期間指定イベントを取得
  // ※ calendar-data のフィールド制限をしない → RRULEも含む完全データを取得
  //   フィールドを絞ると繰り返し予定のマスターイベントが混入することがある
  const xml = await report(
    calendarUrl,
    `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toICalUtc(from)}" end="${toICalUtc(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
  );

  // XMLの中にある calendar-data（iCal形式テキスト）をすべて取り出してパース
  const icalBlocks = xml.match(/<[^:]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:]*:?calendar-data>/gi) ?? [];
  const slots: BusySlot[] = [];

  for (const block of icalBlocks) {
    // タグを除去してiCalテキストだけ取り出す
    const icalText = block
      .replace(/<[^:]*:?calendar-data[^>]*>/i, "")
      .replace(/<\/[^:]*:?calendar-data>/i, "")
      .trim();

    slots.push(...parseICalToBusySlots(icalText, from, to));
  }

  // iCloudが範囲外のイベントを返すことがあるので、明示的に日付範囲でフィルター
  // 【重要】 s.start >= from ではなく s.end > from にする理由:
  //   from（= "今"）より前に始まった予約でも、終了が from より後なら
  //   まだ進行中の予約なので除外してはいけない。
  //   例: 12:00〜13:00の予約があり now=13:01 なら除外してOKだが、
  //       12:00〜15:00 なら now=13:01 でもまだ"埋まっている"ので残す必要がある。
  return slots.filter((s) => s.end > from && s.start < to);
}

// ─────────────────────────────────────────
// イベント取得（トラッカー用：名前・UID付き）
// ─────────────────────────────────────────

/**
 * トラッカー用イベント（名前・UIDを含む）
 */
export interface CalendarEvent {
  uid: string;            // "base_uid__YYYYMMDD" 形式（繰り返しイベントも一意）
  summary: string;        // 予約者名
  start: Date;
  end: Date;
  durationMinutes: number;
}

/** JST 日付文字列 "YYYYMMDD" を生成する */
function toJSTDateStr(d: Date): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const y   = jst.getUTCFullYear();
  const m   = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** iCal テキストから CalendarEvent[] を抽出する（トラッカー用） */
function parseICalToEvents(
  icalText: string,
  from: Date,
  to: Date
): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const eventBlocks = icalText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) ?? [];

  for (const block of eventBlocks) {
    try {
      const uidMatch     = block.match(/^UID:([^\r\n]+)/m);
      const summaryMatch = block.match(/^SUMMARY:([^\r\n]+)/m);
      const startProp    = extractDtProp(block, "DTSTART");
      const endProp      = extractDtProp(block, "DTEND");

      if (!startProp) continue;

      const baseUid = uidMatch?.[1].trim()    ?? "";
      const summary = summaryMatch?.[1].trim() ?? "(無題)";

      const startDate = parseICalDate(startProp.val, startProp.tzid);
      let endDate: Date;
      if (endProp) {
        endDate = parseICalDate(endProp.val, endProp.tzid);
      } else {
        const durMatch = block.match(/^DURATION:PT?(\d+)H(?:(\d+)M)?/im);
        if (durMatch) {
          endDate = new Date(
            startDate.getTime() +
            parseInt(durMatch[1]) * 3600000 +
            parseInt(durMatch[2] ?? "0") * 60000
          );
        } else {
          endDate = new Date(startDate.getTime() + 3600000);
        }
      }

      const durationMs      = endDate.getTime() - startDate.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      // ── RRULE なし → 単発イベント ─────────────────────────────────
      if (!/^RRULE:/m.test(block)) {
        if (startDate < to && endDate > from) {
          events.push({
            uid: `${baseUid}__${toJSTDateStr(startDate)}`,
            summary,
            start: startDate,
            end:   endDate,
            durationMinutes,
          });
        }
        continue;
      }

      // ── RRULE あり → rrule で展開 ────────────────────────────────
      const rruleLineMatch = block.match(/^RRULE:([^\r\n]+)/m);
      if (!rruleLineMatch) continue;

      const rruleSet   = new RRuleSet();
      const naiveStart = toNaiveJST(startProp.val, startProp.tzid);
      const rule       = RRule.fromString(
        `DTSTART:${toRRuleUTCString(naiveStart)}\nRRULE:${rruleLineMatch[1].trim()}`
      );
      rruleSet.rrule(rule);

      const exdateMatches = [
        ...block.matchAll(/^EXDATE(?:;TZID=([^:]+))?(?:;[^:]*)?:([^\r\n]+)/gm),
      ];
      for (const m of exdateMatches) {
        const exTzid = m[1];
        for (const exVal of m[2].split(",")) {
          try { rruleSet.exdate(toNaiveJST(exVal.trim(), exTzid)); } catch { /* skip */ }
        }
      }

      const naiveOccs = rruleSet.between(toFakeUTC(from), toFakeUTC(to), true);
      for (const naiveOcc of naiveOccs) {
        const realStart = fromFakeUTC(naiveOcc);
        const realEnd   = new Date(realStart.getTime() + durationMs);
        events.push({
          uid: `${baseUid}__${toJSTDateStr(realStart)}`,
          summary,
          start: realStart,
          end:   realEnd,
          durationMinutes,
        });
      }
    } catch {
      // 1件のパースエラーで全体を止めない
    }
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * 指定カレンダーの指定期間内のイベント（名前・UID付き）を取得する（トラッカー用）
 */
export async function fetchEvents(
  calendarUrl: string,
  from: Date,
  to: Date
): Promise<CalendarEvent[]> {
  const toICalUtc = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const xml = await report(
    calendarUrl,
    `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag/>
    <c:calendar-data/>
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toICalUtc(from)}" end="${toICalUtc(to)}"/>
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`
  );

  const icalBlocks = xml.match(/<[^:]*:?calendar-data[^>]*>([\s\S]*?)<\/[^:]*:?calendar-data>/gi) ?? [];
  const events: CalendarEvent[] = [];

  for (const block of icalBlocks) {
    const icalText = block
      .replace(/<[^:]*:?calendar-data[^>]*>/i, "")
      .replace(/<\/[^:]*:?calendar-data>/i, "")
      .trim();
    events.push(...parseICalToEvents(icalText, from, to));
  }

  return events
    .filter(e => e.start < to && e.end > from)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
