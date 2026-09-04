import { useState, useEffect } from "react";

const C = {
  white:     "#FFFFFF",
  offWhite:  "#f0f2f5",
  lightGrey: "#b2b2b2",
  grey:      "#666666",
  blue:      "#579ed1",
  gold:      "#ffab40",
  black:     "#000000",
  charcoal:  "#0c0c0c",
  border:    "#1e1e1e",
  green:     "#3dbb7a",
  red:       "#e05252",
};

const LI_ACCOUNT_ID = "513153545";
const GA_ALLOWLIST  = ["draftwise"];

// ── Date helpers ───────────────────────────────────────────────────────────────
function isMonthKey(v) { return typeof v === "string" && /^\d{4}-\d{2}$/.test(v); }

function getTrailingMonths(count = 5) {
  const now = new Date();
  const out = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const key = `${y}-${String(m).padStart(2, "0")}`;
    const sameYear = y === now.getFullYear();
    const label = d.toLocaleString("en-US", { month: "short" }) + (sameYear ? "" : ` '${String(y).slice(-2)}`);
    out.push({ key, label });
  }
  return out;
}

function getDateRange(value) {
  const pad = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (isMonthKey(value)) {
    const [y, m] = value.split("-").map(Number);
    const start    = new Date(y, m - 1, 1);
    const end      = new Date(y, m, 0);
    const prevStart = new Date(y, m - 2, 1);
    const prevEnd   = new Date(y, m - 1, 0);
    return {
      current: { since: fmt(start), until: fmt(end) },
      prev:    { since: fmt(prevStart), until: fmt(prevEnd) },
    };
  }
  const days = value;
  const now       = new Date();
  const end       = new Date(now);
  const start     = new Date(now); start.setDate(start.getDate() - days + 1);
  const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    current: { since: fmt(start), until: fmt(end) },
    prev:    { since: fmt(prevStart), until: fmt(prevEnd) },
  };
}

function toLinkedInRange(since, until) {
  const toObj = iso => { const d = new Date(iso); return { day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() }; };
  return { start: toObj(since), end: toObj(until) };
}

// ── API fetchers ───────────────────────────────────────────────────────────────
function liErrorMessage(json, status) {
  if (json && json._setupRequired) {
    return "LinkedIn is not connected. Add the LinkedIn API credentials in Vercel, then redeploy.";
  }
  if (json && json._authExpired) {
    return json.error || "LinkedIn authorization has expired. Reconnect the LinkedIn app.";
  }
  const upstream = (json && json.upstream) || json || {};
  return upstream.message || (json && json.error) || `LinkedIn request failed (${status}).`;
}

async function liApiFetch(path) {
  const res  = await fetch(`/api/linkedin?path=${encodeURIComponent(path)}`);
  const json = await res.json();
  if (!res.ok) throw new Error(liErrorMessage(json, res.status));
  return json;
}

async function gaFetch(params) {
  const res  = await fetch(`/api/google-ads?${new URLSearchParams(params)}`);
  const json = await res.json();
  if (json._setupRequired) throw Object.assign(new Error("setup"), { setupRequired: true });
  if (json.error) throw new Error(json.error?.message || String(json.error));
  return json;
}

async function fetchLinkedInAggregate(since, until) {
  const liRange = toLinkedInRange(since, until);
  const { start: s, end: e } = liRange;
  const urn       = `urn:li:sponsoredAccount:${LI_ACCOUNT_ID}`;
  const dateRange = `(start:(day:${s.day},month:${s.month},year:${s.year}),end:(day:${e.day},month:${e.month},year:${e.year}))`;
  const path      = `/v2/adAnalyticsV2?q=analytics&pivot=CAMPAIGN&timeGranularity=ALL&dateRange=${dateRange}` +
    `&accounts=List(${encodeURIComponent(urn)})&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivotValues`;

  const data = await liApiFetch(path);
  const elements = data.elements || [];

  let impressions = 0, clicks = 0, spend = 0, conversions = 0;
  elements.forEach(el => {
    impressions += parseInt(el.impressions  || 0);
    clicks      += parseInt(el.clicks       || 0);
    spend       += parseFloat(el.costInLocalCurrency || 0);
    conversions += parseInt(el.externalWebsiteConversions || 0);
  });

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks      > 0 ? spend / clicks               : 0;
  return { impressions, clicks, spend, conversions, ctr, cpc };
}

async function fetchGoogleAggregate(accounts, since, until) {
  const results = await Promise.all(
    accounts.map(acc =>
      gaFetch({
        customerId: acc.id,
        q: encodeURIComponent(
          `SELECT metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
           FROM campaign
           WHERE campaign.status IN ('ENABLED', 'PAUSED') AND segments.date BETWEEN '${since}' AND '${until}'`
        ),
      }).catch(() => ({ results: [] }))
    )
  );

  let impressions = 0, clicks = 0, spend = 0, conversions = 0;
  results.forEach(r => {
    (r.results || []).forEach(row => {
      impressions += parseInt(row.metrics?.impressions || 0);
      clicks      += parseInt(row.metrics?.clicks      || 0);
      spend       += (row.metrics?.costMicros || 0) / 1_000_000;
      conversions += parseFloat(row.metrics?.conversions || 0);
    });
  });

  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks      > 0 ? spend / clicks               : 0;
  return { impressions, clicks, spend, conversions, ctr, cpc };
}

// ── UI helpers ─────────────────────────────────────────────────────────────────
function tickerColor(curr, prev, invert = false) {
  if (!prev || prev === 0) return "#333";
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return "#333";
  return (invert ? pct < 0 : pct > 0) ? C.green : C.red;
}

function Ticker({ curr, prev, invert = false }) {
  if (!prev || prev === 0) return null;
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return null;
  const up   = pct > 0;
  const good = invert ? !up : up;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: good ? C.green : C.red, marginLeft: 5 }}>
      {up ? "↑" : "↓"}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function fmt(n)    { n = Math.round(n || 0); if (n >= 1e6) return (n/1e6).toFixed(1)+"M"; if (n >= 1e3) return (n/1e3).toFixed(1)+"K"; return n.toString(); }
function fmtUSD(n) { return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function fmtCTR(n) { return n > 0 ? n.toFixed(2) + "%" : "—"; }
function fmtCPC(n) { return n > 0 ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"; }

function MetricCard({ label, value, accent, ticker }) {
  return (
    <div style={{
      background: C.charcoal, borderRadius: 10, padding: "14px 18px",
      border: `1px solid ${C.border}`, borderTop: `3px solid ${accent || "#333"}`,
    }}>
      <div style={{ fontSize: 10, color: C.lightGrey, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "'Inter', sans-serif" }}>{label}</div>
      <div style={{ display: "flex", alignItems: "baseline" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{value}</div>
        {ticker}
      </div>
    </div>
  );
}

function PlatformSection({ title, accentColor, metrics, loading }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: accentColor }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: C.offWhite, fontFamily: "'Inter', sans-serif", letterSpacing: "0.01em" }}>{title}</span>
        {loading && <span style={{ fontSize: 11, color: C.grey, fontFamily: "'Inter', sans-serif" }}>Loading…</span>}
      </div>
      {!loading && metrics.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}>
          {metrics.map(m => <MetricCard key={m.label} {...m} />)}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function OverviewDashboard() {
  const [days,   setDays]   = useState(30);
  const [liCurr, setLiCurr] = useState(null);
  const [liPrev, setLiPrev] = useState(null);
  const [gCurr,  setGCurr]  = useState(null);
  const [gPrev,  setGPrev]  = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const loadAll = async (daysN) => {
    setLoading(true); setError(null);
    try {
      const { current, prev } = getDateRange(daysN);

      const accountsData = await gaFetch({ action: "accounts" }).catch(() => ({ customers: [] }));
      const gaAccounts   = (accountsData.customers || [])
        .map(c => ({ id: c.id, name: c.name || "" }))
        .filter(a => a.id && GA_ALLOWLIST.some(al => a.name.toLowerCase().includes(al)));

      const [lc, lp, gc, gp] = await Promise.all([
        fetchLinkedInAggregate(current.since, current.until),
        fetchLinkedInAggregate(prev.since, prev.until),
        fetchGoogleAggregate(gaAccounts, current.since, current.until),
        fetchGoogleAggregate(gaAccounts, prev.since, prev.until),
      ]);

      setLiCurr(lc); setLiPrev(lp);
      setGCurr(gc);  setGPrev(gp);
    } catch (e) {
      if (!e.setupRequired) setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(days); }, []); // eslint-disable-line

  const handleDaySwitch = (d) => { setDays(d); loadAll(d); };

  const liMetrics = liCurr ? [
    { label: "Ad Spend",    value: liCurr.spend > 0 ? fmtUSD(liCurr.spend) : "—",  accent: tickerColor(liCurr.spend,       liPrev?.spend,       true), ticker: <Ticker curr={liCurr.spend}       prev={liPrev?.spend}       invert /> },
    { label: "Impressions", value: fmt(liCurr.impressions),                           accent: tickerColor(liCurr.impressions, liPrev?.impressions),       ticker: <Ticker curr={liCurr.impressions} prev={liPrev?.impressions} /> },
    { label: "Clicks",      value: fmt(liCurr.clicks),                                accent: tickerColor(liCurr.clicks,      liPrev?.clicks),            ticker: <Ticker curr={liCurr.clicks}      prev={liPrev?.clicks} /> },
    { label: "CTR",         value: fmtCTR(liCurr.ctr),                               accent: tickerColor(liCurr.ctr,         liPrev?.ctr),               ticker: <Ticker curr={liCurr.ctr}         prev={liPrev?.ctr} /> },
    { label: "Conversions", value: fmt(liCurr.conversions),                           accent: tickerColor(liCurr.conversions, liPrev?.conversions),       ticker: <Ticker curr={liCurr.conversions} prev={liPrev?.conversions} /> },
    { label: "CPC",         value: fmtCPC(liCurr.cpc),                               accent: tickerColor(liCurr.cpc,         liPrev?.cpc,         true), ticker: <Ticker curr={liCurr.cpc}         prev={liPrev?.cpc}         invert /> },
  ] : [];

  const gMetrics = gCurr ? [
    { label: "Ad Spend",    value: gCurr.spend > 0 ? fmtUSD(gCurr.spend) : "—",  accent: tickerColor(gCurr.spend,       gPrev?.spend,       true), ticker: <Ticker curr={gCurr.spend}       prev={gPrev?.spend}       invert /> },
    { label: "Impressions", value: fmt(gCurr.impressions),                          accent: tickerColor(gCurr.impressions, gPrev?.impressions),       ticker: <Ticker curr={gCurr.impressions} prev={gPrev?.impressions} /> },
    { label: "Clicks",      value: fmt(gCurr.clicks),                               accent: tickerColor(gCurr.clicks,      gPrev?.clicks),            ticker: <Ticker curr={gCurr.clicks}      prev={gPrev?.clicks} /> },
    { label: "CTR",         value: fmtCTR(gCurr.ctr),                              accent: tickerColor(gCurr.ctr,         gPrev?.ctr),               ticker: <Ticker curr={gCurr.ctr}         prev={gPrev?.ctr} /> },
    { label: "Conversions", value: fmt(gCurr.conversions),                          accent: tickerColor(gCurr.conversions, gPrev?.conversions),       ticker: <Ticker curr={gCurr.conversions} prev={gPrev?.conversions} /> },
    { label: "CPC",         value: fmtCPC(gCurr.cpc),                              accent: tickerColor(gCurr.cpc,         gPrev?.cpc,         true), ticker: <Ticker curr={gCurr.cpc}         prev={gPrev?.cpc}         invert /> },
  ] : [];

  return (
    <div style={{ minHeight: "100vh", background: C.black, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: 'Inter', sans-serif; }
      `}</style>

      <div style={{ background: C.black, borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48 }}>
        <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>Performance Overview</span>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
          {[7, 14, 30, 60, 90].map(d => (
            <button key={d} onClick={() => handleDaySwitch(d)} style={{
              padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
              background: days === d ? C.blue : "transparent",
              color: days === d ? C.white : C.grey,
              fontSize: 11, transition: "all 0.15s",
            }}>{d}d</button>
          ))}
          <div style={{ width: 1, height: 14, background: C.border, margin: "0 4px" }} />
          {getTrailingMonths().map(m => (
            <button key={m.key} onClick={() => handleDaySwitch(m.key)} style={{
              padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
              background: days === m.key ? C.blue : "transparent",
              color: days === m.key ? C.white : C.grey,
              fontSize: 11, transition: "all 0.15s",
            }}>{m.label}</button>
          ))}
        </div>
      </div>
      </div>

      <div style={{ maxWidth: 1300, margin: "0 auto", padding: "32px 32px" }}>
        {error && (
          <div style={{ background: C.charcoal, border: `1px solid ${C.red}44`, borderRadius: 10, padding: "18px 22px", marginBottom: 24 }}>
            <div style={{ color: C.red, fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Error</div>
            <div style={{ color: C.lightGrey, fontSize: 12 }}>{error}</div>
          </div>
        )}

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.blue, animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 12, color: C.lightGrey }}>Loading platform data…</div>
          </div>
        ) : (
          <>
            <PlatformSection title="LinkedIn Ads" accentColor="#0A66C2" metrics={liMetrics} loading={false} />
            <div style={{ height: 1, background: C.border, marginBottom: 32 }} />
            <PlatformSection title="Google Ads"   accentColor={C.gold}   metrics={gMetrics}  loading={false} />
          </>
        )}
      </div>
    </div>
  );
}
