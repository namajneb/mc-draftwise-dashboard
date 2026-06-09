import { useState, useCallback, useEffect } from "react";

const C = {
  white:     "#FFFFFF",
  offWhite:  "#f0f2f5",
  lightGrey: "#b2b2b2",
  grey:      "#666666",
  blue:      "#579ed1",
  blueDim:   "#579ed122",
  blueLight: "#579ed114",
  gold:      "#ffab40",
  goldDim:   "#ffab4022",
  black:     "#000000",
  charcoal:  "#0c0c0c",
  surface:   "#111111",
  divider:   "#181818",
  border:    "#1e1e1e",
  rowHover:  "#111111",
  green:     "#3dbb7a",
  greenDim:  "#3dbb7a18",
  red:       "#e05252",
  redDim:    "#e0525218",
};

const ACCOUNT = { id: "513153545", name: "Draftwise" };

async function liApiFetch(path) {
  const encoded = encodeURIComponent(path);
  const res = await fetch(`/api/linkedin?path=${encoded}`);
  const json = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(json));
  return json;
}

async function fetchCampaigns(accountId) {
  const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
  const data = await liApiFetch(
    `/v2/adCampaignsV2?q=account&account=${urn}&count=50&fields=id,name,status,type`
  );
  return data.elements || [];
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
  const urn = encodeURIComponent(`urn:li:sponsoredAccount:${accountId}`);
  const data = await liApiFetch(
    `/v2/adCreativesV2?q=account&account=${urn}&count=100&fields=id,name,status,campaign,variables,reference,changeAuditStamps`
  );
  return (data.elements || []).filter(c => c.status !== 'REMOVED' && c.status !== 'DELETED');
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
  for (const key of Object.keys(data)) {
    const d   = data[key];
    const usc = d.userSelectedContent || d;
    const name = usc.headline || usc.title || d.title || d.headline || d.text || null;
    const imageUrn     = findMediaUrn(d);
    const referenceUrn = creativeRef || d.activity || null;
    if (name || imageUrn || referenceUrn) return { name: name || null, imageUrn, referenceUrn };
  }
  return { name: null, imageUrn: null, referenceUrn: creativeRef };
}

async function fetchPostData(postUrns) {
  if (!postUrns.length) return { names: {}, imageUrls: {}, carouselUrns: new Set() };
  const names = {}, imageUrls = {}, carouselUrns = new Set();
  const ugcUrns   = postUrns.filter(u => u.includes("ugcPost"));
  const shareUrns = postUrns.filter(u => u.includes(":share:") || u.includes(":activity:"));
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

function getLiDateRange(days) {
  const now   = new Date();
  const end   = new Date(now);
  const start = new Date(now);
  start.setDate(start.getDate() - days + 1);
  const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  const toObj = d => ({ day: d.getDate(), month: d.getMonth() + 1, year: d.getFullYear() });
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

function CreativeThumb({ name, imageUrl, isCarousel }) {
  if (imageUrl) {
    return (
      <div style={{ position: "relative", flexShrink: 0, width: 187, height: 187 }}>
        <img src={imageUrl} alt={name} style={{ width: 187, height: 187, borderRadius: 8, objectFit: "cover", border: `1px solid ${C.border}`, display: "block" }} />
        {isCarousel && (
          <div style={{ position: "absolute", top: 5, right: 5, background: "rgba(0,0,0,0.72)", borderRadius: 4, width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><rect x="0" y="0" width="5" height="5" rx="1" fill="#fff"/><rect x="6" y="0" width="5" height="5" rx="1" fill="#fff"/><rect x="0" y="6" width="5" height="5" rx="1" fill="#fff"/><rect x="6" y="6" width="5" height="5" rx="1" fill="#fff"/></svg>
          </div>
        )}
      </div>
    );
  }
  const color = THUMB_COLORS[Math.abs((name?.charCodeAt(0) ?? 0) + (name?.charCodeAt(2) ?? 0)) % THUMB_COLORS.length];
  return (
    <div style={{ width: 187, height: 187, borderRadius: 8, flexShrink: 0, background: color, display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 40, opacity: 0.45 }}>📣</span>
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

function AdRow({ ad, isTop, isBottom }) {
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
      <CreativeThumb name={ad.name} imageUrl={ad.imageUrl} isCarousel={ad.isCarousel} />
      <div style={{ flex: "1 1 160px", minWidth: 140 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.offWhite }}>{ad.name}</span>
          {isTop    && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenDim, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.green}33` }}>▲ Top 20%</span>}
          {isBottom && <span style={{ fontSize: 10, fontWeight: 600, color: C.red,   background: C.redDim,   padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.red}33`   }}>▼ Bottom 20%</span>}
        </div>
        <div style={{ fontSize: 11, color: C.lightGrey, fontFamily: "'Inter', sans-serif" }}>
          <span style={{ color: C.green }}>● Active</span>
        </div>
      </div>
      <div style={{ display: "flex", flex: "1 1 480px", alignItems: "flex-start" }}>
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
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
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

export default function LinkedInAdsDashboard() {
  const [campaigns, setCampaigns]         = useState([]);
  const [ads, setAds]                     = useState([]);
  const [activeCamId, setActiveCamId]     = useState(null);
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

  const loadData = useCallback(async (daysN) => {
    setLoading(true); setError(null); setCampaigns([]); setAds([]); setActiveCamId(null);
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

      const [rawCampaigns, rawCreatives, fetchedCampaigns, fetchedCreatives] = await Promise.all([
        fetchCampaigns(ACCOUNT.id).catch(() => []),
        fetchCreatives(ACCOUNT.id).catch(() => []),
        fetchCampaignsByIds(camIds),
        fetchCreativesByIds(creativeIds),
      ]);

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

      const resolvedCampaigns = rawCampaigns.length ? rawCampaigns : fetchedCampaigns;
      const resolvedCreatives = rawCreatives.length ? rawCreatives : fetchedCreatives;

      const campaigns = resolvedCampaigns.length
        ? resolvedCampaigns.map(c => ({ ...c, metrics: camAnalyticsMap[String(c.id)] || zeroMetrics }))
        : campaignAnalytics.length
          ? campaignAnalytics.map(el => {
              const id = String((el.pivotValues?.[0] || "").split(":").pop() || "");
              return { id, name: `Campaign #${id.slice(-6)}`, status: "ACTIVE", metrics: toMetrics(el) };
            })
          : [{ id: "__all__", name: "All Campaigns", status: "ACTIVE", metrics: { ...zeroMetrics } }];

      setCampaigns(campaigns);
      setActiveCamId(campaigns[0].id);

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
            const imageUrl = meta.imageUrn ? (assetUrlMap[meta.imageUrn] || null)
                           : (meta.referenceUrn ? (postImageUrls[meta.referenceUrn] || null) : null);
            const camName  = resolvedCampaigns.find(c => String(c.id) === camId)?.name || null;
            const name     = meta.name || (meta.referenceUrn && postNames[meta.referenceUrn]) || camName || `Ad #${id.slice(-6)}`;
            const isCarousel = meta.referenceUrn ? carouselUrns.has(meta.referenceUrn) : false;
            return { id, campaignId: camId, name, imageUrl, isCarousel, createdTime: created, status: creative?.status || null, metrics: toMetrics(el) };
          })
        : campaignAnalytics.map(el => {
            const id   = String((el.pivotValues?.[0] || "").split(":").pop() || "");
            const camp = resolvedCampaigns.find(c => String(c.id) === id);
            return { id, campaignId: id, name: camp?.name || `Campaign #${id.slice(-6)}`, imageUrl: null, createdTime: null, metrics: toMetrics(el) };
          });

      setAds(adsData);
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

  const campaignAds = (activeCamId === "__all__" ? ads : ads.filter(a => a.campaignId === String(activeCamId)))
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
        button { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* Controls Bar */}
      <div style={{ background: C.black, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, borderBottom: "1px solid #1a1a1a" }}>
        <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>LinkedIn Ads Performance</span>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {[7, 14, 30, 60, 90].map(d => (
              <button key={d} onClick={() => handleDaySwitch(d)} style={{
                padding: "4px 10px", borderRadius: 5, border: "none", cursor: "pointer",
                background: days === d ? C.blue : "transparent",
                color: days === d ? C.white : C.grey,
                fontSize: 11, transition: "all 0.15s",
              }}>{d}d</button>
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

      {/* Campaign Grid */}
      {campaigns.length > 0 && (
        <div style={{ background: C.black, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", padding: "14px 32px" }}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.grey, textTransform: "uppercase", letterSpacing: "0.1em" }}>Campaigns</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {campaigns
                .filter(c => !showActive || c.status === "ACTIVE")
                .map(c => {
                  const isSelected = activeCamId === c.id;
                  const isActive   = c.status === "ACTIVE";
                  const spend = c.metrics?.spend || 0;
                  const convs = c.metrics?.conversions || 0;
                  return (
                    <button key={c.id} onClick={() => setActiveCamId(c.id)} style={{
                      padding: "10px 12px", borderRadius: 8, textAlign: "left", cursor: "pointer",
                      border: "1px solid transparent",
                      borderBottom: `2px solid ${isSelected ? C.blue : "transparent"}`,
                      background: C.charcoal, transition: "all 0.15s", opacity: isActive ? 1 : 0.5,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? C.green : C.grey, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: isSelected ? C.white : C.lightGrey, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{c.name}</span>
                      </div>
                      {!loading && (spend > 0 || convs > 0) && (
                        <div style={{ fontSize: 10, color: C.grey }}>{fmtUSD(spend)} · {fmt(convs)} conv.</div>
                      )}
                      {!isActive && (
                        <div style={{ fontSize: 9, color: C.grey, marginTop: 3, textTransform: "uppercase", letterSpacing: "0.05em" }}>Paused</div>
                      )}
                    </button>
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
            {activeCamId && campaignAds.length > 0 && (
              <div style={{ fontSize: 11, color: C.grey, marginBottom: 16 }}>
                {ACCOUNT.name} Ad Account · Last {days} days · {campaignAds.length} ads
              </div>
            )}

            {campaignAds.length > 0 && (
              <>
                <SummaryBar ads={campaignAds} prevMap={prevMap} prevCampaignMetrics={prevCampaignMap?.[String(activeCamId)]} />
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
                  <AdRow key={a.id} ad={a} isTop={topIds.has(a.id)} isBottom={botIds.has(a.id)} />
                ))}
              </>
            )}

            {campaignAds.length === 0 && !error && activeCamId && (
              <div style={{ textAlign: "center", padding: "60px 0", color: C.lightGrey, fontSize: 13 }}>
                No ad data found for this campaign in the selected date range.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
