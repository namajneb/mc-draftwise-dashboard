// Generated from the Draftwise report artifact (claude.ai/artifact/6a7SjrsMdiwBvH9tgQ26MT).
// Copied verbatim so the charts match the report exactly. Regenerate rather than hand-edit.
/* eslint-disable */
export function runReport(dash, d3) {
  const SERIES = [
    { key: 'google_ads_clicks', name: 'Google Ads' },
    { key: 'linkedin_feed_clicks', name: 'LinkedIn feed' },
    { key: 'linkedin_audience_network_clicks', name: 'LinkedIn Audience Network' },
    { key: 'search_console_clicks', name: 'Search Console (organic)' },
    { key: 'meta_link_clicks', name: 'Meta' },
  ];
  const EVENTS = [
    { day: '2026-09-10', label: 'Consent changes start' },
    { day: '2026-09-18', label: 'Audience Network off, In-house stopped' },
    { day: '2026-09-20', label: 'Consent changes complete' },
    { day: '2026-09-28', label: 'Google Ads changes start' },
    { day: '2026-10-06', label: 'Google Ads changes end' },
    { day: '2026-10-28', label: 'Audience Network fully off' },
  ];
  const LEAD_SERIES = [
    { key: 'contact_us_submissions', name: 'Contact Us submissions', color: 4 },
    { key: 'new_form_contacts_excl_event', name: 'New form contacts', color: 5 },
  ];

  dash.calc('before_after', {
    inputs: ['ad_clicks', 'gsc_daily', 'hubspot_daily', 'ga_daily'],
    title: 'Per day, before vs after',
    description: 'Average daily clicks or sessions per source for Sep 1–17 and Sep 21 – Oct 18, and the change between them.',
    fn: (ad_clicks, gsc_daily, hubspot_daily, ga_daily) => {
      const inRange = (rows, a, b) => rows.filter(r => r.date >= a && r.date <= b);
      const avg = (rows, keys) => rows.reduce((s, r) => s + keys.reduce((t, k) => t + Number(r[k]), 0), 0) / rows.length;
      const row = (source, rows, keys) => {
        const b = Math.round(avg(inRange(rows, '2026-09-01', '2026-09-17'), keys));
        const a = Math.round(avg(inRange(rows, '2026-09-21', '2026-10-18'), keys));
        return { source, before: b, after: a, change: b ? Math.round((a - b) / b * 100) / 100 : null };
      };
      const ads = ['google_ads_clicks', 'linkedin_feed_clicks', 'linkedin_audience_network_clicks', 'meta_link_clicks'];
      return [
        row('Google Ads', ad_clicks, ['google_ads_clicks']),
        row('LinkedIn feed', ad_clicks, ['linkedin_feed_clicks']),
        row('LinkedIn Audience Network', ad_clicks, ['linkedin_audience_network_clicks']),
        row('Meta', ad_clicks, ['meta_link_clicks']),
        row('All ad clicks', ad_clicks, ads),
        row('Search Console (organic)', gsc_daily, ['search_console_clicks']),
        row('HubSpot sessions (all)', hubspot_daily, ['total']),
        row('Google Analytics sessions (all)', ga_daily, ['ga_sessions']),
      ];
    },
  });

  dash.calc('capture', {
    inputs: ['hubspot_daily', 'gsc_daily', 'ad_clicks'],
    title: 'Share of clicks HubSpot records',
    description: 'HubSpot sessions per day divided by platform clicks per day, for Sep 1–17 and Sep 21 – Oct 18.',
    fn: (hubspot_daily, gsc_daily, ad_clicks) => {
      const avg = (rows, a, b, keys) => {
        const r = rows.filter(x => x.date >= a && x.date <= b);
        return r.reduce((s, x) => s + keys.reduce((t, k) => t + Number(x[k]), 0), 0) / r.length;
      };
      const row = (channel, hsKey, rows, keys) => {
        const bp = avg(rows, '2026-09-01', '2026-09-17', keys), bh = avg(hubspot_daily, '2026-09-01', '2026-09-17', [hsKey]);
        const ap = avg(rows, '2026-09-21', '2026-10-18', keys), ah = avg(hubspot_daily, '2026-09-21', '2026-10-18', [hsKey]);
        return {
          channel,
          before_platform: Math.round(bp), before_hubspot: Math.round(bh), before_share: Math.round(bh / bp * 100) / 100,
          after_platform: Math.round(ap), after_hubspot: Math.round(ah), after_share: Math.round(ah / ap * 100) / 100,
        };
      };
      return [
        row('Organic search (vs Search Console)', 'organic', gsc_daily, ['search_console_clicks']),
        row('Paid search (vs Google Ads)', 'paid', ad_clicks, ['google_ads_clicks']),
        row('Paid social (vs LinkedIn and Meta)', 'paid_social', ad_clicks, ['linkedin_feed_clicks', 'linkedin_audience_network_clicks', 'meta_link_clicks']),
      ];
    },
  });

  const fmt = d3.format(',');
  const fmt1 = d3.format(',.1f');
  const pct = (v) => v == null ? '—' : (v > 0 ? '+' : '') + d3.format('.0%')(v);
  const share = (v) => v == null ? '—' : d3.format('.0%')(v);
  const dayFmt = d3.utcFormat('%b %-d');
  const parse = (s) => new Date(s + 'T00:00:00Z');


  function fail(box, st) {
    box.textContent = '';
    box.classList.remove('dw-fail');
    if (st === 'loading' || st === 'missing') { box.classList.add('dash-skeleton'); return false; }
    box.classList.remove('dash-skeleton');
    if (st !== 'ok') {
      if (st === 'error' || st === 'connect') { box.classList.add('dw-fail'); box.textContent = 'Failed to load'; }
      return false;
    }
    return true;
  }

  function legendInto(el, items, square) {
    el.textContent = '';
    items.forEach(it => {
      const s = document.createElement('span');
      const sw = document.createElement('i');
      if (square) sw.className = 'sq';
      sw.style.background = it.color;
      s.append(sw, it.name);
      el.append(s);
    });
  }

  function axes(svg, x, y, left, right, W, H, bottom, xAxis) {
    svg.append('g').selectAll('line').data(y.ticks(5)).join('line')
      .attr('x1', left).attr('x2', W - right).attr('y1', d => y(d)).attr('y2', d => y(d))
      .attr('stroke', 'var(--cds-chart-grid)').attr('stroke-width', 1);
    svg.append('g').attr('transform', `translate(${left - 6},0)`)
      .call(d3.axisLeft(y).ticks(5).tickFormat(fmt).tickSize(0))
      .attr('font-size', null).attr('font-family', null)
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)'));
    svg.append('g').attr('transform', `translate(0,${H - bottom})`)
      .call(xAxis)
      .attr('font-size', null).attr('font-family', null)
      .call(g => g.select('.domain').attr('stroke', 'var(--cds-chart-axis)'))
      .call(g => g.selectAll('text').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)'));
  }

  function leftMargin(svg, y) {
    const probe = svg.append('g');
    const w = d3.max(y.ticks(5), t => {
      const n = probe.append('text').style('font-size', 'var(--cds-font-size-caption)').text(fmt(t)).node();
      return n.getComputedTextLength();
    });
    probe.remove();
    return Math.ceil(w) + 8;
  }

  function showTip(box, tip, W, px, top, title, lines) {
    tip.textContent = '';
    const d = document.createElement('div'); d.className = 'd'; d.textContent = title; tip.append(d);
    lines.forEach(l => {
      const row = document.createElement('div'); row.className = 'r';
      const sw = document.createElement('i'); sw.style.background = l.color;
      const v = document.createElement('b'); v.textContent = l.value;
      row.append(sw, l.name, v); tip.append(row);
    });
    tip.hidden = false;
    const scale = box.clientWidth / W;
    const tw = tip.offsetWidth;
    let tx = px * scale + 12;
    if (tx + tw > box.clientWidth) tx = px * scale - tw - 12;
    tip.style.left = Math.max(0, tx) + 'px';
    tip.style.top = top + 'px';
  }

  // Same date ticks on every daily chart, always ending on the last day of data.
  const dateTicks = (W) => (W < 520
    ? ['2026-08-19', '2026-09-20', '2026-10-18', '2026-11-11']
    : ['2026-08-19', '2026-09-01', '2026-09-15', '2026-10-01', '2026-10-18', '2026-11-11']).map(parse);
  const START = '2026-08-19', END = '2026-11-11';

  const EV_ROW = 14, EV_TOP = EVENTS.length * EV_ROW + 8;
  function drawEvents(svg, xOf, top, H, bottom, W, right) {
    const a = xOf('2026-09-10'), b = xOf('2026-09-20');
    svg.append('rect').attr('x', a).attr('y', top).attr('width', Math.max(0, b - a)).attr('height', H - bottom - top)
      .attr('fill', 'var(--cds-chart-grid)').attr('opacity', 0.7);
    const g = svg.append('g');
    EVENTS.forEach((e, i) => {
      const ex = xOf(e.day), ly = i * EV_ROW + 10;
      g.append('line').attr('x1', ex).attr('x2', ex).attr('y1', ly + 3).attr('y2', H - bottom)
        .attr('stroke', 'var(--cds-chart-reference)').attr('stroke-width', 1).attr('stroke-dasharray', '3 3');
      const t = g.append('text').attr('y', ly).attr('x', ex + 4).attr('fill', 'var(--color-fg-muted)')
        .style('font-size', 'var(--cds-font-size-caption)').text(e.label);
      if (ex + 4 + t.node().getComputedTextLength() > W - right) t.attr('x', ex - 4).attr('text-anchor', 'end');
    });
  }

  function drawClicks() {
    const box = document.getElementById('dw-chart');
    const ads = dash.data('ad_clicks'), gsc = dash.data('gsc_daily');
    legendInto(document.getElementById('dw-legend'), SERIES.map((s, i) => ({ name: s.name, color: dash.colors[i] })));
    const st = ads.status !== 'ok' ? ads.status : gsc.status;
    if (!fail(box, st)) return;
    const g = new Map(gsc.data.map(r => [r.date, Number(r.search_console_clicks)]));
    const rows = ads.data.filter(r => r.date >= START && r.date <= END).map(r => ({
      date: parse(r.date),
      google_ads_clicks: Number(r.google_ads_clicks),
      linkedin_feed_clicks: Number(r.linkedin_feed_clicks),
      linkedin_audience_network_clicks: Number(r.linkedin_audience_network_clicks),
      meta_link_clicks: r.meta_link_clicks === '' || r.meta_link_clicks == null ? null : Number(r.meta_link_clicks),
      search_console_clicks: g.has(r.date) ? g.get(r.date) : null,
    }));
    const W = Math.max(280, box.clientWidth), H = 440, bottom = 24;
    const top = EV_TOP;
    const yMax = d3.max(rows, r => d3.max(SERIES, s => r[s.key] ?? 0));
    const y = d3.scaleLinear([0, yMax], [H - bottom, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const left = leftMargin(svg, y), right = 8;
    const x = d3.scaleUtc([parse(START), parse(END)], [left, W - right]);
    axes(svg, x, y, left, right, W, H, bottom,
      d3.axisBottom(x).tickValues(dateTicks(W)).tickFormat(dayFmt).tickSize(0).tickPadding(8));

    drawEvents(svg, d => x(parse(d)), top, H, bottom, W, right);

    SERIES.forEach((s, i) => {
      const line = d3.line().defined(r => r[s.key] != null).x(r => x(r.date)).y(r => y(r[s.key]));
      svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', dash.colors[i])
        .attr('stroke-width', 2).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('d', line);
    });

    const hover = svg.append('g').style('display', 'none');
    const rule = hover.append('line').attr('y1', top).attr('y2', H - bottom).attr('stroke', 'var(--cds-chart-axis)');
    const dots = SERIES.map((s, i) => hover.append('circle').attr('r', 4).attr('fill', dash.colors[i]).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2));
    const tip = document.createElement('div'); tip.className = 'dw-tip'; tip.hidden = true; box.append(tip);
    const bis = d3.bisector(r => r.date).center;
    svg.append('rect').attr('x', left).attr('y', top).attr('width', W - left - right).attr('height', H - bottom - top)
      .attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const r = rows[bis(rows, x.invert(mx))];
        const px = x(r.date);
        hover.style('display', null);
        rule.attr('x1', px).attr('x2', px);
        SERIES.forEach((s, i) => {
          if (r[s.key] == null) dots[i].attr('display', 'none');
          else dots[i].attr('display', null).attr('cx', px).attr('cy', y(r[s.key]));
        });
        showTip(box, tip, W, px, top, d3.utcFormat('%a, %b %-d')(r.date),
          SERIES.map((s, i) => ({ name: s.name, color: dash.colors[i], value: r[s.key] == null ? '—' : fmt(r[s.key]) })));
      });
  }

  function drawLeads() {
    const box = document.getElementById('dw-leads');
    const src = dash.data('leads_weekly');
    legendInto(document.getElementById('dw-leads-legend'), LEAD_SERIES.map(s => ({ name: s.name, color: dash.colors[s.color] })), true);
    if (!fail(box, src.status)) return;
    const num = (v) => (v === '' || v == null) ? null : Number(v);
    const rows = src.data.filter(r => r.week_start >= '2026-08-17').map(r => ({ week: r.week_start, contact_us_submissions: num(r.contact_us_submissions), new_form_contacts_excl_event: num(r.new_form_contacts_excl_event) }));
    const W = Math.max(280, box.clientWidth), H = 400, bottom = 24, top = EV_TOP;
    const y = d3.scaleLinear([0, d3.max(rows, r => Math.max(r.contact_us_submissions ?? 0, r.new_form_contacts_excl_event ?? 0))], [H - bottom, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const left = leftMargin(svg, y), right = 4;
    const x = d3.scaleBand(rows.map(r => r.week), [left, W - right]).paddingInner(0.25).paddingOuter(0.1);
    const inner = d3.scaleBand(LEAD_SERIES.map(s => s.key), [0, x.bandwidth()]).padding(0.12);
    const every = W < 520 ? 2 : 1;
    axes(svg, x, y, left, right, W, H, bottom,
      d3.axisBottom(x).tickValues(rows.map(r => r.week).filter((_, i) => i % every === 0)).tickFormat(w => dayFmt(parse(w))).tickSize(0).tickPadding(8));

    const weekX = (day) => {
      const d = parse(day), key = d3.utcFormat('%Y-%m-%d')(d3.utcMonday.floor(d));
      const start = x(key) - (x.step() - x.bandwidth()) / 2;
      return start + (((d.getUTCDay() + 6) % 7) + 0.5) / 7 * x.step();
    };
    drawEvents(svg, weekX, top, H, bottom, W, right);

    const groups = svg.append('g').selectAll('g').data(rows).join('g').attr('transform', r => `translate(${x(r.week)},0)`);
    LEAD_SERIES.forEach(s => {
      groups.filter(r => r[s.key] != null).append('rect').attr('class', 'bar')
        .attr('x', inner(s.key)).attr('width', inner.bandwidth())
        .attr('y', r => y(r[s.key])).attr('height', r => Math.max(0, y(0) - y(r[s.key])))
        .attr('rx', 3).attr('fill', dash.colors[s.color]);
    });
    const tip = document.createElement('div'); tip.className = 'dw-tip'; tip.hidden = true; box.append(tip);
    groups.append('rect').attr('x', -(x.step() - x.bandwidth()) / 2).attr('width', x.step()).attr('y', top).attr('height', H - bottom - top)
      .attr('fill', 'transparent')
      .on('pointerenter', function (event, r) {
        groups.selectAll('.bar').attr('opacity', d => d === r ? 1 : 0.45);
        const px = x(r.week) + x.bandwidth() / 2;
        showTip(box, tip, W, px, top, 'Week of ' + dayFmt(parse(r.week)),
          LEAD_SERIES.map(s => ({ name: s.name, color: dash.colors[s.color], value: r[s.key] == null ? '—' : fmt(r[s.key]) })));
      })
      .on('pointerleave', () => { groups.selectAll('.bar').attr('opacity', 1); tip.hidden = true; });
  }

  function fillTable(id, src, cols, totalKey) {
    const body = document.getElementById(id);
    body.textContent = '';
    if (src.status !== 'ok') return;
    for (const r of src.data) {
      const tr = document.createElement('tr');
      if (totalKey && totalKey(r)) tr.className = 'total';
      cols.forEach(c => {
        const td = document.createElement('td');
        td.textContent = c.f(r[c.k]);
        if (c.signed && r[c.k] != null) td.className = r[c.k] < 0 ? 'neg' : 'pos';
        tr.append(td);
      });
      body.append(tr);
    }
  }

  dash.calc('placement', {
    inputs: ['placement_may_sep'],
    title: 'Feed vs Audience Network',
    description: 'LinkedIn spend, clicks and conversions by placement, May through September, with cost per conversion.',
    fn: (placement_may_sep) => placement_may_sep.map(r => ({
      placement: r.placement,
      spend: Number(r.spend),
      clicks_to_site: Number(r.clicks_to_site),
      conversions: Number(r.conversions),
      cost_per_conversion: Math.round(Number(r.spend) / Number(r.conversions)),
    })),
  });

  dash.calc('placement_compare', {
    inputs: ['placement_may_sep'],
    title: 'Audience Network vs feed',
    description: 'How many times as many clicks the Audience Network drew as the feed, and how much higher its cost per conversion was.',
    fn: (placement_may_sep) => {
      const feed = placement_may_sep.find(r => r.placement === 'LinkedIn feed');
      const lan = placement_may_sep.find(r => r.placement === 'Audience Network');
      const cpc = (r) => Number(r.spend) / Number(r.conversions);
      return [
        { measure: 'click_multiple', value: Math.floor(Number(lan.clicks_to_site) / Number(feed.clicks_to_site)) },
        { measure: 'cost_premium', value: Math.round((cpc(lan) / cpc(feed) - 1) * 100) / 100 },
      ];
    },
  });

  dash.calc('changes', {
    inputs: ['report_figures', 'capture', 'before_after'],
    title: 'Before vs after changes',
    description: 'Percent change for each before/after pair quoted in the text, and percentage-point change for shares.',
    fn: (report_figures, capture, before_after) => {
      const ba = (s, f) => Number(before_after.find(r => r.source === s)[f]);
      const v = (k) => Number(report_figures.find(r => r.key === k).value);
      const pct = (b, a) => b ? Math.round((a - b) / b * 100) / 100 : null;
      const pts = (b, a) => Math.round((a - b) * 100) / 100;
      const cap = (ch, f) => Number(capture.find(r => r.channel === ch)[f]);
      return [
        { key: 'lan_eng', change: pct(v('engagement_lan_clicks_per_day'), v('engagement_lan_clicks_after')) },
        { key: 'lan_inh', change: pct(v('inhouse_lan_clicks_per_day'), v('inhouse_lan_clicks_after')) },
        { key: 'li_spend', change: pct(v('li_spend_before'), v('li_spend_after')) },
        { key: 'feed_spend', change: pct(v('feed_spend_before'), v('feed_spend_after')) },
        { key: 'feed_views', change: pct(v('feed_video_views_before'), v('feed_video_views_after')) },
        { key: 'li_conv', change: pct(v('li_conv_week_before'), v('li_conv_week_after')) },
        { key: 'gads_leadform', change: pct(v('gads_leadform_week_before'), v('gads_leadform_week_after')) },
        // Different window lengths (Aug 1 - Sept 17 is 48 days, Sept 21 - Oct 18 is 28), so compare per day.
        { key: 'paid_search_contacts', change: pct(v('paid_search_form_contacts') / 48, v('paid_search_form_contacts_after') / 28) },
        { key: 'direct_share', change: pts(v('direct_share_before'), v('direct_share_after')) },
        { key: 'search_engine_share', change: pts(v('search_engine_share_before'), v('search_engine_share_after')) },
        { key: 'organic_share', change: pts(cap('Organic search (vs Search Console)', 'before_share'), cap('Organic search (vs Search Console)', 'after_share')) },
        { key: 'hs_vs_ga_before', change: Math.round(ba('HubSpot sessions (all)', 'before') / ba('Google Analytics sessions (all)', 'before') * 100) / 100 },
        { key: 'hs_vs_ga_after', change: Math.round(ba('HubSpot sessions (all)', 'after') / ba('Google Analytics sessions (all)', 'after') * 100) / 100 },
        { key: 'hs_org', change: pct(cap('Organic search (vs Search Console)', 'before_hubspot'), cap('Organic search (vs Search Console)', 'after_hubspot')) },
        { key: 'sc_org', change: pct(cap('Organic search (vs Search Console)', 'before_platform'), cap('Organic search (vs Search Console)', 'after_platform')) },
        { key: 'hs_social', change: pct(cap('Paid social (vs LinkedIn and Meta)', 'before_hubspot'), cap('Paid social (vs LinkedIn and Meta)', 'after_hubspot')) },
        { key: 'li_clicks', change: pct(cap('Paid social (vs LinkedIn and Meta)', 'before_platform'), cap('Paid social (vs LinkedIn and Meta)', 'after_platform')) },
        { key: 'social_share', change: pts(cap('Paid social (vs LinkedIn and Meta)', 'before_share'), cap('Paid social (vs LinkedIn and Meta)', 'after_share')) },
      ];
    },
  });

  dash.calc('tracking_calc', {
    inputs: ['ad_clicks', 'nov12_figures'],
    title: 'Ad clicks vs. site visits, Q3',
    description: 'LinkedIn and Meta clicks to the site, Aug 1 – Oct 31, and the share Google Analytics recorded as paid social visits.',
    fn: (ad_clicks, nov12_figures) => {
      const q3 = ad_clicks.filter(r => r.date >= '2026-08-01' && r.date <= '2026-10-31');
      const clicks = d3.sum(q3, r => Number(r.linkedin_feed_clicks) + Number(r.linkedin_audience_network_clicks) + Number(r.meta_link_clicks || 0));
      const visits = Number(nov12_figures.find(r => r.key === 'ga_q3_paid_social').value);
      return [
        { key: 'q3_social_clicks', value: clicks },
        { key: 'q3_social_visit_share', value: visits / clicks },
      ];
    },
  });

  dash.calc('nov12_calc', {
    inputs: ['nov12_figures', 'li_impressions_monthly'],
    title: 'Answers to the Nov 12 questions',
    description: 'Cost per conversion two ways, the impressions gap, the summer Audience Network share, the HeyReach monthly cost and Q3 ad spend per likely prospect.',
    fn: (nov12_figures, li_impressions_monthly) => {
      const v = (k) => Number(nov12_figures.find(r => r.key === k).value);
      const summer = li_impressions_monthly.filter(r => r.month >= '2026-05' && r.month <= '2026-09');
      const an = d3.sum(summer, r => Number(r.audience_network));
      const all = an + d3.sum(summer, r => Number(r.linkedin_feed));
      return [
        { key: 'cpa_all', value: v('q3_li_spend') / v('q3_li_conversions') },
        { key: 'cpa_shown', value: v('q3_li_spend_converting') / v('q3_li_conversions') },
        { key: 'q3_li_spend_nonconv', value: v('q3_li_spend') - v('q3_li_spend_converting') },
        { key: 'q3_li_campaigns_nonconv', value: v('q3_li_campaigns') - v('q3_li_campaigns_converting') },
        { key: 'impr_gap', value: v('yr_li_impr_total') - v('yr_page_sponsored') },
        { key: 'impr_other_gap', value: v('yr_li_impr_total') - v('yr_page_sponsored') - v('yr_li_impr_an') },
        { key: 'summer_an_share', value: an / all },
        { key: 'heyreach_monthly', value: v('heyreach_seats') * v('heyreach_seat_price') },
        { key: 'q3_spend_per_prospect', value: v('q3_paid_spend') / v('q3_likely_prospects') },
        { key: 'heyreach_draftwise_monthly', value: v('heyreach_seats_draftwise') * v('heyreach_seat_price') },
        { key: 'visit_rate', value: v('q3_contact_submissions') / v('ga_q3_sessions') },
        { key: 'visit_rate_prospects', value: v('q3_likely_prospects') / v('ga_q3_sessions') },
        { key: 'sessions_per_request', value: v('ga_q3_sessions') / v('q3_contact_submissions') },
        { key: 'visit_rate_ex_ps', value: v('q3_contact_submissions') / (v('ga_q3_sessions') - v('ga_q3_paid_social')) },
        { key: 'visit_rate_engaged', value: v('q3_contact_submissions') / v('ga_q3_engaged') },
        { key: 'gsc_brand_share', value: v('gsc_brand_clicks') / v('gsc_known_clicks') },
        { key: 'gsc_nonbrand_clicks', value: v('gsc_known_clicks') - v('gsc_brand_clicks') },
        { key: 'search_prospects_per_1k', value: v('q3_prospects_search') / v('gsc_q3_clicks') * 1000 },
      ];
    },
  });

  const IMPR = [
    { key: 'linkedin_feed', name: 'LinkedIn feed', color: 1 },
    { key: 'audience_network', name: 'Audience Network', color: 2 },
  ];
  function drawImpr() {
    const box = document.getElementById('dw-impr');
    const src = dash.data('li_impressions_monthly');
    legendInto(document.getElementById('dw-impr-legend'), IMPR.map(s => ({ name: s.name, color: dash.colors[s.color] })), true);
    if (!fail(box, src.status)) return;
    const rows = src.data.map(r => ({ month: r.month, linkedin_feed: Number(r.linkedin_feed), audience_network: Number(r.audience_network) }));
    const W = Math.max(280, box.clientWidth), H = 400, bottom = 24, top = 12;
    const stack = d3.stack().keys(IMPR.map(s => s.key))(rows);
    const y = d3.scaleLinear([0, d3.max(rows, r => r.linkedin_feed + r.audience_network)], [H - bottom, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const left = leftMargin(svg, y), right = 8;
    const x = d3.scaleBand(rows.map(r => r.month), [left, W - right]).padding(0.25);
    const mFmt = (m) => d3.utcFormat(W < 560 ? '%b' : "%b '%y")(new Date(m + '-01T00:00:00Z'));
    const every = W < 420 ? 2 : 1;
    axes(svg, x, y, left, right, W, H, bottom,
      d3.axisBottom(x).tickValues(x.domain().filter((d, i) => i % every === 0)).tickFormat(mFmt).tickSize(0).tickPadding(8));
    stack.forEach((layer, li) => {
      svg.append('g').selectAll('rect').data(layer).join('rect')
        .attr('x', d => x(d.data.month)).attr('width', x.bandwidth())
        .attr('y', d => y(d[1])).attr('height', d => Math.max(0, y(d[0]) - y(d[1])))
        .attr('fill', dash.colors[IMPR[li].color]);
    });
    const tip = document.createElement('div'); tip.className = 'dw-tip'; tip.hidden = true; box.append(tip);
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', r => x(r.month) - x.step() * x.paddingInner() / 2).attr('width', x.step())
      .attr('y', top).attr('height', H - bottom - top).attr('fill', 'transparent')
      .on('pointerleave', () => { tip.hidden = true; })
      .on('pointermove', (event, r) => {
        showTip(box, tip, W, x(r.month) + x.bandwidth() / 2, top, d3.utcFormat('%B %Y')(new Date(r.month + '-01T00:00:00Z')),
          IMPR.map(s => ({ name: s.name, color: dash.colors[s.color], value: fmt(r[s.key]) })));
      });
  }

  dash.calc('leads_latest', {
    inputs: ['leads_weekly'],
    title: 'Leads per week, before vs after',
    description: 'Average Contact Us submissions and new form contacts per week for the weeks starting Jul 6 – Sep 14 and Sep 21 – Nov 9 (through Nov 15), and the change.',
    fn: (leads_weekly) => {
      const row = (key, measure) => {
        const avg = (rows) => rows.reduce((s, r) => s + Number(r[key]), 0) / rows.length;
        const b = Math.round(avg(leads_weekly.filter(r => r.week_start <= '2026-09-14')) * 10) / 10;
        const a = Math.round(avg(leads_weekly.filter(r => r.week_start >= '2026-09-21' && r.week_start <= '2026-11-09')) * 10) / 10;
        return { measure, before: b, after: a, change: b ? Math.round((a - b) / b * 100) / 100 : null };
      };
      return [row('contact_us_submissions', 'Contact Us submissions'), row('new_form_contacts_excl_event', 'New form contacts')];
    },
  });

  const SPEND = [
    { key: 'linkedin_spend', name: 'LinkedIn', color: 1 },
    { key: 'google_search_display_spend', name: 'Google Search & Display', color: 0 },
    { key: 'youtube_spend', name: 'YouTube', color: 3 },
    { key: 'meta_spend', name: 'Meta', color: 2 },
  ];
  const DEMOS = [
    { key: 'contact_us_submissions', name: 'Demo requests', color: 4 },
    { key: 'likely_prospects', name: 'Likely prospects', color: 5 },
  ];
  dash.calc('spend_vs_demos_calc', {
    inputs: ['spend_vs_demos_weekly'],
    title: 'Spend vs. demo requests, summary',
    description: 'Average weekly ad spend from the week of Aug 3 on, and the lowest and highest weekly demo-request counts.',
    fn: (w) => {
      const tot = (r) => Number(r.linkedin_spend) + Number(r.google_search_display_spend) + Number(r.youtube_spend);
      const fromAug = w.filter(r => r.week_start >= '2026-08-03');
      return [
        { key: 'avg_weekly_spend', value: d3.mean(fromAug, tot) },
        { key: 'min_weekly_requests', value: d3.min(w, r => Number(r.contact_us_submissions)) },
        { key: 'max_weekly_requests', value: d3.max(w, r => Number(r.contact_us_submissions)) },
      ];
    },
  });
  dash.calc('spend_vs_demos_monthly_calc', {
    inputs: ['spend_vs_demos_monthly'],
    title: 'Spend per demo request, by month',
    description: 'Monthly ad spend divided by Contact Us submissions and by likely prospects.',
    fn: (m) => m.map(r => ({ ...r,
      spend_per_request: Number(r.ad_spend) / Number(r.contact_us_submissions),
      spend_per_prospect: Number(r.ad_spend) / Number(r.likely_prospects) })),
  });

  function drawSpend() {
    const box = document.getElementById('dw-spend');
    const src = dash.data('spend_vs_demos_weekly');
    legendInto(document.getElementById('dw-spend-legend'), [
      ...SPEND.map(s => ({ name: s.name + ' spend', color: dash.colors[s.color] })),
      ...DEMOS.map(s => ({ name: s.name, color: dash.colors[s.color] })),
    ], true);
    if (!fail(box, src.status)) return;
    const rows = src.data.map(r => { const o = { week: r.week_start }; [...SPEND, ...DEMOS].forEach(s => o[s.key] = Number(r[s.key]) || 0); o.total = SPEND.reduce((t, s) => t + o[s.key], 0); return o; });
    const W = Math.max(280, box.clientWidth), H = 400, bottom = 24, top = 28;
    const yS = d3.scaleLinear([0, d3.max(rows, r => r.total) * 1.05], [H - bottom, top]).nice();
    const yD = d3.scaleLinear([0, Math.max(8, d3.max(rows, r => r.contact_us_submissions))], [H - bottom, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const left = leftMargin(svg, yS) + 14, right = 34;
    const x = d3.scaleBand(rows.map(r => r.week), [left, W - right]).paddingInner(0.25).paddingOuter(0.1);
    const every = W < 520 ? 3 : W < 760 ? 2 : 1;
    svg.append('g').selectAll('line').data(yS.ticks(5)).join('line')
      .attr('x1', left).attr('x2', W - right).attr('y1', d => yS(d)).attr('y2', d => yS(d))
      .attr('stroke', d => d === 0 ? 'var(--cds-chart-axis)' : 'var(--cds-chart-grid)').attr('stroke-width', 1);
    const tickStyle = g => g.attr('font-size', null).attr('font-family', null)
      .call(g => g.select('.domain').remove())
      .call(g => g.selectAll('text').attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)'));
    svg.append('g').attr('transform', `translate(${left - 6},0)`)
      .call(d3.axisLeft(yS).ticks(5).tickFormat(v => '$' + d3.format('~s')(v)).tickSize(0)).call(tickStyle);
    svg.append('g').attr('transform', `translate(${W - right + 6},0)`)
      .call(d3.axisRight(yD).ticks(Math.min(5, yD.domain()[1])).tickFormat(d3.format('d')).tickSize(0)).call(tickStyle);
    svg.append('g').attr('transform', `translate(0,${H - bottom})`)
      .call(d3.axisBottom(x).tickValues(rows.map(r => r.week).filter((_, i) => i % every === 0)).tickFormat(w => dayFmt(parse(w))).tickSize(0).tickPadding(8))
      .call(tickStyle);
    const label = (xx, anchor, t) => svg.append('text').attr('x', xx).attr('y', top - 12).attr('text-anchor', anchor)
      .attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)').style('font-weight', 600).text(t);
    label(left - 6, 'end', 'Ad spend').attr('x', 4).attr('text-anchor', 'start');
    label(W - 4, 'end', 'Demo requests');

    const stack = d3.stack().keys(SPEND.map(s => s.key))(rows);
    stack.forEach((layer, i) => {
      svg.append('g').selectAll('rect').data(layer).join('rect').attr('class', 'bar')
        .attr('x', d => x(d.data.week)).attr('width', x.bandwidth())
        .attr('y', d => yS(d[1])).attr('height', d => Math.max(0, yS(d[0]) - yS(d[1])))
        .attr('fill', dash.colors[SPEND[i].color]).attr('fill-opacity', 0.55);
    });
    const cx = r => x(r.week) + x.bandwidth() / 2;
    DEMOS.forEach((s, i) => {
      svg.append('path').datum(rows).attr('fill', 'none').attr('stroke', dash.colors[s.color])
        .attr('stroke-width', i === 0 ? 3 : 2).attr('stroke-dasharray', i === 0 ? null : '5 4')
        .attr('d', d3.line().x(cx).y(r => yD(r[s.key])));
      svg.append('g').selectAll('circle').data(rows).join('circle')
        .attr('cx', cx).attr('cy', r => yD(r[s.key])).attr('r', i === 0 ? 4.5 : 3.5)
        .attr('fill', dash.colors[s.color]).attr('stroke', 'var(--color-bg)').attr('stroke-width', 1.5);
    });
    const tip = document.createElement('div'); tip.className = 'dw-tip'; tip.hidden = true; box.append(tip);
    const money = (v) => '$' + fmt(Math.round(v));
    svg.append('g').selectAll('rect').data(rows).join('rect')
      .attr('x', r => x(r.week) - (x.step() - x.bandwidth()) / 2).attr('width', x.step())
      .attr('y', top).attr('height', H - bottom - top).attr('fill', 'transparent')
      .on('pointerenter', function (event, r) {
        svg.selectAll('.bar').attr('fill-opacity', d => ((d.data || d).week === r.week ? 0.9 : 0.35));
        showTip(box, tip, W, cx(r), top, 'Week of ' + dayFmt(parse(r.week)), [
          ...SPEND.map(s => ({ name: s.name, color: dash.colors[s.color], value: money(r[s.key]) })),
          { name: 'Total ad spend', color: 'transparent', value: money(r.total) },
          ...DEMOS.map(s => ({ name: s.name, color: dash.colors[s.color], value: fmt(r[s.key]) })),
        ]);
      })
      .on('pointerleave', () => { svg.selectAll('.bar').attr('fill-opacity', 0.55); tip.hidden = true; });
  }

  const FMT = {
    money2: (v) => '$' + d3.format(',.2f')(v),
    int: (v) => fmt(Math.round(v)),
    dec1: (v) => fmt1(v),
    pct: (v) => d3.format('.0%')(v),
    pct2: (v) => d3.format('.2%')(v),
    pctabs: (v) => d3.format('.0%')(Math.abs(v)),
    money: (v) => '$' + fmt(Math.round(v)),
    times: (v) => fmt(v) + ' times',
    chg: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + d3.format('.0%')(Math.abs(v)),
    pts: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.round(Math.abs(v) * 100) + '%',
  };

  function fillFigs() {
    document.querySelectorAll('.dw .fig').forEach(el => {
      const d = dash.data(el.dataset.source);
      if (d.status !== 'ok') { el.textContent = '—'; return; }
      const conds = el.dataset.where.split('&').map(p => p.split('='));
      const row = d.data.find(r => conds.every(([k, v]) => String(r[k]) === v));
      const v = row ? Number(row[el.dataset.field]) : NaN;
      el.textContent = Number.isFinite(v) ? FMT[el.dataset.fmt](v) : '—';
      el.classList.remove('neg', 'pos');
      if (el.dataset.field === 'change' && el.dataset.fmt !== 'pct' && Number.isFinite(v) && v !== 0) el.classList.add(v < 0 ? 'neg' : 'pos');
    });
  }

  const COMPARE = [
    { id: 'gads', name: 'Google Ads clicks', src: 'ad_clicks', keys: ['google_ads_clicks'], color: 0, dash: false, on: true },
    { id: 'hs_paid', name: 'HubSpot paid search', src: 'hubspot_daily', keys: ['paid'], color: 0, dash: true, on: true },
    { id: 'li', name: 'LinkedIn clicks', src: 'ad_clicks', keys: ['linkedin_feed_clicks', 'linkedin_audience_network_clicks'], color: 2, dash: false, on: false },
    { id: 'hs_social', name: 'HubSpot paid social', src: 'hubspot_daily', keys: ['paid_social'], color: 2, dash: true, on: false },
    { id: 'gsc', name: 'Search Console clicks', src: 'gsc_daily', keys: ['search_console_clicks'], color: 3, dash: false, on: true },
    { id: 'hs_org', name: 'HubSpot organic', src: 'hubspot_daily', keys: ['organic'], color: 3, dash: true, on: true },
    { id: 'ga', name: 'Google Analytics sessions', src: 'ga_daily', keys: ['ga_sessions'], color: 7, dash: false, on: false },
    { id: 'hs_all', name: 'HubSpot sessions (all)', src: 'hubspot_daily', keys: ['total'], color: 7, dash: true, on: false },
  ];
  const shown = new Set(COMPARE.filter(s => s.on).map(s => s.id));

  function drawToggles() {
    const wrap = document.getElementById('dw-toggles');
    wrap.textContent = '';
    COMPARE.forEach(s => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'dw-toggle';
      btn.setAttribute('aria-pressed', shown.has(s.id) ? 'true' : 'false');
      const sw = d3.create('svg').attr('width', 18).attr('height', 8);
      sw.append('line').attr('x1', 1).attr('x2', 17).attr('y1', 4).attr('y2', 4)
        .attr('stroke', dash.colors[s.color]).attr('stroke-width', 2).attr('stroke-linecap', 'round')
        .attr('stroke-dasharray', s.dash ? '4 3' : null);
      btn.append(sw.node(), s.name);
      btn.addEventListener('click', () => {
        if (shown.has(s.id)) shown.delete(s.id); else shown.add(s.id);
        drawToggles(); drawCompare();
      });
      wrap.append(btn);
    });
  }

  function drawCompare() {
    const box = document.getElementById('dw-compare');
    const ids = ['ad_clicks', 'gsc_daily', 'hubspot_daily', 'ga_daily'];
    const bad = ids.map(id => dash.data(id)).find(d => d.status !== 'ok');
    if (!fail(box, bad ? bad.status : 'ok')) return;
    const series = COMPARE.filter(s => shown.has(s.id)).map(s => ({
      ...s,
      pts: dash.data(s.src).data.filter(r => r.date >= START && r.date <= END)
        .map(r => ({ date: parse(r.date), v: s.keys.reduce((a, k) => a + Number(r[k]), 0) })),
    }));
    const W = Math.max(280, box.clientWidth), H = 480, bottom = 24, top = EV_TOP;
    const yMax = d3.max(series, s => d3.max(s.pts, p => p.v)) || 10;
    const y = d3.scaleLinear([0, yMax], [H - bottom, top]).nice();
    const svg = d3.select(box).append('svg').attr('width', '100%').attr('height', H).attr('viewBox', `0 0 ${W} ${H}`);
    const left = leftMargin(svg, y), right = 8;
    const x = d3.scaleUtc([parse(START), parse(END)], [left, W - right]);
    axes(svg, x, y, left, right, W, H, bottom,
      d3.axisBottom(x).tickValues(dateTicks(W)).tickFormat(dayFmt).tickSize(0).tickPadding(8));
    drawEvents(svg, d => x(parse(d)), top, H, bottom, W, right);
    if (!series.length) {
      svg.append('text').attr('x', (left + W) / 2).attr('y', H / 2).attr('text-anchor', 'middle')
        .attr('fill', 'var(--color-fg-muted)').style('font-size', 'var(--cds-font-size-caption)').text('Pick a series above to show it');
      return;
    }
    series.forEach(s => {
      svg.append('path').datum(s.pts).attr('fill', 'none').attr('stroke', dash.colors[s.color]).attr('stroke-width', 2)
        .attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round').attr('stroke-dasharray', s.dash ? '5 4' : null)
        .attr('d', d3.line().x(p => x(p.date)).y(p => y(p.v)));
    });
    const hover = svg.append('g').style('display', 'none');
    const rule = hover.append('line').attr('y1', top).attr('y2', H - bottom).attr('stroke', 'var(--cds-chart-axis)');
    const dots = series.map(s => hover.append('circle').attr('r', 4).attr('fill', dash.colors[s.color]).attr('stroke', 'var(--color-panel)').attr('stroke-width', 2));
    const tip = document.createElement('div'); tip.className = 'dw-tip'; tip.hidden = true; box.append(tip);
    const days = d3.utcDay.range(parse(START), d3.utcDay.offset(parse(END), 1));
    const maps = series.map(s => new Map(s.pts.map(p => [+p.date, p.v])));
    svg.append('rect').attr('x', left).attr('y', top).attr('width', W - left - right).attr('height', H - bottom - top)
      .attr('fill', 'transparent')
      .on('pointerleave', () => { hover.style('display', 'none'); tip.hidden = true; })
      .on('pointermove', (event) => {
        const [mx] = d3.pointer(event);
        const day = days[Math.max(0, Math.min(days.length - 1, d3.bisectCenter(days.map(Number), +x.invert(mx))))];
        const px = x(day);
        hover.style('display', null);
        rule.attr('x1', px).attr('x2', px);
        series.forEach((s, i) => {
          const v = maps[i].get(+day);
          if (v == null) dots[i].attr('display', 'none'); else dots[i].attr('display', null).attr('cx', px).attr('cy', y(v));
        });
        showTip(box, tip, W, px, top, d3.utcFormat('%a, %b %-d')(day),
          series.map((s, i) => ({ name: s.name, color: dash.colors[s.color], value: maps[i].has(+day) ? fmt(maps[i].get(+day)) : '—' })));
      });
  }


  document.querySelectorAll('.dw-nav a').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const el = document.getElementById(a.getAttribute('href').slice(1));
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); dash.setLink(el.id); }
  }));

  dash.onData(() => {
    drawClicks();
    drawLeads();
    fillTable('dw-ba-body', dash.data('before_after'), [
      { k: 'source', f: v => v }, { k: 'before', f: fmt }, { k: 'after', f: fmt }, { k: 'change', f: pct, signed: true },
    ], r => r.source === 'All ad clicks');
    fillTable('dw-cap-body', dash.data('capture'), [
      { k: 'channel', f: v => v }, { k: 'before_platform', f: fmt }, { k: 'before_hubspot', f: fmt }, { k: 'before_share', f: share },
      { k: 'after_platform', f: fmt }, { k: 'after_hubspot', f: fmt }, { k: 'after_share', f: share },
    ]);
    fillTable('dw-lba-body', dash.data('leads_latest'), [
      { k: 'measure', f: v => v }, { k: 'before', f: fmt1 }, { k: 'after', f: fmt1 }, { k: 'change', f: pct, signed: true },
    ]);
    drawImpr();
    drawSpend();
    fillTable('dw-svd-body', dash.data('spend_vs_demos_monthly_calc'), [
      { k: 'label', f: v => v }, { k: 'ad_spend', f: v => '$' + fmt(Math.round(v)) }, { k: 'contact_us_submissions', f: fmt },
      { k: 'likely_prospects', f: fmt }, { k: 'spend_per_request', f: v => '$' + fmt(Math.round(v)) }, { k: 'spend_per_prospect', f: v => '$' + fmt(Math.round(v)) },
    ]);
    fillFigs();
  });
}
