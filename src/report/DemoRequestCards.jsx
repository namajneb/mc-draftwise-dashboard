import { csvParse } from "d3";
import monthlyCsv from "./data/spend_vs_demos_monthly.csv?raw";
import weeklyCsv from "./data/leads_weekly.csv?raw";
import { ManualDataFlag } from "./VisitRateCard";

// Demo request counts (HubSpot Contact Us submissions, internal tests removed), from the
// same hand-pulled export the report charts use. Refresh the CSVs in ./data to update.

const monthly = csvParse(monthlyCsv.trim());
const weekly  = csvParse(weeklyCsv.trim());
const n = v => Number(v || 0);

function Card({ label, value, sub }) {
  return (
    <div style={{ background: "#0c0c0c", borderRadius: 10, padding: "14px 18px", border: "1px solid #1e1e1e", borderTop: "3px solid #9085e9", minWidth: 0 }}>
      <div style={{ fontSize: 10, color: "#b2b2b2", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6, fontFamily: "'Inter', sans-serif" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: "#f0f2f5", fontFamily: "'Inter', sans-serif", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#666", marginTop: 4, fontFamily: "'Inter', sans-serif" }}>{sub}</div>}
    </div>
  );
}

export default function DemoRequestCards() {
  const byMonth = Object.fromEntries(monthly.map(r => [r.month, r]));
  const q3 = ["2026-08", "2026-09", "2026-10"].reduce((s, m) => s + n(byMonth[m]?.contact_us_submissions), 0);
  const last = monthly[monthly.length - 1];
  const prevFull = monthly[monthly.length - 2];
  const avg = rows => rows.reduce((s, r) => s + n(r.contact_us_submissions), 0) / rows.length;
  const before = avg(weekly.filter(r => r.week_start <= "2026-09-14"));
  const after  = avg(weekly.filter(r => r.week_start >= "2026-09-21"));
  const lastWeek = weekly[weekly.length - 1];
  const wk = s => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 3, height: 18, borderRadius: 2, background: "#9085e9" }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#f0f2f5", fontFamily: "'Inter', sans-serif" }}>Demo requests</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <Card label="Q3 total" value={q3} sub="Aug 1 – Oct 31" />
        <Card label={prevFull.label} value={n(prevFull.contact_us_submissions)} sub="Last full month" />
        <Card label={last.label} value={n(last.contact_us_submissions)} sub="Month to date" />
        <Card label={`Week of ${wk(lastWeek.week_start)}`} value={n(lastWeek.contact_us_submissions)} sub="Latest week" />
        <Card label="Per week since Sept 21" value={after.toFixed(1)} sub={`${before.toFixed(1)} before the changes`} />
      </div>
      <ManualDataFlag>HubSpot Contact Us submissions (internal test fills removed), entered by hand from an export through Nov 15. They don't update or follow the date buttons.</ManualDataFlag>
    </div>
  );
}
