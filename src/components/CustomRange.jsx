import { useEffect, useRef, useState } from "react";

// A custom date range is stored in the same `days` state the presets use, as
// "YYYY-MM-DD..YYYY-MM-DD", so every dashboard can keep passing one value around.
const RE = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/;

const pad = n => String(n).padStart(2, "0");
export const toIsoDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

export function isCustomKey(v) { return typeof v === "string" && RE.test(v); }

export function makeCustomKey(from, to) { return `${from}..${to}`; }

// Current range plus the equal-length period right before it (for the % change).
export function customDates(v) {
  if (!isCustomKey(v)) return null;
  const [, a, b] = v.match(RE);
  const start = parseDay(a);
  const end   = parseDay(b);
  const len   = Math.round((end - start) / 86400000) + 1;
  const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - len + 1);
  return { start, end, prevStart, prevEnd, len };
}

export function customLabel(v) {
  const c = customDates(v);
  if (!c) return null;
  const sameYear = c.start.getFullYear() === c.end.getFullYear();
  const f = (d, withYear) => d.toLocaleString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) });
  return `${f(c.start, !sameYear)} – ${f(c.end, true)}`;
}

export function CustomRangeButton({ value, onApply, colors }) {
  const { active: activeBg, white, grey, border, panel = "#111" } = colors;
  const isActive = isCustomKey(value);
  const today = toIsoDay(new Date());
  const current = customDates(value);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(current ? toIsoDay(current.start) : "");
  const [to, setTo]     = useState(current ? toIsoDay(current.end) : today);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const valid = from && to && from <= to && to <= today;
  const inputStyle = {
    background: "#000", color: white, border: `1px solid ${border}`, borderRadius: 5,
    padding: "5px 8px", fontSize: 12, colorScheme: "dark", width: "100%",
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
        background: isActive ? activeBg : "transparent",
        color: isActive ? white : grey,
        fontSize: 11, transition: "all 0.15s", whiteSpace: "nowrap",
      }}>{isActive ? customLabel(value) : "Custom"}</button>
      {open && (
        <div style={{
          position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
          background: panel, border: `1px solid ${border}`, borderRadius: 8, padding: 12,
          display: "flex", flexDirection: "column", gap: 10, width: 220,
          boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
        }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: grey }}>
            From
            <input type="date" value={from} max={to || today} onChange={e => setFrom(e.target.value)} style={inputStyle} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, color: grey }}>
            To
            <input type="date" value={to} min={from || undefined} max={today} onChange={e => setTo(e.target.value)} style={inputStyle} />
          </label>
          <button disabled={!valid} onClick={() => { setOpen(false); onApply(makeCustomKey(from, to)); }} style={{
            padding: "6px 10px", borderRadius: 5, border: "none",
            cursor: valid ? "pointer" : "default", opacity: valid ? 1 : 0.4,
            background: activeBg, color: white, fontSize: 12, fontWeight: 600,
          }}>Apply</button>
        </div>
      )}
    </div>
  );
}
