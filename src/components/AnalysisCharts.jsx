import { useState, useEffect, useRef } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";
import {
  adClicks, searchConsole, gaSessions, hubspotSessions,
  leadsWeekly, spendWeekly, spendMonthly, liImpressionsMonthly,
} from "../data/draftwiseAnalysis";

// The traffic and demo-request analysis from the Draftwise report, as a fixed
// snapshot. It does not follow the date buttons above it: the comparisons are
// built around fixed before/after windows (the Sept 18–20 changes).

const T = {
  surface:  "#0c0c0c",
  border:   "#1e1e1e",
  grid:     "#1f1f1f",
  axis:     "#333333",
  text:     "#f0f2f5",
  muted:    "#b2b2b2",
  faint:    "#666666",
  green:    "#3dbb7a",
  red:      "#e05252",
};

// Categorical series colors, validated for the dark surface (lightness band,
// colorblind separation, contrast). Each entity keeps its color on every chart.
const S = {
  liFeed:  "#3987e5",
  liAN:    "#d95926",
  organic: "#199e70",
  gads:    "#c98500",
  meta:    "#d55181",
  youtube: "#0ca30c",
  demos:   "#9085e9",
  forms:   "#d95926",
};

const FONT = "'Inter', sans-serif";
const nf = new Intl.NumberFormat("en-US");
const fmtN = v => (v == null || Number.isNaN(v) ? "—" : nf.format(Math.round(v)));
const fmt1 = v => (v == null ? "—" : v.toFixed(1));
const fmtUSD = v => (v == null ? "—" : "$" + nf.format(Math.round(v)));
const fmtPct = v => (v == null || !Number.isFinite(v) ? "—" : Math.round(v * 100) + "%");
const fmtChg = v => (v == null || !Number.isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.round(Math.abs(v) * 100) + "%");

const parseDay = s => new Date(s + "T00:00:00Z");
const dayLabel = d => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const weekLabel = s => dayLabel(parseDay(s));
const monthLabel = m => new Date(m + "-01T00:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }).replace(" ", " '");

const avg = (rows, f) => rows.length ? rows.reduce((s, r) => s + f(r), 0) / rows.length : null;
const inRange = (rows, a, b, key = "date") => rows.filter(r => r[key] >= a && r[key] <= b);
const change = (b, a) => (b ? (a - b) / b : null);

function niceScale(max) {
  if (!max || max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => s >= raw);
  const top = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);
  return { top, ticks };
}
const tickFmt = v => (v >= 1e6 ? (v / 1e6).toFixed(v % 1e6 ? 1 : 0) + "M" : v >= 1e3 ? (v / 1e3).toFixed(v % 1e3 ? 1 : 0) + "K" : String(v));

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    setW(Math.floor(ref.current.getBoundingClientRect().width));
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ── Layout pieces ──────────────────────────────────────────────────────────────
function Card({ id, title, takeaway, note, children }) {
  return (
    <section id={id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: "18px 20px", display: "grid", gap: 10, minWidth: 0, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: FONT }}>{title}</h3>
      {takeaway && <p style={{ fontSize: 13, color: T.text, lineHeight: 1.5, fontFamily: FONT }}>{takeaway}</p>}
      {note && <p style={{ fontSize: 11, color: T.muted, lineHeight: 1.5, fontFamily: FONT }}>{note}</p>}
      {children}
    </section>
  );
}

function Legend({ items }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", fontSize: 11, color: T.muted, fontFamily: FONT }}>
      {items.map(it => (
        <span key={it.name} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <i style={{ width: it.square ? 10 : 14, height: it.square ? 10 : 2, borderRadius: it.square ? 2 : 1, background: it.color, display: "inline-block" }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}

function Tip({ tip, width }) {
  if (!tip) return null;
  const left = Math.min(Math.max(tip.x + 12, 0), Math.max(width - 210, 0));
  return (
    <div style={{ position: "absolute", left, top: tip.y, pointerEvents: "none", background: "#161616", border: `1px solid ${T.axis}`, borderRadius: 8, padding: "8px 10px", minWidth: 170, fontFamily: FONT, zIndex: 2 }}>
      <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>{tip.title}</div>
      {tip.rows.map(r => (
        <div key={r.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text, lineHeight: 1.6 }}>
          <i style={{ width: 8, height: 8, borderRadius: 2, background: r.color, display: "inline-block" }} />
          <span style={{ flex: 1, color: T.muted }}>{r.name}</span>
          <b style={{ fontWeight: 600 }}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function YAxis({ ticks, y, left, right, fmt = tickFmt }) {
  return ticks.map(t => (
    <g key={t}>
      <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke={t === 0 ? T.axis : T.grid} />
      <text x={left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill={T.faint} fontFamily={FONT}>{fmt(t)}</text>
    </g>
  ));
}

// A table that becomes one block per row on narrow screens (no sideways scrolling).
function DataTable({ columns, rows, groups, stackAt = 720 }) {
  const narrow = useIsNarrow(stackAt);
  if (narrow) {
    return (
      <div style={{ display: "grid", gap: 8 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text, fontFamily: FONT }}>{r[columns[0].key]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: 8 }}>
              {columns.slice(1).map(c => (
                <div key={c.key}>
                  <div style={{ fontSize: 10, color: T.faint, fontFamily: FONT }}>{c.group ? `${c.group} · ${c.label}` : c.label}</div>
                  <div style={{ fontSize: 13, color: c.tone ? c.tone(r[c.key]) : T.text, fontFamily: FONT }}>{c.fmt ? c.fmt(r[c.key]) : r[c.key]}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  const th = { fontSize: 10, color: T.faint, fontWeight: 500, textAlign: "right", padding: "6px 8px", borderBottom: `1px solid ${T.border}`, fontFamily: FONT };
  const td = { fontSize: 12, color: T.text, textAlign: "right", padding: "7px 8px", borderBottom: `1px solid ${T.grid}`, fontFamily: FONT, fontVariantNumeric: "tabular-nums" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        {groups && (
          <tr>{groups.map((g, i) => <th key={i} colSpan={g.span} style={{ ...th, textAlign: "center", color: T.muted, borderBottom: g.label ? th.borderBottom : "none" }}>{g.label}</th>)}</tr>
        )}
        <tr>{columns.map((c, i) => <th key={c.key} style={{ ...th, textAlign: i === 0 ? "left" : "right" }}>{c.label}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>{columns.map((c, i) => (
            <td key={c.key} style={{ ...td, textAlign: i === 0 ? "left" : "right", color: c.tone ? c.tone(r[c.key]) : T.text }}>{c.fmt ? c.fmt(r[c.key]) : r[c.key]}</td>
          ))}</tr>
        ))}
      </tbody>
    </table>
  );
}
const toneChange = v => (v == null || v === 0 ? T.text : v < 0 ? T.red : T.green);

// ── Line chart (daily) ─────────────────────────────────────────────────────────
function LineChart({ rows, series, events = [], shade, height = 340 }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState(null);
  const H = height, top = 12, bottom = 24, right = 10;
  const max = Math.max(...rows.flatMap(r => series.map(s => r[s.key] ?? 0)));
  const { top: yTop, ticks } = niceScale(max);
  const left = 44;
  const t0 = parseDay(rows[0].date).getTime(), t1 = parseDay(rows[rows.length - 1].date).getTime();
  const x = d => left + ((parseDay(d).getTime() - t0) / (t1 - t0 || 1)) * (W - left - right);
  const y = v => H - bottom - (v / yTop) * (H - bottom - top);
  const nTicks = W < 500 ? 4 : 7;
  const xTicks = Array.from({ length: nTicks }, (_, i) => rows[Math.round(i * (rows.length - 1) / (nTicks - 1))].date);

  const onMove = e => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const frac = (px - left) / (W - left - right);
    const i = Math.max(0, Math.min(rows.length - 1, Math.round(frac * (rows.length - 1))));
    const r = rows[i];
    setTip({ i, x: x(r.date), y: top, title: parseDay(r.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }),
      rows: series.map(s => ({ name: s.name, color: s.color, value: fmtN(r[s.key]) })) });
  };

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {W > 0 && (
        <svg width={W} height={H} style={{ display: "block" }} onPointerMove={onMove} onPointerLeave={() => setTip(null)}>
          {shade && <rect x={x(shade.from)} y={top} width={Math.max(0, x(shade.to) - x(shade.from))} height={H - bottom - top} fill="#ffffff" opacity={0.04} />}
          <YAxis ticks={ticks} y={y} left={left} right={W - right} />
          {xTicks.map((d, i) => <text key={d} x={x(d)} y={H - 6} textAnchor={i === 0 ? "start" : i === xTicks.length - 1 ? "end" : "middle"} fontSize={10} fill={T.faint} fontFamily={FONT}>{dayLabel(parseDay(d))}</text>)}
          {events.map(ev => <line key={ev.date} x1={x(ev.date)} x2={x(ev.date)} y1={top} y2={H - bottom} stroke={T.muted} strokeDasharray="3 4" opacity={0.6} />)}
          {series.map(s => {
            let d = "", pen = false;
            rows.forEach(r => {
              const v = r[s.key];
              if (v == null) { pen = false; return; }
              d += `${pen ? "L" : "M"}${x(r.date).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
            });
            return <path key={s.key} d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {tip && (
            <g>
              <line x1={tip.x} x2={tip.x} y1={top} y2={H - bottom} stroke={T.axis} />
              {series.map(s => rows[tip.i][s.key] != null && (
                <circle key={s.key} cx={tip.x} cy={y(rows[tip.i][s.key])} r={4} fill={s.color} stroke={T.surface} strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  );
}

// ── Bar chart (grouped or stacked) ─────────────────────────────────────────────
function BarChart({ rows, xKey, xFmt, series, stacked = false, height = 260, valueFmt = fmtN, yFmt = tickFmt, tipTitle }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState(null);
  const H = height, top = 12, bottom = 24, right = 6, left = 48;
  const totals = rows.map(r => stacked ? series.reduce((s, k) => s + (r[k.key] || 0), 0) : Math.max(...series.map(k => r[k.key] || 0)));
  const { top: yTop, ticks } = niceScale(Math.max(...totals));
  const band = (W - left - right) / rows.length;
  const pad = Math.min(band * 0.25, 10);
  const y = v => H - bottom - (v / yTop) * (H - bottom - top);
  const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - left) / 56)));

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {W > 0 && (
        <svg width={W} height={H} style={{ display: "block" }} onPointerLeave={() => setTip(null)}>
          <YAxis ticks={ticks} y={y} left={left} right={W - right} fmt={yFmt} />
          {rows.map((r, i) => {
            const bx = left + i * band + pad / 2, bw = band - pad;
            let acc = 0;
            const bars = series.map((s, si) => {
              const v = r[s.key];
              if (v == null || v <= 0) return null;
              if (stacked) {
                const y0 = y(acc), y1 = y(acc + v); acc += v;
                return <rect key={s.key} x={bx} y={y1} width={bw} height={Math.max(0, y0 - y1 - 2)} fill={s.color} rx={si === series.length - 1 ? 2 : 0} />;
              }
              const w = (bw - 2 * (series.length - 1)) / series.length;
              return <rect key={s.key} x={bx + si * (w + 2)} y={y(v)} width={Math.max(1, w)} height={y(0) - y(v)} fill={s.color} rx={2} />;
            });
            return (
              <g key={r[xKey]}>
                {bars}
                {i % every === 0 && <text x={bx + bw / 2} y={H - 6} textAnchor="middle" fontSize={10} fill={T.faint} fontFamily={FONT}>{xFmt(r[xKey])}</text>}
                <rect x={left + i * band} y={top} width={band} height={H - bottom - top} fill="transparent"
                  onPointerEnter={() => setTip({ x: bx + bw / 2, y: top, title: tipTitle ? tipTitle(r) : xFmt(r[xKey]),
                    rows: series.map(s => ({ name: s.name, color: s.color, value: r[s.key] == null ? "—" : valueFmt(r[s.key]) })) })} />
              </g>
            );
          })}
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  );
}

// ── The section ────────────────────────────────────────────────────────────────
const START = "2026-08-19", END = "2026-11-11";
const BEFORE = ["2026-09-01", "2026-09-17"], AFTER = ["2026-09-21", "2026-10-18"];

export default function AnalysisCharts() {
  const gsc = new Map(searchConsole.map(r => [r.date, r.search_console_clicks]));
  const ga = new Map(gaSessions.map(r => [r.date, r.ga_sessions]));
  const hs = new Map(hubspotSessions.map(r => [r.date, r]));

  // 1. Clicks by source
  const clickRows = inRange(adClicks, START, END).map(r => ({ ...r, search_console_clicks: gsc.get(r.date) ?? null }));
  const clickSeries = [
    { key: "google_ads_clicks", name: "Google Ads", color: S.gads },
    { key: "linkedin_feed_clicks", name: "LinkedIn feed", color: S.liFeed },
    { key: "linkedin_audience_network_clicks", name: "LinkedIn Audience Network", color: S.liAN },
    { key: "search_console_clicks", name: "Search Console (organic)", color: S.organic },
    { key: "meta_link_clicks", name: "Meta", color: S.meta },
  ];
  const events = [
    { date: "2026-09-18", label: "Audience Network off for most campaigns" },
    { date: "2026-09-28", label: "Google Ads changes start" },
    { date: "2026-10-06", label: "Google Ads changes end" },
    { date: "2026-10-28", label: "Audience Network fully off" },
  ];

  // 2. Before / after per day
  const ba = (name, src, f) => {
    const b = avg(inRange(src, ...BEFORE), f), a = avg(inRange(src, ...AFTER), f);
    return { source: name, before: b, after: a, change: change(b, a) };
  };
  const gscRows = searchConsole, gaRows = gaSessions, hsRows = hubspotSessions;
  const baRows = [
    ba("Google Ads", adClicks, r => r.google_ads_clicks),
    ba("LinkedIn feed", adClicks, r => r.linkedin_feed_clicks),
    ba("LinkedIn Audience Network", adClicks, r => r.linkedin_audience_network_clicks),
    ba("Meta", adClicks, r => r.meta_link_clicks || 0),
    ba("Search Console (organic)", gscRows, r => r.search_console_clicks),
    ba("HubSpot sessions (all)", hsRows, r => r.total),
    ba("Google Analytics sessions (all)", gaRows, r => r.ga_sessions),
  ];
  const baBy = Object.fromEntries(baRows.map(r => [r.source, r]));

  // 3. HubSpot share of platform clicks
  const cap = (name, platform, hsKey) => {
    const join = (a, b) => inRange(adClicks.map(r => ({ ...r, sc: gsc.get(r.date) })), a, b).filter(r => hs.has(r.date));
    const calc = ([a, b]) => {
      const rr = join(a, b);
      const p = avg(rr, platform), h = avg(rr, r => hs.get(r.date)[hsKey]);
      return { p, h, share: p ? h / p : null };
    };
    const B = calc(BEFORE), A = calc(AFTER);
    return { channel: name, bp: B.p, bh: B.h, bs: B.share, ap: A.p, ah: A.h, as: A.share };
  };
  const capRows = [
    cap("Organic search (vs Search Console)", r => r.sc ?? 0, "organic"),
    cap("Paid search (vs Google Ads)", r => r.google_ads_clicks, "paid"),
    cap("Paid social (vs LinkedIn and Meta)", r => r.linkedin_feed_clicks + r.linkedin_audience_network_clicks + (r.meta_link_clicks || 0), "paid_social"),
  ];

  // 4. Leads per week
  const leadRows = leadsWeekly.filter(r => r.week_start >= "2026-08-17");
  const leadSeries = [
    { key: "contact_us_submissions", name: "Contact Us submissions", color: S.demos },
    { key: "new_form_contacts_excl_event", name: "New form contacts", color: S.forms },
  ];
  const leadBA = (key, name) => {
    const r1 = v => Math.round(v * 10) / 10;   // compare the rounded averages people see
    const b = r1(avg(leadsWeekly.filter(r => r.week_start <= "2026-09-14" && r[key] != null), r => r[key]));
    const a = r1(avg(leadsWeekly.filter(r => r.week_start >= "2026-09-21" && r.week_start <= "2026-11-09" && r[key] != null), r => r[key]));
    return { measure: name, before: b, after: a, change: change(b, a) };
  };
  const leadTable = [leadBA("contact_us_submissions", "Contact Us submissions"), leadBA("new_form_contacts_excl_event", "New form contacts")];

  // 5. Spend vs demo requests
  const spendSeries = [
    { key: "linkedin_spend", name: "LinkedIn", color: S.liFeed },
    { key: "google_search_display_spend", name: "Google Search & Display", color: S.gads },
    { key: "youtube_spend", name: "YouTube", color: S.youtube },
    { key: "meta_spend", name: "Meta", color: S.meta },
  ];
  const demoSeries = [
    { key: "contact_us_submissions", name: "Demo requests", color: S.demos },
    { key: "likely_prospects", name: "Likely prospects", color: S.organic },
  ];
  const monthRows = spendMonthly.map(r => ({ ...r, perReq: r.contact_us_submissions ? r.ad_spend / r.contact_us_submissions : null, perPros: r.likely_prospects ? r.ad_spend / r.likely_prospects : null }));

  // 6. LinkedIn impressions
  const imprSeries = [
    { key: "linkedin_feed", name: "LinkedIn feed", color: S.liFeed },
    { key: "audience_network", name: "Audience Network", color: S.liAN },
  ];

  const grid2 = { display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" };

  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(0, 1fr)" }}>
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 3, height: 18, borderRadius: 2, background: S.demos }} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, fontFamily: FONT }}>Traffic and demo requests</span>
        </div>
        <p style={{ fontSize: 11, color: T.muted, fontFamily: FONT }}>Fixed snapshot from the Nov 2026 analysis (data through Nov 15). These charts don't follow the date buttons above.</p>
      </div>

      <Card id="an-clicks" title="Clicks to the website, by source"
        takeaway={`Traffic fell for two planned reasons: the LinkedIn Audience Network (mostly non-ICP clicks) was turned off, and in-house Google Ads search categories were cut. Audience Network clicks fell from ${fmtN(baBy["LinkedIn Audience Network"].before)} to ${fmtN(baBy["LinkedIn Audience Network"].after)} a day, and Google Analytics sessions fell from ${fmtN(baBy["Google Analytics sessions (all)"].before)} to ${fmtN(baBy["Google Analytics sessions (all)"].after)}.`}
        note="Daily, Aug 19 – Nov 11. Dashed lines: Sept 18 Audience Network off for most campaigns · Sept 28 – Oct 6 Google Ads changes · Oct 28 Audience Network fully off. Shaded: Sept 10–20 cookie consent changes.">
        <Legend items={clickSeries} />
        <LineChart rows={clickRows} series={clickSeries} events={events} shade={{ from: "2026-09-10", to: "2026-09-20" }} />
      </Card>

      <div style={grid2}>
        <Card id="an-before-after" title="Average per day, before and after" note="Before: Sept 1–17. After: Sept 21 – Oct 18.">
          <DataTable stackAt={560} rows={baRows} columns={[
            { key: "source", label: "Source" },
            { key: "before", label: "Before", fmt: fmtN },
            { key: "after", label: "After", fmt: fmtN },
            { key: "change", label: "Change", fmt: fmtChg, tone: toneChange },
          ]} />
        </Card>

        <Card id="an-hubspot-share" title="How much real traffic HubSpot sees"
          takeaway={`Since the Sept 20 cookie consent changes, HubSpot misses most visits, so its sessions fell ${fmtPct(Math.abs(baBy["HubSpot sessions (all)"].change))} while Google Analytics fell ${fmtPct(Math.abs(baBy["Google Analytics sessions (all)"].change))}. Use Google Analytics for traffic.`}
          note="HubSpot sessions vs. clicks counted by each platform, per day. Shares can exceed 100% because HubSpot also counts Bing and other engines.">
          <DataTable stackAt={900} rows={capRows}
            groups={[{ span: 1 }, { span: 3, label: "Before (Sept 1–17)" }, { span: 3, label: "After (Sept 21 – Oct 18)" }]}
            columns={[
              { key: "channel", label: "Channel" },
              { key: "bp", label: "Platform clicks", fmt: fmtN, group: "Before" },
              { key: "bh", label: "HubSpot sessions", fmt: fmtN, group: "Before" },
              { key: "bs", label: "Share seen", fmt: fmtPct, group: "Before" },
              { key: "ap", label: "Platform clicks", fmt: fmtN, group: "After" },
              { key: "ah", label: "HubSpot sessions", fmt: fmtN, group: "After" },
              { key: "as", label: "Share seen", fmt: fmtPct, group: "After" },
            ]} />
        </Card>
      </div>

      <Card id="an-leads" title="Leads per week"
        takeaway="Demo requests held steady through the changes. HubSpot counts every form submission, cookies or not."
        note="Weeks start Monday; both series run through Nov 15. New form contacts are first-time contacts from any website form, not counting the ILTA event raffle. An internal test on Nov 9 is left out.">
        <Legend items={leadSeries.map(s => ({ ...s, square: true }))} />
        <BarChart rows={leadRows} xKey="week_start" xFmt={weekLabel} series={leadSeries} tipTitle={r => "Week of " + weekLabel(r.week_start)} height={220} />
        <DataTable stackAt={560} rows={leadTable} columns={[
          { key: "measure", label: "Per week" },
          { key: "before", label: "Before (July 6 – Sept 20)", fmt: fmt1 },
          { key: "after", label: "After (Sept 21 – Nov 15)", fmt: fmt1 },
          { key: "change", label: "Change", fmt: fmtChg, tone: toneChange },
        ]} />
      </Card>

      <Card id="an-spend" title="Ad spend vs. demo requests, per week"
        takeaway="Requests don't move with spend. Compare total spend across all platforms against HubSpot demo requests, month by month."
        note="Spend is LinkedIn, Google Ads (Search, Display, YouTube) and Meta (from Aug 31). HeyReach isn't included. Likely prospects leave out vendor pitches and spam.">
        <div style={{ fontSize: 11, color: T.muted, fontFamily: FONT }}>Ad spend</div>
        <Legend items={spendSeries.map(s => ({ ...s, square: true }))} />
        <BarChart rows={spendWeekly} xKey="week_start" xFmt={weekLabel} series={spendSeries} stacked valueFmt={fmtUSD} yFmt={v => "$" + tickFmt(v)} tipTitle={r => "Week of " + weekLabel(r.week_start)} height={200} />
        <div style={{ fontSize: 11, color: T.muted, fontFamily: FONT, marginTop: 6 }}>Demo requests</div>
        <Legend items={demoSeries.map(s => ({ ...s, square: true }))} />
        <BarChart rows={spendWeekly} xKey="week_start" xFmt={weekLabel} series={demoSeries} tipTitle={r => "Week of " + weekLabel(r.week_start)} height={160} />
        <DataTable stackAt={720} rows={monthRows} columns={[
          { key: "label", label: "Month" },
          { key: "ad_spend", label: "Ad spend", fmt: fmtUSD },
          { key: "contact_us_submissions", label: "Demo requests", fmt: fmtN },
          { key: "likely_prospects", label: "Likely prospects", fmt: fmtN },
          { key: "perReq", label: "Spend per request", fmt: fmtUSD },
          { key: "perPros", label: "Spend per prospect", fmt: fmtUSD },
        ]} />
      </Card>

      <Card id="an-impressions" title="LinkedIn ad impressions by month"
        takeaway="Most of the year's impressions ran on the Audience Network, which the Company Page chart never counts. Use Campaign Manager for ad reporting."
        note="Campaign Manager, Nov 2025 – Nov 11, 2026.">
        <Legend items={imprSeries.map(s => ({ ...s, square: true }))} />
        <BarChart rows={liImpressionsMonthly} xKey="month" xFmt={monthLabel} series={imprSeries} stacked height={220} />
      </Card>
    </div>
  );
}
