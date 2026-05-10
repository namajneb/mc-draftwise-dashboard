import { useState, useCallback, useEffect } from "react";

const C = {
  white:     "#FFFFFF",
  offWhite:  "#f0f2f5",
  lightGrey: "#b2b2b2",
  grey:      "#666666",
  green:     "#0ea97a",
  greenDim:  "#0ea97a18",
  black:     "#000000",
  charcoal:  "#0c0c0c",
  surface:   "#111111",
  border:    "#1e1e1e",
  gold:      "#ffab40",
  red:       "#e05252",
  redDim:    "#e0525218",
  blue:      "#579ed1",
};

async function hrFetch(path, body) {
  const res = await fetch(`/api/heyreach?path=${encodeURIComponent(path)}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || JSON.stringify(json));
  return json;
}

function getDateRange(days) {
  const end   = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days + 1);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function timeSince(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmt(n) {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return Math.round(n).toString();
}
function fmtPct(n) {
  if (n == null || isNaN(n)) return "—";
  return parseFloat(n).toFixed(1) + "%";
}

function statusColor(status) {
  if (status === "ACTIVE" || status === "IN_PROGRESS") return C.green;
  if (status === "PAUSED") return C.gold;
  if (status === "DRAFT") return C.grey;
  return C.lightGrey;
}

function StatusBadge({ status }) {
  const color = statusColor(status);
  const label = status === "IN_PROGRESS" ? "Running" : status?.charAt(0) + status?.slice(1).toLowerCase();
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, color,
      background: color + "18", border: `1px solid ${color}33`,
      padding: "2px 8px", borderRadius: 20, fontFamily: "'Inter', sans-serif",
      whiteSpace: "nowrap",
    }}>● {label}</span>
  );
}

function SummaryBar({ stats }) {
  const s = stats || {};
  const cards = [
    { label: "Conn. Requests",  value: fmt(s.connection_requests_sent), accent: C.green },
    { label: "Accepted",        value: fmt(s.connections),               accent: C.green },
    { label: "Acceptance Rate", value: fmtPct(s.acceptance_rate),        accent: C.green },
    { label: "Messages Sent",   value: fmt(s.messagesSent),              accent: C.blue },
    { label: "Replies",         value: fmt(s.replies),                   accent: C.blue },
    { label: "Reply Rate",      value: fmtPct(s.reply_rate),             accent: C.blue },
  ];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} style={{
          flex: "1 1 100px", background: C.charcoal, borderRadius: 10,
          padding: "14px 18px", border: `1px solid ${C.border}`,
          borderTop: `3px solid ${c.accent}`,
        }}>
          <div style={{ fontSize: 10, color: C.lightGrey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{c.label}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

function CampaignTable({ campaigns }) {
  if (!campaigns.length) return null;

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "2fr 100px 90px 80px 80px 80px 80px 80px",
        gap: 0, background: C.charcoal,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px",
      }}>
        {["Campaign", "Status", "Requests", "Accepted", "Acc. Rate", "Messages", "Replies", "Reply Rate"].map(h => (
          <div key={h} style={{ fontSize: 10, color: C.grey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
        ))}
      </div>

      {campaigns.map((c, i) => {
        const s = c.stats || {};
        return (
          <div key={c.id} style={{
            display: "grid",
            gridTemplateColumns: "2fr 100px 90px 80px 80px 80px 80px 80px",
            gap: 0, padding: "14px 20px", alignItems: "center",
            borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none",
            background: i % 2 === 0 ? C.charcoal : C.surface,
          }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif", paddingRight: 16, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
            <div><StatusBadge status={c.status} /></div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{fmt(s.connection_requests_sent)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{fmt(s.connections)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: s.acceptance_rate > 30 ? C.green : s.acceptance_rate > 15 ? C.gold : C.lightGrey, fontFamily: "'Inter', sans-serif" }}>{fmtPct(s.acceptance_rate)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{fmt(s.messagesSent)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{fmt(s.replies)}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: s.reply_rate > 20 ? C.green : s.reply_rate > 10 ? C.gold : C.lightGrey, fontFamily: "'Inter', sans-serif" }}>{fmtPct(s.reply_rate)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default function HeyReachDashboard() {
  const [overallStats, setOverallStats]   = useState(null);
  const [campaigns, setCampaigns]         = useState([]);
  const [days, setDays]                   = useState(30);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [syncing, setSyncing]             = useState(false);

  const loadData = useCallback(async (daysN) => {
    setLoading(true); setError(null);
    try {
      const range = getDateRange(daysN);

      // Fetch campaigns and overall stats in parallel
      const [campaignRes, overallRes] = await Promise.all([
        hrFetch("/campaign/GetAll", { offset: 0, limit: 50 }),
        hrFetch("/stats/GetOverallStats", { ...range }),
      ]);

      const rawCampaigns = campaignRes.campaigns || campaignRes.items || campaignRes || [];
      setOverallStats(overallRes.overallStats || overallRes);

      // Fetch per-campaign stats in parallel
      const campaignsWithStats = await Promise.all(
        rawCampaigns.map(async (c) => {
          try {
            const statsRes = await hrFetch("/stats/GetOverallStats", {
              campaignIds: [c.id],
              ...range,
            });
            return { ...c, stats: statsRes.overallStats || statsRes };
          } catch {
            return { ...c, stats: {} };
          }
        })
      );

      setCampaigns(campaignsWithStats);
      setLastUpdated(new Date().toISOString());
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadData(days); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDaySwitch = (d) => { setDays(d); loadData(d); };

  const handleRefresh = async () => {
    setSyncing(true);
    try { await loadData(days); }
    catch (e) { setError(e.message); }
    finally { setSyncing(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.black, fontFamily: "'Inter', sans-serif" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } button { font-family: 'Inter', sans-serif; }`}</style>

      {/* Controls Bar */}
      <div style={{ background: C.black, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, gap: 16, flexWrap: "wrap", borderBottom: `1px solid #1a1a1a` }}>
        <span style={{ color: C.white, fontWeight: 700, fontSize: 14, letterSpacing: "0.01em" }}>HeyReach Outreach</span>

        <div style={{ display: "flex", gap: 3 }}>
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => handleDaySwitch(d)} style={{
              padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
              background: days === d ? C.green : "transparent",
              color: days === d ? C.white : C.grey,
              fontSize: 11, transition: "all 0.15s",
            }}>{d}d</button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastUpdated && !syncing && <span style={{ fontSize: 10, color: C.grey, fontFamily: "'Inter', sans-serif" }}>Synced {timeSince(lastUpdated)}</span>}
          <button onClick={handleRefresh} disabled={syncing} style={{
            padding: "4px 10px", borderRadius: 5, border: `1px solid ${C.border}`,
            background: "transparent", color: C.grey, cursor: syncing ? "default" : "pointer",
            fontSize: 11, transition: "color 0.15s", opacity: syncing ? 0.5 : 1,
          }}
          onMouseEnter={e => { if (!syncing) e.currentTarget.style.color = C.lightGrey; }}
          onMouseLeave={e => e.currentTarget.style.color = C.grey}
          >{syncing ? "Syncing…" : "↻ Refresh"}</button>
        </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "24px 32px" }}>
        {error && (
          <div style={{ background: C.charcoal, border: `1px solid ${C.red}44`, borderRadius: 10, padding: "18px 22px", marginBottom: 20, display: "flex", gap: 14, alignItems: "flex-start" }}>
            <span style={{ fontSize: 18 }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: C.red, marginBottom: 4, fontSize: 14 }}>API Error</div>
              <div style={{ fontSize: 12, color: C.lightGrey }}>{error}</div>
            </div>
            <button onClick={() => loadData(days)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: C.red, color: C.white, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Retry</button>
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.green, animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 12, color: C.lightGrey }}>Fetching from HeyReach…</div>
          </div>
        )}

        {!loading && !error && (
          <>
            {overallStats && (
              <>
                <div style={{ fontSize: 11, color: C.grey, marginBottom: 16 }}>Last {days} days · {campaigns.length} campaigns</div>
                <SummaryBar stats={overallStats} />
              </>
            )}

            {campaigns.length > 0 && (
              <>
                <div style={{ fontSize: 10, fontWeight: 600, color: C.lightGrey, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 12 }}>Campaigns</div>
                <CampaignTable campaigns={campaigns} />
              </>
            )}

            {!overallStats && campaigns.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: C.lightGrey, fontSize: 13 }}>
                No data found for the selected date range.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
