import { useState, useCallback, useEffect } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";

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

async function hrFetch(path, body, internal = false) {
  const qs = `/api/heyreach?path=${encodeURIComponent(path)}${internal ? "&internal=1" : ""}`;
  const res = await fetch(qs, {
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
  const acceptRate = s.connectionAcceptanceRate != null ? s.connectionAcceptanceRate * 100 : null;
  const replyRate  = s.messageReplyRate != null ? s.messageReplyRate * 100 : null;
  const cards = [
    { label: "Conn. Requests",  value: fmt(s.connectionsSent),    accent: C.green },
    { label: "Accepted",        value: fmt(s.connectionsAccepted), accent: C.green },
    { label: "Acceptance Rate", value: fmtPct(acceptRate),         accent: C.green },
    { label: "Messages Sent",   value: fmt(s.messagesSent),        accent: C.blue },
    { label: "Replies",         value: fmt(s.totalMessageReplies), accent: C.blue },
    { label: "Reply Rate",      value: fmtPct(replyRate),          accent: C.blue },
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

// Columns as data, so the wide grid and the stacked cards below render from one
// definition instead of drifting apart. `render` returns the value node; the
// campaign name is handled separately since it titles the stacked card.
const HR_COLS = [
  { label: "Status",     render: c => <StatusBadge status={c.status} /> },
  { label: "Requests",   render: (c, s) => <Stat>{fmt(s.connectionsSent)}</Stat> },
  { label: "Accepted",   render: (c, s) => <Stat>{fmt(s.connectionsAccepted)}</Stat> },
  { label: "Acc. Rate",  render: (c, s) => {
      const v = s.connectionAcceptanceRate != null ? s.connectionAcceptanceRate * 100 : null;
      return <Stat color={v > 30 ? C.green : v > 15 ? C.gold : C.lightGrey}>{fmtPct(v)}</Stat>;
    } },
  { label: "Messages",   render: (c, s) => <Stat>{fmt(s.messagesSent)}</Stat> },
  { label: "Replies",    render: (c, s) => <Stat>{fmt(s.totalMessageReplies)}</Stat> },
  { label: "Reply Rate", render: (c, s) => {
      const v = s.messageReplyRate != null ? s.messageReplyRate * 100 : null;
      return <Stat color={v > 20 ? C.green : v > 10 ? C.gold : C.lightGrey}>{fmtPct(v)}</Stat>;
    } },
];

function Stat({ children, color }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: color || C.offWhite, fontFamily: "'Inter', sans-serif" }}>
      {children}
    </div>
  );
}

// The eight fixed columns total ~590px of hard widths plus a 2fr name column and
// 40px of padding, so below this they stack rather than overflow.
const HR_STACK_AT = 900;

function CampaignName({ c, showDisconnected }) {
  return (
    <>
      <div style={{ fontSize: 13, fontWeight: 600, color: C.offWhite, fontFamily: "'Inter', sans-serif", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
      {showDisconnected && (
        <div style={{ fontSize: 9, color: C.red, fontFamily: "'Inter', sans-serif", letterSpacing: "0.08em", marginTop: 2 }}>SENDER DISCONNECTED</div>
      )}
    </>
  );
}

const hrDisconnected = c => {
  const s = c.stats || {};
  const finished = c.status === "FINISHED" || c.status === "COMPLETED";
  return finished && !c.campaignAccountIds?.length && !s.connectionsSent && !s.messagesSent;
};

function CampaignTable({ campaigns }) {
  const stacked = useIsNarrow(HR_STACK_AT);
  if (!campaigns.length) return null;

  const TEMPLATE = "2fr 100px 90px 80px 80px 80px 80px 80px";

  if (stacked) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {campaigns.map(c => {
          const s = c.stats || {};
          return (
            <div key={c.id} style={{ background: C.charcoal, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px" }}>
              <div style={{ marginBottom: 10 }}>
                <CampaignName c={c} showDisconnected={hrDisconnected(c)} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: "10px 10px" }}>
                {HR_COLS.map(col => (
                  <div key={col.label}>
                    <div style={{ fontSize: 9, color: C.grey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 3 }}>{col.label}</div>
                    {col.render(c, s)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: TEMPLATE,
        gap: 0, background: C.charcoal,
        borderBottom: `1px solid ${C.border}`,
        padding: "10px 20px",
      }}>
        {["Campaign", ...HR_COLS.map(c => c.label)].map(h => (
          <div key={h} style={{ fontSize: 10, color: C.grey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em" }}>{h}</div>
        ))}
      </div>

      {campaigns.map((c, i) => {
        const s = c.stats || {};
        return (
          <div key={c.id} style={{
            display: "grid",
            gridTemplateColumns: TEMPLATE,
            gap: 0, padding: "14px 20px", alignItems: "center",
            borderBottom: i < campaigns.length - 1 ? `1px solid ${C.border}` : "none",
            background: i % 2 === 0 ? C.charcoal : C.surface,
          }}>
            <div style={{ paddingRight: 16, overflow: "hidden" }}>
              <CampaignName c={c} showDisconnected={hrDisconnected(c)} />
            </div>
            {HR_COLS.map(col => <div key={col.label}>{col.render(c, s)}</div>)}
          </div>
        );
      })}
    </div>
  );
}

function FunnelView({ stats }) {
  const s = stats || {};
  const requests  = s.connectionsSent      || 0;
  const accepted  = s.connectionsAccepted  || 0;
  const messages  = s.messagesSent         || 0;
  const replies   = s.totalMessageReplies  || 0;
  const base      = requests || 1;

  const steps = [
    { label: "Conn. Requests", value: requests, pct: 100,                                    color: C.green },
    { label: "Accepted",       value: accepted, pct: (accepted / base) * 100,                color: C.green },
    { label: "Messages Sent",  value: messages, pct: (messages / base) * 100,                color: C.blue  },
    { label: "Replies",        value: replies,  pct: messages ? (replies / messages) * 100 : 0, color: C.blue, replyRate: true },
  ];

  const drops = [
    accepted && requests  ? `${((accepted / requests)  * 100).toFixed(1)}% accepted`    : null,
    accepted              ? `sent to ${((messages / (accepted || 1)) * 100).toFixed(0)}% of connections` : null,
    messages              ? `${((replies  / messages)  * 100).toFixed(1)}% reply rate`  : null,
  ];

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: C.lightGrey, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 16 }}>Outreach Funnel</div>
      <div style={{ background: C.charcoal, borderRadius: 10, border: `1px solid ${C.border}`, padding: "24px 28px" }}>
        {steps.map((step, i) => (
          <div key={step.label}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div style={{ width: 120, flexShrink: 0, fontSize: 11, color: C.lightGrey, fontFamily: "'Inter', sans-serif" }}>{step.label}</div>
              <div style={{ flex: 1, height: 28, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 4,
                  width: `${Math.max(step.pct, 0.5)}%`,
                  background: step.color + "88",
                  borderRight: `2px solid ${step.color}`,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ width: 48, flexShrink: 0, textAlign: "right", fontSize: 15, fontWeight: 700, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{fmt(step.value)}</div>
              <div style={{ width: 52, flexShrink: 0, textAlign: "right", fontSize: 11, color: step.color, fontFamily: "'Inter', sans-serif" }}>
                {i === 0 ? "100%" : `${step.pct.toFixed(1)}%`}
              </div>
            </div>
            {i < steps.length - 1 && drops[i] && (
              <div style={{ paddingLeft: 136, paddingTop: 6, paddingBottom: 6, fontSize: 10, color: C.grey, fontFamily: "'Inter', sans-serif" }}>
                ↓ {drops[i]}
              </div>
            )}
          </div>
        ))}
      </div>
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

      const campaignRes = await hrFetch("/campaign/GetAll", { offset: 0, limit: 50 });
      const rawCampaigns = campaignRes.campaigns || campaignRes.items || [];

      const allCampaignIds = rawCampaigns.map(c => c.id).filter(Boolean);
      const allTimeRange = { startDate: "2024-01-01T00:00:00.000Z", endDate: new Date().toISOString() };

      const allAccountIds = [...new Set(
        rawCampaigns.flatMap(c => c.campaignAccountIds || []).filter(Boolean)
      )];

      // Fetch overall stats + per-campaign stats in parallel
      const [overallRes, ...campaignStatsResults] = await Promise.all([
        hrFetch("/stats/GetOverallStats", {
          accountIds: allAccountIds.length ? allAccountIds : null,
          campaignIds: allCampaignIds,
          ...range,
        }),
        ...rawCampaigns.map(c => {
          const isFinished = c.status === "FINISHED" || c.status === "COMPLETED";
          const statsRange = isFinished ? allTimeRange : range;

          // Use campaign-specific IDs if available, otherwise fall back to all known workspace IDs
          const accountIds = c.campaignAccountIds?.length ? c.campaignAccountIds : allAccountIds;
          return hrFetch("/stats/GetOverallStats", {
            campaignIds: [c.id],
            accountIds: accountIds.length ? accountIds : null,
            ...statsRange,
          }).catch(() => null);
        }),
      ]);

      setOverallStats(overallRes?.overallStats || overallRes);
      const finalCampaigns = rawCampaigns.map((c, i) => ({
        ...c,
        stats: campaignStatsResults[i]?.overallStats || campaignStatsResults[i] || {},
      }));
      setCampaigns(finalCampaigns);
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
      <div style={{ background: C.black, borderBottom: `1px solid #1a1a1a` }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 56, gap: 16, flexWrap: "wrap" }}>
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

            {overallStats && <FunnelView stats={overallStats} />}

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
