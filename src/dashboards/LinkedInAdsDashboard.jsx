import { useState, useCallback, useEffect, useRef } from "react";
import { useIsNarrow } from "../hooks/useIsNarrow";

const C = {
  white:     "#FFFFFF",
  offWhite:  "#f0f2f5",
  lightGrey: "#b2b2b2",
  grey:      "#666666",
  blue:      "#579ed1",
  gold:      "#ffab40",
  black:     "#000000",
  charcoal:  "#0c0c0c",
  surface:   "#111111",
  divider:   "#181818",
  border:    "#1e1e1e",
  green:     "#3dbb7a",
  red:       "#e05252",
  // Derived — the same hues at low alpha, for fills sitting behind their own text.
  blueDim:   "#579ed122",
  goldDim:   "#ffab4022",
  greenDim:  "#3dbb7a18",
  redDim:    "#e0525218",
};

const ACCOUNT = { id: "513153545", name: "Draftwise" };

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
  const encoded = encodeURIComponent(path);
  const res = await fetch(`/api/linkedin?path=${encoded}`);
  const json = await res.json();
  if (!res.ok) throw new Error(liErrorMessage(json, res.status));
  return json;
}

// The /v2 `q=account` finders are retired (404 RESOURCE_NOT_FOUND), and the /rest
// collections ignore `start` — they page by an opaque metadata.nextPageToken cursor.
async function fetchRestPages(pathBase, { cap = 5 } = {}) {
  const out = [];
  let token = null;
  for (let page = 0; page < cap; page++) {
    const sep  = pathBase.includes("?") ? "&" : "?";
    const path = `${pathBase}${sep}count=100${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
    const data = await liApiFetch(path);
    const els  = data.elements || [];
    out.push(...els);
    token = data.metadata?.nextPageToken;
    if (!token || els.length < 100) break;
  }
  return out;
}

async function fetchCampaigns(accountId) {
  const els = await fetchRestPages(`/rest/adAccounts/${accountId}/adCampaigns?q=search`);
  return els.map(c => ({
    id:     String(c.id),
    name:   c.name,
    status: c.status,
    type:   c.type || c.format || null,
  }));
}

async function fetchCampaignsByIds(campaignIds) {
  const results = await Promise.all(
    campaignIds.map(id =>
      liApiFetch(`/v2/adCampaignsV2/${id}?fields=id,name,status`).catch(() => null)
    )
  );
  return results.filter(c => c && c.id && c.name);
}

async function fetchCreatives(accountId) {
  const els = await fetchRestPages(`/rest/adAccounts/${accountId}/creatives?q=criteria`);
  // Deliberately no `status` on the result. The old per-id GETs returned no status
  // field either, so ads carried null and passed the "Active only" filter; mapping
  // intendedStatus here instead would hide the 86% of creatives that are PAUSED.
  return els.map(c => ({
    id:        String(c.id).split(":").pop(),
    name:      c.name || null,
    campaign:  c.campaign,
    reference: c.content?.reference || null,
    changeAuditStamps: { created: { time: c.createdAt } },
  }));
}

// The rendered ad preview is the only view that shows the creative as LinkedIn
// actually displays it. /rest/adPreviews is part of the Advertising API, so it works
// on ads scopes alone — unlike /v2/ugcPosts and /v2/shares, which need organic
// permissions and return 403. LinkedIn's iframe src is valid for only ~3 hours, so
// these are fetched per session in the browser and never persisted.
async function fetchAdPreview(creativeId, accountId) {
  try {
    const creative = encodeURIComponent(`urn:li:sponsoredCreative:${creativeId}`);
    const account  = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
    const data = await liApiFetch(`/rest/adPreviews?q=creative&creative=${creative}&account=${account}`);
    const els  = data.elements || [];
    // One element per placement. The desktop render stacks the caption above the
    // creative; mobile is a wide letterbox. Order is not guaranteed.
    const el   = els.find(e => e.placement?.linkedin?.contentPresentationType === "DESKTOP_WEBSITE") || els[0];
    const html = el?.preview;
    if (!html) return null;
    // LinkedIn quotes the attributes with single quotes: <iframe src='…' height=580 …>
    const src = html.replace(/&amp;/g, "&").match(/src=["\']([^"\']+)["\']/)?.[1];
    return src ? { src } : null;
  } catch {
    // Some creative types have no preview and 422 — a missing thumbnail, not an error.
    return null;
  }
}

async function fetchCreativesByIds(creativeIds) {
  const results = await Promise.all(
    creativeIds.map(id =>
      liApiFetch(`/v2/adCreativesV2/${id}`).catch(() => null)
    )
  );
  return results.filter(c => c && c.id);
}

function findMediaUrn(obj, depth = 0) {
  if (depth > 6 || !obj || typeof obj !== "object") return null;
  for (const [key, val] of Object.entries(obj)) {
    if (key === "media" && typeof val === "string" &&
        (val.includes("urn:li:image:") || val.includes("urn:li:digitalmediaAsset:"))) return val;
    if (typeof val === "object") {
      const found = findMediaUrn(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function parseCreativeContent(creative) {
  const creativeRef = typeof creative?.reference === "string"
    ? creative.reference
    : (creative?.reference?.["$URN"] || null);
  const data = creative?.variables?.data || {};
  // LinkedIn names the variables type after the ad format, so a carousel says so itself:
  // com.linkedin.ads.SponsoredUpdateCarouselCreativeVariables. That matters because the
  // post lookups that used to spot a multi-image share need r_organization_social, and
  // this dashboard's token routinely lacks it — carouselUrns comes back empty.
  const isCarousel = Object.keys(data).some(k => /Carousel/i.test(k));
  for (const key of Object.keys(data)) {
    const d   = data[key];
    const usc = d.userSelectedContent || d;
    const name = usc.headline || usc.title || d.title || d.headline || d.text || null;
    const imageUrn     = findMediaUrn(d);
    const referenceUrn = creativeRef || d.activity || null;
    if (name || imageUrn || referenceUrn) return { name: name || null, imageUrn, referenceUrn, isCarousel };
  }
  return { name: null, imageUrn: null, referenceUrn: creativeRef, isCarousel };
}

// Reading post text needs r_organization_social; an ads-only token gets 403
// ACCESS_DENIED on every one of these. Probing one URN per kind first means a narrow
// token costs 2 requests rather than one per ad (~165). The tradeoff is that a single
// unlucky failure skips its whole kind — acceptable against 11s of certain waste.
async function probeReadable(path) {
  return liApiFetch(path).then(() => true).catch(() => false);
}

async function fetchPostData(postUrns) {
  if (!postUrns.length) return { names: {}, imageUrls: {}, carouselUrns: new Set() };
  const names = {}, imageUrls = {}, carouselUrns = new Set();
  let ugcUrns   = postUrns.filter(u => u.includes("ugcPost"));
  let shareUrns = postUrns.filter(u => u.includes(":share:") || u.includes(":activity:"));

  const [ugcOk, shareOk] = await Promise.all([
    ugcUrns.length   ? probeReadable(`/v2/ugcPosts/${encodeURIComponent(ugcUrns[0])}`) : false,
    shareUrns.length ? probeReadable(`/v2/shares/${encodeURIComponent(shareUrns[0])}`) : false,
  ]);
  if (!ugcOk)   ugcUrns   = [];
  if (!shareOk) shareUrns = [];
  if (ugcUrns.length) {
    await Promise.all(ugcUrns.map(async urn => {
      try {
        const post  = await liApiFetch(`/v2/ugcPosts/${encodeURIComponent(urn)}`);
        const share = post?.specificContent?.["com.linkedin.ugc.ShareContent"];
        const text  = share?.shareCommentary?.text;
        if (text) names[urn] = text.slice(0, 80);
        const media = share?.media || [];
        if (media.length > 1) carouselUrns.add(urn);
        const thumb = media[0]?.thumbnails?.[0]?.url || media[0]?.thumbnail?.url || media[0]?.originalUrl || null;
        if (thumb) imageUrls[urn] = thumb;
      } catch {}
    }));
  }
  if (shareUrns.length) {
    await Promise.all(shareUrns.map(async urn => {
      try {
        const share = await liApiFetch(`/v2/shares/${encodeURIComponent(urn)}`);
        const text  = share?.text?.text || share?.subject;
        if (text) names[urn] = text.slice(0, 80);
        const entities = share?.content?.contentEntities || [];
        if (entities.length > 1) carouselUrns.add(urn);
        const thumb = share?.content?.thumbnailUrl
                   || entities[0]?.thumbnails?.[0]?.resolvedUrl
                   || entities[0]?.thumbnails?.[0]?.url
                   || entities[0]?.entityLocation || null;
        if (thumb) imageUrls[urn] = thumb;
      } catch {}
    }));
  }
  return { names, imageUrls, carouselUrns };
}

async function fetchAssetUrls(assetUrns) {
  if (!assetUrns.length) return {};
  const ids  = `List(${assetUrns.map(u => encodeURIComponent(u)).join(",")})`;
  const data = await liApiFetch(`/v2/assets?ids=${ids}`).catch(() => ({}));
  const map  = {};
  Object.entries(data.results || {}).forEach(([urn, val]) => {
    const url = val?.recipes?.[0]?.downloadUrl || val?.downloadUrl;
    if (url) map[urn] = url;
  });
  return map;
}

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

function getLiDateRange(value) {
  const toObj = d => ({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
  if (isMonthKey(value)) {
    const [y, m] = value.split("-").map(Number);
    const start    = new Date(y, m - 1, 1);
    const end      = new Date(y, m, 0);
    const prevStart = new Date(y, m - 2, 1);
    const prevEnd   = new Date(y, m - 1, 0);
    return { current: { start: toObj(start), end: toObj(end) }, prev: { start: toObj(prevStart), end: toObj(prevEnd) } };
  }
  const days = value;
  const now   = new Date();
  const end   = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return { current: { start: toObj(start), end: toObj(end) }, prev: { start: toObj(prevStart), end: toObj(prevEnd) } };
}

function buildAnalyticsPath(accountId, range, pivot = "CAMPAIGN") {
  const urn = `urn:li:sponsoredAccount:${accountId}`;
  const { start: s, end: e } = range;
  const dateRange = `(start:(day:${s.day},month:${s.month},year:${s.year}),end:(day:${e.day},month:${e.month},year:${e.year}))`;
  return `/v2/adAnalyticsV2?q=analytics&pivot=${pivot}&timeGranularity=ALL&dateRange=${dateRange}` +
    `&accounts=List(${encodeURIComponent(urn)})&fields=impressions,clicks,costInLocalCurrency,externalWebsiteConversions,pivotValues`;
}

async function fetchAnalytics(accountId, range, pivot = "CAMPAIGN") {
  const data = await liApiFetch(buildAnalyticsPath(accountId, range, pivot));
  return data.elements || [];
}

function scoreAd(m) {
  const ctr       = m.impressions > 0 ? (m.clicks / m.impressions) * 100 : 0;
  const cpc       = m.clicks > 0 ? m.spend / m.clicks : 0;
  const ctrScore  = Math.min(ctr / 1.0, 1) * 40;
  const convScore = Math.min(m.conversions / 10, 1) * 30;
  const cpcScore  = cpc > 0 ? Math.max(1 - cpc / 30, 0) * 20 : 0;
  const clickScore = Math.min(m.clicks / 200, 1) * 10;
  return Math.round(ctrScore + convScore + cpcScore + clickScore);
}

function timeSince(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1)  return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function ctrColor(ctr) {
  if (ctr >= 0.01) return C.green;
  if (ctr >= 0.004) return C.blue;
  if (ctr > 0) return C.gold;
  return C.lightGrey;
}

function scoreColor(score) {
  const s = Math.max(0, Math.min(100, score)) / 100;
  let r, g, b;
  if (s < 0.5) {
    const t = s / 0.5;
    r = Math.round(224 + (255 - 224) * t);
    g = Math.round(82  + (171 - 82)  * t);
    b = Math.round(82  + (64  - 82)  * t);
  } else {
    const t = (s - 0.5) / 0.5;
    r = Math.round(255 + (61  - 255) * t);
    g = Math.round(171 + (187 - 171) * t);
    b = Math.round(64  + (122 - 64)  * t);
  }
  return `rgb(${r},${g},${b})`;
}

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000)    return (n / 1000).toFixed(1) + "K";
  return Math.round(n).toString();
}
function fmtUSD(n)  { return "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 }); }
function fmtCTR(n)  { return n ? (n * 100).toFixed(2) + "%" : "—"; }
function fmtCPC(spendOrVal, clicks) {
  const val = clicks !== undefined ? (clicks > 0 ? spendOrVal / clicks : 0) : spendOrVal;
  return val > 0 ? "$" + Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
}
function fmtCPConv(spend, conv) { return conv > 0 ? fmtUSD(spend / conv) : "—"; }

const THUMB_COLORS = ["#dde3ea","#d6dde6","#e2ddd8","#d8e2dd","#e0dae2","#dde0e2","#e2e0d8","#d8dce2","#e2d8dd","#dadada"];

// A carousel is the one format the embedded preview cannot draw. LinkedIn renders the
// actor header and the ad copy, then lays its media strip out at zero height, so the rest
// of the tile is empty white that reads as a broken thumbnail. Crop to the part that does
// render and label the rest. The slides themselves live on /rest/posts and /v2/shares,
// which 403 without r_organization_social — that is a token problem, not a layout one.
const CARD_COPY_H = 260;   // unscaled px — actor header plus about four lines of copy

// Thumbnail size. Every dimension inside CreativeThumb is expressed as a multiple of
// THUMB_W so the whole tile — iframe scale, corner radius, carousel chip, placeholder
// glyph — grows evenly from this one number. 374 is the 187px original doubled.
const THUMB_W        = 374;
const THUMB_NARROW_W = 187;   // 374 + the row's padding and page gutters overflows a phone
const THUMB_NARROW_AT = 480;

function CreativeThumb({ name, imageUrl, previewSrc, isCarousel }) {
  const w = useIsNarrow(THUMB_NARROW_AT) ? THUMB_NARROW_W : THUMB_W;
  const u = px => Math.round(px * w / 187);   // scale a 187-era dimension to the current width

  if (previewSrc) {
    const scale  = w / 552;
    const frameH = Math.round((isCarousel ? CARD_COPY_H : 552) * scale);
    return (
      <div style={{ width: w, borderRadius: u(8), flexShrink: 0, overflow: "hidden", border: `1px solid ${C.border}`, background: C.surface }}>
        <div style={{ width: w, height: frameH, overflow: "hidden", position: "relative" }}>
          <iframe
            src={previewSrc}
            title={name}
            scrolling="no"
            style={{ position: "absolute", left: 0, top: 0, width: 552, height: 552, transform: `scale(${scale})`, transformOrigin: "top left", border: "none", pointerEvents: "none", display: "block" }}
          />
        </div>
        {isCarousel && (
          <div style={{ display: "flex", alignItems: "center", gap: u(5), padding: `${u(6)}px ${u(8)}px`, background: C.charcoal, borderTop: `1px solid ${C.border}` }}>
            <svg width={u(10)} height={u(10)} viewBox="0 0 11 11" fill="none"><rect x="0" y="0" width="5" height="5" rx="1" fill={C.lightGrey}/><rect x="6" y="0" width="5" height="5" rx="1" fill={C.lightGrey}/><rect x="0" y="6" width="5" height="5" rx="1" fill={C.lightGrey}/><rect x="6" y="6" width="5" height="5" rx="1" fill={C.lightGrey}/></svg>
            <span style={{ fontSize: u(9), fontWeight: 600, color: C.lightGrey, letterSpacing: "0.05em", textTransform: "uppercase" }}>Carousel</span>
          </div>
        )}
      </div>
    );
  }
  if (imageUrl) {
    return (
      <div style={{ position: "relative", flexShrink: 0, width: w, height: w }}>
        <img src={imageUrl} alt={name} style={{ width: w, height: w, borderRadius: u(8), objectFit: "cover", border: `1px solid ${C.border}`, display: "block" }} />
        {isCarousel && (
          <div style={{ position: "absolute", top: u(5), right: u(5), background: "rgba(0,0,0,0.72)", borderRadius: u(4), width: u(18), height: u(18), display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width={u(11)} height={u(11)} viewBox="0 0 11 11" fill="none"><rect x="0" y="0" width="5" height="5" rx="1" fill="#fff"/><rect x="6" y="0" width="5" height="5" rx="1" fill="#fff"/><rect x="0" y="6" width="5" height="5" rx="1" fill="#fff"/><rect x="6" y="6" width="5" height="5" rx="1" fill="#fff"/></svg>
          </div>
        )}
      </div>
    );
  }
  const bgColors = ["#1a2030","#1a2820","#2a1a20","#201a2a","#1a2228","#282018","#181c28","#281820","#201828","#1e2020"];
  const accents  = ["#579ed1","#3dbb7a","#e05252","#a78bfa","#38bdf8","#ffab40","#4ade80","#f472b6","#818cf8","#94a3b8"];
  const colorIdx = Math.abs((name?.charCodeAt(0) ?? 0) + (name?.charCodeAt(2) ?? 0)) % bgColors.length;
  const bg       = bgColors[colorIdx];
  const accent   = accents[colorIdx];
  const displayName = name ? name.slice(0, 60) : "Ad Creative";
  return (
    <div style={{ width: w, height: w, borderRadius: u(8), flexShrink: 0, background: bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: u(10), border: `1px solid rgba(255,255,255,0.07)` }}>
      <svg width={u(24)} height={u(24)} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="24" height="24" rx="4" fill={accent} opacity="0.18"/>
        <path d="M6 8h2v8H6V8zm5-1a3 3 0 0 1 3 3v5h-2v-5a1 1 0 0 0-1-1 1 1 0 0 0-1 1v5h-2V7h2v.93A3 3 0 0 1 11 7z" fill={accent}/>
      </svg>
      <span style={{ fontSize: u(11), fontWeight: 500, color: "#c8cdd4", textAlign: "center", padding: `0 ${u(12)}px`, lineHeight: 1.4, wordBreak: "break-word" }}>{displayName}</span>
    </div>
  );
}

function MetricCell({ label, value, accent }) {
  return (
    <div style={{ flex: "1 1 0", textAlign: "center", minWidth: 56 }}>
      <div style={{ fontSize: 10, color: C.lightGrey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: accent || C.offWhite, lineHeight: 1, fontFamily: "'Inter', sans-serif" }}>{value}</div>
    </div>
  );
}

function ScoreBadge({ score }) {
  return (
    <div style={{ flex: "1 1 0", textAlign: "center", minWidth: 56 }}>
      <div style={{ fontSize: 10, color: C.lightGrey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 4 }}>Score</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: scoreColor(score), fontFamily: "'Inter', sans-serif", lineHeight: 1, marginBottom: 5 }}>{score}</div>
      <div style={{ width: 40, height: 3, borderRadius: 2, background: "linear-gradient(to right, #e05252, #ffab40, #3dbb7a)", overflow: "hidden", position: "relative", margin: "0 auto" }}>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${100 - score}%`, background: C.charcoal }} />
      </div>
    </div>
  );
}

function AdRow({ ad, isTop, isBottom, campaignName }) {
  const m = ad.metrics;
  const score = scoreAd(m);
  const cpcAccent = m.clicks > 0 ? scoreColor(Math.max(1 - (m.spend / m.clicks) / 30, 0) * 100) : C.lightGrey;
  const daysOld = ad.createdTime ? Math.floor((Date.now() - ad.createdTime) / 86400000) : null;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20, padding: "16px 20px",
      borderRadius: 10, flexWrap: "wrap", marginBottom: 8,
      background: isTop ? C.greenDim : isBottom ? C.redDim : C.charcoal,
      border: `1px solid ${isTop ? C.green + "44" : isBottom ? C.red + "44" : C.border}`,
    }}>
      <CreativeThumb name={ad.name} imageUrl={ad.imageUrl} previewSrc={ad.preview?.src} isCarousel={ad.isCarousel} />
      <div style={{ flex: "1 1 160px", minWidth: 140 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.offWhite }}>{ad.name}</span>
          {isTop    && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenDim, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.green}33` }}>▲ Top 20%</span>}
          {isBottom && <span style={{ fontSize: 10, fontWeight: 600, color: C.red,   background: C.redDim,   padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.red}33`   }}>▼ Bottom 20%</span>}
        </div>
        <div style={{ fontSize: 11, color: C.lightGrey, fontFamily: "'Inter', sans-serif", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: C.green }}>● Active</span>
          {campaignName && (
            <span style={{ color: C.grey, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}
                  title={campaignName}>in {campaignName}</span>
          )}
        </div>
      </div>
      {/* 8 cells at a 56px floor need ~450px; wrapping lets them form rows on a phone
          instead of pushing the card past the viewport. */}
      <div style={{ display: "flex", flex: "1 1 480px", alignItems: "flex-start", flexWrap: "wrap", rowGap: 14 }}>
        <ScoreBadge score={score} />
        <MetricCell label="Age"     value={daysOld != null ? `${daysOld}d` : "—"} accent={daysOld != null && daysOld < 7 ? C.gold : undefined} />
        <MetricCell label="Impr."   value={fmt(m.impressions)} />
        <MetricCell label="Clicks"  value={fmt(m.clicks)} />
        <MetricCell label="CTR"     value={fmtCTR(m.ctr)} />
        <MetricCell label="CPC"     value={fmtCPC(m.spend, m.clicks)} accent={cpcAccent} />
        <MetricCell label="Conv."   value={fmt(m.conversions)} />
        <MetricCell label="CPConv." value={fmtCPConv(m.spend, m.conversions)} />
        <MetricCell label="Spend"   value={fmtUSD(m.spend)} />
      </div>
    </div>
  );
}

function tickerColor(curr, prev, invert = false) {
  if (!prev || prev === 0) return "#333";
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return "#333";
  return (invert ? pct < 0 : pct > 0) ? "#3dbb7a" : "#e05252";
}

function Ticker({ curr, prev, invert = false }) {
  if (!prev || prev === 0) return null;
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return null;
  const up   = pct > 0;
  const good = invert ? !up : up;
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: good ? "#3dbb7a" : "#e05252", marginLeft: 5 }}>
      {up ? "↑" : "↓"}{Math.abs(pct).toFixed(1)}%
    </span>
  );
}

function SummaryBar({ ads, prevMap, prevCampaignMetrics }) {
  const t = ads.reduce((acc, a) => {
    acc.impressions += a.metrics.impressions || 0;
    acc.clicks      += a.metrics.clicks      || 0;
    acc.spend       += a.metrics.spend       || 0;
    acc.conversions += a.metrics.conversions || 0;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0 });

  const p = prevCampaignMetrics || ads.reduce((acc, a) => {
    const pm = prevMap?.[a.id];
    if (!pm) return acc;
    acc.spend       += pm.spend       || 0;
    acc.clicks      += pm.clicks      || 0;
    acc.impressions += pm.impressions || 0;
    acc.conversions += pm.conversions || 0;
    return acc;
  }, { spend: 0, clicks: 0, impressions: 0, conversions: 0 });

  const ctr      = t.impressions > 0 ? t.clicks / t.impressions : 0;
  const prevCtr  = p.impressions > 0 ? p.clicks / p.impressions : 0;
  const cpc      = t.clicks > 0 ? t.spend / t.clicks : 0;
  const prevCpc  = p.clicks > 0 ? p.spend / p.clicks : 0;
  const cpcConv  = t.conversions > 0 ? t.spend / t.conversions : 0;
  const prevCpcConv = p.conversions > 0 ? p.spend / p.conversions : 0;

  const cards = [
    { label: "Impressions",  value: fmt(t.impressions),             ticker: <Ticker curr={t.impressions} prev={p.impressions} />, accent: tickerColor(t.impressions, p.impressions) },
    { label: "Clicks",       value: fmt(t.clicks),                  ticker: <Ticker curr={t.clicks}      prev={p.clicks} />,       accent: tickerColor(t.clicks, p.clicks) },
    { label: "CTR",          value: fmtCTR(ctr),                    ticker: <Ticker curr={ctr}           prev={prevCtr} />,         accent: tickerColor(ctr, prevCtr) },
    { label: "CPC",          value: fmtCPC(cpc),                    ticker: <Ticker curr={cpc}           prev={prevCpc} invert />,  accent: tickerColor(cpc, prevCpc, true) },
    { label: "Conversions",  value: fmt(t.conversions),             ticker: <Ticker curr={t.conversions} prev={p.conversions} />,   accent: tickerColor(t.conversions, p.conversions) },
    { label: "Cost / Conv.", value: cpcConv > 0 ? fmtUSD(cpcConv) : "—", ticker: <Ticker curr={cpcConv} prev={prevCpcConv} invert />, accent: tickerColor(cpcConv, prevCpcConv, true) },
  ];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} style={{ flex: "1 1 100px", background: C.charcoal, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.border}`, borderTop: `3px solid ${c.accent}` }}>
          <div style={{ fontSize: 10, color: C.lightGrey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: C.offWhite, fontFamily: "'Inter', sans-serif" }}>{c.value}</div>
            {c.ticker}
          </div>
        </div>
      ))}
    </div>
  );
}

function buildInsights(ads, prevMap) {
  const insights = [];
  const t = ads.reduce((acc, a) => {
    acc.spend       += a.metrics.spend       || 0;
    acc.clicks      += a.metrics.clicks      || 0;
    acc.impressions += a.metrics.impressions || 0;
    acc.conversions += a.metrics.conversions || 0;
    return acc;
  }, { spend: 0, clicks: 0, impressions: 0, conversions: 0 });
  const p = ads.reduce((acc, a) => {
    const pm = prevMap?.[a.id];
    if (!pm) return acc;
    acc.spend       += pm.spend       || 0;
    acc.clicks      += pm.clicks      || 0;
    acc.conversions += pm.conversions || 0;
    return acc;
  }, { spend: 0, clicks: 0, conversions: 0 });

  const ctr      = t.impressions > 0 ? (t.clicks / t.impressions) * 100 : 0;
  const cpc      = t.clicks > 0 ? t.spend / t.clicks : 0;
  const convRate = t.clicks > 0 ? (t.conversions / t.clicks) * 100 : 0;
  const prevCpc  = p.clicks > 0 ? p.spend / p.clicks : 0;
  const prevConv = p.conversions;
  const scored   = [...ads].sort((a, b) => scoreAd(b.metrics) - scoreAd(a.metrics));
  const topAd    = scored[0];
  const botAd    = scored[scored.length - 1];

  if (ctr >= 0.6) {
    insights.push({ type: "positive", icon: "🎯", title: "Strong CTR — audience resonating",
      body: `Campaign CTR is ${ctr.toFixed(2)}%, well above LinkedIn's ~0.4% benchmark. Your creative and targeting are well-aligned. Consider expanding reach with a broader matched audience.` });
  } else if (ctr >= 0.3) {
    insights.push({ type: "neutral", icon: "📊", title: "Average CTR — room to improve",
      body: `CTR is ${ctr.toFixed(2)}%. Typical for LinkedIn but not exceptional. A/B test your headline copy or try a different creative format (e.g., carousel vs. single image) to lift engagement.` });
  } else if (t.impressions > 500) {
    insights.push({ type: "warning", icon: "⚠️", title: "Low CTR — creative may need refresh",
      body: `CTR is ${ctr.toFixed(2)}%, below the 0.3% LinkedIn benchmark. Review your creative angles, audience targeting, and call-to-action. Pausing the lowest-scoring ads may lift the average.` });
  }

  if (cpc > 0 && cpc > 20) {
    insights.push({ type: "warning", icon: "💸", title: "High CPC — review bidding strategy",
      body: `Average CPC is ${fmtCPC(cpc)}, which is high. Consider switching from Max Clicks to Manual CPC bidding, narrowing audience to improve relevance score, or refreshing creatives to improve CTR.` });
  } else if (cpc > 0 && cpc < 8) {
    insights.push({ type: "positive", icon: "💰", title: "Efficient CPC — strong click value",
      body: `Average CPC is ${fmtCPC(cpc)}, which is well below LinkedIn norms. Your relevance scores are working. Consider scaling spend to capture more of this efficient traffic.` });
  }

  if (prevCpc > 0 && cpc > 0) {
    const delta = ((cpc - prevCpc) / prevCpc) * 100;
    if (delta >= 25) {
      insights.push({ type: "warning", icon: "📈", title: "CPC rising vs prior period",
        body: `CPC increased ${delta.toFixed(0)}% vs the prior period (now ${fmtCPC(cpc)}). This may indicate increased auction competition or creative fatigue. Test new ad variants.` });
    }
  }

  if (t.clicks >= 20 && convRate < 1) {
    insights.push({ type: "warning", icon: "🛑", title: "Low conversion rate",
      body: `Only ${convRate.toFixed(1)}% of clicks convert. Review your landing page for alignment with ad messaging, load speed, and form length. Consider LinkedIn Lead Gen Forms as an alternative.` });
  } else if (t.clicks >= 20 && convRate >= 3) {
    insights.push({ type: "positive", icon: "✅", title: "Strong conversion rate",
      body: `${convRate.toFixed(1)}% of clicks convert — that's strong for LinkedIn. Landing page and ad message are well-aligned. Consider increasing budget to scale this funnel.` });
  }

  if (prevConv > 0 && t.conversions > 0) {
    const delta = ((t.conversions - prevConv) / prevConv) * 100;
    if (delta <= -25) {
      insights.push({ type: "warning", icon: "📉", title: "Conversions dropping",
        body: `Conversions fell ${Math.abs(delta).toFixed(0)}% vs prior period. Check for landing page changes, audience overlap with other campaigns, or creative wear-out.` });
    } else if (delta >= 25) {
      insights.push({ type: "positive", icon: "📈", title: "Conversions trending up",
        body: `Conversions are up ${delta.toFixed(0)}% vs the prior period. Momentum is building — consider a modest budget increase while performance holds.` });
    }
  }

  if (topAd) {
    const s = scoreAd(topAd.metrics);
    const daysOld = topAd.createdTime ? Math.floor((Date.now() - topAd.createdTime) / 86400000) : null;
    if (s >= 40) {
      insights.push({ type: "positive", icon: "⭐", title: `Scale this ad: ${topAd.name}`,
        body: `Score ${s}/100 · CTR ${fmtCTR(topAd.metrics.ctr)} · ${topAd.metrics.conversions} conv.${daysOld ? ` · ${daysOld}d old` : ""}. Best performer in this campaign — increase its budget or duplicate to a similar audience segment.` });
    }
  }

  if (botAd && botAd.id !== topAd?.id) {
    const s = scoreAd(botAd.metrics);
    const daysOld = botAd.createdTime ? Math.floor((Date.now() - botAd.createdTime) / 86400000) : null;
    if (s < 30) {
      const ageNote = daysOld == null ? "" : daysOld < 7 ? " It's still in the early learning phase — allow until day 14 before pausing." : daysOld >= 14 ? ` At ${daysOld} days, it's past the learning phase.` : "";
      const action  = daysOld == null || daysOld >= 14 ? "Pause and reallocate budget to higher-scoring ads." : "Hold — let it clear the learning phase first.";
      insights.push({ type: daysOld != null && daysOld < 7 ? "neutral" : "negative", icon: "🔻", title: `Underperformer: ${botAd.name}`,
        body: `Score ${s}/100 · CTR ${fmtCTR(botAd.metrics.ctr)} · ${botAd.metrics.conversions} conv.${ageNote} ${action}` });
    }
  }

  return insights;
}

const INSIGHT_COLORS = {
  positive: { bg: C.green + "0f", border: C.green + "33", label: C.green },
  neutral:  { bg: C.blue  + "0f", border: C.blue  + "33", label: C.blue  },
  warning:  { bg: C.gold  + "0f", border: C.gold  + "33", label: C.gold  },
  negative: { bg: C.red   + "0f", border: C.red   + "33", label: C.red   },
};

function InsightsPanel({ ads, prevMap }) {
  if (!ads.length) return null;
  const insights = buildInsights(ads, prevMap);
  if (!insights.length) return null;
  return (
    <div style={{ borderRadius: 10, background: C.charcoal, padding: "24px 28px", marginBottom: 24, border: `1px solid #222` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: C.blue + "22", border: `1px solid ${C.blue}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🧠</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.white, letterSpacing: "-0.01em" }}>Campaign Insights</div>
          <div style={{ fontSize: 11, color: C.grey, fontFamily: "'Inter', sans-serif", marginTop: 2 }}>{insights.length} recommendation{insights.length !== 1 ? "s" : ""} based on current performance</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 }}>
        {insights.map((ins, i) => {
          const clr = INSIGHT_COLORS[ins.type];
          return (
            <div key={i} style={{ background: clr.bg, border: `1px solid ${clr.border}`, borderRadius: 10, padding: "14px 18px", display: "flex", gap: 14, alignItems: "flex-start" }}>
              <span style={{ fontSize: 18, lineHeight: 1, marginTop: 1, flexShrink: 0 }}>{ins.icon}</span>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: clr.label, marginBottom: 4, fontFamily: "'Inter', sans-serif" }}>{ins.title}</div>
                <div style={{ fontSize: 12, color: C.lightGrey, lineHeight: 1.6, fontFamily: "'Inter', sans-serif" }}>{ins.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Cross-campaign comparison. `dir` is which way is *better*: 1 higher, -1 lower,
// 0 means the metric is volume rather than performance, so a winner is meaningless —
// a campaign spending more is not thereby worse, and colouring it red would imply it is.
const CMP_COLS = [
  { key: "spend",       label: "Spend",        dir:  0, render: r => fmtUSD(r.spend) },
  { key: "impressions", label: "Impr.",        dir:  0, render: r => fmt(r.impressions) },
  { key: "clicks",      label: "Clicks",       dir:  0, render: r => fmt(r.clicks) },
  { key: "ctr",         label: "CTR",          dir:  1, render: r => fmtCTR(r.ctr) },
  // zeroMissing: a 0 here is an undefined ratio (no clicks / no conversions), not a
  // result — so it must be ignored rather than winning a lowest-is-better column.
  // Conversions and CTR are the opposite: zero is a real, and bad, outcome.
  { key: "cpc",         label: "CPC",          dir: -1, zeroMissing: true, render: r => fmtCPC(r.cpc) },
  { key: "conversions", label: "Conv.",        dir:  1, render: r => fmt(r.conversions) },
  { key: "cpcConv",     label: "Cost / Conv.", dir: -1, zeroMissing: true, render: r => r.cpcConv > 0 ? fmtUSD(r.cpcConv) : "—" },
];

// Ratios are recomputed from summed volumes, never averaged across campaigns —
// averaging CTRs would weight a 100-impression campaign like a 100k one.
function cmpRow(id, name, status, m, prev) {
  const spend = m?.spend || 0, clicks = m?.clicks || 0;
  const impressions = m?.impressions || 0, conversions = m?.conversions || 0;
  return {
    id, name, status, spend, clicks, impressions, conversions,
    ctr:     impressions > 0 ? clicks / impressions : 0,
    cpc:     clicks      > 0 ? spend / clicks       : 0,
    cpcConv: conversions > 0 ? spend / conversions  : 0,
    prev: prev || null,
  };
}

// Only ratio columns treat 0 as missing (see zeroMissing above); for conversions a
// zero is a real outcome and has to be eligible to be the worst.
function bestWorst(rows, key, dir, zeroMissing) {
  if (!dir || rows.length < 2) return {};
  const vals = rows.map(r => r[key]).filter(v => Number.isFinite(v) && (zeroMissing ? v > 0 : true));
  if (vals.length < 2) return {};
  const hi = Math.max(...vals), lo = Math.min(...vals);
  if (hi === lo) return {};
  return dir > 0 ? { best: hi, worst: lo } : { best: lo, worst: hi };
}

// The table's natural width measured 1222px in Chrome — its 720px minWidth is a
// floor, not what it actually occupies. Add the 32px page gutters and the card's own
// padding and it needs ~1300px, so anything narrower stacks into one block per
// campaign instead. Stacking keeps every figure reachable; a drag bar hides half of
// them behind a gesture.
const COMPARE_STACK_AT = 1360;

function CampaignCompare({ rows }) {
  const stacked = useIsNarrow(COMPARE_STACK_AT);   // before the early return: hooks are unconditional
  if (rows.length < 2) return null;

  const marks = {};
  CMP_COLS.forEach(col => { marks[col.key] = bestWorst(rows, col.key, col.dir, col.zeroMissing); });

  const tot = rows.reduce((a, r) => ({
    spend: a.spend + r.spend, clicks: a.clicks + r.clicks,
    impressions: a.impressions + r.impressions, conversions: a.conversions + r.conversions,
  }), { spend: 0, clicks: 0, impressions: 0, conversions: 0 });
  const totalRow = cmpRow("__tot__", `All ${rows.length} selected`, null, tot, null);

  const th = { fontSize: 10, fontWeight: 600, color: C.grey, textTransform: "uppercase",
               letterSpacing: "0.07em", padding: "0 14px 10px", textAlign: "right", whiteSpace: "nowrap" };
  const td = { fontSize: 13, fontWeight: 600, padding: "13px 14px", textAlign: "right", whiteSpace: "nowrap" };

  // Previous-period value for the same metric, recomputed through cmpRow so the
  // ratio columns are derived the same way in both layouts.
  const prevOf = (r, key) => (r.prev ? cmpRow(r.id, r.name, r.status, r.prev, null)[key] : 0);

  const cellColor = (col, r) => {
    const mk = marks[col.key];
    if (mk.best === undefined) return C.offWhite;
    // A cell rendered as "—" carries no value, so it is never marked either way.
    if (col.zeroMissing && !(r[col.key] > 0)) return C.offWhite;
    if (r[col.key] === mk.best)  return C.green;
    if (r[col.key] === mk.worst) return C.red;
    return C.offWhite;
  };

  return (
    <div style={{ background: C.charcoal, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 24 }}>
      <div style={{ padding: "16px 20px 0", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.offWhite }}>Campaign Comparison</span>
        <span style={{ fontSize: 11, color: C.grey }}>
          {rows.length} campaigns · best in <span style={{ color: C.green }}>green</span>, worst in <span style={{ color: C.red }}>red</span>
        </span>
      </div>
      {stacked ? (
        <div style={{ display: "grid", gap: 8, padding: "14px 14px 16px" }}>
          {[...rows, totalRow].map((r, i) => {
            const isTotal = i === rows.length;
            return (
              <div key={r.id} style={{
                background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: "10px 12px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 9 }}>
                  {!isTotal && (
                    <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                   background: r.status === "ACTIVE" ? C.green : C.grey }} />
                  )}
                  <span style={{ fontSize: 12, fontWeight: 700, color: isTotal ? C.lightGrey : C.offWhite }}>
                    {r.name}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))", gap: "9px 10px" }}>
                  {CMP_COLS.map(col => (
                    <div key={col.key}>
                      <div style={{ fontSize: 9, color: C.grey, textTransform: "uppercase",
                                    letterSpacing: "0.07em", marginBottom: 3 }}>{col.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 600,
                                    color: isTotal ? C.lightGrey : cellColor(col, r) }}>
                        {col.render(r)}
                        {!isTotal && col.dir !== 0 && prevOf(r, col.key) > 0 && (
                          <Ticker curr={r[col.key]} prev={prevOf(r, col.key)} invert={col.dir < 0} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      // overflowX stays as a floor, not a scroll affordance: the stacked layout takes
      // over below 820px, so this only guards odd widths instead of overflowing the page.
      <div style={{ overflowX: "auto", padding: "14px 6px 6px" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left", paddingLeft: 14 }}>Campaign</th>
              {CMP_COLS.map(col => <th key={col.key} style={th}>{col.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} style={{ borderTop: `1px solid ${C.divider}` }}>
                <td style={{ ...td, textAlign: "left", fontWeight: 500, color: C.offWhite, maxWidth: 260,
                             overflow: "hidden", textOverflow: "ellipsis" }} title={r.name}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", marginRight: 8,
                                 background: r.status === "ACTIVE" ? C.green : C.grey }} />
                  {r.name}
                </td>
                {CMP_COLS.map(col => {
                  const prevVal = prevOf(r, col.key);
                  return (
                    <td key={col.key} style={{ ...td, color: cellColor(col, r) }}>
                      {col.render(r)}
                      {col.dir !== 0 && prevVal > 0 && (
                        <Ticker curr={r[col.key]} prev={prevVal} invert={col.dir < 0} />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${C.border}` }}>
              <td style={{ ...td, textAlign: "left", color: C.lightGrey, fontWeight: 700 }}>{totalRow.name}</td>
              {CMP_COLS.map(col => (
                <td key={col.key} style={{ ...td, color: C.lightGrey }}>{col.render(totalRow)}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

export default function LinkedInAdsDashboard() {
  const [campaigns, setCampaigns]         = useState([]);
  const [ads, setAds]                     = useState([]);
  const [selectedIds, setSelectedIds]     = useState(() => new Set(["__all__"]));
  const [prevMap, setPrevMap]             = useState({});
  const [prevCampaignMap, setPrevCampaignMap] = useState({});
  const [days, setDays]                   = useState(30);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [showActive, setShowActive]       = useState(true);
  const [sortBy, setSortBy]               = useState("score");
  const [sortDir, setSortDir]             = useState("desc");
  const [lastUpdated, setLastUpdated]     = useState(null);
  const [syncing, setSyncing]             = useState(false);

  const previewCache = useRef({});   // adId -> { preview, at }
  const previewSeq   = useRef(0);

  // Well inside LinkedIn's ~3h expiry, so a src is never handed to an iframe stale.
  const PREVIEW_TTL_MS = 2.5 * 60 * 60 * 1000;
  const livePreview = id => {
    const hit = previewCache.current[id];
    return hit && Date.now() - hit.at < PREVIEW_TTL_MS ? hit.preview : null;
  };
  const attachPreviews = list => list.map(a => ({ ...a, preview: livePreview(a.id) }));

  // Previews arrive after the metrics, one small batch at a time — 160+ creatives
  // fetched at once would swamp both the proxy and LinkedIn. The sequence guard drops
  // an in-flight run when the date range changes, so a stale run cannot overwrite the
  // new one's rows.
  const hydratePreviews = useCallback(async (adList) => {
    const seq = ++previewSeq.current;
    setAds(prev => attachPreviews(prev));   // adopt anything an abandoned run resolved
    const missing = adList.filter(a => !livePreview(a.id));
    for (let i = 0; i < missing.length; i += 3) {
      if (previewSeq.current !== seq) return;
      await Promise.all(missing.slice(i, i + 3).map(async a => {
        const preview = await fetchAdPreview(a.id, ACCOUNT.id);
        if (!preview) return;
        previewCache.current[a.id] = { preview, at: Date.now() };
        if (previewSeq.current === seq) {
          setAds(prev => prev.map(ad => ad.id === a.id ? { ...ad, preview } : ad));
        }
      }));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadData = useCallback(async (daysN) => {
    setLoading(true); setError(null); setCampaigns([]); setAds([]);
    setSelectedIds(new Set(["__all__"]));
    try {
      const { current, prev } = getLiDateRange(daysN);

      const [campaignAnalytics, creativeAnalytics, prevCreativeAnalytics, prevCampaignAnalytics] = await Promise.all([
        fetchAnalytics(ACCOUNT.id, current, "CAMPAIGN"),
        fetchAnalytics(ACCOUNT.id, current, "CREATIVE").catch(() => []),
        fetchAnalytics(ACCOUNT.id, prev,    "CREATIVE").catch(() => []),
        fetchAnalytics(ACCOUNT.id, prev,    "CAMPAIGN").catch(() => []),
      ]);

      const camIds = campaignAnalytics.map(el => (el.pivotValues?.[0] || "").split(":").pop()).filter(Boolean);
      const creativeIds = creativeAnalytics.map(el => (el.pivotValues?.[0] || "").split(":").pop()).filter(Boolean);

      const [rawCampaigns, rawCreatives] = await Promise.all([
        fetchCampaigns(ACCOUNT.id).catch(() => []),
        fetchCreatives(ACCOUNT.id).catch(() => []),
      ]);

      // Per-id GETs are a fallback, not a parallel belt-and-braces. Running them
      // alongside the batch cost one request per creative — 165 of them, ~12s of the
      // load — even when the batch had already returned everything.
      const resolvedCampaigns = rawCampaigns.length ? rawCampaigns : await fetchCampaignsByIds(camIds);
      const resolvedCreatives = rawCreatives.length ? rawCreatives : await fetchCreativesByIds(creativeIds);

      const toMetrics = (el) => {
        const imp  = parseInt(el.impressions || 0);
        const clk  = parseInt(el.clicks || 0);
        const spnd = parseFloat(el.costInLocalCurrency || 0);
        const conv = parseInt(el.externalWebsiteConversions || 0);
        return { impressions: imp, clicks: clk, spend: spnd, conversions: conv, ctr: imp > 0 ? clk / imp : 0 };
      };
      const zeroMetrics = { impressions: 0, clicks: 0, spend: 0, conversions: 0, ctr: 0 };

      const camAnalyticsMap = {};
      campaignAnalytics.forEach(el => {
        const id = String((el.pivotValues?.[0] || "").split(":").pop() || "");
        if (id) camAnalyticsMap[id] = toMetrics(el);
      });

      const campaigns = resolvedCampaigns.length
        ? resolvedCampaigns.map(c => ({ ...c, metrics: camAnalyticsMap[String(c.id)] || zeroMetrics }))
        : campaignAnalytics.length
          ? campaignAnalytics.map(el => {
              const id = String((el.pivotValues?.[0] || "").split(":").pop() || "");
              return { id, name: `Campaign #${id.slice(-6)}`, status: "ACTIVE", metrics: toMetrics(el) };
            })
          : [{ id: "__all__", name: "All Campaigns", status: "ACTIVE", metrics: { ...zeroMetrics } }];

      setCampaigns(campaigns);

      const creativeToCampaign = {}, creativeMetaMap = {};
      resolvedCreatives.forEach(c => {
        const camUrn = typeof c.campaign === "string" ? c.campaign : (c.campaign?.["$URN"] || "");
        const camId  = camUrn.split(":").pop();
        if (camId) creativeToCampaign[String(c.id)] = camId;
        creativeMetaMap[String(c.id)] = parseCreativeContent(c);
      });

      const uniqueUrns  = [...new Set(Object.values(creativeMetaMap).map(m => m.imageUrn).filter(Boolean))];
      const assetUrlMap = await fetchAssetUrls(uniqueUrns);

      const postUrns = [...new Set(Object.values(creativeMetaMap).map(m => m.referenceUrn).filter(Boolean))];
      const { names: postNames, imageUrls: postImageUrls, carouselUrns } = await fetchPostData(postUrns);

      const prevMapBuilt = {};
      prevCreativeAnalytics.forEach(el => {
        const id = String((el.pivotValues?.[0] || "").split(":").pop() || "");
        if (id) prevMapBuilt[id] = toMetrics(el);
      });
      setPrevMap(prevMapBuilt);

      const prevCampaignMapBuilt = {};
      prevCampaignAnalytics.forEach(el => {
        const id = String((el.pivotValues?.[0] || "").split(":").pop() || "");
        if (id) prevCampaignMapBuilt[id] = toMetrics(el);
      });
      setPrevCampaignMap(prevCampaignMapBuilt);

      const fallbackCamId = String(campaigns[0].id);
      const adsData = creativeAnalytics.length
        ? creativeAnalytics.map(el => {
            const urn      = el.pivotValues?.[0] || "";
            const id       = String(urn.split(":").pop() || urn);
            const creative = resolvedCreatives.find(c => String(c.id) === id);
            const meta     = creativeMetaMap[id] || {};
            const camId    = creativeToCampaign[id] || fallbackCamId;
            const created  = creative?.changeAuditStamps?.created?.time || null;
            // Fall through rather than branch: a creative carrying an imageUrn used to
            // commit to the asset lookup and return null when it failed, even when the
            // post behind the same creative had a usable thumbnail. /v2/assets is now
            // retired (404 RESOURCE_NOT_FOUND), so that branch fails for every creative.
            const imageUrl = (meta.imageUrn && assetUrlMap[meta.imageUrn])
                          || (meta.referenceUrn && postImageUrls[meta.referenceUrn])
                          || null;
            const camName  = resolvedCampaigns.find(c => String(c.id) === camId)?.name || null;
            // Post copy reads best but needs organic scopes; the creative's own name is
            // ad-level and distinguishable, so it beats repeating the campaign name.
            const name     = meta.name || (meta.referenceUrn && postNames[meta.referenceUrn])
                          || creative?.name || camName || `Ad #${id.slice(-6)}`;
            const isCarousel = meta.isCarousel || (meta.referenceUrn ? carouselUrns.has(meta.referenceUrn) : false);
            return { id, campaignId: camId, name, imageUrl, isCarousel, createdTime: created, status: creative?.status || null, metrics: toMetrics(el) };
          })
        : campaignAnalytics.map(el => {
            const id   = String((el.pivotValues?.[0] || "").split(":").pop() || "");
            const camp = resolvedCampaigns.find(c => String(c.id) === id);
            return { id, campaignId: id, name: camp?.name || `Campaign #${id.slice(-6)}`, imageUrl: null, createdTime: null, metrics: toMetrics(el) };
          });

      setAds(attachPreviews(adsData));
      setSelectedIds(new Set(["__all__"]));
      setLastUpdated(new Date().toISOString());
      hydratePreviews(adsData);
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

  const isAll           = selectedIds.has("__all__");
  const selectedRealIds = [...selectedIds].filter(id => id !== "__all__");

  const selectAll  = () => setSelectedIds(new Set(["__all__"]));
  // Toggling always leaves "all" mode; emptying the selection falls back to it
  // rather than stranding the page with nothing selected.
  const toggleId   = (id) => setSelectedIds(prev => {
    const next = new Set(prev);
    next.delete("__all__");
    const key = String(id);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next.size ? next : new Set(["__all__"]);
  });

  const camById   = {};
  campaigns.forEach(c => { camById[String(c.id)] = c; });

  const compareRows = selectedRealIds
    .map(id => camById[id])
    .filter(Boolean)
    .map(c => cmpRow(String(c.id), c.name, c.status, c.metrics, prevCampaignMap?.[String(c.id)]))
    .sort((a, b) => b.spend - a.spend);
  const isCompare = !isAll && compareRows.length >= 2;

  // Summing the selected campaigns' previous-period metrics keeps the summary bar's
  // deltas aligned with whatever subset is on screen.
  const selectedPrev = (() => {
    if (isAll || !selectedRealIds.length) return undefined;
    let any = false;
    const acc = { spend: 0, clicks: 0, impressions: 0, conversions: 0 };
    selectedRealIds.forEach(id => {
      const pm = prevCampaignMap?.[id];
      if (!pm) return;
      any = true;
      acc.spend += pm.spend || 0; acc.clicks += pm.clicks || 0;
      acc.impressions += pm.impressions || 0; acc.conversions += pm.conversions || 0;
    });
    return any ? acc : undefined;
  })();

  const campaignAds = (isAll ? ads : ads.filter(a => selectedIds.has(String(a.campaignId))))
    .filter(a => !showActive || a.status === "ACTIVE" || a.status === null);
  const scored = [...campaignAds].sort((a, b) => scoreAd(b.metrics) - scoreAd(a.metrics));
  const cut    = scored.length > 1 ? Math.max(1, Math.ceil(scored.length * 0.2)) : 0;
  const topIds = new Set(scored.slice(0, cut).map(a => a.id));
  const botIds = new Set(scored.slice(-cut).filter(a => !topIds.has(a.id)).map(a => a.id));

  const SORT_COLS = [
    { key: "score",       label: "Score" },
    { key: "spend",       label: "Spend" },
    { key: "impressions", label: "Impr." },
    { key: "clicks",      label: "Clicks" },
    { key: "ctr",         label: "CTR" },
    { key: "cpc",         label: "CPC" },
    { key: "conversions", label: "Conv." },
    { key: "cpcConv",     label: "CPConv." },
    { key: "daysOld",     label: "Age" },
  ];

  const daysOld = (a) => a.createdTime ? Math.floor((Date.now() - a.createdTime) / 86400000) : 0;

  const sortVal = (a, key) => {
    const m = a.metrics;
    if (key === "score")   return scoreAd(m);
    if (key === "ctr")     return m.ctr || 0;
    if (key === "cpc")     return m.clicks > 0 ? -(m.spend / m.clicks) : 0;
    if (key === "cpcConv") return m.conversions > 0 ? -(m.spend / m.conversions) : 0;
    if (key === "daysOld") return daysOld(a);
    return m[key] || 0;
  };

  const sortedAds = [...campaignAds].sort((a, b) => {
    const diff = sortVal(b, sortBy) - sortVal(a, sortBy);
    return sortDir === "desc" ? diff : -diff;
  });

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(key); setSortDir("desc"); }
  };

  return (
    <div style={{ minHeight: "100vh", background: C.black, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button, input { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Controls Bar */}
      <div style={{ background: C.black, borderBottom: "1px solid #1a1a1a" }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", padding: "8px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 48, flexWrap: "wrap", gap: "8px 16px" }}>
        <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>LinkedIn Ads Performance</span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px 16px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
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
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ fontSize: 11, color: C.grey }}>Active only</span>
            <div onClick={() => setShowActive(v => !v)} style={{ width: 32, height: 18, borderRadius: 9, cursor: "pointer", position: "relative", background: showActive ? C.blue : "#333", transition: "background 0.2s" }}>
              <div style={{ position: "absolute", top: 3, left: showActive ? 17 : 3, width: 12, height: 12, borderRadius: "50%", background: "#fff", transition: "left 0.2s" }} />
            </div>
          </div>
          {lastUpdated && !syncing && <span style={{ fontSize: 10, color: C.grey }}>Synced {timeSince(lastUpdated)}</span>}
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

      {/* Campaign Grid */}
      {campaigns.length > 0 && (
        <div style={{ background: C.black, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", padding: "10px 32px" }}>
            <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.grey, textTransform: "uppercase", letterSpacing: "0.1em" }}>Campaigns</span>
              <span style={{ fontSize: 10, color: C.grey }}>
                {selectedRealIds.length >= 2
                  ? `${selectedRealIds.length} selected — comparing`
                  : "click campaigns to compare them"}
              </span>
              {selectedRealIds.length > 0 && (
                <button onClick={selectAll} style={{
                  padding: "2px 8px", borderRadius: 4, border: `1px solid ${C.border}`,
                  background: "transparent", color: C.grey, fontSize: 10, cursor: "pointer",
                }}>Clear</button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 5 }}>
              {(() => {
                const isSelected = isAll;
                const realCampaigns = campaigns.filter(c => c.id !== "__all__");
                const allSpend = realCampaigns.reduce((s, c) => s + (c.metrics?.spend || 0), 0);
                const allConvs = realCampaigns.reduce((s, c) => s + (c.metrics?.conversions || 0), 0);
                return (
                  <button onClick={selectAll}
                    title={`All Campaigns — ${fmtUSD(allSpend)}, ${fmt(allConvs)} conv.`}
                    style={{
                    padding: "6px 9px", borderRadius: 6, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 6,
                    border: `1px solid ${isSelected ? C.blue + "44" : "transparent"}`,
                    borderBottom: `2px solid ${isSelected ? C.blue : "transparent"}`,
                    background: C.charcoal, transition: "all 0.15s",
                  }}>
                    <span style={{ flex: 1, minWidth: 0, textAlign: "left", fontSize: 11.5, fontWeight: 500,
                                   color: isSelected ? C.white : C.lightGrey, overflow: "hidden",
                                   textOverflow: "ellipsis", whiteSpace: "nowrap" }}>All Campaigns</span>
                    {!loading && allSpend > 0 && (
                      <span style={{ fontSize: 9.5, color: C.grey, flexShrink: 0 }}>{fmtUSD(allSpend)}</span>
                    )}
                    {!loading && allConvs > 0 && (
                      <span style={{ fontSize: 9.5, color: C.green, fontWeight: 600, flexShrink: 0 }}>{fmt(allConvs)}</span>
                    )}
                  </button>
                );
              })()}
              {campaigns
                .filter(c => c.id !== "__all__" && (!showActive || c.status === "ACTIVE"))
                .map(c => {
                  const isSelected = selectedIds.has(String(c.id));
                  const isActive   = c.status === "ACTIVE";
                  const spend = c.metrics?.spend || 0;
                  const convs = c.metrics?.conversions || 0;
                  return (
                    <div key={c.id} role="checkbox" aria-checked={isSelected} tabIndex={0}
                      onClick={() => toggleId(c.id)}
                      onKeyDown={e => {
                        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleId(c.id); }
                      }}
                      title={`${isSelected ? "Remove" : "Add"} ${c.name} — ${fmtUSD(spend)}, ${fmt(convs)} conv.${isActive ? "" : " (paused)"}`}
                      style={{
                      padding: "6px 9px", borderRadius: 6, cursor: "pointer",
                      border: `1px solid ${isSelected ? C.blue + "33" : "transparent"}`,
                      borderBottom: `2px solid ${isSelected ? C.blue : "transparent"}`,
                      background: C.charcoal, transition: "all 0.15s", opacity: isActive ? 1 : 0.5,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div aria-hidden="true"
                          style={{
                            width: 12, height: 12, borderRadius: 3, flexShrink: 0,
                            border: `1px solid ${isSelected ? C.blue : C.grey}`,
                            background: isSelected ? C.blue : "transparent",
                            display: "grid", placeItems: "center",
                          }}>
                          {isSelected && <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 800, color: C.black }}>✓</span>}
                        </div>
                        <div style={{ width: 5, height: 5, borderRadius: "50%", background: isActive ? C.green : C.grey, flexShrink: 0 }} />
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, fontWeight: 500, color: isSelected ? C.white : C.lightGrey, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                        {!loading && spend > 0 && (
                          <span style={{ fontSize: 9.5, color: C.grey, flexShrink: 0 }}>{fmtUSD(spend)}</span>
                        )}
                        {!loading && convs > 0 && (
                          <span style={{ fontSize: 9.5, color: C.green, fontWeight: 600, flexShrink: 0 }}>{fmt(convs)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

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
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.blue, animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 12, color: C.lightGrey }}>Fetching from LinkedIn API…</div>
          </div>
        )}

        {!loading && (
          <>
            {campaignAds.length > 0 && (
              <div style={{ fontSize: 11, color: C.grey, marginBottom: 16 }}>
                {ACCOUNT.name} Ad Account · {isMonthKey(days) ? (getTrailingMonths().find(m => m.key === days)?.label || days) : `Last ${days} days`} · {campaignAds.length} ads
                {isCompare && ` across ${compareRows.length} campaigns`}
              </div>
            )}

            {campaignAds.length > 0 && (
              <>
                <SummaryBar ads={campaignAds} prevMap={prevMap} prevCampaignMetrics={selectedPrev} />
                {isCompare && <CampaignCompare rows={compareRows} />}
                <InsightsPanel ads={campaignAds} prevMap={prevMap} />

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: C.lightGrey, textTransform: "uppercase", letterSpacing: "0.1em", marginRight: 4 }}>Ads</span>
                  {SORT_COLS.map(col => {
                    const active = sortBy === col.key;
                    return (
                      <button key={col.key} onClick={() => handleSort(col.key)} style={{
                        padding: "3px 9px", borderRadius: 4, border: `1px solid ${active ? C.blue + "66" : C.border}`,
                        background: active ? C.blue + "18" : "transparent",
                        color: active ? C.blue : C.grey,
                        fontSize: 10, cursor: "pointer", fontWeight: active ? 600 : 400, transition: "all 0.15s",
                      }}>
                        {col.label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
                      </button>
                    );
                  })}
                </div>

                {sortedAds.map(a => (
                  <AdRow key={a.id} ad={a} isTop={topIds.has(a.id)} isBottom={botIds.has(a.id)}
                         campaignName={(isCompare || isAll) ? camById[String(a.campaignId)]?.name : undefined} />
                ))}
              </>
            )}

            {campaignAds.length === 0 && !error && campaigns.length > 0 && (
              <div style={{ textAlign: "center", padding: "60px 0", color: C.lightGrey, fontSize: 13 }}>
                No ad data found for {selectedRealIds.length > 1 ? "these campaigns" : "this campaign"} in the selected date range.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
