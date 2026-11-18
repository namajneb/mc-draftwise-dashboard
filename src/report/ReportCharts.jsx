import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { REPORT_CSS } from "./reportCss";
import { REPORT_HTML } from "./reportHtml";
import { runReport } from "./reportScript";

import adClicks from "./data/ad_clicks.csv?raw";
import gscDaily from "./data/gsc_daily.csv?raw";
import gaDaily from "./data/ga_daily.csv?raw";
import hubspotDaily from "./data/hubspot_daily.csv?raw";
import leadsWeekly from "./data/leads_weekly.csv?raw";
import spendWeekly from "./data/spend_vs_demos_weekly.csv?raw";
import spendMonthly from "./data/spend_vs_demos_monthly.csv?raw";
import liImpressions from "./data/li_impressions_monthly.csv?raw";

// The charts from the Draftwise traffic report, drawn by the report's own code
// (reportScript.js, copied verbatim) so they match it exactly. The report runs
// inside a dashboard runtime that provides `dash`; this is a minimal stand-in
// for the parts the copied code uses, fed from a fixed snapshot of its data.

const CSV = {
  ad_clicks: adClicks,
  gsc_daily: gscDaily,
  ga_daily: gaDaily,
  hubspot_daily: hubspotDaily,
  leads_weekly: leadsWeekly,
  spend_vs_demos_weekly: spendWeekly,
  spend_vs_demos_monthly: spendMonthly,
  li_impressions_monthly: liImpressions,
};

function parse(text) {
  // Same shape as the report runtime: cells are text, an empty cell is null.
  const rows = d3.csvParse(text.trim(), r => {
    const o = {};
    for (const k in r) o[k] = r[k] === "" ? null : r[k];
    return o;
  });
  return rows;
}

function makeDash() {
  const datasets = Object.fromEntries(Object.entries(CSV).map(([id, text]) => [id, parse(text)]));
  const calcs = new Map();
  const cache = new Map();
  const listeners = [];

  const data = (id) => {
    if (datasets[id]) {
      const rows = datasets[id];
      return { status: "ok", data: rows, columns: rows.columns, message: "", refreshing: false, truncated: false, meta: [] };
    }
    if (calcs.has(id)) {
      if (!cache.has(id)) {
        const def = calcs.get(id);
        const inputs = def.inputs.map(i => data(i));
        const bad = inputs.find(x => x.status !== "ok");
        if (bad) return { status: bad.status, data: null };
        let value;
        try { value = def.fn(...inputs.map(x => x.data)); } catch (e) { return { status: "error", data: null, message: String(e) }; }
        cache.set(id, value);
      }
      return { status: "ok", data: cache.get(id), message: "", refreshing: false, truncated: false };
    }
    return { status: "missing", data: [] };
  };

  return {
    data,
    calc: (id, def) => { calcs.set(id, def); },
    onData: (fn) => { listeners.push(fn); },
    setLink: () => {},
    colors: Array.from({ length: 8 }, (_, i) => `var(--cds-chart-categorical-${i + 1})`),
    _run: () => listeners.forEach(fn => fn()),
  };
}

export default function ReportCharts() {
  const root = useRef(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const dash = makeDash();
    runReport(dash, d3);
    let lastW = -1;
    const draw = () => {
      const w = el.clientWidth;
      if (w === lastW) return;   // redraw only when the width changes, like the report
      lastW = w;
      dash._run();
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <>
      <style>{REPORT_CSS}</style>
      <div className="dw-port" ref={root} dangerouslySetInnerHTML={{ __html: REPORT_HTML }} />
    </>
  );
}
