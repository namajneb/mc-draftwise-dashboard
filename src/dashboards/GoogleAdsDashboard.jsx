import { useState, useEffect, useCallback } from "react";

// ── Brand Tokens ──────────────────────────────────────────────────────────────
const C = {
  white:     "#FFFFFF",
  offWhite:  "#f0f2f5",
  lightGrey: "#b2b2b2",
  grey:      "#666666",
  blue:      "#579ed1",
  blueDim:   "#579ed122",
  gold:      "#ffab40",
  goldDim:   "#ffab4022",
  black:     "#000000",
  charcoal:  "#0c0c0c",
  surface:   "#111111",
  border:    "#1e1e1e",
  green:     "#3dbb7a",
  greenDim:  "#3dbb7a18",
  red:       "#e05252",
  redDim:    "#e0525218",
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function getDateRange(days) {
  const pad = n => String(n).padStart(2, "0");
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now   = new Date();
  const end   = new Date(now);
  const start = new Date(now); start.setDate(start.getDate() - days + 1);
  const prevEnd   = new Date(start); prevEnd.setDate(prevEnd.getDate() - 1);
  const prevStart = new Date(prevEnd); prevStart.setDate(prevStart.getDate() - days + 1);
  return {
    current: { since: fmt(start), until: fmt(end) },
    prev:    { since: fmt(prevStart), until: fmt(prevEnd) },
  };
}

async function gaApiFetch(params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`/api/google-ads?${qs}`);
  const json = await res.json();
  if (json._setupRequired) throw Object.assign(new Error("setup"), { setupRequired: true, missing: json.missing });
  if (json.error) {
    let msg = json.error?.message || String(json.error);
    const details = json.error?.details;
    if (Array.isArray(details)) {
      for (const d of details) {
        if (Array.isArray(d.errors) && d.errors.length) {
          msg = d.errors.map(e => e.message).join("; ");
          break;
        }
      }
    }
    throw new Error(msg);
  }
  return json;
}

async function fetchAccounts() {
  return gaApiFetch({ action: "accounts" });
}

async function fetchCampaigns(customerId) {
  return gaApiFetch({
    customerId,
    q: encodeURIComponent(
      `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type
       FROM campaign
       WHERE campaign.status IN ('ENABLED', 'PAUSED')
       ORDER BY campaign.name`
    ),
  });
}

async function fetchShoppingProducts(customerId, since, until) {
  return gaApiFetch({
    customerId,
    q: encodeURIComponent(
      `SELECT
         campaign.id,
         campaign.status,
         segments.product_title,
         segments.product_brand,
         metrics.impressions,
         metrics.clicks,
         metrics.cost_micros,
         metrics.conversions,
         metrics.conversions_value
       FROM shopping_performance_view
       WHERE
         campaign.status = 'ENABLED'
         AND segments.date BETWEEN '${since}' AND '${until}'`
    ),
  });
}

async function fetchKeywords(customerId, since, until) {
  return gaApiFetch({
    customerId,
    q: encodeURIComponent(
      `SELECT
         ad_group_criterion.keyword.text,
         ad_group_criterion.keyword.match_type,
         campaign.id,
         metrics.impressions,
         metrics.clicks,
         metrics.ctr,
         metrics.average_cpc,
         metrics.cost_micros,
         metrics.conversions
       FROM keyword_view
       WHERE
         ad_group_criterion.status = 'ENABLED'
         AND campaign.status = 'ENABLED'
         AND segments.date BETWEEN '${since}' AND '${until}'`
    ),
  });
}

async function fetchAds(customerId, since, until) {
  return gaApiFetch({
    customerId,
    q: encodeURIComponent(
      `SELECT
         ad_group_ad.ad.id,
         ad_group_ad.ad.name,
         ad_group_ad.ad.type,
         ad_group_ad.status,
         ad_group_ad.ad.responsive_search_ad.headlines,
         ad_group_ad.ad.responsive_search_ad.descriptions,
         ad_group_ad.ad.responsive_display_ad.headlines,
         ad_group_ad.ad.responsive_display_ad.descriptions,
         campaign.id,
         campaign.name,
         metrics.impressions,
         metrics.clicks,
         metrics.ctr,
         metrics.average_cpc,
         metrics.cost_micros,
         metrics.conversions
       FROM ad_group_ad
       WHERE
         ad_group_ad.status = 'ENABLED'
         AND campaign.status = 'ENABLED'
         AND segments.date BETWEEN '${since}' AND '${until}'`
    ),
  });
}

async function fetchPMaxAssetGroups(customerId, since, until) {
  return gaApiFetch({
    customerId,
    q: encodeURIComponent(
      `SELECT
         asset_group.id,
         asset_group.name,
         asset_group.status,
         campaign.id,
         campaign.name,
         metrics.impressions,
         metrics.clicks,
         metrics.ctr,
         metrics.cost_micros,
         metrics.conversions
       FROM asset_group
       WHERE
         asset_group.status = 'ENABLED'
         AND campaign.status = 'ENABLED'
         AND campaign.advertising_channel_type = 'PERFORMANCE_MAX'
         AND segments.date BETWEEN '${since}' AND '${until}'`
    ),
  });
}

// ── Scoring ────────────────────────────────────────────────────────────────────
// Google Ads (Search + Display): CTR 30pts (caps 5%) · Conversions 35pts (caps 20)
//   · CPC efficiency 25pts (lower=better, $25+=0) · Clicks 10pts (caps 300)
function scoreAd(m) {
  const ctrPct   = (m.ctr || 0) * 100;
  const ctrScore  = Math.min(ctrPct / 5, 1) * 30;
  const convScore = Math.min((m.conversions || 0) / 20, 1) * 35;
  const cpc       = m.averageCpc || 0;
  const cpcScore  = cpc > 0 ? Math.max(1 - cpc / 25, 0) * 25 : 0;
  const clickScore = Math.min((m.clicks || 0) / 300, 1) * 10;
  return Math.round(ctrScore + convScore + cpcScore + clickScore);
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

// ── Formatters ─────────────────────────────────────────────────────────────────
const micros = n  => (n || 0) / 1_000_000;
const fmt    = n  => { n = Math.round(n || 0); if (n >= 1e6) return (n/1e6).toFixed(1)+"M"; if (n >= 1e3) return (n/1e3).toFixed(1)+"K"; return n.toString(); };
const fmtUSD = n  => "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const fmtCTR = n  => n != null ? ((n || 0) * 100).toFixed(2) + "%" : "—";
const fmtCPC = n  => n > 0 ? "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";
const fmtCPConv = (spend, conv) => conv > 0 ? fmtUSD(spend / conv) : "—";

// ── Components ─────────────────────────────────────────────────────────────────
const THUMB_COLORS = ["#dde3ea","#d6dde6","#e2ddd8","#d8e2dd","#e0dae2","#dde0e2","#e2e0d8","#d8dce2","#e2d8dd","#dadada"];

function AdThumb({ name, type }) {
  const color = THUMB_COLORS[Math.abs((name?.charCodeAt(0) ?? 0) + (name?.charCodeAt(2) ?? 0)) % THUMB_COLORS.length];
  const icon  = type === "PERFORMANCE_MAX" ? "⚡" : type?.includes("RESPONSIVE_DISPLAY") ? "🖼️" : type?.includes("TEXT") ? "📝" : "📣";
  return (
    <div style={{ width: 72, height: 72, borderRadius: 8, flexShrink: 0, background: color, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, border: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 20, opacity: 0.45 }}>{icon}</span>
      <span style={{ fontSize: 7, opacity: 0.45, fontFamily: "'Inter', sans-serif", letterSpacing: "0.05em", textTransform: "uppercase" }}>
        {type?.replace(/_/g, " ").substring(0, 12) || "AD"}
      </span>
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
      <div style={{ width: 40, height: 3, borderRadius: 2, background: "linear-gradient(to right,#e05252,#ffab40,#3dbb7a)", overflow: "hidden", position: "relative", margin: "0 auto" }}>
        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${100 - score}%`, background: C.charcoal }} />
      </div>
    </div>
  );
}

function AdRow({ ad, isTop, isBottom }) {
  const m    = ad.metrics;
  const score = scoreAd(m);
  const cpcAccent = m.averageCpc > 0 ? scoreColor(Math.max(1 - m.averageCpc / 25, 0) * 100) : C.lightGrey;
  const headlineText = ad.headlines.length
    ? ad.headlines.slice(0, 3).join(" | ")
    : (ad.name || `Ad #${ad.id}`);
  const descText = ad.descriptions[0] || null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 20, padding: "16px 20px",
      borderRadius: 10, flexWrap: "wrap", marginBottom: 8,
      background: isTop ? C.greenDim : isBottom ? C.redDim : C.charcoal,
      border: `1px solid ${isTop ? C.green + "44" : isBottom ? C.red + "44" : C.border}`,
    }}>
      <AdThumb name={ad.name} type={ad.adType} />

      <div style={{ flex: "1 1 220px", minWidth: 180 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, flexWrap: "wrap", marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.offWhite, lineHeight: 1.35 }}>{headlineText}</span>
        </div>
        {descText && (
          <div style={{ fontSize: 11, color: C.lightGrey, lineHeight: 1.45, marginBottom: 4, maxWidth: 420 }}>{descText}</div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: C.green, fontFamily: "'Inter', sans-serif" }}>● Active</span>
          {isTop    && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenDim, padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.green}33` }}>▲ Top 20%</span>}
          {isBottom && <span style={{ fontSize: 10, fontWeight: 600, color: C.red,   background: C.redDim,   padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.red}33`   }}>▼ Bottom 20%</span>}
        </div>
      </div>

      <div style={{ display: "flex", flex: "1 1 480px", alignItems: "flex-start" }}>
        <ScoreBadge score={score} />
        <MetricCell label="Impr."      value={fmt(m.impressions)} />
        <MetricCell label="Clicks"     value={fmt(m.clicks)} />
        <MetricCell label="CTR"        value={fmtCTR(m.ctr)} />
        <MetricCell label="CPC"        value={fmtCPC(m.averageCpc)} accent={cpcAccent} />
        <MetricCell label="Conv."      value={fmt(m.conversions)} />
        <MetricCell label="Cost/Conv." value={fmtCPConv(m.spend, m.conversions)} />
        <MetricCell label="Spend"      value={fmtUSD(m.spend)} />
      </div>
    </div>
  );
}

// ── Ticker ─────────────────────────────────────────────────────────────────────
function tickerColor(curr, prev, invert = false) {
  if (!prev) return "#333";
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return "#333";
  return (invert ? pct < 0 : pct > 0) ? C.green : C.red;
}
function Ticker({ curr, prev, invert = false }) {
  if (!prev) return null;
  const pct = (curr - prev) / prev * 100;
  if (Math.abs(pct) < 0.5) return null;
  const up = pct > 0, good = invert ? !up : up;
  return <span style={{ fontSize: 10, fontWeight: 600, color: good ? C.green : C.red, marginLeft: 5 }}>{up ? "↑" : "↓"}{Math.abs(pct).toFixed(1)}%</span>;
}

// ── Summary Bar ────────────────────────────────────────────────────────────────
function SummaryBar({ ads, prevMap }) {
  const t = ads.reduce((acc, a) => {
    acc.impressions += a.metrics.impressions || 0;
    acc.clicks      += a.metrics.clicks      || 0;
    acc.spend       += a.metrics.spend       || 0;
    acc.conversions += a.metrics.conversions || 0;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0 });

  const p = ads.reduce((acc, a) => {
    const pm = prevMap?.[a.id];
    if (!pm) return acc;
    acc.impressions += pm.impressions || 0;
    acc.clicks      += pm.clicks      || 0;
    acc.spend       += pm.spend       || 0;
    acc.conversions += pm.conversions || 0;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0 });

  const ctr      = t.impressions > 0 ? t.clicks / t.impressions : 0;
  const prevCtr  = p.impressions > 0 ? p.clicks / p.impressions : 0;
  const cpc      = t.clicks > 0 ? t.spend / t.clicks : 0;
  const prevCpc  = p.clicks > 0 ? p.spend / p.clicks : 0;
  const cpcConv  = t.conversions > 0 ? t.spend / t.conversions : 0;
  const prevCpcConv = p.conversions > 0 ? p.spend / p.conversions : 0;

  const cards = [
    { label: "Impressions",  value: fmt(t.impressions),             ticker: <Ticker curr={t.impressions}  prev={p.impressions} />,  accent: tickerColor(t.impressions, p.impressions) },
    { label: "Clicks",       value: fmt(t.clicks),                  ticker: <Ticker curr={t.clicks}       prev={p.clicks} />,        accent: tickerColor(t.clicks, p.clicks) },
    { label: "CTR",          value: fmtCTR(ctr),                    ticker: <Ticker curr={ctr}            prev={prevCtr} />,         accent: tickerColor(ctr, prevCtr) },
    { label: "Avg. CPC",     value: fmtCPC(cpc),                    ticker: <Ticker curr={cpc}            prev={prevCpc} invert />,  accent: tickerColor(cpc, prevCpc, true) },
    { label: "Conversions",  value: fmt(t.conversions),             ticker: <Ticker curr={t.conversions}  prev={p.conversions} />,   accent: tickerColor(t.conversions, p.conversions) },
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

// ── Insights ───────────────────────────────────────────────────────────────────
function buildInsights(ads, prevMap) {
  const insights = [];
  if (!ads.length) return insights;

  const t = ads.reduce((acc, a) => {
    acc.impressions += a.metrics.impressions || 0;
    acc.clicks      += a.metrics.clicks      || 0;
    acc.spend       += a.metrics.spend       || 0;
    acc.conversions += a.metrics.conversions || 0;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0 });

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
  const cpcConv  = t.conversions > 0 ? t.spend / t.conversions : 0;
  const prevConv = p.conversions;
  const prevCpc  = p.clicks > 0 ? p.spend / p.clicks : 0;
  const scored   = [...ads].sort((a, b) => scoreAd(b.metrics) - scoreAd(a.metrics));
  const topAd    = scored[0];
  const botAd    = scored[scored.length - 1];

  // CTR health
  if (ctr >= 3) {
    insights.push({ type: "positive", icon: "🎯", title: "Strong CTR — ads resonating",
      body: `Campaign CTR is ${ctr.toFixed(2)}%, well above the ~2% Google Search benchmark. Audience targeting and ad copy are aligned. Consider expanding keywords or increasing bids on top performers.` });
  } else if (ctr >= 1) {
    insights.push({ type: "neutral", icon: "📊", title: "Average CTR — room to improve",
      body: `CTR is ${ctr.toFixed(2)}%. Test stronger headlines, more specific ad copy, and ensure keyword-to-ad relevance. Adding ad extensions (sitelinks, callouts) typically lifts CTR 10–20%.` });
  } else if (t.impressions > 200) {
    insights.push({ type: "warning", icon: "⚠️", title: "Low CTR — ads may be misaligned",
      body: `CTR of ${ctr.toFixed(2)}% is below benchmark. Review keyword match types, negative keywords, and ad relevance scores. Pausing low-Quality Score ads can raise overall CTR quickly.` });
  }

  // CPC efficiency
  if (cpc > 15) {
    insights.push({ type: "warning", icon: "💸", title: "High CPC — review bidding strategy",
      body: `Average CPC is ${fmtCPC(cpc)}. Consider switching from Maximize Clicks to Target CPA bidding, narrowing keyword targeting to higher-intent terms, or improving Quality Scores to lower CPCs.` });
  } else if (cpc > 0 && cpc < 3) {
    insights.push({ type: "positive", icon: "💰", title: "Efficient CPC — scale opportunity",
      body: `Average CPC is ${fmtCPC(cpc)}, which is very competitive. Quality Scores are likely strong. Consider increasing bids or daily budgets to capture more of this efficient traffic.` });
  }

  // CPC trend
  if (prevCpc > 0 && cpc > 0) {
    const delta = ((cpc - prevCpc) / prevCpc) * 100;
    if (delta >= 25) {
      insights.push({ type: "warning", icon: "📈", title: "CPC rising vs prior period",
        body: `CPC increased ${delta.toFixed(0)}% (now ${fmtCPC(cpc)}). This may indicate increased auction competition or reduced Quality Scores. Review landing page experience and ad relevance.` });
    }
  }

  // Conversion rate
  if (t.clicks >= 30 && convRate < 1) {
    insights.push({ type: "warning", icon: "🛑", title: "Low conversion rate",
      body: `Only ${convRate.toFixed(1)}% of clicks convert. Check landing page speed (target <2s), form friction, and message-to-landing-page alignment. Consider adding conversion rate optimizations or using Unbounce/dedicated landing pages.` });
  } else if (t.clicks >= 30 && convRate >= 5) {
    insights.push({ type: "positive", icon: "✅", title: "Excellent conversion rate",
      body: `${convRate.toFixed(1)}% conversion rate — exceptional for Google Ads (benchmark is ~2–4%). Landing page and intent alignment are working. Scale this campaign's budget to maximize conversions.` });
  }

  // Conversion trend
  if (prevConv > 0 && t.conversions > 0) {
    const delta = ((t.conversions - prevConv) / prevConv) * 100;
    if (delta <= -20) {
      insights.push({ type: "warning", icon: "📉", title: "Conversions dropping",
        body: `Conversions fell ${Math.abs(delta).toFixed(0)}% vs the prior period. Check for landing page changes, seasonal demand shifts, or budget constraints limiting impression share.` });
    } else if (delta >= 20) {
      insights.push({ type: "positive", icon: "📈", title: "Conversions trending up",
        body: `Conversions up ${delta.toFixed(0)}% vs prior period. Momentum is building — consider a 15–20% budget increase to capitalize while performance holds.` });
    }
  }

  // Cost per conversion
  if (t.conversions >= 3 && cpcConv > 0) {
    const note = cpcConv > 100
      ? `Cost per conversion is ${fmtUSD(cpcConv)}, which is high. Pause the lowest-scoring ads and focus budget on top performers to bring this down.`
      : cpcConv < 20
      ? `Cost per conversion is ${fmtUSD(cpcConv)} — very efficient. This campaign is generating leads/sales at a strong ROI. Scale budget to grow volume.`
      : null;
    if (note) {
      insights.push({ type: cpcConv > 100 ? "warning" : "positive", icon: cpcConv > 100 ? "⚠️" : "💎", title: cpcConv > 100 ? "High cost per conversion" : "Low cost per conversion", body: note });
    }
  }

  // Top performer
  if (topAd) {
    const s = scoreAd(topAd.metrics);
    if (s >= 40) {
      insights.push({ type: "positive", icon: "⭐", title: `Scale this ad: ${topAd.headlines[0] || topAd.name || `Ad #${topAd.id}`}`,
        body: `Score ${s}/100 · CTR ${fmtCTR(topAd.metrics.ctr)} · ${fmt(topAd.metrics.conversions)} conv. · ${fmtCPC(topAd.metrics.averageCpc)} CPC. Best performer — increase its ad group budget or duplicate to similar keywords.` });
    }
  }

  // Bottom performer
  if (botAd && botAd.id !== topAd?.id) {
    const s = scoreAd(botAd.metrics);
    if (s < 25) {
      insights.push({ type: "negative", icon: "🔻", title: `Underperformer: ${botAd.headlines[0] || botAd.name || `Ad #${botAd.id}`}`,
        body: `Score ${s}/100 · CTR ${fmtCTR(botAd.metrics.ctr)} · ${fmt(botAd.metrics.conversions)} conv. Review Quality Score, rewrite headlines, and test a new landing page before pausing.` });
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
    <div style={{ borderRadius: 10, background: C.charcoal, padding: "24px 28px", marginBottom: 24, border: "1px solid #222" }}>
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

// ── Keyword Summary ────────────────────────────────────────────────────────────
const MATCH_COLORS = {
  EXACT:  { bg: "#4285F422", border: "#4285F466", text: "#4285F4" },
  PHRASE: { bg: "#ffab4022", border: "#ffab4066", text: "#ffab40" },
  BROAD:  { bg: "#3dbb7a22", border: "#3dbb7a66", text: "#3dbb7a" },
};

const KW_SORT_COLS = [
  { key: "impressions", label: "Impr." },
  { key: "clicks",      label: "Clicks" },
  { key: "ctr",         label: "CTR" },
  { key: "cpc",         label: "CPC" },
  { key: "conversions", label: "Conv." },
  { key: "spend",       label: "Spend" },
];

function KeywordSummary({ keywords }) {
  const [sortBy, setSortBy]   = useState("impressions");
  const [sortDir, setSortDir] = useState("desc");

  if (!keywords.length) return null;

  const sortVal = (kw) => {
    if (sortBy === "ctr")  return kw.ctr || 0;
    if (sortBy === "cpc")  return -(kw.averageCpc || 0);
    return kw[sortBy] || 0;
  };

  const sorted = [...keywords].sort((a, b) => {
    const diff = sortVal(b) - sortVal(a);
    return sortDir === "desc" ? diff : -diff;
  }).slice(0, 20);

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(key); setSortDir("desc"); }
  };

  return (
    <div style={{ borderRadius: 10, background: C.charcoal, padding: "20px 24px", marginBottom: 24, border: "1px solid #222" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: C.blue + "22", border: `1px solid ${C.blue}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🔑</div>
        <div style={{ marginRight: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>Keywords</div>
          <div style={{ fontSize: 11, color: C.grey, marginTop: 1 }}>{keywords.length} active keywords</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {KW_SORT_COLS.map(col => {
            const active = sortBy === col.key;
            return (
              <button key={col.key} onClick={() => handleSort(col.key)} style={{
                padding: "3px 9px", borderRadius: 4, border: `1px solid ${active ? C.blue + "66" : C.border}`,
                background: active ? C.blue + "18" : "transparent",
                color: active ? C.blue : C.grey,
                fontSize: 10, cursor: "pointer", fontWeight: active ? 600 : 400,
              }}>
                {col.label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
              </button>
            );
          })}
        </div>
      </div>

      {/* Header row */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px 60px 60px 60px 60px 70px", gap: 8, padding: "4px 10px", marginBottom: 4 }}>
        {["Keyword", "Match", "Impr.", "Clicks", "CTR", "CPC", "Conv.", "Spend"].map(h => (
          <div key={h} style={{ fontSize: 10, color: C.grey, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'Inter', sans-serif" }}>{h}</div>
        ))}
      </div>

      {sorted.map((kw, i) => {
        const mc = MATCH_COLORS[kw.matchType] || MATCH_COLORS.BROAD;
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 70px 60px 60px 60px 60px 70px", gap: 8, padding: "8px 10px", borderRadius: 6, background: i % 2 === 0 ? "#0a0a0a" : "transparent", alignItems: "center" }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.offWhite, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{kw.text}</div>
            <div><span style={{ fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: mc.bg, border: `1px solid ${mc.border}`, color: mc.text, letterSpacing: "0.05em" }}>{kw.matchType}</span></div>
            <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(kw.impressions)}</div>
            <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(kw.clicks)}</div>
            <div style={{ fontSize: 12, color: C.lightGrey }}>{fmtCTR(kw.ctr)}</div>
            <div style={{ fontSize: 12, color: kw.averageCpc > 0 ? scoreColor(Math.max(1 - kw.averageCpc / 25, 0) * 100) : C.lightGrey }}>{fmtCPC(kw.averageCpc)}</div>
            <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(kw.conversions)}</div>
            <div style={{ fontSize: 12, color: C.lightGrey }}>{fmtUSD(kw.spend)}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── Shopping Summary Bar ───────────────────────────────────────────────────────
function ShoppingSummaryBar({ products, prevProducts }) {
  const sum = (arr) => arr.reduce((acc, p) => {
    acc.impressions     += p.impressions     || 0;
    acc.clicks          += p.clicks          || 0;
    acc.spend           += p.spend           || 0;
    acc.conversions     += p.conversions     || 0;
    acc.conversionValue += p.conversionValue || 0;
    return acc;
  }, { impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0 });

  const t = sum(products);
  const p = sum(prevProducts || []);

  const ctr         = t.impressions > 0 ? t.clicks / t.impressions : 0;
  const prevCtr     = p.impressions > 0 ? p.clicks / p.impressions : 0;
  const avgCpc      = t.clicks > 0 ? t.spend / t.clicks : 0;
  const prevAvgCpc  = p.clicks > 0 ? p.spend / p.clicks : 0;
  const costPerConv = t.conversions > 0 ? t.spend / t.conversions : 0;
  const prevCostPerConv = p.conversions > 0 ? p.spend / p.conversions : 0;
  const roas        = t.spend > 0 ? t.conversionValue / t.spend : 0;
  const prevRoas    = p.spend > 0 ? p.conversionValue / p.spend : 0;
  const roasAccent  = tickerColor(roas, prevRoas) !== "#333" ? tickerColor(roas, prevRoas) : (roas >= 4 ? C.green : roas >= 2 ? C.gold : roas > 0 ? C.red : "#333");

  const cards = [
    { label: "Impressions",  value: fmt(t.impressions),                           accent: tickerColor(t.impressions, p.impressions),        ticker: <Ticker curr={t.impressions}  prev={p.impressions} /> },
    { label: "Clicks",       value: fmt(t.clicks),                                accent: tickerColor(t.clicks, p.clicks),                   ticker: <Ticker curr={t.clicks}       prev={p.clicks} /> },
    { label: "CTR",          value: fmtCTR(ctr),                                  accent: tickerColor(ctr, prevCtr),                         ticker: <Ticker curr={ctr}            prev={prevCtr} /> },
    { label: "Avg. CPC",     value: fmtCPC(avgCpc),                               accent: tickerColor(avgCpc, prevAvgCpc, true),             ticker: <Ticker curr={avgCpc}         prev={prevAvgCpc} invert /> },
    { label: "Conversions",  value: fmt(t.conversions),                           accent: tickerColor(t.conversions, p.conversions),         ticker: <Ticker curr={t.conversions}  prev={p.conversions} /> },
    { label: "Cost / Conv.", value: costPerConv > 0 ? fmtUSD(costPerConv) : "—", accent: tickerColor(costPerConv, prevCostPerConv, true),   ticker: <Ticker curr={costPerConv}    prev={prevCostPerConv} invert /> },
    { label: "ROAS",         value: roas > 0 ? roas.toFixed(2) + "×" : "—",      accent: roasAccent, valueColor: roas > 0 ? roasAccent : C.offWhite, ticker: <Ticker curr={roas} prev={prevRoas} /> },
  ];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 24 }}>
      {cards.map(c => (
        <div key={c.label} style={{ flex: "1 1 100px", background: C.charcoal, borderRadius: 10, padding: "14px 18px", border: `1px solid ${C.border}`, borderTop: `3px solid ${c.accent}` }}>
          <div style={{ fontSize: 10, color: C.lightGrey, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{c.label}</div>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: c.valueColor || C.offWhite, fontFamily: "'Inter', sans-serif" }}>{c.value}</div>
            {c.ticker}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shopping Products Table ────────────────────────────────────────────────────
const SHOP_SORT_COLS = [
  { key: "impressions", label: "Impr." },
  { key: "clicks",      label: "Clicks" },
  { key: "ctr",         label: "CTR" },
  { key: "cpc",         label: "CPC" },
  { key: "conversions", label: "Conv." },
  { key: "spend",       label: "Spend" },
];

function ShoppingProductsTable({ products }) {
  const [sortBy, setSortBy]   = useState("impressions");
  const [sortDir, setSortDir] = useState("desc");

  if (!products.length) return null;

  const sortVal = (p) => {
    if (sortBy === "ctr") return p.ctr || 0;
    if (sortBy === "cpc") return -(p.averageCpc || 0);
    return p[sortBy] || 0;
  };

  const sorted = [...products].sort((a, b) => {
    const diff = sortVal(b) - sortVal(a);
    return sortDir === "desc" ? diff : -diff;
  });

  const handleSort = (key) => {
    if (sortBy === key) setSortDir(d => d === "desc" ? "asc" : "desc");
    else { setSortBy(key); setSortDir("desc"); }
  };

  return (
    <div style={{ borderRadius: 10, background: C.charcoal, padding: "20px 24px", marginBottom: 24, border: "1px solid #222" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: C.gold + "22", border: `1px solid ${C.gold}44`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>🛍️</div>
        <div style={{ marginRight: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.white }}>Products</div>
          <div style={{ fontSize: 11, color: C.grey, marginTop: 1 }}>{products.length} products</div>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {SHOP_SORT_COLS.map(col => {
            const active = sortBy === col.key;
            return (
              <button key={col.key} onClick={() => handleSort(col.key)} style={{
                padding: "3px 9px", borderRadius: 4, border: `1px solid ${active ? C.blue + "66" : C.border}`,
                background: active ? C.blue + "18" : "transparent",
                color: active ? C.blue : C.grey,
                fontSize: 10, cursor: "pointer", fontWeight: active ? 600 : 400,
              }}>
                {col.label}{active ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px 60px 60px 60px 60px 70px", gap: 8, padding: "4px 10px", marginBottom: 4 }}>
        {["Product", "Brand", "Impr.", "Clicks", "CTR", "CPC", "Conv.", "Spend"].map(h => (
          <div key={h} style={{ fontSize: 10, color: C.grey, textTransform: "uppercase", letterSpacing: "0.07em", fontFamily: "'Inter', sans-serif" }}>{h}</div>
        ))}
      </div>

      {sorted.map((p, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 100px 70px 60px 60px 60px 60px 70px", gap: 8, padding: "8px 10px", borderRadius: 6, background: i % 2 === 0 ? "#0a0a0a" : "transparent", alignItems: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: C.offWhite, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
          <div style={{ fontSize: 11, color: C.lightGrey, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.brand || "—"}</div>
          <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(p.impressions)}</div>
          <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(p.clicks)}</div>
          <div style={{ fontSize: 12, color: C.lightGrey }}>{fmtCTR(p.ctr)}</div>
          <div style={{ fontSize: 12, color: p.averageCpc > 0 ? scoreColor(Math.max(1 - p.averageCpc / 25, 0) * 100) : C.lightGrey }}>{fmtCPC(p.averageCpc)}</div>
          <div style={{ fontSize: 12, color: C.lightGrey }}>{fmt(p.conversions)}</div>
          <div style={{ fontSize: 12, color: C.lightGrey }}>{fmtUSD(p.spend)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Setup Guide ────────────────────────────────────────────────────────────────
function SetupGuide({ missing }) {
  return (
    <div style={{ maxWidth: 560, margin: "60px auto", padding: "0 24px" }}>
      <div style={{ background: C.charcoal, borderRadius: 12, padding: "40px", border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.offWhite, marginBottom: 8 }}>Google Ads — Setup Required</div>
        <div style={{ fontSize: 13, color: C.grey, marginBottom: 24, lineHeight: 1.65 }}>
          Add these environment variables in your Vercel project settings, then redeploy.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 28 }}>
          {["GOOGLE_ADS_DEVELOPER_TOKEN", "GOOGLE_ADS_CLIENT_ID", "GOOGLE_ADS_CLIENT_SECRET", "GOOGLE_ADS_REFRESH_TOKEN", "GOOGLE_ADS_MANAGER_ID"].map(k => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: missing?.includes(k) ? C.red : C.green, flexShrink: 0 }} />
              <code style={{ fontSize: 12, color: missing?.includes(k) ? C.red : C.lightGrey, fontFamily: "monospace" }}>{k}</code>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.grey, lineHeight: 1.7 }}>
          See the connection guide in the project README or ask Claude Code: <em>"Walk me through connecting Google Ads"</em>
        </div>
      </div>
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────
export default function GoogleAdsDashboard() {
  const [accounts, setAccounts]                         = useState([]);
  const [accountIdx, setAccountIdx]                     = useState(0);
  const [campaigns, setCampaigns]                       = useState([]);
  const [ads, setAds]                                   = useState([]);
  const [keywords, setKeywords]                         = useState([]);
  const [shoppingProducts, setShoppingProducts]         = useState([]);
  const [prevShoppingProducts, setPrevShoppingProducts] = useState([]);
  const [prevMap, setPrevMap]                           = useState({});
  const [activeCamId, setActiveCamId]                   = useState(null);
  const [days, setDays]               = useState(30);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [missingEnv, setMissingEnv]   = useState([]);
  const [sortBy, setSortBy]           = useState("score");
  const [sortDir, setSortDir]         = useState("desc");
  const [camFilter, setCamFilter]     = useState("active");

  const account = accounts[accountIdx];

  // Load ad data for selected account + date range
  const loadData = useCallback(async (acct, daysN) => {
    if (!acct) return;
    setLoading(true); setError(null); setCampaigns([]); setAds([]); setKeywords([]); setShoppingProducts([]); setPrevShoppingProducts([]); setActiveCamId(null);
    try {
      const { current, prev } = getDateRange(daysN);
      const [camRes, adsRes, prevAdsRes, kwRes, shopRes, prevShopRes, pmaxRes, prevPmaxRes] = await Promise.all([
        fetchCampaigns(acct.id),
        fetchAds(acct.id, current.since, current.until),
        fetchAds(acct.id, prev.since, prev.until),
        fetchKeywords(acct.id, current.since, current.until),
        fetchShoppingProducts(acct.id, current.since, current.until),
        fetchShoppingProducts(acct.id, prev.since, prev.until),
        fetchPMaxAssetGroups(acct.id, current.since, current.until).catch(() => ({ results: [] })),
        fetchPMaxAssetGroups(acct.id, prev.since, prev.until).catch(() => ({ results: [] })),
      ]);

      const rawCampaigns = (camRes.results || []).map(r => ({
        id:          String(r.campaign.id),
        name:        r.campaign.name,
        status:      r.campaign.status || "ENABLED",
        channelType: r.campaign.advertisingChannelType || "SEARCH",
      }));
      console.log("[campaigns]", rawCampaigns.map(c => `${c.name} → ${c.channelType}`));
      setCampaigns(rawCampaigns);
      const firstActive = rawCampaigns.find(c => c.status === "ENABLED") || rawCampaigns[0];
      if (firstActive) setActiveCamId(firstActive.id);

      // Build previous-period lookup by ad ID
      const pMap = {};
      (prevAdsRes.results || []).forEach(r => {
        const id = r.adGroupAd?.ad?.id;
        if (!id) return;
        pMap[id] = {
          impressions: parseInt(r.metrics?.impressions || 0),
          clicks:      parseInt(r.metrics?.clicks || 0),
          spend:       micros(r.metrics?.costMicros),
          conversions: parseFloat(r.metrics?.conversions || 0),
        };
      });
      (prevPmaxRes.results || []).forEach(r => {
        const id = r.assetGroup?.id;
        if (!id) return;
        pMap[`pmax_${id}`] = {
          impressions: parseInt(r.metrics?.impressions || 0),
          clicks:      parseInt(r.metrics?.clicks || 0),
          spend:       micros(r.metrics?.costMicros),
          conversions: parseFloat(r.metrics?.conversions || 0),
        };
      });
      setPrevMap(pMap);

      const rawAds = (adsRes.results || []).map(r => {
        const rsa = r.adGroupAd?.ad?.responsiveSearchAd;
        const rda = r.adGroupAd?.ad?.responsiveDisplayAd;
        const headlines = [
          ...(rsa?.headlines || []),
          ...(rda?.headlines || []),
        ].map(h => h.text).filter(Boolean);
        const descriptions = [
          ...(rsa?.descriptions || []),
          ...(rda?.descriptions || []),
        ].map(d => d.text).filter(Boolean);
        return {
        id:           r.adGroupAd?.ad?.id,
        name:         r.adGroupAd?.ad?.name || "",
        adType:       r.adGroupAd?.ad?.type || "",
        status:       r.adGroupAd?.status,
        headlines,
        descriptions,
        campaignId:   String(r.campaign?.id),
        campaignName: r.campaign?.name,
        metrics: {
          impressions: parseInt(r.metrics?.impressions || 0),
          clicks:      parseInt(r.metrics?.clicks || 0),
          ctr:         parseFloat(r.metrics?.ctr || 0),
          averageCpc:  micros(r.metrics?.averageCpc),
          spend:       micros(r.metrics?.costMicros),
          conversions: parseFloat(r.metrics?.conversions || 0),
        },
        };
      }).filter(a => a.id);

      const rawPMaxAds = (pmaxRes.results || []).map(r => ({
        id:           `pmax_${r.assetGroup?.id}`,
        name:         r.assetGroup?.name || `Asset Group #${r.assetGroup?.id}`,
        adType:       "PERFORMANCE_MAX",
        status:       r.assetGroup?.status || "ENABLED",
        headlines:    [],
        descriptions: [],
        campaignId:   String(r.campaign?.id),
        campaignName: r.campaign?.name,
        metrics: {
          impressions: parseInt(r.metrics?.impressions || 0),
          clicks:      parseInt(r.metrics?.clicks || 0),
          ctr:         parseFloat(r.metrics?.ctr || 0),
          averageCpc:  parseInt(r.metrics?.clicks || 0) > 0
                         ? micros(r.metrics?.costMicros) / parseInt(r.metrics?.clicks || 0)
                         : 0,
          spend:       micros(r.metrics?.costMicros),
          conversions: parseFloat(r.metrics?.conversions || 0),
        },
      })).filter(a => a.id);
      setAds([...rawAds, ...rawPMaxAds]);

      const rawKeywords = (kwRes.results || []).map(r => ({
        text:        r.adGroupCriterion?.keyword?.text || "",
        matchType:   r.adGroupCriterion?.keyword?.matchType || "BROAD",
        campaignId:  String(r.campaign?.id),
        impressions: parseInt(r.metrics?.impressions || 0),
        clicks:      parseInt(r.metrics?.clicks || 0),
        ctr:         parseFloat(r.metrics?.ctr || 0),
        averageCpc:  micros(r.metrics?.averageCpc),
        spend:       micros(r.metrics?.costMicros),
        conversions: parseFloat(r.metrics?.conversions || 0),
      })).filter(kw => kw.text);
      setKeywords(rawKeywords);

      // Aggregate shopping product data by title per campaign
      const productMap = {};
      (shopRes.results || []).forEach(r => {
        const title = r.segments?.productTitle || "Unknown Product";
        const key   = `${r.campaign?.id}::${title}`;
        if (!productMap[key]) {
          productMap[key] = {
            title,
            brand:           r.segments?.productBrand || "",
            campaignId:      String(r.campaign?.id),
            impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0,
          };
        }
        const p = productMap[key];
        p.impressions     += parseInt(r.metrics?.impressions || 0);
        p.clicks          += parseInt(r.metrics?.clicks      || 0);
        p.spend           += micros(r.metrics?.costMicros);
        p.conversions     += parseFloat(r.metrics?.conversions || 0);
        p.conversionValue += parseFloat(r.metrics?.conversionsValue || 0);
      });
      const rawShoppingProducts = Object.values(productMap).map(p => ({
        ...p,
        ctr:        p.impressions > 0 ? p.clicks / p.impressions : 0,
        averageCpc: p.clicks > 0 ? p.spend / p.clicks : 0,
        roas:       p.spend > 0 ? p.conversionValue / p.spend : 0,
      }));
      setShoppingProducts(rawShoppingProducts);

      const prevProductMap = {};
      (prevShopRes.results || []).forEach(r => {
        const title = r.segments?.productTitle || "Unknown Product";
        const key   = `${r.campaign?.id}::${title}`;
        if (!prevProductMap[key]) {
          prevProductMap[key] = {
            title, campaignId: String(r.campaign?.id),
            impressions: 0, clicks: 0, spend: 0, conversions: 0, conversionValue: 0,
          };
        }
        const p = prevProductMap[key];
        p.impressions     += parseInt(r.metrics?.impressions || 0);
        p.clicks          += parseInt(r.metrics?.clicks      || 0);
        p.spend           += micros(r.metrics?.costMicros);
        p.conversions     += parseFloat(r.metrics?.conversions || 0);
        p.conversionValue += parseFloat(r.metrics?.conversionsValue || 0);
      });
      setPrevShoppingProducts(Object.values(prevProductMap));
    } catch (e) {
      if (e.setupRequired) { setSetupRequired(true); setMissingEnv(e.missing || []); }
      else setError(e.message);
    } finally { setLoading(false); }
  }, []);

  // Initial load — fetch account list
  useEffect(() => {
    setLoading(true);
    fetchAccounts()
      .then(data => {
        const ACCOUNT_ALLOWLIST = ["draftwise"];
        const accts = (data.customers || []).map(c => ({
          id: c.id,
          name: c.name || `Account ${c.id}`,
        })).filter(a => a.id && ACCOUNT_ALLOWLIST.some(al => a.name.toLowerCase().includes(al)));
        setAccounts(accts);
        if (accts.length) loadData(accts[0], 30);
        else { setLoading(false); setError("No active accounts found in your MCC."); }
      })
      .catch(e => {
        if (e.setupRequired) { setSetupRequired(true); setMissingEnv(e.missing || []); setLoading(false); }
        else { setError(e.message); setLoading(false); }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAccSwitch = (i) => { setAccountIdx(i); loadData(accounts[i], days); };
  const handleDaySwitch = (d) => { setDays(d); if (account) loadData(account, d); };

  const activeCampaign     = campaigns.find(c => c.id === activeCamId);
  const isShoppingCampaign = activeCampaign?.channelType === "SHOPPING";
  const campaignShoppingProducts     = shoppingProducts.filter(p => p.campaignId === activeCamId);
  const campaignPrevShoppingProducts = prevShoppingProducts.filter(p => p.campaignId === activeCamId);

  const campaignAds = ads.filter(a => a.campaignId === activeCamId);
  const scored  = [...campaignAds].sort((a, b) => scoreAd(b.metrics) - scoreAd(a.metrics));
  const cut     = Math.max(1, Math.ceil(scored.length * 0.2));
  const topIds  = new Set(scored.slice(0, cut).map(a => a.id));
  const botIds  = new Set(scored.slice(-cut).map(a => a.id));

  const SORT_COLS = [
    { key: "score",       label: "Score" },
    { key: "spend",       label: "Spend" },
    { key: "impressions", label: "Impr." },
    { key: "clicks",      label: "Clicks" },
    { key: "ctr",         label: "CTR" },
    { key: "cpc",         label: "CPC" },
    { key: "conversions", label: "Conv." },
    { key: "cpcConv",     label: "Cost/Conv." },
  ];

  const sortVal = (a, key) => {
    const m = a.metrics;
    if (key === "score")   return scoreAd(m);
    if (key === "ctr")     return m.ctr || 0;
    if (key === "cpc")     return m.averageCpc > 0 ? -m.averageCpc : 0;
    if (key === "cpcConv") return m.conversions > 0 ? -(m.spend / m.conversions) : 0;
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

  if (setupRequired) return <SetupGuide missing={missingEnv} />;

  return (
    <div style={{ minHeight: "100vh", background: C.black, fontFamily: "'Inter', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: 'Inter', sans-serif; }
      `}</style>

      {/* ── Title + Day Range + Active Toggle ── */}
      <div style={{ background: C.black, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 48, borderBottom: "1px solid #1a1a1a" }}>
        <span style={{ color: C.white, fontWeight: 700, fontSize: 14 }}>Google Ads Performance</span>
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
            <span style={{ fontSize: 11, color: C.grey, fontFamily: "'Inter', sans-serif" }}>Active only</span>
            <div
              onClick={() => setCamFilter(v => v === "active" ? "all" : "active")}
              style={{
                width: 32, height: 18, borderRadius: 9, cursor: "pointer", position: "relative",
                background: camFilter === "active" ? C.blue : "#333", transition: "background 0.2s",
              }}
            >
              <div style={{
                position: "absolute", top: 3, left: camFilter === "active" ? 17 : 3,
                width: 12, height: 12, borderRadius: "50%", background: C.white,
                transition: "left 0.2s",
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Account Tabs ── */}
      {accounts.length > 0 && (
        <div style={{ background: C.black, borderBottom: "1px solid #1a1a1a", padding: "0 32px", display: "flex", gap: 2, overflowX: "auto" }}>
          {accounts.map((acc, i) => (
            <button key={acc.id} onClick={() => handleAccSwitch(i)} style={{
              padding: "5px 14px", borderRadius: 6, border: "none", cursor: "pointer", whiteSpace: "nowrap",
              background: accountIdx === i ? C.blue : "transparent",
              color: accountIdx === i ? C.white : C.grey,
              fontSize: 12, fontWeight: accountIdx === i ? 600 : 400, transition: "all 0.15s",
              margin: "6px 2px",
            }}>{acc.name}</button>
          ))}
        </div>
      )}

      {/* ── Campaign Grid ── */}
      {campaigns.length > 0 && (
        <div style={{ background: C.black, borderBottom: `1px solid ${C.border}` }}>
          <div style={{ maxWidth: 1300, margin: "0 auto", padding: "14px 32px" }}>
            <div style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.grey, textTransform: "uppercase", letterSpacing: "0.1em" }}>Campaigns</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
              {campaigns
                .filter(c => camFilter === "all" || c.status === "ENABLED")
                .map(c => {
                  const isSelected  = activeCamId === c.id;
                  const isActive    = c.status === "ENABLED";
                  const isShopping  = c.channelType === "SHOPPING";
                  const isPMax      = c.channelType === "PERFORMANCE_MAX";
                  const isSearch    = c.channelType === "SEARCH";
                  const isDisplay   = c.channelType === "DISPLAY";
                  const camAds      = isShopping
                    ? shoppingProducts.filter(p => p.campaignId === c.id)
                    : ads.filter(a => a.campaignId === c.id);
                  const spend = camAds.reduce((s, x) => s + (isShopping ? x.spend : x.metrics?.spend || 0), 0);
                  const convs = camAds.reduce((s, x) => s + (isShopping ? x.conversions : x.metrics?.conversions || 0), 0);
                  return (
                    <button key={c.id} onClick={() => setActiveCamId(c.id)} style={{
                      padding: "10px 12px", borderRadius: 8, textAlign: "left", cursor: "pointer",
                      border: "1px solid transparent",
                      borderBottom: `2px solid ${isSelected ? C.blue : "transparent"}`,
                      background: C.charcoal,
                      transition: "all 0.15s", opacity: isActive ? 1 : 0.5,
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 5 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: isActive ? C.green : C.grey, flexShrink: 0, marginTop: 4 }} />
                        <span style={{ fontSize: 12, fontWeight: 500, color: isSelected ? C.white : C.lightGrey, lineHeight: 1.4 }}>{c.name}</span>
                        {isShopping && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: C.goldDim, border: `1px solid ${C.gold}44`, color: C.gold, flexShrink: 0, letterSpacing: "0.04em", marginTop: 2 }}>SHOP</span>}
                        {isPMax     && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: C.blueDim, border: `1px solid ${C.blue}44`, color: C.blue, flexShrink: 0, letterSpacing: "0.04em", marginTop: 2 }}>PMAX</span>}
                        {isSearch   && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: C.greenDim, border: `1px solid ${C.green}44`, color: C.green, flexShrink: 0, letterSpacing: "0.04em", marginTop: 2 }}>SEARCH</span>}
                        {isDisplay  && <span style={{ fontSize: 8, fontWeight: 700, padding: "1px 5px", borderRadius: 3, background: C.redDim, border: `1px solid ${C.red}44`, color: C.red, flexShrink: 0, letterSpacing: "0.04em", marginTop: 2 }}>DISPLAY</span>}
                      </div>
                      {!loading && (spend > 0 || convs > 0) && (
                        <div style={{ fontSize: 10, color: C.grey, fontFamily: "'Inter', sans-serif" }}>{fmtUSD(spend)} · {fmt(convs)} conv.</div>
                      )}
                      {!isActive && (
                        <div style={{ fontSize: 9, color: C.grey, marginTop: 3, fontFamily: "'Inter', sans-serif", textTransform: "uppercase", letterSpacing: "0.05em" }}>Paused</div>
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
            <button onClick={() => loadData(account, days)} style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: C.red, color: C.white, cursor: "pointer", fontWeight: 600, fontSize: 12 }}>Retry</button>
          </div>
        )}

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 0", gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${C.border}`, borderTopColor: C.blue, animation: "spin 0.8s linear infinite" }} />
            <div style={{ fontSize: 12, color: C.lightGrey }}>Fetching from Google Ads API…</div>
          </div>
        )}

        {!loading && (
          <>
            {isShoppingCampaign ? (
              <>
                {activeCamId && campaignShoppingProducts.length > 0 && (
                  <div style={{ fontSize: 11, color: C.grey, marginBottom: 16 }}>
                    {account?.name} · Last {days} days · {campaignShoppingProducts.length} products
                  </div>
                )}
                {campaignShoppingProducts.length > 0 && (
                  <>
                    <ShoppingSummaryBar products={campaignShoppingProducts} prevProducts={campaignPrevShoppingProducts} />
                    <ShoppingProductsTable products={campaignShoppingProducts} />
                  </>
                )}
                {campaignShoppingProducts.length === 0 && !error && activeCamId && (
                  <div style={{ textAlign: "center", padding: "60px 0", color: C.lightGrey, fontSize: 13 }}>
                    No shopping data found for this campaign in the selected date range.
                  </div>
                )}
              </>
            ) : (
              <>
                {activeCamId && campaignAds.length > 0 && (
                  <div style={{ fontSize: 11, color: C.grey, marginBottom: 16 }}>
                    {account?.name} · Last {days} days · {campaignAds.length} ads
                  </div>
                )}

                {campaignAds.length > 0 && (
                  <>
                    <SummaryBar ads={campaignAds} prevMap={prevMap} />
                    <InsightsPanel ads={campaignAds} prevMap={prevMap} />
                    <KeywordSummary keywords={keywords.filter(kw => kw.campaignId === activeCamId)} />

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
          </>
        )}
      </div>
    </div>
  );
}
