import { REPORT_CSS } from "./reportCss";
import { VISIT_RATE_INPUTS as I } from "./manualInputs";

// The "Site visit-to-demo request rate" card from the Draftwise report, same markup
// and styles. Its numbers are plain <b> (not .fig): the report script fills every .fig
// on the page and would blank these. Its numbers are entered by hand (manualInputs.js), so it carries a flag.

const int  = v => new Intl.NumberFormat("en-US").format(Math.round(v));
const pct2 = v => (v * 100).toFixed(2) + "%";

export function ManualDataFlag({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap", fontSize: 11, color: "#b2b2b2", lineHeight: 1.5, fontFamily: "'Inter', sans-serif" }}>
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4, color: "#ffab40", background: "#ffab4022", border: "1px solid #ffab4044", flexShrink: 0 }}>MANUAL DATA</span>
      <span style={{ flex: "1 1 240px" }}>{children}</span>
    </div>
  );
}

export default function VisitRateCard() {
  const rate     = I.demoRequests / I.sessions;
  const rateExPs = I.demoRequests / (I.sessions - I.paidSocial);
  const rateEng  = I.demoRequests / I.engagedSessions;
  return (
    <>
      <style>{REPORT_CSS}</style>
      <div className="dw-port">
        <div className="dw">
          <section className="dw-card dw-prose" id="s3-rate">
            <h2>Site visit-to-demo request rate</h2>
            <p>{I.period}: <b>{int(I.demoRequests)}</b> requests from <b>{int(I.sessions)}</b> Google Analytics sessions = <b>{pct2(rate)}</b>. Excluding LinkedIn ad traffic, it's <b>{pct2(rateExPs)}</b>. Per engaged session, <b>{pct2(rateEng)}</b>.</p>
            <ManualDataFlag>
              Entered by hand from a HubSpot export (demo requests) and Google Analytics (sessions), covering {I.periodDates}. Last updated {I.updated}. It doesn't follow the date buttons.
            </ManualDataFlag>
          </section>
        </div>
      </div>
    </>
  );
}
