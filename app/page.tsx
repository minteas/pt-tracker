"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Check, RotateCcw, Lock } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Booking {
  id: string;
  customer_name: string;
  trainer: "GYM" | "GYM2";
  start_at: string;
  duration_minutes: number;
  consumed: boolean;
  consumed_at: string | null;
  price: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRAINER: Record<string, string> = { GYM: "井尻", GYM2: "高野" };
const GOLD = "#C9A84C";

function toJSTDateStr(d: Date): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d).replace(/\//g, "-");
}

function todayJST() { return toJSTDateStr(new Date()); }

function currentYM(): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit",
  }).format(new Date()).replace("/", "-");
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  d.setDate(d.getDate() + n);
  return toJSTDateStr(d);
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  let nm = m + n, ny = y;
  while (nm > 12) { nm -= 12; ny++; }
  while (nm < 1)  { nm += 12; ny--; }
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function fmtYM(ym: string): string {
  const [y, m] = ym.split("-");
  return `${y}年${parseInt(m)}月`;
}

function fmtDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00+09:00`);
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", month: "long", day: "numeric", weekday: "short",
  }).format(d);
}

function fmtTime(isoStr: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(isoStr));
}

function fmtPrice(n: number): string {
  return `¥${n.toLocaleString("ja-JP")}`;
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const S = {
  page: {
    minHeight: "100vh", background: "#111", color: "#fff",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Hiragino Sans', sans-serif",
    paddingBottom: 40,
  } as React.CSSProperties,

  // Login
  loginWrap: {
    minHeight: "100vh", display: "flex", alignItems: "center",
    justifyContent: "center", background: "#111",
  } as React.CSSProperties,
  loginBox: {
    background: "#1a1a1a", border: `1px solid ${GOLD}33`, borderRadius: 16,
    padding: "40px 32px", width: 320, textAlign: "center" as const,
  } as React.CSSProperties,
  loginTitle: { color: GOLD, fontSize: 22, fontWeight: 700, marginBottom: 8 },
  loginSub:   { color: "#888", fontSize: 13, marginBottom: 28 },
  input: {
    width: "100%", padding: "12px 16px", background: "#222", border: `1px solid #444`,
    borderRadius: 10, color: "#fff", fontSize: 16, outline: "none",
    marginBottom: 12, letterSpacing: 4,
  } as React.CSSProperties,
  loginBtn: {
    width: "100%", padding: "14px 0", background: GOLD, border: "none",
    borderRadius: 10, color: "#111", fontSize: 16, fontWeight: 700, cursor: "pointer",
  } as React.CSSProperties,
  loginErr: { color: "#e55", fontSize: 13, marginTop: 10 },

  // Header
  header: {
    background: "#1a1a1a", borderBottom: `1px solid ${GOLD}33`,
    padding: "16px 20px",
  } as React.CSSProperties,
  appTitle: { color: GOLD, fontSize: 18, fontWeight: 700 },

  // Monthly summary
  summary: {
    background: "#1a1a1a", borderBottom: `1px solid ${GOLD}22`,
    padding: "14px 20px",
  } as React.CSSProperties,
  summaryRow: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } as React.CSSProperties,
  summaryNav: {
    background: "none", border: "none", color: GOLD, cursor: "pointer",
    padding: "2px 6px", fontSize: 18, lineHeight: 1,
  } as React.CSSProperties,
  summaryYM: { color: "#ccc", fontSize: 15, fontWeight: 600, flex: 1, textAlign: "center" as const },
  summaryStats: { display: "flex", gap: 24 } as React.CSSProperties,
  statItem: { textAlign: "center" as const } as React.CSSProperties,
  statVal:  { color: GOLD, fontSize: 22, fontWeight: 700 },
  statLbl:  { color: "#888", fontSize: 11, marginTop: 2 },

  // Date nav
  dateNav: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 20px", background: "#161616",
  } as React.CSSProperties,
  navBtn: {
    background: "none", border: `1px solid ${GOLD}44`, color: GOLD,
    borderRadius: 8, padding: "6px 14px", cursor: "pointer", fontSize: 14,
  } as React.CSSProperties,
  dateLabel: { color: "#ddd", fontSize: 15, fontWeight: 600 },
  todayBtn: {
    background: "none", border: "none", color: GOLD, fontSize: 12,
    cursor: "pointer", padding: "4px 8px",
  } as React.CSSProperties,

  // Trainer section
  trainerSection: { padding: "16px 20px 0" } as React.CSSProperties,
  trainerHeader: {
    display: "flex", alignItems: "center", gap: 8, marginBottom: 10,
  } as React.CSSProperties,
  trainerDot: {
    width: 8, height: 8, borderRadius: "50%", background: GOLD, flexShrink: 0,
  } as React.CSSProperties,
  trainerName: { color: GOLD, fontSize: 14, fontWeight: 700, letterSpacing: 1 },
  trainerCount: { color: "#666", fontSize: 12 },

  // Card
  card: (consumed: boolean): React.CSSProperties => ({
    background: consumed ? "#1a1a0e" : "#1a1a1a",
    border: `1px solid ${consumed ? GOLD + "99" : "#333"}`,
    borderRadius: 12, marginBottom: 10, overflow: "hidden",
    transition: "border-color 0.2s",
  }),
  cardBody: {
    display: "flex", alignItems: "center", padding: "14px 16px", gap: 14,
  } as React.CSSProperties,
  cardLeft: { flex: 1, minWidth: 0 } as React.CSSProperties,
  cardName: {
    fontSize: 16, fontWeight: 600, color: "#fff",
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  cardMeta: { fontSize: 12, color: "#888", marginTop: 3 },
  cardPrice: { fontSize: 13, color: GOLD, marginTop: 3, fontWeight: 600 },

  consumeBtn: (consumed: boolean): React.CSSProperties => ({
    flexShrink: 0,
    width: 52, height: 52, borderRadius: "50%",
    background: consumed ? GOLD : "transparent",
    border: `2px solid ${consumed ? GOLD : "#555"}`,
    color: consumed ? "#111" : "#555",
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", transition: "all 0.2s",
  }),

  undoRow: {
    display: "flex", justifyContent: "flex-end",
    padding: "4px 16px 10px", borderTop: `1px solid ${GOLD}22`,
  } as React.CSSProperties,
  undoBtn: {
    background: "none", border: "none", color: "#888",
    fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4,
  } as React.CSSProperties,

  // Empty state
  empty: { color: "#555", fontSize: 14, textAlign: "center" as const, padding: "32px 0" },

  // Overlay / Modal
  overlay: {
    position: "fixed" as const, inset: 0, background: "#000a", zIndex: 100,
    display: "flex", alignItems: "flex-end",
  } as React.CSSProperties,
  modal: {
    background: "#1a1a1a", borderTop: `2px solid ${GOLD}`,
    borderRadius: "16px 16px 0 0", padding: 28, width: "100%",
  } as React.CSSProperties,
  modalTitle: { color: GOLD, fontSize: 17, fontWeight: 700, marginBottom: 4 },
  modalSub:   { color: "#888", fontSize: 13, marginBottom: 20 },
  priceInput: {
    width: "100%", padding: "14px 16px", background: "#222",
    border: `1px solid ${GOLD}66`, borderRadius: 10, color: "#fff",
    fontSize: 20, textAlign: "center" as const, outline: "none", marginBottom: 16,
  } as React.CSSProperties,
  modalBtnRow: { display: "flex", gap: 10 } as React.CSSProperties,
  cancelBtn: {
    flex: 1, padding: "13px 0", background: "none", border: `1px solid #444`,
    borderRadius: 10, color: "#888", fontSize: 15, cursor: "pointer",
  } as React.CSSProperties,
  confirmBtn: {
    flex: 2, padding: "13px 0", background: GOLD, border: "none",
    borderRadius: 10, color: "#111", fontSize: 15, fontWeight: 700, cursor: "pointer",
  } as React.CSSProperties,
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function TrackerPage() {
  const [password, setPassword] = useState("");
  const [authed,   setAuthed]   = useState(false);
  const [authErr,  setAuthErr]  = useState("");
  const [loading,  setLoading]  = useState(false);

  const [date,     setDate]     = useState(todayJST);
  const [ym,       setYm]       = useState(currentYM);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [prices,   setPrices]   = useState<Record<string, number>>({});
  const [monthly,  setMonthly]  = useState<{ totalCount: number; totalRevenue: number } | null>(null);
  const [dayLoad,  setDayLoad]  = useState(false);

  // Price modal
  const [modal,      setModal]      = useState<Booking | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [saving,     setSaving]     = useState(false);

  // ── API helpers ─────────────────────────────────────────────────────────────

  const hdrs = useCallback((): Record<string, string> => ({
    "Content-Type": "application/json",
    "x-admin-password": password,
  }), [password]);

  const fetchDaily = useCallback(async (d: string) => {
    setDayLoad(true);
    try {
      const r = await fetch(`/api/daily?date=${d}`, { headers: hdrs() });
      const j = await r.json();
      setBookings(j.bookings ?? []);
    } catch { setBookings([]); }
    setDayLoad(false);
  }, [hdrs]);

  const fetchMonthly = useCallback(async (m: string) => {
    try {
      const r = await fetch(`/api/monthly?ym=${m}`, { headers: hdrs() });
      const j = await r.json();
      setMonthly(j);
    } catch { /* silent */ }
  }, [hdrs]);

  const fetchPrices = useCallback(async () => {
    try {
      const r = await fetch("/api/prices", { headers: hdrs() });
      const j = await r.json();
      setPrices(j.prices ?? {});
    } catch { /* silent */ }
  }, [hdrs]);

  // ── Login ────────────────────────────────────────────────────────────────────

  const handleLogin = async () => {
    if (!password.trim()) return;
    setLoading(true);
    setAuthErr("");
    try {
      const r = await fetch(`/api/daily?date=${todayJST()}`, {
        headers: { "x-admin-password": password },
      });
      if (r.status === 401) { setAuthErr("パスワードが違います"); setLoading(false); return; }
      setAuthed(true);
    } catch { setAuthErr("通信エラー"); }
    setLoading(false);
  };

  // ── Data loading ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!authed) return;
    fetchPrices();
    fetchDaily(date);
    fetchMonthly(ym);
  }, [authed]); // eslint-disable-line

  useEffect(() => { if (authed) fetchDaily(date); }, [date, authed]); // eslint-disable-line
  useEffect(() => { if (authed) fetchMonthly(ym); }, [ym, authed]); // eslint-disable-line

  // ── Consume logic ───────────────────────────────────────────────────────────

  const handleTap = (b: Booking) => {
    if (b.consumed) return;
    const known = b.price ?? prices[b.customer_name] ?? null;
    if (known === null) {
      setModal(b);
      setPriceInput("");
    } else {
      doConsume(b, known);
    }
  };

  const doConsume = async (b: Booking, price: number) => {
    const sessionDate = toJSTDateStr(new Date(b.start_at));
    // 即時反映：カードを消す＋月次集計を楽観的更新
    setBookings(prev => prev.filter(bk => bk.id !== b.id));
    setMonthly(prev => prev
      ? { totalCount: prev.totalCount + 1, totalRevenue: prev.totalRevenue + price }
      : prev
    );
    const r = await fetch(`/api/bookings/${encodeURIComponent(b.id)}`, {
      method: "PATCH", headers: hdrs(),
      body: JSON.stringify({
        action: "consume",
        price,
        customer_name: b.customer_name,
        trainer:       b.trainer,
        session_date:  sessionDate,
        start_at:      b.start_at,
      }),
    });
    if (!r.ok) {
      // 失敗したら元に戻す
      setBookings(prev => [...prev, { ...b, consumed: false }].sort((a, c) => a.start_at.localeCompare(c.start_at)));
      setMonthly(prev => prev
        ? { totalCount: prev.totalCount - 1, totalRevenue: prev.totalRevenue - price }
        : prev
      );
    } else {
      fetchMonthly(ym); // バックグラウンドで正確な値を取得
    }
  };

  const doUnconsume = async (id: string) => {
    const r = await fetch(`/api/bookings/${id}`, {
      method: "PATCH", headers: hdrs(),
      body: JSON.stringify({ action: "unconsume" }),
    });
    if (r.ok) {
      setBookings(prev => prev.map(b =>
        b.id === id ? { ...b, consumed: false, consumed_at: null, price: null } : b
      ));
      fetchMonthly(ym);
    }
  };

  const handlePriceConfirm = async () => {
    if (!modal) return;
    const price = parseInt(priceInput.replace(/[^0-9]/g, ""), 10);
    if (isNaN(price) || price < 0) return;
    setSaving(true);
    // Save to customer_prices for future bookings
    await fetch("/api/prices", {
      method: "POST", headers: hdrs(),
      body: JSON.stringify({ customer_name: modal.customer_name, price }),
    });
    setPrices(prev => ({ ...prev, [modal.customer_name]: price }));
    await doConsume(modal, price);
    setSaving(false);
    setModal(null);
  };

  // ── Grouping ────────────────────────────────────────────────────────────────

  const gymBookings  = bookings.filter(b => b.trainer === "GYM");
  const gym2Bookings = bookings.filter(b => b.trainer === "GYM2");

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: Login
  // ─────────────────────────────────────────────────────────────────────────────

  if (!authed) {
    return (
      <div style={S.loginWrap}>
        <div style={S.loginBox}>
          <Lock size={28} color={GOLD} style={{ marginBottom: 12 }} />
          <div style={S.loginTitle}>PT Tracker</div>
          <div style={S.loginSub}>セッション消化管理</div>
          <input
            type="password"
            placeholder="パスワード"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleLogin()}
            style={S.input}
            autoFocus
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            style={{ ...S.loginBtn, opacity: loading ? 0.7 : 1 }}
          >
            {loading ? "確認中..." : "ログイン"}
          </button>
          {authErr && <div style={S.loginErr}>{authErr}</div>}
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Render: Main
  // ─────────────────────────────────────────────────────────────────────────────

  const renderTrainerSection = (name: string, list: Booking[]) => (
    <div style={S.trainerSection} key={name}>
      <div style={S.trainerHeader}>
        <div style={S.trainerDot} />
        <span style={S.trainerName}>{name}</span>
        <span style={S.trainerCount}>{list.length}件</span>
      </div>

      {list.length === 0 ? (
        <div style={S.empty}>この日の予約なし</div>
      ) : (
        list.map(b => (
          <div key={b.id} style={S.card(b.consumed)}>
            <div style={S.cardBody}>
              <div style={S.cardLeft}>
                <div style={S.cardName}>{b.customer_name}</div>
                <div style={S.cardMeta}>
                  {fmtTime(b.start_at)}〜 ({b.duration_minutes}分)
                </div>
                {b.consumed && b.price != null && (
                  <div style={S.cardPrice}>{fmtPrice(b.price)}</div>
                )}
              </div>
              <button
                style={S.consumeBtn(b.consumed)}
                onClick={() => !b.consumed && handleTap(b)}
                aria-label={b.consumed ? "消化済み" : "消化する"}
              >
                <Check size={22} strokeWidth={3} />
              </button>
            </div>
            {b.consumed && (
              <div style={S.undoRow}>
                <button style={S.undoBtn} onClick={() => doUnconsume(b.id)}>
                  <RotateCcw size={12} /> 取り消し
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <div style={S.appTitle}>PT Tracker</div>
      </div>

      {/* Monthly summary */}
      <div style={S.summary}>
        <div style={S.summaryRow}>
          <button style={S.summaryNav} onClick={() => setYm(y => addMonths(y, -1))}>‹</button>
          <div style={S.summaryYM}>{fmtYM(ym)}</div>
          <button style={S.summaryNav} onClick={() => setYm(y => addMonths(y, 1))}>›</button>
        </div>
        <div style={S.summaryStats}>
          <div style={S.statItem}>
            <div style={S.statVal}>{monthly?.totalCount ?? "—"}</div>
            <div style={S.statLbl}>消化セッション</div>
          </div>
          <div style={S.statItem}>
            <div style={S.statVal}>
              {monthly?.totalRevenue != null ? fmtPrice(monthly.totalRevenue) : "—"}
            </div>
            <div style={S.statLbl}>消化金額</div>
          </div>
        </div>
      </div>

      {/* Date navigation */}
      <div style={S.dateNav}>
        <button style={S.navBtn} onClick={() => setDate(d => addDays(d, -1))}>
          <ChevronLeft size={16} style={{ verticalAlign: "middle" }} /> 前日
        </button>
        <div style={{ textAlign: "center" }}>
          <div style={S.dateLabel}>{fmtDate(date)}</div>
          {date !== todayJST() && (
            <button style={S.todayBtn} onClick={() => setDate(todayJST())}>今日に戻る</button>
          )}
        </div>
        <button style={S.navBtn} onClick={() => setDate(d => addDays(d, 1))}>
          翌日 <ChevronRight size={16} style={{ verticalAlign: "middle" }} />
        </button>
      </div>

      {/* Loading */}
      {dayLoad && (
        <div style={{ color: "#555", textAlign: "center", padding: 24, fontSize: 13 }}>
          読み込み中...
        </div>
      )}

      {/* Bookings by trainer */}
      {!dayLoad && (
        <>
          {renderTrainerSection(TRAINER.GYM,  gymBookings)}
          {bookings.length > 0 && <div style={{ height: 1, background: "#2a2a2a", margin: "8px 20px" }} />}
          {renderTrainerSection(TRAINER.GYM2, gym2Bookings)}
        </>
      )}

      {/* Price modal */}
      {modal && (
        <div style={S.overlay} onClick={() => !saving && setModal(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={S.modalTitle}>{modal.customer_name}</div>
            <div style={S.modalSub}>単価を入力してください（この顧客の初回）</div>
            <input
              type="number"
              inputMode="numeric"
              placeholder="例: 8000"
              value={priceInput}
              onChange={e => setPriceInput(e.target.value)}
              style={S.priceInput}
              autoFocus
            />
            <div style={S.modalBtnRow}>
              <button style={S.cancelBtn} onClick={() => setModal(null)} disabled={saving}>
                キャンセル
              </button>
              <button
                style={{ ...S.confirmBtn, opacity: saving ? 0.7 : 1 }}
                onClick={handlePriceConfirm}
                disabled={saving || !priceInput}
              >
                {saving ? "保存中..." : "消化する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
