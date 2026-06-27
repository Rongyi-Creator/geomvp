interface Env {
  ACCOUNT_ID: string;
  AE_DATASET: string;
  CF_API_TOKEN: string;
  DASHBOARD_TOKEN: string;
  DASHBOARD_KV: KVNamespace;
  GEO_TRAFFIC: AnalyticsEngineDataset;
  SLACK_WEBHOOK_URL?: string;
  RESEND_API_KEY?: string;
}

// ── Types ──

interface AERow {
  [key: string]: string | number;
}

interface AEQueryResult {
  data: AERow[];
  rows: number;
}

interface OtterlyData {
  updatedAt: string;
  prompts: {
    total: number;
    brandMentioned: number;
    domainCited: number;
    items: { prompt: string; brandRank: string; domainCited: string; totalCitations: number }[];
    competitors: { name: string; mentioned: number; cited: number }[];
  };
  citations: {
    total: number;
    myDomainCitations: number;
    engines: { name: string; citations: number; myDomainCited: number }[];
    myUrls: { url: string; engine: string; prompt: string; position: number; date: string }[];
    topDomains: { domain: string; citations: number }[];
  };
}

interface BaselineData {
  capturedAt: string;
  schemaPages: number;
  metaDescPages: number;
  robotsTxt: string;
  sitemapUrls: number;
  canonicalCoverage: string;
  otterlyScore: number | null;
}

interface ClientConfig {
  domain: string;
  activeSince: string;
}

// ── Analytics Engine SQL queries ──

function queryCategoryBreakdown(dataset: string, days: number): string {
  return `SELECT blob1 AS category, SUM(_sample_interval) AS visits FROM ${dataset} WHERE timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY category ORDER BY visits DESC`;
}

function queryBotDetails(dataset: string, days: number): string {
  return `SELECT blob2 AS bot_name, blob1 AS category, SUM(_sample_interval) AS visits FROM ${dataset} WHERE blob1 IN ('ai_retrieval', 'seo_crawler', 'ai_training') AND timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY bot_name, category ORDER BY visits DESC`;
}

function queryDailyTrend(dataset: string, days: number): string {
  return `SELECT toDate(timestamp) AS day, blob1 AS category, SUM(_sample_interval) AS visits FROM ${dataset} WHERE timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY day, category ORDER BY day`;
}

function queryGeoStatus(dataset: string, days: number): string {
  return `SELECT blob4 AS status, SUM(_sample_interval) AS count FROM ${dataset} WHERE timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY status ORDER BY count DESC`;
}

function queryTopGeoPages(dataset: string, days: number): string {
  return `SELECT blob3 AS page, blob5 AS page_type, blob2 AS bot, SUM(_sample_interval) AS visits FROM ${dataset} WHERE blob1 = 'ai_retrieval' AND blob4 = 'injected' AND timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY page, page_type, bot ORDER BY visits DESC LIMIT 10`;
}

function queryCoverageGaps(dataset: string, days: number): string {
  return `SELECT blob3 AS page, SUM(_sample_interval) AS visits FROM ${dataset} WHERE blob4 = 'passthrough' AND blob1 IN ('ai_retrieval','seo_crawler') AND timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY page ORDER BY visits DESC LIMIT 15`;
}

function queryTotalRequests(dataset: string, days: number): string {
  return `SELECT SUM(_sample_interval) AS total FROM ${dataset} WHERE timestamp >= NOW() - INTERVAL '${days}' DAY`;
}

function queryDailyAIBots(dataset: string, days: number): string {
  return `SELECT toDate(timestamp) AS day, blob2 AS bot_name, SUM(_sample_interval) AS visits FROM ${dataset} WHERE blob1 = 'ai_retrieval' AND timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY day, bot_name ORDER BY day`;
}

function queryDailyAIBotsByPage(dataset: string, days: number): string {
  return `SELECT toDate(timestamp) AS day, blob2 AS bot_name, blob3 AS page, SUM(_sample_interval) AS visits FROM ${dataset} WHERE blob1 = 'ai_retrieval' AND timestamp >= NOW() - INTERVAL '${days}' DAY GROUP BY day, bot_name, page ORDER BY day, bot_name, visits DESC`;
}

function queryAIBotLog(dataset: string, days: number): string {
  return `SELECT timestamp, blob2 AS bot_name, blob3 AS page, blob4 AS geo_status FROM ${dataset} WHERE blob1 = 'ai_retrieval' AND timestamp >= NOW() - INTERVAL '${days}' DAY ORDER BY timestamp DESC LIMIT 500`;
}

// ── AE SQL API caller ──

async function queryAE(env: Env, sql: string): Promise<AERow[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.ACCOUNT_ID}/analytics_engine/sql`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_API_TOKEN}`,
      "Content-Type": "text/plain",
    },
    body: sql,
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("AE query failed:", resp.status, text);
    return [];
  }
  const result = (await resp.json()) as AEQueryResult;
  return result.data ?? [];
}

// ── SVG Generators ──

const COLORS: Record<string, string> = {
  ai_retrieval: "#86AD94",
  seo_crawler: "#6E8CA8",
  ai_training: "#BE9A5E",
  visitor: "#454C57",
};

const LABELS: Record<string, string> = {
  ai_retrieval: "AI Retrieval",
  seo_crawler: "SEO Crawlers",
  ai_training: "AI Training",
  visitor: "Visitors",
};

function svgDonutChart(
  data: { label: string; value: number; color: string }[],
  chartId: string
): string {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="72" fill="none" stroke="#1B2028" stroke-width="28"/><text x="100" y="108" text-anchor="middle" fill="#5C636E" font-size="13" font-family="Geist,-apple-system,sans-serif">No data</text></svg>`;
  }
  const cx = 100, cy = 100, outerR = 86, innerR = 57, GAP = 2.5;
  const dominant = data.reduce((a, b) => a.value > b.value ? a : b);
  const toR = (a: number) => (a * Math.PI) / 180;
  const domLbl = dominant.label.toUpperCase();
  let svg = `<svg id="${chartId}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" style="cursor:pointer">`;
  svg += `<circle cx="${cx}" cy="${cy}" r="${(outerR + innerR) / 2}" fill="none" stroke="#1B2028" stroke-width="${outerR - innerR}"/>`;
  let cum = -90;
  for (let di = 0; di < data.length; di++) {
    const d = data[di];
    if (d.value === 0) continue;
    const lbl = d.label.toUpperCase();
    const seg = (d.value / total) * 360;
    const sA = cum + GAP / 2, eA = cum + seg - GAP / 2;
    cum += seg;
    const large = seg - GAP > 180 ? 1 : 0;
    const ox1 = cx + outerR * Math.cos(toR(sA)), oy1 = cy + outerR * Math.sin(toR(sA));
    const ox2 = cx + outerR * Math.cos(toR(eA)), oy2 = cy + outerR * Math.sin(toR(eA));
    const ix1 = cx + innerR * Math.cos(toR(eA)), iy1 = cy + innerR * Math.sin(toR(eA));
    const ix2 = cx + innerR * Math.cos(toR(sA)), iy2 = cy + innerR * Math.sin(toR(sA));
    svg += `<path data-seg="${cum}" data-idx="${di}" onmouseenter="geoDonut('${chartId}',${d.value},'${lbl}',${di})" onmouseleave="geoDonut('${chartId}',${dominant.value},'${domLbl}',-1)" d="M${ox1.toFixed(1)},${oy1.toFixed(1)} A${outerR},${outerR} 0 ${large},1 ${ox2.toFixed(1)},${oy2.toFixed(1)} L${ix1.toFixed(1)},${iy1.toFixed(1)} A${innerR},${innerR} 0 ${large},0 ${ix2.toFixed(1)},${iy2.toFixed(1)} Z" fill="${d.color}"/>`;
  }
  svg += `<text id="${chartId}-val" x="${cx}" y="${cy - 4}" text-anchor="middle" dominant-baseline="auto" font-weight="600" font-size="34" fill="#E8E9E5" font-family="Geist,-apple-system,sans-serif">${dominant.value}</text>`;
  svg += `<text id="${chartId}-lbl" x="${cx}" y="${cy + 17}" text-anchor="middle" dominant-baseline="auto" font-size="9" fill="#9298A1" font-family="Geist Mono,monospace" letter-spacing="1">${escHtml(dominant.label.toUpperCase())}</text>`;
  svg += `</svg>`;
  return svg;
}

function svgLineChart(
  series: { label: string; color: string; points: { x: number; y: number }[] }[],
  xLabels: string[],
  width = 600,
  height = 240,
  activationIdx = -1,
  interactive = false
): string {
  const legendH = interactive || series.length <= 1 ? 0 : 28;
  const extraBottom = activationIdx >= 0 ? 16 : 0;
  const totalH = height + extraBottom;
  const pad = { top: 8 + legendH, right: 20, bottom: 30, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  let maxY = 0;
  for (const s of series) for (const p of s.points) if (p.y > maxY) maxY = p.y;
  if (maxY === 0) maxY = 1;

  // Stable chart ID from series labels (same labels → same ID across renders)
  const chartId = interactive
    ? `lc${series.map(s => s.label).join('').split('').reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 0).toString(36)}`
    : '';

  let svgBody = `<rect width="${width}" height="${totalH}" fill="#12151A"/>`;

  // Static legend (non-interactive, multi-series only)
  if (!interactive && series.length > 1) {
    let legendX = pad.left;
    for (const s of series) {
      svgBody += `<circle cx="${legendX + 5}" cy="16" r="5" fill="${s.color}"/>`;
      svgBody += `<text x="${legendX + 14}" y="20" fill="#E8E9E5" font-size="11">${s.label}</text>`;
      legendX += s.label.length * 7 + 30;
    }
  }

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    svgBody += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#1F252E" stroke-width="1"/>`;
    svgBody += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#5C636E" font-size="10">${val}</text>`;
  }

  // X labels (thin when many)
  const step = xLabels.length > 1 ? w / (xLabels.length - 1) : 0;
  const labelSkip = Math.max(1, Math.ceil(xLabels.length / 8));
  for (let i = 0; i < xLabels.length; i++) {
    if (i % labelSkip !== 0 && i !== xLabels.length - 1) continue;
    const x = pad.left + step * i;
    svgBody += `<text x="${x}" y="${height - 5}" text-anchor="middle" fill="#5C636E" font-size="9">${xLabels[i]}</text>`;
  }

  // Lines + data labels
  for (const s of series) {
    if (s.points.length === 0) continue;
    const safeId = s.label.replace(/[^a-z0-9]/gi, '_');
    if (interactive) svgBody += `<g class="geo-series" id="${chartId}-${safeId}">`;
    const pts = s.points.map((p) => {
      const x = pad.left + (p.x / Math.max(xLabels.length - 1, 1)) * w;
      const y = pad.top + h - (p.y / maxY) * h;
      return `${x},${y}`;
    }).join(" ");
    svgBody += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of s.points) {
      const x = pad.left + (p.x / Math.max(xLabels.length - 1, 1)) * w;
      const y = pad.top + h - (p.y / maxY) * h;
      svgBody += `<circle cx="${x}" cy="${y}" r="3" fill="${s.color}"/>`;
      if (p.y > 0) svgBody += `<text x="${x}" y="${y - 8}" text-anchor="middle" fill="${s.color}" font-size="9" font-weight="600">${p.y}</text>`;
    }
    if (interactive) svgBody += `</g>`;
  }

  // Activation marker
  if (activationIdx >= 0 && activationIdx < xLabels.length) {
    const markerX = pad.left + (activationIdx / Math.max(xLabels.length - 1, 1)) * w;
    svgBody += `<line x1="${markerX}" y1="${pad.top}" x2="${markerX}" y2="${pad.top + h}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    svgBody += `<text x="${markerX}" y="${height + extraBottom - 4}" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="600">GEO Active</text>`;
  }

  const svgEl = `<svg viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;display:block">${svgBody}</svg>`;

  if (!interactive) return svgEl;

  // Interactive: HTML legend buttons + SVG with series groups
  const legendHtml = `<div id="${chartId}-legend" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
${series.map(s => {
    const safeId = s.label.replace(/[^a-z0-9]/gi, '_');
    return `<button class="geo-lb" data-sid="${safeId}" onclick="geoToggle('${chartId}','${safeId}')" style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:9999px;font-size:11px;font-weight:600;border:1.5px solid ${s.color};color:${s.color};background:none;cursor:pointer;transition:opacity .15s"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color}"></span>${escHtml(s.label)}</button>`;
  }).join('\n')}
</div>`;

  return `<div id="${chartId}">${legendHtml}${svgEl}</div>`;
}

function svgStackedBarChart(
  days: { label: string; bots: { name: string; color: string; value: number }[] }[],
  activationIdx: number,
  width = 800,
  height = 260
): string {
  const pad = { top: 36, right: 20, bottom: 30, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  let maxY = 0;
  for (const d of days) {
    const sum = d.bots.reduce((s, b) => s + b.value, 0);
    if (sum > maxY) maxY = sum;
  }
  if (maxY === 0) maxY = 1;

  const allBots = new Map<string, string>();
  for (const d of days) for (const b of d.bots) allBots.set(b.name, b.color);

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%">`;
  svg += `<rect width="${width}" height="${height}" fill="#12151A"/>`;

  // Legend
  let legendX = pad.left;
  for (const [name, color] of allBots) {
    svg += `<circle cx="${legendX + 5}" cy="16" r="5" fill="${color}"/>`;
    svg += `<text x="${legendX + 14}" y="20" fill="#E8E9E5" font-size="10">${name}</text>`;
    legendX += name.length * 6.5 + 28;
  }

  // Grid
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#1F252E" stroke-width="1"/>`;
    svg += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#5C636E" font-size="10">${val}</text>`;
  }

  // Bars
  const barGap = 4;
  const barW = days.length > 0 ? Math.min(40, (w - barGap * days.length) / days.length) : 20;
  const totalBarSpace = days.length * (barW + barGap) - barGap;
  const offsetX = pad.left + (w - totalBarSpace) / 2;

  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    const x = offsetX + i * (barW + barGap);
    let yOffset = 0;
    for (const b of d.bots) {
      const barH = (b.value / maxY) * h;
      const y = pad.top + h - yOffset - barH;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${b.color}" rx="2"/>`;
      if (barH > 14) {
        svg += `<text x="${x + barW / 2}" y="${y + barH / 2 + 4}" text-anchor="middle" fill="white" font-size="9" font-weight="600">${b.value}</text>`;
      }
      yOffset += barH;
    }
    // X label
    svg += `<text x="${x + barW / 2}" y="${height - 5}" text-anchor="middle" fill="#5C636E" font-size="9">${d.label}</text>`;
  }

  // Activation marker
  if (activationIdx >= 0 && activationIdx < days.length) {
    const markerX = offsetX + activationIdx * (barW + barGap) + barW / 2;
    svg += `<line x1="${markerX}" y1="${pad.top}" x2="${markerX}" y2="${pad.top + h}" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="4,3"/>`;
    svg += `<text x="${markerX}" y="${pad.top - 4}" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="600">GEO Active</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// ── HTML Rendering ──

function renderStyles(): string {
  return `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--accent:#587B66;--bright:#86AD94;--strong:#456250;--bg:#12151A;--panel:#171B21;--panel2:#1B2028;--line:#252B35;--line2:#1F252E;--tx:#E8E9E5;--tx2:#9298A1;--tx3:#5C636E;--blue:#6E8CA8;--amber:#BE9A5E;--neutral:#454C57;--warn:#C99A52;--danger:#CB7E70}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
body{font-family:'Geist',-apple-system,BlinkMacSystemFont,sans-serif;background:var(--bg);color:var(--tx);min-height:100vh;-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.55}
button{font:inherit;color:inherit;cursor:pointer;border:none;background:none;padding:0}
a{color:var(--bright)}
table{border-collapse:collapse;width:100%}
::selection{background:rgba(134,173,148,.3)}
::-webkit-scrollbar{width:10px;height:10px}
::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:#2A313B;border-radius:0;border:2px solid var(--bg)}
::-webkit-scrollbar-thumb:hover{background:#3A424E}
@keyframes geo-pulse{0%{transform:scale(1);opacity:.5}70%{transform:scale(3);opacity:0}100%{transform:scale(3);opacity:0}}
.container{max-width:1160px;margin:0 auto;padding:clamp(24px,4vw,44px) clamp(16px,4vw,40px) 80px}
.geo-header{position:sticky;top:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:14px clamp(16px,4vw,40px);background:rgba(18,21,26,.82);backdrop-filter:saturate(150%) blur(16px);-webkit-backdrop-filter:saturate(150%) blur(16px);border-bottom:1px solid var(--line2)}
.geo-logo{display:flex;align-items:center;gap:14px;min-width:0}
.geo-logo-brand{display:flex;align-items:center;font-size:15px;letter-spacing:-.02em}
.geo-logo-dot{display:inline-block;width:5px;height:5px;background:var(--bright);transform:rotate(45deg);margin:0 7px;flex-shrink:0}
.geo-sep{width:1px;height:18px;background:var(--line);flex-shrink:0}
.geo-domain-wrap{min-width:0}
.geo-domain{font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.geo-domain-sub{font-size:11px;color:var(--tx3);white-space:nowrap}
.geo-header-right{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.geo-live{display:inline-flex;align-items:center;gap:7px;font-family:'Geist Mono',monospace;font-size:11px;color:var(--bright)}
.geo-live-dot{position:relative;width:7px;height:7px;flex-shrink:0;display:inline-block}
.geo-live-dot span{position:absolute;inset:0;border-radius:50%;background:var(--bright)}
.geo-live-dot span+span{animation:geo-pulse 2.4s ease-out infinite}
.geo-avatar{width:34px;height:34px;display:flex;align-items:center;justify-content:center;background:var(--panel);border:1px solid var(--line);font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx2);letter-spacing:.02em;flex-shrink:0}
.page-label{font-family:'Geist Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.16em;color:var(--bright);margin:0 0 12px}
h1{font-weight:600;font-size:clamp(26px,4vw,38px);letter-spacing:-.035em;line-height:1.05;margin:0 0 28px;color:var(--tx)}
.section-hdr{display:flex;align-items:center;gap:14px;margin:72px 0 24px}
.section-num{font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx3)}
h2{font-weight:600;font-size:clamp(18px,2.4vw,23px);letter-spacing:-.025em;margin:0;color:var(--tx)}
.section-rule{flex:1;height:1px;background:var(--line2)}
h3{font-size:13px;font-weight:500;color:var(--tx);margin:0 0 16px}
.card{background:var(--panel);border:1px solid var(--line);padding:22px}
.grid{display:grid;gap:14px;margin-bottom:14px}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.grid-3{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.grid-4{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}
.stat-value{font-weight:600;font-size:30px;letter-spacing:-.035em;line-height:1;color:var(--tx)}
.stat-label{font-family:'Geist Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.07em;color:var(--tx2);margin:8px 0 4px}
.stat-sub{font-size:11px;color:var(--tx3)}
th{text-align:left;padding:7px 12px;font-family:'Geist Mono',monospace;font-size:10px;font-weight:500;text-transform:uppercase;letter-spacing:.06em;color:var(--tx3);position:sticky;top:0;background:var(--panel);border-bottom:1px solid var(--line2)}
td{padding:8px 12px;border-top:1px solid var(--line2);font-size:13px;color:var(--tx)}
tr:hover td{background:var(--panel2)}
.badge{display:inline-block;font-family:'Geist Mono',monospace;font-size:10px;font-weight:400;padding:2px 8px;border:1px solid;background:transparent}
.badge-green{color:var(--bright);border-color:var(--bright)}
.badge-blue{color:var(--blue);border-color:var(--blue)}
.badge-amber{color:var(--amber);border-color:var(--amber)}
.badge-gray{color:var(--tx3);border-color:var(--neutral)}
.badge-red{color:var(--danger);border-color:var(--danger)}
.section{margin-bottom:0}
.pie-container{display:flex;align-items:center;gap:28px;flex-wrap:wrap}
.pie-chart{width:200px;height:200px;flex-shrink:0}
.pie-legend{display:flex;flex-direction:column;gap:14px;flex:1;min-width:160px}
.legend-item{display:flex;align-items:center;gap:10px;font-size:13px;cursor:default}
.legend-item:hover .legend-lbl{color:var(--tx)}
.legend-dot{width:10px;height:10px;flex-shrink:0}
.legend-lbl{flex:1;color:var(--tx2)}
.legend-val{font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx2)}
.empty{color:var(--tx3);font-style:italic;padding:20px 0;text-align:center}
.bar{height:6px;background:var(--line2);overflow:hidden}
.bar-fill{height:100%}
.status-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--line2);font-size:13px}
.status-row:last-child{border:none}
.change-up{color:var(--bright);font-family:'Geist Mono',monospace;font-size:12px}
.change-down{color:var(--danger);font-family:'Geist Mono',monospace;font-size:12px}
.change-neutral{color:var(--tx3);font-family:'Geist Mono',monospace;font-size:12px}
.subtitle{color:var(--tx2);font-size:14px;margin-bottom:16px}
.timestamp{font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx3)}
.time-nav{display:inline-flex;padding:3px;background:var(--panel);border:1px solid var(--line);gap:2px;margin-bottom:28px}
.time-pill{display:inline-block;padding:6px 13px;font-family:'Geist Mono',monospace;font-size:12px;letter-spacing:.02em;text-decoration:none;color:var(--tx2);background:transparent;transition:background .2s,color .2s}
.time-pill:hover{color:var(--tx)}
.time-pill.active{background:var(--bright);color:var(--bg);font-weight:500}
.data-source{font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx3);margin-top:12px}
.data-source a{color:var(--tx3);text-decoration:underline}
.layer-label{font-family:'Geist Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:var(--tx3);margin-bottom:8px}
.btn-outline{display:inline-block;padding:6px 14px;border:1px solid var(--line);font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx2);text-decoration:none;white-space:nowrap;flex-shrink:0;letter-spacing:.02em}
.btn-outline:hover{border-color:var(--tx3);color:var(--tx)}
.insight-banner{background:linear-gradient(135deg,rgba(88,123,102,.12),rgba(88,123,102,.03));border:1px solid rgba(134,173,148,.3);padding:20px;margin-bottom:14px}
.insight-banner h3{color:var(--tx);font-size:15px;margin-bottom:6px;font-weight:600}
.insight-banner p{color:var(--tx2);font-size:13px;line-height:1.5}
.geo-bar{transition:width .7s cubic-bezier(.4,0,.2,1)}
[data-seg]{transition:opacity .2s,transform .2s;transform-box:fill-box;transform-origin:center}
.geo-footer{margin-top:40px;padding-top:24px;border-top:1px solid var(--line2);display:flex;align-items:center;justify-content:space-between;gap:16px}
@media(max-width:768px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.pie-container{flex-direction:column}}
</style>
<script>
function geoToggle(cid,sid){var chart=document.getElementById(cid);if(!chart)return;var allG=chart.querySelectorAll('.geo-series');var allB=chart.querySelectorAll('.geo-lb');var target=document.getElementById(cid+'-'+sid);var isSolo=target&&target.getAttribute('data-solo')==='1';if(isSolo){allG.forEach(function(g){g.style.display='';g.removeAttribute('data-solo')});allB.forEach(function(b){b.style.opacity='1'})}else{allG.forEach(function(g){g.style.display='none';g.removeAttribute('data-solo')});allB.forEach(function(b){b.style.opacity='0.35'});if(target){target.style.display='';target.setAttribute('data-solo','1')}var ab=chart.querySelector('.geo-lb[data-sid="'+sid+'"]');if(ab)ab.style.opacity='1'}}
function geoDonut(cid,val,lbl,idx){
  var v=document.getElementById(cid+'-val');var l=document.getElementById(cid+'-lbl');
  if(v)v.textContent=val;if(l)l.textContent=lbl;
  var svg=document.getElementById(cid);if(!svg)return;
  var segs=svg.querySelectorAll('[data-seg]');
  var lbs=document.querySelectorAll('[data-lb="'+cid+'"]');
  var active=idx!=null&&idx>=0;
  segs.forEach(function(s){var si=parseInt(s.getAttribute('data-idx')||'-1');s.style.opacity=active&&si!==idx?'0.3':'1';s.style.transform=active&&si===idx?'scale(1.06)':'none';});
  lbs.forEach(function(lb,i){
    var on=!active||i===idx;
    lb.style.opacity=on?'1':'0.4';
    var ll=lb.querySelector('.legend-lbl');var lv=lb.querySelector('.legend-val');
    if(ll)ll.style.color=on?'var(--tx)':'';if(lv)lv.style.color=on?'var(--tx)':'';
  });
}
function geoAnim(){
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var io=new IntersectionObserver(function(ents){
    ents.forEach(function(e){if(!e.isIntersecting)return;io.unobserve(e.target);if(e.target.__anim)e.target.__anim();});
  },{threshold:0.25});
  document.querySelectorAll('.stat-value').forEach(function(el){
    var orig=el.textContent.trim();
    var m=orig.match(/^([^\\d]*)(\\d[\\d,.]*)([^\\d]*)$/);if(!m)return;
    var pre=m[1],suf=m[3],num=parseFloat(m[2].replace(/,/g,''));if(!num)return;
    if(reduce)return;
    el.textContent=pre+'0'+suf;
    el.__anim=function(){var t0=performance.now(),dur=1400;
      requestAnimationFrame(function tick(t){var p=Math.min((t-t0)/dur,1),e=p*p;
        el.textContent=pre+Math.round(e*num).toLocaleString()+suf;
        if(p<1)requestAnimationFrame(tick);else el.textContent=orig;});};
    io.observe(el);
  });
  document.querySelectorAll('.geo-bar').forEach(function(el){
    var w=el.style.width;if(!w||reduce)return;
    el.style.transition='none';el.style.width='0';el.offsetWidth;el.style.transition='';
    el.__anim=function(){el.style.width=w;};
    io.observe(el);
  });
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',geoAnim);else geoAnim();
</script>`;
}

function renderTimeNav(days: number, view: string, client: string = "virum", inHeader = false): string {
  const presets = [
    { d: 7, label: "7D" },
    { d: 14, label: "14D" },
    { d: 30, label: "30D" },
    { d: 90, label: "90D" },
  ];
  const clientParam = client !== "virum" ? `&client=${encodeURIComponent(client)}` : "";
  const viewParam = view !== "ops" ? `&view=${view}` : "";
  const style = inHeader ? ' style="margin-bottom:0"' : '';
  return `<div class="time-nav"${style}>${presets.map(p =>
    `<a href="?days=${p.d}${clientParam}${viewParam}" class="time-pill${p.d === days ? " active" : ""}">${p.label}</a>`
  ).join("")}</div>`;
}

function renderHeader(config: ClientConfig, _generatedAt: string, days: number, client: string = "virum"): string {
  return `<header class="geo-header">
<div class="geo-logo">
  <div class="geo-logo-brand">
    <span style="font-weight:600;color:var(--tx)">Found</span><span class="geo-logo-dot"></span><span style="color:var(--tx2);font-weight:400">by AI</span>
  </div>
  <span class="geo-sep"></span>
  <div class="geo-domain-wrap">
    <div class="geo-domain">${escHtml(config.domain)}</div>
    <div class="geo-domain-sub">GEO aktiv siden ${escHtml(config.activeSince)}</div>
  </div>
</div>
<div class="geo-header-right">
  <div class="geo-live"><span class="geo-live-dot"><span></span><span></span></span>Live</div>
  ${renderTimeNav(days, "ops", client, true)}
</div>
</header>`;
}

function renderStatCard(value: string, label: string, sub?: string): string {
  return `<div class="card">
<div class="stat-value">${value}</div>
<div class="stat-label">${label}</div>
${sub ? `<div class="stat-sub">${sub}</div>` : ""}
</div>`;
}

function renderInsightCard(
  value: string,
  label: string,
  insight: string,
  _status: "good" | "neutral" | "warn" | "bad" = "neutral"
): string {
  return `<div class="card">
<div class="stat-value">${value}</div>
<div class="stat-label">${label}</div>
<div style="margin-top:8px;font-size:12px;color:var(--tx2);line-height:1.4">${insight}</div>
</div>`;
}

function badgeClass(category: string): string {
  switch (category) {
    case "ai_retrieval": return "badge-green";
    case "seo_crawler": return "badge-blue";
    case "ai_training": return "badge-amber";
    default: return "badge-gray";
  }
}

// ── Block 1: Bot Traffic ──

async function renderBlock1(env: Env, days: number, config: ClientConfig): Promise<string> {
  const ds = env.AE_DATASET;
  const [categoryRows, botRows, aiBotRows, totalRows] = await Promise.all([
    queryAE(env, queryCategoryBreakdown(ds, days)),
    queryAE(env, queryBotDetails(ds, days)),
    queryAE(env, queryDailyAIBots(ds, days)),
    queryAE(env, queryTotalRequests(ds, days)),
  ]);

  const total = totalRows.length > 0 ? Number(totalRows[0].total) || 0 : 0;
  const aiTotal = categoryRows
    .filter((r) => r.category === "ai_retrieval")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);
  const seoTotal = categoryRows
    .filter((r) => r.category === "seo_crawler")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);
  const visitorTotal = categoryRows
    .filter((r) => r.category === "visitor")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);

  // Pie chart data — bots only, visitors excluded (they pass through unchanged)
  const pieData = categoryRows
    .filter((r) => r.category !== "visitor")
    .map((r) => ({
      label: LABELS[r.category as string] ?? String(r.category),
      value: Number(r.visits) || 0,
      color: COLORS[r.category as string] ?? "#6b7280",
    }));

  // Per-bot daily trend (exclude today's partial data)
  const todayStr = new Date().toISOString().slice(0, 10);
  const dayBotMap = new Map<string, Map<string, number>>();
  const allBotNames = new Set<string>();
  for (const r of aiBotRows) {
    const day = String(r.day).slice(0, 10);
    if (day === todayStr) continue;
    const bot = String(r.bot_name);
    allBotNames.add(bot);
    if (!dayBotMap.has(day)) dayBotMap.set(day, new Map());
    const m = dayBotMap.get(day)!;
    m.set(bot, (m.get(bot) || 0) + (Number(r.visits) || 0));
  }
  // Fixed range matching selector — include zero-visit days
  const rangeBase = new Date(); rangeBase.setHours(0, 0, 0, 0);
  const sortedDays: string[] = [];
  for (let i = days; i >= 1; i--) {
    const d = new Date(rangeBase); d.setDate(d.getDate() - i);
    sortedDays.push(d.toISOString().slice(0, 10));
  }
  const botNames = [...allBotNames].sort();
  const xLabels = sortedDays.map((d) => d.slice(5));
  const activationDate = config.activeSince ? new Date(config.activeSince).toISOString().slice(0, 10) : "";
  const activationIdx = activationDate ? sortedDays.indexOf(activationDate) : -1;
  const lineSeries = botNames.map((name) => ({
    label: name,
    color: AI_BOT_COLORS[name] || AI_BOT_DEFAULT_COLOR,
    points: sortedDays.map((d, i) => ({ x: i, y: dayBotMap.get(d)?.get(name) || 0 })),
  }));

  // Bot detail table
  const botTable = botRows.length > 0
    ? `<table>
<thead><tr><th>Bot</th><th>Category</th><th>Visits</th></tr></thead>
<tbody>${botRows
        .map(
          (r) =>
            `<tr><td>${escHtml(String(r.bot_name))}</td><td><span class="badge ${badgeClass(String(r.category))}">${escHtml(LABELS[r.category as string] ?? String(r.category))}</span></td><td>${fmt(Number(r.visits))}</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="empty">No bot visits recorded yet</div>`;

  const dominant = pieData.length ? pieData.reduce((a, b) => a.value > b.value ? a : b) : { label: '', value: 0 };
  return `<div class="section">
<div class="section-hdr"><span class="section-num">01</span><h2>Bot Traffic Overview</h2><span class="section-rule"></span></div>
<div class="grid grid-4" style="margin-bottom:20px">
  ${renderStatCard(fmt(total), "Total Requests", `${fmt(aiTotal)} AI · ${fmt(seoTotal)} SEO · ${fmt(visitorTotal)} visitors`)}
  ${renderStatCard(fmt(aiTotal), "AI Retrieval Bots", "ChatGPT, Perplexity, Claude…")}
  ${renderStatCard(fmt(seoTotal), "SEO Crawlers", "Googlebot, Bingbot…")}
  ${renderStatCard(fmt(visitorTotal), "Visitors Served", "Transparent passthrough — zero friction")}
</div>
<div class="grid grid-2">
  <div class="card">
    <h3>Trafikfordeling</h3>
    <div class="pie-container">
      <div class="pie-chart">${svgDonutChart(pieData, 'geo-dn-traffic')}</div>
      <div class="pie-legend">
        ${pieData.map((d, i) => `<div class="legend-item" data-lb="geo-dn-traffic" data-idx="${i}" onmouseenter="geoDonut('geo-dn-traffic','${d.value}','${d.label.toUpperCase()}',${i})" onmouseleave="geoDonut('geo-dn-traffic','${dominant.value}','${dominant.label.toUpperCase()}',-1)"><div class="legend-dot" style="background:${d.color}"></div><span class="legend-lbl">${escHtml(d.label)}</span><span class="legend-val">${fmt(d.value)}</span></div>`).join("")}
        <div style="font-size:11px;color:var(--tx3);margin-top:4px;line-height:1.5">+ ${fmt(visitorTotal)} besøgende serveret transparent via samme proxy.</div>
      </div>
    </div>
  </div>
  <div class="card" style="display:flex;flex-direction:column">
    <h3>Bot-detaljer</h3>
    <div style="overflow-y:auto;max-height:270px;flex:1">${botTable}</div>
  </div>
</div>
<div class="card" style="margin-top:20px">
  <h3>AI Bot Visits Per Day</h3>
  <div style="font-size:12px;color:#64748b;margin-bottom:8px">Completed days only · today excluded · refreshes every ~5 min · Analytics Engine data has ~10 min lag</div>
  ${lineSeries.length > 0 ? svgLineChart(lineSeries, xLabels, 800, 240, activationIdx, true) : '<div class="empty">No trend data yet — data appears after DNS switch</div>'}
</div>
<div class="data-source">Data source: Cloudflare Analytics Engine (third-party) · Each data point = one verified HTTP request · <a href="/api/export/ai-bot-visits.csv?days=${days}">Export CSV</a></div>
</div>`;
}

// ── Block 2: GEO Injection Stats ──

async function renderBlock2(env: Env, days: number): Promise<string> {
  const ds = env.AE_DATASET;
  const [statusRows, topPages] = await Promise.all([
    queryAE(env, queryGeoStatus(ds, days)),
    queryAE(env, queryTopGeoPages(ds, days)),
  ]);

  const statusMap: Record<string, number> = {};
  let totalHtml = 0;
  for (const r of statusRows) {
    const st = String(r.status);
    const ct = Number(r.count) || 0;
    statusMap[st] = ct;
    totalHtml += ct;
  }

  const injected = statusMap["injected"] || 0;
  const passthrough = statusMap["passthrough"] || 0;
  const nonHtml = statusMap["passthrough_nonhtml"] || 0;
  const skipped = statusMap["skipped_non2xx"] || 0;
  const rate = totalHtml > 0 ? ((injected / (injected + passthrough)) * 100).toFixed(1) : "—";

  const statusItems = [
    { label: "GEO Injected", value: injected, color: "#86AD94" },
    { label: "Passthrough (no match)", value: passthrough, color: "#454C57" },
    { label: "Non-HTML (assets)", value: nonHtml, color: "#454C57" },
    { label: "Skipped (non-2xx)", value: skipped, color: "#CB7E70" },
  ];

  const topPagesTable = topPages.length > 0
    ? `<table>
<thead><tr><th>Page</th><th>Type</th><th>Bot</th><th>Visits</th></tr></thead>
<tbody>${topPages
        .map(
          (r) =>
            `<tr><td>${escHtml(String(r.page))}</td><td><span class="badge badge-blue">${escHtml(String(r.page_type))}</span></td><td>${escHtml(String(r.bot))}</td><td>${fmt(Number(r.visits))}</td></tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="empty">No AI bot visits to GEO-injected pages yet</div>`;

  return `<div class="section">
<div class="section-hdr"><span class="section-num">02</span><h2>GEO Injection Stats</h2><span class="section-rule"></span></div>
<div class="grid grid-4" style="margin-bottom:20px">
  <div class="card"><div class="stat-value" style="color:var(--bright)">${rate}%</div><div class="stat-label">Injection Rate</div><div class="stat-sub">HTML pages with GEO schema</div></div>
  ${renderStatCard(fmt(injected), "Pages Injected", "Schema added on-the-fly")}
  ${renderStatCard(fmt(passthrough), "Passthrough", "No matching GEO data")}
  ${renderStatCard(fmt(skipped), "Skipped", "Non-2xx responses")}
</div>
<div class="grid grid-2">
  <div class="card">
    <h3>Request Status Breakdown</h3>
    ${statusItems
      .map((s) => {
        const pct = totalHtml > 0 ? (s.value / totalHtml) * 100 : 0;
        return `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--line2);font-size:13px">
          <span style="flex:1;color:var(--tx2)">${s.label}</span>
          <div style="width:160px;height:4px;background:var(--line2);overflow:hidden;flex-shrink:0"><div class="geo-bar" style="height:100%;width:${pct.toFixed(0)}%;background:${s.color}"></div></div>
          <span style="font-family:'Geist Mono',monospace;font-size:12px;min-width:36px;text-align:right;color:var(--tx)">${fmt(s.value)}</span>
        </div>`;
      })
      .join("")}
  </div>
  <div class="card" style="display:flex;flex-direction:column">
    <h3>Top GEO Pages (AI Bot Visits)</h3>
    <div style="overflow-y:auto;max-height:270px;flex:1">${topPagesTable}</div>
  </div>
</div>
</div>`;
}

// ── Block 3: AI Search Visibility (OtterlyAI) ──

function deltaHtml(curr: number, prev: number): string {
  const d = curr - prev;
  if (d === 0) return "";
  const color = d > 0 ? "#10b981" : "#ef4444";
  return ` <span style="font-size:14px;color:${color}">${d > 0 ? "↑" : "↓"}${Math.abs(d)}</span>`;
}

async function renderBlock3(env: Env, client: string): Promise<string> {
  const [promptsRaw, citationsRaw, promptsPrevRaw, citationsPrevRaw] = await Promise.all([
    env.DASHBOARD_KV.get(`otterly_prompts:${client}`, "text"),
    env.DASHBOARD_KV.get(`otterly_citations:${client}`, "text"),
    env.DASHBOARD_KV.get(`otterly_prompts:${client}:prev`, "text"),
    env.DASHBOARD_KV.get(`otterly_citations:${client}:prev`, "text"),
  ]);

  if (!promptsRaw && !citationsRaw) {
    return `<div class="section">
<div class="section-hdr"><span class="section-num">03</span><h2>AI Search Visibility</h2><span class="section-rule"></span></div>
<div class="card">
  <div class="empty">
    <p style="font-size:16px;margin-bottom:8px">OtterlyAI data not yet imported</p>
    <p style="font-size:13px;color:#64748b">POST /api/otterly/:client/prompts — upload prompts CSV</p>
    <p style="font-size:13px;color:#64748b">POST /api/otterly/:client/citations?domain=example.com — upload citations CSV</p>
  </div>
</div>
</div>`;
  }

  type PromptsStored = OtterlyData["prompts"] & { updatedAt?: string };
  type CitationsStored = OtterlyData["citations"] & { updatedAt?: string };

  let prompts: PromptsStored | null = null;
  let citations: CitationsStored | null = null;
  let promptsPrev: PromptsStored | null = null;
  let citationsPrev: CitationsStored | null = null;
  if (promptsRaw) try { prompts = JSON.parse(promptsRaw); } catch { /* invalid */ }
  if (citationsRaw) try { citations = JSON.parse(citationsRaw); } catch { /* invalid */ }
  if (promptsPrevRaw) try { promptsPrev = JSON.parse(promptsPrevRaw); } catch { /* invalid */ }
  if (citationsPrevRaw) try { citationsPrev = JSON.parse(citationsPrevRaw); } catch { /* invalid */ }

  const updatedAt = prompts?.updatedAt || citations?.updatedAt || "";
  const prevDate = promptsPrev?.updatedAt || citationsPrev?.updatedAt || "";

  // ── Stat cards with interpretation ──
  let statsHtml = `<div class="grid grid-4" style="margin-bottom:20px">`;
  if (prompts) {
    const brandPct = prompts.total > 0 ? (prompts.brandMentioned / prompts.total) * 100 : 0;
    const brandStatus: "good" | "neutral" | "warn" | "bad" = brandPct >= 30 ? "good" : brandPct >= 10 ? "neutral" : "warn";
    const brandInsight = `In ${prompts.total} AI searches for your industry, your brand was mentioned ${prompts.brandMentioned} time${prompts.brandMentioned !== 1 ? "s" : ""} (${brandPct.toFixed(0)}%)`;
    const brandDelta = promptsPrev ? deltaHtml(prompts.brandMentioned, promptsPrev.brandMentioned) : "";
    statsHtml += renderInsightCard(`${prompts.brandMentioned}/${prompts.total}${brandDelta}`, "Brand Mentioned", brandInsight, brandStatus);

    const domainPct = prompts.total > 0 ? (prompts.domainCited / prompts.total) * 100 : 0;
    const domainStatus: "good" | "neutral" | "warn" | "bad" = domainPct >= 30 ? "good" : domainPct >= 10 ? "neutral" : "warn";
    const domainInsight = `Your website was cited as a source in ${domainPct.toFixed(0)}% of relevant AI queries`;
    const domainDelta = promptsPrev ? deltaHtml(prompts.domainCited, promptsPrev.domainCited) : "";
    statsHtml += renderInsightCard(`${prompts.domainCited}/${prompts.total}${domainDelta}`, "Domain Cited", domainInsight, domainStatus);
  }
  if (citations) {
    const share = citations.total > 0 ? ((citations.myDomainCitations / citations.total) * 100) : 0;
    const shareStr = share.toFixed(1);
    const citInsight = `${citations.total} total citations across all AI engines in your market`;
    const totalDelta = citationsPrev ? deltaHtml(citations.total, citationsPrev.total) : "";
    statsHtml += renderInsightCard(`${fmt(citations.total)}${totalDelta}`, "Total Citations", citInsight, "neutral");

    const myStatus: "good" | "neutral" | "warn" | "bad" = share >= 5 ? "good" : share >= 1 ? "neutral" : "warn";
    const myInsight = `${shareStr}% of all AI citations point to your site — ${share >= 5 ? "strong presence" : share >= 1 ? "growing, room to improve" : "early stage, GEO is building momentum"}`;
    const myDelta = citationsPrev ? deltaHtml(citations.myDomainCitations, citationsPrev.myDomainCitations) : "";
    statsHtml += renderInsightCard(`${fmt(citations.myDomainCitations)}${myDelta}`, "My Citations", myInsight, myStatus);
  }
  statsHtml += `</div>`;

  // ── Competitors table ──
  let competitorsHtml = `<div class="empty">No prompts data</div>`;
  if (prompts && prompts.competitors.length > 0) {
    const myMentioned = prompts.brandMentioned ?? 0;
    const myCited = citations?.myDomainCitations ?? 0;
    const prevMentioned = promptsPrev?.brandMentioned ?? 0;
    const mentionDelta = myMentioned - prevMentioned;
    const deltaHtml2 = mentionDelta > 0
      ? ` <span style="font-family:'Geist Mono',monospace;font-size:10px;color:var(--bright)">+${mentionDelta}</span>`
      : mentionDelta < 0 ? ` <span style="font-family:'Geist Mono',monospace;font-size:10px;color:var(--danger)">${mentionDelta}</span>` : '';
    const selfRow = `<tr style="border-top:2px solid var(--line2)">
      <td style="color:var(--tx3)">—</td>
      <td style="color:var(--bright);font-weight:500">${escHtml(client)} <span style="font-family:'Geist Mono',monospace;font-size:10px;border:1px solid var(--accent);color:var(--accent);padding:1px 5px;margin-left:4px">dig</span></td>
      <td>${myMentioned}${deltaHtml2}</td>
      <td>${myCited}</td>
    </tr>`;
    competitorsHtml = `<div style="font-size:11px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-bottom:12px">Importeret data · ikke tidsfilteret</div><table>
<thead><tr><th>#</th><th>Competitor</th><th>Mentioned</th><th>Cited</th></tr></thead>
<tbody>${prompts.competitors.map((c, i) => `<tr><td>${i + 1}</td><td>${escHtml(c.name)}</td><td>${c.mentioned}</td><td>${c.cited}</td></tr>`).join("")}${selfRow}</tbody></table>`;
  }

  // ── AI Engine coverage ──
  let enginesHtml = `<div class="empty">No citations data</div>`;
  if (citations && citations.engines.length > 0) {
    enginesHtml = citations.engines
      .map((e) => {
        return `<div class="status-row">
          <span style="text-transform:capitalize">${escHtml(e.name)}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span style="min-width:50px;text-align:right">${e.citations}</span>
            <span>${e.myDomainCited > 0 ? `<span class="badge badge-green">${e.myDomainCited} mine</span>` : `<span class="badge badge-gray">0 mine</span>`}</span>
          </span>
        </div>`;
      })
      .join("");
  }

  // ── My domain citations table ──
  const fmtDato = (d: string) => {
    const parts = d.split('-');
    const mo = parseInt(parts[1] ?? '0');
    const dy = parseInt(parts[2] ?? '0');
    const months = ['','jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
    return `${dy}. ${months[mo] ?? ''}`;
  };

  let myUrlsBody = `<div class="empty">No domain citations found</div>`;
  if (citations && citations.myUrls.length > 0) {
    myUrlsBody = `<table>
<thead><tr><th>Motor</th><th>Pos</th><th>Prompt</th><th>Dato</th></tr></thead>
<tbody>${citations.myUrls.map(u =>
  `<tr>
    <td style="font-weight:500;text-transform:capitalize">${escHtml(u.engine)}</td>
    <td style="font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx3)">#${u.position}</td>
    <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--tx2)">${escHtml(u.prompt)}</td>
    <td style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx3);white-space:nowrap">${escHtml(fmtDato(u.date))}</td>
  </tr>`).join('')}</tbody></table>`;
  }

  let topDomainsBody = `<div class="empty">No domain data</div>`;
  if (citations && citations.topDomains.length > 0) {
    const maxCit = citations.topDomains[0].citations;
    topDomainsBody = citations.topDomains.slice(0, 10).map(d => {
      const pct = maxCit > 0 ? (d.citations / maxCit) * 100 : 0;
      const isMine = d.domain.includes("virumakupunktur");
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13px">
        <span style="flex:1;${isMine ? 'color:var(--bright);font-weight:500' : 'color:var(--tx2)'}">${escHtml(d.domain)}</span>
        <div style="width:140px;height:4px;background:var(--line2);overflow:hidden;flex-shrink:0"><div class="geo-bar" style="height:100%;width:${pct.toFixed(0)}%;background:${isMine ? 'var(--bright)' : 'var(--neutral)'}"></div></div>
        <span style="font-family:'Geist Mono',monospace;font-size:12px;min-width:28px;text-align:right;color:var(--tx2)">${d.citations}</span>
      </div>`;
    }).join('');
  }

  return `<div class="section">
<div class="section-hdr"><span class="section-num">03</span><h2>AI Search Visibility</h2><span class="badge badge-amber">OtterlyAI</span><span class="section-rule"></span></div>
<div class="timestamp" style="margin-bottom:16px">Last updated: ${escHtml(updatedAt)}${prevDate ? ` · vs ${escHtml(prevDate)}` : ""}</div>
${statsHtml}
<div class="grid grid-2">
  <div class="card">
    <h3>Competitor Ranking</h3>
    ${competitorsHtml}
  </div>
  <div class="card">
    <h3>AI Engine Coverage</h3>
    ${enginesHtml}
  </div>
</div>
<div class="grid grid-2" style="margin-top:20px">
  <div class="card" style="display:flex;flex-direction:column">
    <h3>Mine domæne-citationer</h3>
    <div style="overflow-y:auto;max-height:300px;flex:1;padding-right:14px">${myUrlsBody}</div>
  </div>
  <div class="card" style="display:flex;flex-direction:column">
    <h3>Mest citerede domæner</h3>
    <div style="overflow-y:auto;max-height:300px;flex:1;padding-right:14px">${topDomainsBody}</div>
  </div>
</div>
</div>`;
}

// ── Block 4: Baseline Comparison ──

async function renderBlock4(env: Env, client: string = "virum"): Promise<string> {
  const raw = await env.DASHBOARD_KV.get(`baseline:${client}`, "text");

  const defaultBaseline: BaselineData = {
    capturedAt: "Pre-GEO (baseline)",
    schemaPages: 0,
    metaDescPages: 0,
    robotsTxt: "No AI bot policy",
    sitemapUrls: 0,
    canonicalCoverage: "Incomplete",
    otterlyScore: null,
  };

  const current = {
    schemaPages: 38,
    metaDescPages: 38,
    robotsTxt: "AI retrieval: allowed / AI training: blocked",
    sitemapUrls: 38,
    canonicalCoverage: "100%",
  };

  let baseline = defaultBaseline;
  if (raw) {
    try {
      baseline = JSON.parse(raw) as BaselineData;
    } catch { /* use default */ }
  }

  const comparisons = [
    {
      metric: "Schema Markup (JSON-LD)",
      before: `${baseline.schemaPages} pages`,
      after: `${current.schemaPages} pages`,
      change: current.schemaPages - baseline.schemaPages,
    },
    {
      metric: "Meta Descriptions",
      before: `${baseline.metaDescPages} pages`,
      after: `${current.metaDescPages} pages`,
      change: current.metaDescPages - baseline.metaDescPages,
    },
    {
      metric: "robots.txt AI Policy",
      before: baseline.robotsTxt,
      after: current.robotsTxt,
      change: 1,
    },
    {
      metric: "Sitemap URLs",
      before: `${baseline.sitemapUrls}`,
      after: `${current.sitemapUrls}`,
      change: current.sitemapUrls - baseline.sitemapUrls,
    },
    {
      metric: "Canonical URLs",
      before: baseline.canonicalCoverage,
      after: current.canonicalCoverage,
      change: 1,
    },
  ];

  return `<div class="section">
<div class="section-hdr"><span class="section-num">04</span><h2>Baseline Comparison</h2><span class="section-rule"></span></div>
<div class="timestamp" style="margin-bottom:16px">Baseline captured: ${escHtml(baseline.capturedAt)}</div>
<div class="card">
  <table>
    <thead><tr><th>Metric</th><th>Before GEO</th><th>After GEO</th><th>Change</th></tr></thead>
    <tbody>
      ${comparisons
        .map(
          (c) =>
            `<tr>
              <td style="font-weight:500">${escHtml(c.metric)}</td>
              <td style="color:#94a3b8">${escHtml(c.before)}</td>
              <td style="color:#f8fafc">${escHtml(c.after)}</td>
              <td>${c.change > 0 ? `<span class="change-up">+${c.change === 1 && !String(c.before).match(/^\d/) ? "✓" : c.change}</span>` : c.change === 0 ? `<span class="change-neutral">—</span>` : `<span class="change-down">${c.change}</span>`}</td>
            </tr>`
        )
        .join("")}
    </tbody>
  </table>
</div>
</div>`;
}

// ── Block 5: GEO Coverage Gaps ──

async function renderBlock5(env: Env, days: number): Promise<string> {
  const rows = await queryAE(env, queryCoverageGaps(env.AE_DATASET, days));

  const gapTable = rows.length > 0
    ? `<table>
<thead><tr><th>Page</th><th>Bot Visits</th><th>Action</th></tr></thead>
<tbody>${rows
        .map((r) => {
          const page = String(r.page);
          const visits = Number(r.visits) || 0;
          return `<tr>
            <td style="font-family:monospace;font-size:13px">${escHtml(page)}</td>
            <td>${fmt(visits)}</td>
            <td><span class="badge badge-amber">Add GEO data</span></td>
          </tr>`;
        })
        .join("")}</tbody></table>`
    : `<div class="empty">No coverage gaps — all bot-visited pages have GEO data 🎉</div>`;

  const totalGaps = rows.length;
  const totalMissedVisits = rows.reduce((s, r) => s + (Number(r.visits) || 0), 0);

  return `<div class="section">
<div class="section-hdr"><span class="section-num">05</span><h2>GEO Coverage Gaps</h2><span class="badge badge-red">Action needed</span><span class="section-rule"></span></div>
<div class="subtitle" style="margin-bottom:16px">Pages bots visit that receive no GEO schema — each row is a GEO improvement ticket</div>
<div class="grid grid-2" style="margin-bottom:20px">
  ${renderStatCard(String(totalGaps), "Uncovered Pages", "Bot-visited with no GEO data")}
  ${renderStatCard(fmt(totalMissedVisits), "Missed Bot Visits", `Last ${days} days without schema`)}
</div>
<div class="card">
  <h3>Top Pages to Add GEO Data (ranked by bot visits)</h3>
  ${gapTable}
</div>
</div>`;
}

// ── Client View: Layer 1 — Funnel (AI traffic reaching your business) ──

const AI_BOT_COLORS: Record<string, string> = {
  "ChatGPT-User": "#86AD94",
  "PerplexityBot": "#6E8CA8",
  "ClaudeBot": "#BE9A5E",
  "OAI-SearchBot": "#9B86AD",
  "GPTBot": "#CB7E70",
};
const AI_BOT_DEFAULT_COLOR = "#5C636E";

async function renderClientFunnel(env: Env, days: number, config: ClientConfig): Promise<string> {
  const ds = env.AE_DATASET;
  const [categoryRows, aiBotRows, totalRows] = await Promise.all([
    queryAE(env, queryCategoryBreakdown(ds, days)),
    queryAE(env, queryDailyAIBots(ds, days)),
    queryAE(env, queryTotalRequests(ds, days)),
  ]);

  const total = totalRows.length > 0 ? Number(totalRows[0].total) || 0 : 0;
  const aiTotal = categoryRows
    .filter((r) => r.category === "ai_retrieval")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);

  // Build per-bot daily data (exclude today)
  const todayStr = new Date().toISOString().slice(0, 10);
  const dayBotMap = new Map<string, Map<string, number>>();
  const allBotNames = new Set<string>();
  for (const r of aiBotRows) {
    const day = String(r.day).slice(0, 10);
    if (day === todayStr) continue;
    const bot = String(r.bot_name);
    allBotNames.add(bot);
    if (!dayBotMap.has(day)) dayBotMap.set(day, new Map());
    const m = dayBotMap.get(day)!;
    m.set(bot, (m.get(bot) || 0) + (Number(r.visits) || 0));
  }
  const sortedDays = [...dayBotMap.keys()].sort();
  const botNames = [...allBotNames].sort();

  // Find activation date index
  const activationDate = config.activeSince ? new Date(config.activeSince).toISOString().slice(0, 10) : "";
  const activationIdx = activationDate ? sortedDays.indexOf(activationDate) : -1;

  const chartDays = sortedDays.map((d) => ({
    label: d.slice(5),
    bots: botNames.map((name) => ({
      name,
      color: AI_BOT_COLORS[name] || AI_BOT_DEFAULT_COLOR,
      value: dayBotMap.get(d)?.get(name) || 0,
    })),
  }));
  const xLabels = sortedDays.map((d) => d.slice(5));
  const lineSeries = botNames.map((name) => ({
    label: name,
    color: AI_BOT_COLORS[name] || AI_BOT_DEFAULT_COLOR,
    points: sortedDays.map((d, i) => ({ x: i, y: dayBotMap.get(d)?.get(name) || 0 })),
  }));

  // Per-bot totals for stat cards
  const botTotals = new Map<string, number>();
  for (const [, bots] of dayBotMap) {
    for (const [name, v] of bots) botTotals.set(name, (botTotals.get(name) || 0) + v);
  }
  const topBots = [...botTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);

  const aiInsight = aiTotal > 0
    ? `In the last ${days} days, AI search engines visited your site ${aiTotal} times to gather information about your business. Each visit means an AI assistant is reading your content to answer real user questions.`
    : "AI search engines haven't visited yet — your GEO layer is active and ready.";

  return `<div class="section">
<div class="layer-label">Layer 1 — AI Traffic Funnel</div>
<div class="insight-banner">
  <h3>Your Business in AI Search</h3>
  <p>${aiInsight}</p>
</div>
<div class="grid grid-${Math.min(topBots.length, 4)}" style="margin-bottom:20px">
  ${topBots.map(([name, visits]) =>
    renderInsightCard(String(visits), name, `Visits from ${name} reading your content`)
  ).join("")}
</div>
<div class="card">
  <h3>AI Bot Visits Per Day</h3>
  <div style="font-size:12px;color:#64748b;margin-bottom:8px">Completed days only · updates daily at 02:00 CET · refreshes every ~5 min</div>
  ${lineSeries.length > 0 ? svgLineChart(lineSeries, xLabels, 800, 240, activationIdx, true) : '<div class="empty">Data will appear once AI bots start visiting</div>'}
</div>
<div class="data-source">Data source: Cloudflare Analytics Engine (third-party infrastructure) · Each data point = one verified HTTP request</div>
</div>`;
}

// ── Client View: Layer 2 — Results (AI search visibility) ──

async function renderClientResults(env: Env, client: string): Promise<string> {
  const [promptsRaw, citationsRaw] = await Promise.all([
    env.DASHBOARD_KV.get(`otterly_prompts:${client}`, "text"),
    env.DASHBOARD_KV.get(`otterly_citations:${client}`, "text"),
  ]);

  if (!promptsRaw && !citationsRaw) {
    return `<div class="section">
<div class="layer-label">Layer 2 — AI Search Results</div>
<div class="card">
  <div class="empty">
    <p style="font-size:16px;margin-bottom:8px">AI search visibility data coming soon</p>
    <p style="font-size:13px;color:#64748b">We measure how often AI assistants recommend your business — first report available shortly.</p>
  </div>
</div>
</div>`;
  }

  type PromptsStored = OtterlyData["prompts"] & { updatedAt?: string };
  type CitationsStored = OtterlyData["citations"] & { updatedAt?: string };

  let prompts: PromptsStored | null = null;
  let citations: CitationsStored | null = null;
  if (promptsRaw) try { prompts = JSON.parse(promptsRaw); } catch { /* invalid */ }
  if (citationsRaw) try { citations = JSON.parse(citationsRaw); } catch { /* invalid */ }

  const updatedAt = prompts?.updatedAt || citations?.updatedAt || "";

  // Per-engine breakdown instead of GEO Score
  let enginesBreakdownHtml = "";
  if (citations && citations.engines.length > 0) {
    const topEngines = citations.engines.slice(0, 4);
    enginesBreakdownHtml = `<div class="grid grid-${Math.min(topEngines.length, 4)}" style="margin-bottom:20px">
    ${topEngines.map((e) =>
      renderInsightCard(
        String(e.myDomainCited),
        e.name,
        `${e.citations} total citations in ${e.name} · ${e.myDomainCited > 0 ? `your site cited ${e.myDomainCited} time${e.myDomainCited > 1 ? "s" : ""}` : "not yet cited"}`
      )
    ).join("")}
    </div>`;
  }

  // Stat cards
  let statsHtml = `<div class="grid grid-2" style="margin-bottom:20px">`;
  if (prompts) {
    statsHtml += renderInsightCard(
      `${prompts.brandMentioned}/${prompts.total}`,
      "Brand Mentioned",
      `When people ask AI about your industry, your brand name appeared in ${prompts.brandMentioned} out of ${prompts.total} answers`
    );

    const domainPct = prompts.total > 0 ? (prompts.domainCited / prompts.total) * 100 : 0;
    statsHtml += renderInsightCard(
      `${prompts.domainCited}/${prompts.total}`,
      "Website Linked",
      `AI assistants linked directly to your website in ${domainPct.toFixed(0)}% of relevant conversations`
    );
  }
  statsHtml += `</div>`;

  // Competitors
  let competitorsHtml = "";
  if (prompts && prompts.competitors.length > 0) {
    const topN = prompts.competitors.slice(0, 5);
    const maxMentions = Math.max(...topN.map(c => c.mentioned + c.cited), 1);
    competitorsHtml = `<div class="card" style="margin-top:20px">
  <h3>How You Compare to Competitors</h3>
  <div style="font-size:12px;color:var(--tx3);margin-bottom:12px">AI visibility ranking in your market</div>
  <div class="status-row" style="border-bottom:2px solid var(--line2)">
    <span style="color:var(--bright);font-weight:600">Your Business</span>
    <span style="display:flex;align-items:center;gap:8px">
      <span style="width:160px"><div class="bar"><div class="bar-fill" style="width:${prompts ? ((prompts.brandMentioned + prompts.domainCited) / maxMentions) * 100 : 0}%;background:var(--bright)"></div></div></span>
      <span style="min-width:80px;text-align:right;color:var(--bright)">${prompts ? prompts.brandMentioned + prompts.domainCited : 0} mentions</span>
    </span>
  </div>
  ${topN.map((c) => {
    const total = c.mentioned + c.cited;
    const pct = (total / maxMentions) * 100;
    return `<div class="status-row">
      <span>${escHtml(c.name)}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span style="width:160px"><div class="bar"><div class="bar-fill geo-bar" style="width:${pct}%;background:var(--blue)"></div></div></span>
        <span style="min-width:80px;text-align:right;color:var(--tx2)">${total} mentions</span>
      </span>
    </div>`;
  }).join("")}
</div>`;
  }

  return `<div class="section">
<div class="layer-label">Layer 2 — AI Search Results</div>
<div class="insight-banner">
  <h3>AI Search Visibility</h3>
  <p>We track how often AI assistants (ChatGPT, Perplexity, Claude, etc.) mention and recommend your business when people search for services you offer.</p>
</div>
${enginesBreakdownHtml}
${statsHtml}
${competitorsHtml}
<div class="timestamp" style="margin-top:16px">Last measured: ${escHtml(updatedAt)}</div>
</div>`;
}

// ── Client View Header ──

function renderClientHeader(config: ClientConfig, _generatedAt: string, days: number, client: string = "virum"): string {
  return `<header class="geo-header">
<div class="geo-logo">
  <div class="geo-logo-brand">
    <span style="font-weight:600;color:var(--tx)">Found</span><span class="geo-logo-dot"></span><span style="color:var(--tx2);font-weight:400">by AI</span>
  </div>
  <span class="geo-sep"></span>
  <div class="geo-domain-wrap">
    <div class="geo-domain">${escHtml(config.domain)}</div>
    <div class="geo-domain-sub">GEO aktiv siden ${escHtml(config.activeSince)}</div>
  </div>
</div>
<div class="geo-header-right">
  <div class="geo-live"><span class="geo-live-dot"><span></span><span></span></span>Live</div>
  ${renderTimeNav(days, "client", client, true)}
</div>
</header>`;
}

// ── Utilities ──

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmt(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(Math.round(n));
}

// ── Auth ──

type AuthIdentity = { type: 'ops' } | { type: 'client'; clientId: string };

async function checkAuth(request: Request, env: Env): Promise<Response | AuthIdentity> {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "ops";
  const client = url.searchParams.get("client") || "virum";
  const urlToken = url.searchParams.get("token");
  const opsToken = env.DASHBOARD_TOKEN;

  // Validate client param to prevent cookie name / KV key injection
  if (!/^[a-z0-9-]+$/.test(client)) {
    return new Response("Invalid client", { status: 400 });
  }

  // Ops token: Bearer header or ops cookie → full access
  const cookieOps = getCookie(request, "dashboard_token");
  if (opsToken && (request.headers.get("Authorization") === `Bearer ${opsToken}` || cookieOps === opsToken)) {
    return { type: 'ops' };
  }

  // Ops token in URL → set cookie and redirect
  if (opsToken && urlToken === opsToken) {
    const cleanUrl = new URL(request.url);
    cleanUrl.searchParams.delete("token");
    return new Response(null, {
      status: 302,
      headers: {
        Location: cleanUrl.pathname + cleanUrl.search,
        "Set-Cookie": `dashboard_token=${opsToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      },
    });
  }

  // Client view: check per-client token (magic link)
  if (view === "client") {
    const clientToken = await env.DASHBOARD_KV.get(`client_token:${client}`, "text");
    if (clientToken) {
      const cookieClient = getCookie(request, `client_token_${client}`);
      if (cookieClient === clientToken) return { type: 'client', clientId: client };

      if (urlToken === clientToken) {
        const cleanUrl = new URL(request.url);
        cleanUrl.searchParams.delete("token");
        return new Response(null, {
          status: 302,
          headers: {
            Location: cleanUrl.pathname + cleanUrl.search,
            "Set-Cookie": `client_token_${client}=${clientToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
          },
        });
      }
    }
    return new Response(renderClientLoginPage(), {
      status: 401,
      headers: { "Content-Type": "text/html;charset=utf-8" },
    });
  }

  return new Response(renderLoginPage(), {
    status: 401,
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
}

function renderClientLoginPage(): string {
  return `<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Found by AI</title>
${renderStyles()}
</head><body>
<div class="container" style="max-width:400px;margin-top:15vh">
<div class="card" style="text-align:center">
<h2 style="border:none;margin-bottom:16px">Found by AI</h2>
<p style="color:#94a3b8;margin-bottom:8px">Dit adgangslink er udløbet eller ugyldigt.</p>
<p style="font-size:13px;color:#64748b">Kontakt os på <a href="mailto:hello@foundbyai.dk" style="color:#3b82f6">hello@foundbyai.dk</a> for et nyt link.</p>
</div>
</div></body></html>`;
}

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("Cookie") || "";
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : null;
}

function renderLoginPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GEO Dashboard — Login</title>
${renderStyles()}
</head><body>
<div class="container" style="max-width:400px;margin-top:15vh">
<div class="card" style="text-align:center">
<h2 style="border:none;margin-bottom:24px">GEO Dashboard</h2>
<p style="color:#94a3b8;margin-bottom:24px">Enter your access token</p>
<form method="GET" action="/">
<input type="password" name="token" placeholder="Access token" style="width:100%;padding:10px 14px;background:#0f172a;border:1px solid #475569;border-radius:8px;color:#f8fafc;font-size:14px;margin-bottom:16px">
<button type="submit" style="width:100%;padding:10px;background:#3b82f6;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">View Dashboard</button>
</form>
</div>
</div></body></html>`;
}

// ── OtterlyAI CSV Parsers ──

function parsePromptsCsv(csv: string): OtterlyData["prompts"] {
  const lines = csv.trim().split("\n");
  const headers = csvSplitRow(lines[0]);

  const promptIdx = headers.indexOf("Prompt");
  const totalCitIdx = headers.indexOf("Total citations");
  const brandMentIdx = headers.indexOf("Your brand mentioned");
  const brandRankIdx = headers.indexOf("All Engines your brand rank");
  const domainCitIdx = headers.indexOf("Your domain cited");

  // Detect competitor columns: pairs of "[Name] mentioned" / "[Name] cited"
  const competitorCols: { name: string; mentionedIdx: number; citedIdx: number }[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    if (h.endsWith(" mentioned") && h !== "Your brand mentioned") {
      const name = h.replace(" mentioned", "");
      const citedIdx = headers.indexOf(`${name} cited`);
      if (citedIdx >= 0) competitorCols.push({ name, mentionedIdx: i, citedIdx });
    }
  }
  const competitorMap = new Map<string, { mentioned: number; cited: number }>();
  for (const c of competitorCols) competitorMap.set(c.name, { mentioned: 0, cited: 0 });

  const items: OtterlyData["prompts"]["items"] = [];
  let brandMentioned = 0;
  let domainCited = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = csvSplitRow(lines[i]);

    const prompt = cols[promptIdx] || "";
    const brandRankVal = cols[brandRankIdx] || "-";
    const domainCitVal = cols[domainCitIdx] || "-";
    const totalCit = parseInt(cols[totalCitIdx] || "0") || 0;
    const brandMentVal = cols[brandMentIdx] || "-";

    if (brandMentVal !== "-" && brandMentVal !== "0") brandMentioned++;
    if (domainCitVal !== "-" && domainCitVal !== "0") domainCited++;

    items.push({ prompt, brandRank: brandRankVal, domainCited: domainCitVal, totalCitations: totalCit });

    for (const comp of competitorCols) {
      const mVal = parseInt(cols[comp.mentionedIdx] || "0") || 0;
      const cVal = parseInt(cols[comp.citedIdx] || "0") || 0;
      const existing = competitorMap.get(comp.name)!;
      existing.mentioned += mVal;
      existing.cited += cVal;
    }
  }

  const competitors = [...competitorMap.entries()]
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => (b.mentioned + b.cited) - (a.mentioned + a.cited));

  return { total: items.length, brandMentioned, domainCited, items, competitors };
}

function parseCitationsCsv(csv: string, myDomain: string): OtterlyData["citations"] {
  const lines = csv.trim().split("\n");
  const headers = csvSplitRow(lines[0]);

  const promptIdx = headers.indexOf("Prompt");
  const serviceIdx = headers.indexOf("Service");
  const urlIdx = headers.indexOf("Url");
  const posIdx = headers.indexOf("Position");
  const dateIdx = headers.indexOf("Date");
  const domainIdx = headers.indexOf("Domain");

  const myDomainLower = myDomain.toLowerCase();
  const engineMap = new Map<string, { citations: number; myDomainCited: number }>();
  const domainMap = new Map<string, number>();
  const myUrls: OtterlyData["citations"]["myUrls"] = [];
  let total = 0;
  let myDomainCitations = 0;

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cols = csvSplitRow(lines[i]);
    total++;

    const engine = cols[serviceIdx] || "";
    const domain = (cols[domainIdx] || "").toLowerCase();
    const url = cols[urlIdx] || "";
    const prompt = cols[promptIdx] || "";
    const position = parseInt(cols[posIdx] || "0") || 0;
    const date = cols[dateIdx] || "";

    const eng = engineMap.get(engine) || { citations: 0, myDomainCited: 0 };
    eng.citations++;
    if (domain === myDomainLower) {
      eng.myDomainCited++;
      myDomainCitations++;
      myUrls.push({ url, engine, prompt, position, date });
    }
    engineMap.set(engine, eng);

    domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
  }

  const engines = [...engineMap.entries()]
    .map(([name, d]) => ({ name, ...d }))
    .sort((a, b) => b.citations - a.citations);

  const topDomains = [...domainMap.entries()]
    .map(([domain, citations]) => ({ domain, citations }))
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 15);

  return { total, myDomainCitations, engines, myUrls, topDomains };
}

// ── OtterlyAI Upload Handlers ──

async function handleOtterlyPromptsUpload(request: Request, env: Env, client: string): Promise<Response> {
  const body = await request.text();
  if (!body.trim()) {
    return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const existing = await env.DASHBOARD_KV.get(`otterly_prompts:${client}`, "text");
  if (existing) await env.DASHBOARD_KV.put(`otterly_prompts:${client}:prev`, existing);
  const parsed = parsePromptsCsv(body);
  const stored = { updatedAt: new Date().toISOString().slice(0, 10), ...parsed };
  await env.DASHBOARD_KV.put(`otterly_prompts:${client}`, JSON.stringify(stored));
  return new Response(
    JSON.stringify({ ok: true, prompts: parsed.total, brandMentioned: parsed.brandMentioned, competitors: parsed.competitors.length }),
    { headers: { "Content-Type": "application/json" } }
  );
}

async function handleOtterlyCitationsUpload(request: Request, env: Env, client: string): Promise<Response> {
  const body = await request.text();
  if (!body.trim()) {
    return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }
  const existingCit = await env.DASHBOARD_KV.get(`otterly_citations:${client}`, "text");
  if (existingCit) await env.DASHBOARD_KV.put(`otterly_citations:${client}:prev`, existingCit);
  const reqUrl = new URL(request.url);
  const myDomain = reqUrl.searchParams.get("domain") || `${client}.dk`;
  const parsed = parseCitationsCsv(body, myDomain);
  const stored = { updatedAt: new Date().toISOString().slice(0, 10), ...parsed };
  await env.DASHBOARD_KV.put(`otterly_citations:${client}`, JSON.stringify(stored));
  return new Response(
    JSON.stringify({ ok: true, totalCitations: parsed.total, myDomainCitations: parsed.myDomainCitations, engines: parsed.engines.length }),
    { headers: { "Content-Type": "application/json" } }
  );
}

function csvSplitRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ── Baseline Upload Handler ──

async function handleBaselineUpload(request: Request, env: Env, client: string): Promise<Response> {
  const body = await request.text();
  try {
    const parsed = JSON.parse(body) as BaselineData;
    await env.DASHBOARD_KV.put(`baseline:${client}`, JSON.stringify(parsed));
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
}

// ── Traffic Event Ingest (called by Vercel Edge Proxy via waitUntil) ──

async function handleTrafficEvent(request: Request, env: Env): Promise<Response> {
  let body: Record<string, string>;
  try {
    body = await request.json() as Record<string, string>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { category, botName, path: reqPath, geoStatus, pageType, client } = body;
  if (!category || !geoStatus || !client) {
    return new Response(JSON.stringify({ error: "Missing required fields: category, geoStatus, client" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  env.GEO_TRAFFIC.writeDataPoint({
    blobs: [
      category,
      botName ?? "none",
      reqPath ?? "/",
      geoStatus,
      pageType ?? "unknown",
    ],
    indexes: [client],
  });

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
}

// ── Block 6 / Layer 3: Platform Alignment ──

interface AlignmentScoreGrade { score: number; grade: string; label_da: string; color: string; }
interface AlignmentScore { total: number; coverage: number; consistency: number; signals: number; grade: AlignmentScoreGrade; }
interface AlignmentPlatform { id: string; name_da: string; icon: string; status: string; statusText_da: string; issues: string[]; actionUrl: string | null; actionText_da: string | null; }
interface AlignmentAction { priority: number; action_da: string; timeEstimate_da: string; impactText_da: string; url: string; }
interface AlignmentReport { clientId: string; generatedAt: string; runType: string; client: { name: string; domain: string }; score: AlignmentScore; platforms: AlignmentPlatform[]; inconsistencies: { platform: string; field: string; match: string; diffDescription: string; }[]; prioritizedActions: AlignmentAction[]; sameAsUpdated: string[]; }
interface ScoreHistoryEntry { date: string; total: number; coverage: number; consistency: number; signals: number; }
interface ScoreHistory { clientId: string; history: ScoreHistoryEntry[]; }
interface ReportIndexEntry { date: string; title: string; }

async function loadAlignmentReport(env: Env, client: string): Promise<AlignmentReport | null> {
  const [raw, ovRaw] = await Promise.all([
    env.DASHBOARD_KV.get(`alignment:${client}:latest`, "text"),
    env.DASHBOARD_KV.get(`alignment_override:${client}`, "text"),
  ]);
  if (!raw) return null;
  try {
    const report = JSON.parse(raw) as AlignmentReport;
    if (ovRaw) applyOverridesToReport(report, JSON.parse(ovRaw) as Record<string, { verdict: string }>);
    return report;
  } catch { return null; }
}

// Live-apply human verdicts so the dashboard reflects a freshly-marked verdict immediately
// (without waiting for the next alignment run to rewrite the report). We mirror the run's
// scoring exactly so the number doesn't flicker when the run later catches up.
// Coverage credit per platform = its score when exists is confirmed.
// ponytail: keep in sync with scripts/alignment/scoring.ts — PLATFORM_WEIGHTS + the per-platform
// `claimed` value (trustpilot claimed=false→existsPoints 5; krak/guleSider/facebook→claimedPoints 5).
const OVERRIDE_EXISTS_POINTS: Record<string, number> = { trustpilot: 5, krak: 5, guleSider: 5, facebook: 5 };

function regradeAlignment(total: number): AlignmentScoreGrade {
  // mirrors scripts/alignment/scoring.ts getGrade
  if (total >= 85) return { score: total, grade: 'A', label_da: 'Fremragende',    color: '#16A34A' };
  if (total >= 70) return { score: total, grade: 'B', label_da: 'God',            color: '#65A30D' };
  if (total >= 50) return { score: total, grade: 'C', label_da: 'Acceptabel',     color: '#CA8A04' };
  if (total >= 30) return { score: total, grade: 'D', label_da: 'Utilstrækkelig', color: '#EA580C' };
  return                  { score: total, grade: 'F', label_da: 'Kritisk',        color: '#DC2626' };
}

function applyOverridesToReport(report: AlignmentReport, ov: Record<string, { verdict: string }>): void {
  let coverageDelta = 0;
  for (const p of report.platforms) {
    const o = ov[p.id];
    if (!o || p.status !== 'needs_verification') continue; // only platforms still pending
    if (o.verdict === 'missing') {
      p.status = 'missing'; p.statusText_da = 'Bekræftet manuelt — ikke registreret';
      p.actionUrl = null; p.actionText_da = null;
    } else {
      const exists = o.verdict === 'exists';
      p.status = exists ? 'ok' : 'warning';
      p.statusText_da = exists ? 'Bekræftet manuelt — profil findes' : 'Findes — oplysninger afviger (manuelt bekræftet)';
      coverageDelta += OVERRIDE_EXISTS_POINTS[p.id] ?? 0; // exists | differs both count as present
    }
  }
  if (coverageDelta && report.score) {
    report.score.coverage += coverageDelta;
    report.score.total += coverageDelta;
    report.score.grade = regradeAlignment(report.score.total);
  }
}

async function loadScoreHistory(env: Env, client: string): Promise<ScoreHistory | null> {
  const raw = await env.DASHBOARD_KV.get(`alignment:${client}:history`, "text");
  if (!raw) return null;
  try { return JSON.parse(raw) as ScoreHistory; } catch { return null; }
}

function renderGeoHealthScoreCard(report: AlignmentReport | null): string {
  if (!report || !report.score?.grade?.grade) {
    return `<div class="card" style="text-align:center;padding:20px 24px;margin-bottom:24px">
  <div style="font-size:14px;color:#64748b">GEO Health Score — checking platforms soon</div>
</div>`;
  }
  const { total, grade, coverage, consistency, signals } = report.score;
  const coveragePct  = (coverage / 40) * 100;
  const consistPct   = (consistency / 40) * 100;
  const signalsPct   = (signals / 20) * 100;
  const g = String(grade.grade).toUpperCase();
  const morandiColor = (g === 'A+' || g === 'A') ? '#86AD94' : g === 'B' ? '#6E8CA8' : '#BE9A5E';
  return `<div class="card" style="display:flex;align-items:center;gap:32px;padding:24px 28px;margin-bottom:14px;flex-wrap:wrap">
  <div style="position:relative;width:128px;height:128px;flex-shrink:0">
    <svg viewBox="0 0 128 128" width="128" height="128" style="display:block;transform:rotate(-90deg)">
      <circle cx="64" cy="64" r="54" fill="none" stroke="#1F252E" stroke-width="9"/>
      <circle cx="64" cy="64" r="54" fill="none" stroke="${morandiColor}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${(2*Math.PI*54).toFixed(1)}" stroke-dashoffset="${(2*Math.PI*54*(1-total/100)).toFixed(1)}"/>
    </svg>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <div style="font-weight:600;font-size:38px;letter-spacing:-.04em;line-height:1;color:${morandiColor}">${escHtml(String(grade.grade))}</div>
      <div style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx3);margin-top:3px">${total}/100</div>
    </div>
  </div>
  <div style="flex:1;min-width:200px">
    <div style="display:flex;align-items:center;gap:9px;margin-bottom:4px">
      <span style="font-weight:600;font-size:15px;color:var(--tx)">GEO Health Score</span>
      <span style="font-family:'Geist Mono',monospace;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--warn);border:1px solid rgba(201,154,82,.4);padding:2px 7px">${escHtml(grade.label_da)}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:11px;margin-top:12px">
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span style="color:var(--tx2)">Platformdækning</span><span style="font-family:'Geist Mono',monospace;color:var(--tx3)">${coverage}/40</span></div>
        <div style="height:5px;background:var(--line2);overflow:hidden"><div class="geo-bar" style="height:100%;width:${coveragePct.toFixed(0)}%;background:var(--blue)"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span style="color:var(--tx2)">NAP-konsistens</span><span style="font-family:'Geist Mono',monospace;color:var(--tx3)">${consistency}/40</span></div>
        <div style="height:5px;background:var(--line2);overflow:hidden"><div class="geo-bar" style="height:100%;width:${consistPct.toFixed(0)}%;background:#9B86AD"></div></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px"><span style="color:var(--tx2)">Signalkvalitet</span><span style="font-family:'Geist Mono',monospace;color:var(--tx3)">${signals}/20</span></div>
        <div style="height:5px;background:var(--line2);overflow:hidden"><div class="geo-bar" style="height:100%;width:${signalsPct.toFixed(0)}%;background:var(--bright)"></div></div>
      </div>
    </div>
  </div>
  <div style="font-family:'Geist Mono',monospace;font-size:11px;color:var(--tx3);align-self:flex-end">${escHtml(report.runType)} · ${escHtml(report.generatedAt.slice(0, 10))}</div>
</div>`;
}

function renderBlock6(report: AlignmentReport | null, history: ScoreHistory | null, days = 14, reportIndex: ReportIndexEntry[] = [], clientId = 'virum'): string {
  if (!report) {
    return `<div class="section"><div class="section-hdr"><span class="section-num">06</span><h2>Platform Alignment</h2><span class="section-rule"></span></div><div class="card"><div class="empty">No alignment data yet — run <code>pnpm tsx scripts/alignment/run.ts virum</code> to check</div></div></div>`;
  }

  const statusColor: Record<string, string> = { ok: 'var(--bright)', warning: 'var(--warn)', missing: 'var(--danger)', error: 'var(--danger)', unable_to_check: 'var(--tx3)', needs_verification: 'var(--tx3)' };

  const platformRowsHtml = report.platforms.map(p => {
    const color = statusColor[p.status] ?? 'var(--tx3)';
    const issueHtml = p.issues.length ? `<div style="font-size:12px;color:var(--warn);margin-top:3px">${p.issues.map(i => escHtml(i)).join(' · ')}</div>` : '';
    const btn = p.actionUrl ? `<a href="${escHtml(p.actionUrl)}" class="btn-outline">${escHtml(p.actionText_da ?? 'Open →')}</a>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0;border-bottom:1px solid var(--line2)">
      <div style="width:34px;height:34px;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:17px">${escHtml(p.icon)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:14px;color:var(--tx)">${escHtml(p.name_da)}</div>
        <div style="font-size:13px;color:${color};margin-top:3px">${escHtml(p.statusText_da)}</div>
        ${issueHtml}
      </div>
      ${btn}
    </div>`;
  }).join('');

  const napHtml = (() => {
    const rows = report.inconsistencies.filter(c => c.match === 'major_diff' || c.match === 'minor_diff');
    if (!rows.length) return '';
    return `<div class="card" style="margin-bottom:14px">
      <h3>NAP-uoverensstemmelser</h3>
      ${rows.map(c => `<div style="display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line2);font-size:13px"><span style="color:var(--tx3);min-width:80px">${escHtml(c.field)}</span><span style="color:var(--tx2);min-width:100px">${escHtml(c.platform)}</span><span style="color:var(--warn)">${escHtml(c.diffDescription)}</span></div>`).join('')}
    </div>`;
  })();

  const actionListHtml = (() => {
    const actions = report.prioritizedActions.slice(0, 5);
    if (!actions.length) return '';
    return `<div class="card" style="margin-bottom:14px">
      <h3 style="margin-bottom:4px">Prioriterede handlinger</h3>
      <div style="font-size:12px;color:var(--tx3);margin-bottom:16px">Hver handling løfter din GEO Health Score.</div>
      ${actions.map(a => `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px 0;border-bottom:1px solid var(--line2)">
        <div style="width:28px;height:28px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx3)">${a.priority}</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:500;font-size:14px;color:var(--tx)">${escHtml(a.action_da)}</div>
          <div style="font-size:12px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-top:3px">${escHtml(a.timeEstimate_da)}</div>
        </div>
        <div style="font-family:'Geist Mono',monospace;font-size:12px;color:var(--bright);flex-shrink:0">${escHtml(a.impactText_da)}</div>
      </div>`).join('')}
    </div>`;
  })();

  // History trend
  let historyHtml = '';
  if (history && history.history.length > 1) {
    const pts = history.history.slice(-Math.max(days, 2));
    const xLabels = pts.map(p => p.date.slice(5));
    const series = [{ label: 'Total', color: '#6E8CA8', points: pts.map((p, i) => ({ x: i, y: p.total })) }];
    historyHtml = `<div class="card" style="margin-bottom:14px"><h3>Score History</h3>${svgLineChart(series, xLabels, 600, 200)}</div>`;
  }

  const sameAsHtml = report.sameAsUpdated.length
    ? `<div style="font-size:11px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-top:12px">sameAs: ${report.sameAsUpdated.map(u => `<a href="${escHtml(u)}" style="color:var(--tx3)">${escHtml(new URL(u).hostname)}</a>`).join(' · ')}</div>`
    : '';

  const reportIndexHtml = reportIndex.length > 0 ? `
<div class="card" style="margin-top:14px">
  <h3 style="margin-bottom:12px">Handlingsrapporter</h3>
  ${reportIndex.map(r => `
  <a href="/report/${escHtml(clientId)}/${escHtml(r.date)}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--panel2);border:1px solid var(--line2);text-decoration:none;margin-bottom:6px">
    <div>
      <div style="font-size:14px;font-weight:500;color:var(--tx)">${escHtml(r.title)}</div>
      <div style="font-size:11px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-top:3px">${escHtml(r.date.slice(0,4))}-${escHtml(r.date.slice(4,6))}-${escHtml(r.date.slice(6,8))}</div>
    </div>
    <span style="color:var(--blue);font-size:14px">→</span>
  </a>`).join('')}
</div>` : '';

  return `<div class="section" id="alignment">
<div class="section-hdr"><span class="section-num">06</span><h2>Platform Alignment</h2><span class="section-rule"></span></div>
<div class="card" style="margin-bottom:14px;padding-bottom:0">${platformRowsHtml}</div>
${napHtml}${actionListHtml}${historyHtml}${sameAsHtml}${reportIndexHtml}
</div>`;
}

function renderClientLayer3(report: AlignmentReport | null, dnsReadyAt: string | null, reportIndex: ReportIndexEntry[], clientId: string): string {
  const dnsStatus = dnsReadyAt
    ? `<div style="font-size:13px;color:var(--bright);margin-bottom:16px">✅ GEO Layer aktiv siden ${escHtml(dnsReadyAt.slice(0, 10))}</div>`
    : `<div style="font-size:13px;color:var(--tx3);margin-bottom:16px">⏳ Afventer DNS-opsætning (typisk 24-48t)</div>`;

  if (!report) {
    return `<div class="section">
<div class="layer-label">Layer 3 — Platformtilpasning</div>
${dnsStatus}
<div class="card"><div class="empty"><p style="font-size:15px;margin-bottom:6px">Din første alignment-rapport er på vej</p><p style="font-size:13px;color:#64748b">Vi tjekker dine platforme inden for 24 timer efter aktivering.</p></div></div>
</div>`;
  }

  const clientStatusColor: Record<string, string> = { ok: 'var(--bright)', warning: 'var(--warn)', missing: 'var(--danger)', error: 'var(--danger)', unable_to_check: 'var(--tx3)', needs_verification: 'var(--tx3)' };
  const platformList = report.platforms.map(p => {
    const color = clientStatusColor[p.status] ?? 'var(--tx3)';
    const issueHtml = p.issues.length ? `<div style="font-size:12px;color:var(--warn);margin-top:3px">${p.issues.map(i => escHtml(i)).join(' · ')}</div>` : '';
    const btn = p.actionUrl ? `<a href="${escHtml(p.actionUrl)}" class="btn-outline">${escHtml(p.actionText_da ?? 'Open →')}</a>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:14px;padding:18px 0;border-bottom:1px solid var(--line2)">
      <div style="width:34px;height:34px;background:var(--panel2);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:17px">${escHtml(p.icon)}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:14px;color:var(--tx)">${escHtml(p.name_da)}</div>
        <div style="font-size:13px;color:${color};margin-top:3px">${escHtml(p.statusText_da)}</div>
        ${issueHtml}
      </div>
      ${btn}
    </div>`;
  }).join('');

  const topActions = report.prioritizedActions.slice(0, 3).map((a, i) =>
    `<div style="display:flex;align-items:flex-start;gap:14px;padding:16px 0;border-bottom:1px solid var(--line2)">
      <div style="width:28px;height:28px;border:1px solid var(--line);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Geist Mono',monospace;font-size:12px;color:var(--tx3)">${i + 1}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:500;font-size:14px;color:var(--tx)">${escHtml(a.action_da)}</div>
        <div style="font-size:12px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-top:3px">${escHtml(a.timeEstimate_da)}</div>
        ${a.url ? `<a href="${escHtml(a.url)}" style="font-size:12px;color:var(--blue);margin-top:4px;display:inline-block">Gå til platform →</a>` : ''}
      </div>
      <div style="font-family:'Geist Mono',monospace;font-size:12px;color:var(--bright);flex-shrink:0">${escHtml(a.impactText_da)}</div>
    </div>`
  ).join('');

  return `<div class="section">
<div class="layer-label">Layer 3 — Platformtilpasning</div>
${dnsStatus}
${renderGeoHealthScoreCard(report)}
<div class="card" style="margin-bottom:14px;padding-bottom:0"><h3 style="margin-bottom:0">Platformstatus</h3>${platformList}</div>
${topActions ? `<div class="card" id="client-actions" style="margin-bottom:14px;scroll-margin-top:24px"><h3 style="margin-bottom:4px">Anbefalede handlinger</h3><div style="font-size:12px;color:var(--tx3);margin-bottom:16px">Hver handling løfter din GEO Health Score.</div>${topActions}</div>` : ''}
<div style="font-size:11px;color:#475569;margin-top:12px">Rapport genereret ${escHtml(report.generatedAt.slice(0, 10))} · Næste check om 2 uger</div>
${reportIndex.length > 0 ? `
<div class="card" style="margin-top:14px">
  <h3 style="margin-bottom:12px">Handlingsrapporter</h3>
  ${reportIndex.map(r => `
  <a href="/report/${escHtml(clientId)}/${escHtml(r.date)}" style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:var(--panel2);border:1px solid var(--line2);text-decoration:none;margin-bottom:6px">
    <div>
      <div style="font-size:14px;font-weight:500;color:var(--tx)">${escHtml(r.title)}</div>
      <div style="font-size:11px;font-family:'Geist Mono',monospace;color:var(--tx3);margin-top:3px">${escHtml(r.date.slice(0,4))}-${escHtml(r.date.slice(4,6))}-${escHtml(r.date.slice(6,8))}</div>
    </div>
    <span style="color:var(--blue);font-size:14px">→</span>
  </a>`).join('')}
</div>` : ''}
</div>`;
}

// ── Notification Helpers ──

async function notifySlack(env: Env, text: string): Promise<void> {
  if (!env.SLACK_WEBHOOK_URL) return;
  await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }).catch(() => {}); // ponytail: fire-and-forget, slack outage must not affect dns-check response
}

async function sendWelcomeEmail(env: Env, clientId: string, requestOrigin: string): Promise<void> {
  if (!env.RESEND_API_KEY) return;
  const [clientEmail, clientToken] = await Promise.all([
    env.DASHBOARD_KV.get(`client_email:${clientId}`, 'text'),
    env.DASHBOARD_KV.get(`client_token:${clientId}`, 'text'),
  ]);
  if (!clientEmail) return;

  const dashUrl = clientToken
    ? `${requestOrigin}/?view=client&client=${clientId}&token=${clientToken}`
    : `${requestOrigin}/?view=client&client=${clientId}`;

  const html = `<!DOCTYPE html><html lang="da"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f9f9f9;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:32px 16px">
  <p style="color:#6b7280;font-size:12px;margin:0 0 24px">Found by AI</p>
  <h1 style="color:#1a1a1a;font-size:22px;margin:0 0 12px">Dit GEO-lag er nu aktivt 🎉</h1>
  <p style="color:#374151;font-size:15px;line-height:1.6;margin:0 0 28px">
    Din hjemmeside er nu synlig for AI-søgemaskiner som ChatGPT, Perplexity og Google AI Overview.
    Vi kører din første platformtjek inden for 24 timer og sender dig en rapport.
  </p>
  <div style="text-align:center;margin:32px 0">
    <a href="${dashUrl}" style="background:#3b82f6;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;display:inline-block">
      Se dit dashboard →
    </a>
  </div>
  <p style="font-size:13px;color:#6b7280;line-height:1.6">
    Spørgsmål? Skriv til <a href="mailto:hello@foundbyai.dk" style="color:#3b82f6">hello@foundbyai.dk</a>
  </p>
</div></body></html>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Found by AI <hej@foundbyai.dk>',
      to: [clientEmail],
      subject: 'Dit GEO-lag er nu aktivt — se dit dashboard',
      html,
    }),
  }).catch(() => {}); // ponytail: fire-and-forget
}

// ── Main Worker ──

// Where the human goes to look (mirrors scripts/alignment/verify-todo.ts). Trustpilot has
// a deterministic profile URL; Facebook a stable page-search; Krak/GuleSider have no clean
// public search URL, so scope a Google search to their domain.
function verifyCheckUrl(platform: string, report: AlignmentReport): string {
  const domain = (report.client.domain || '').replace(/^www\./, '');
  const name = report.client.name || '';
  const g = (s: string) => `https://www.google.com/search?q=${encodeURIComponent(s)}`;
  switch (platform) {
    case 'trustpilot': return `https://www.trustpilot.com/review/${domain}`;
    case 'facebook':   return `https://www.facebook.com/search/pages?q=${encodeURIComponent(name)}`;
    case 'krak':       return g(`${name} site:krak.dk`);
    case 'guleSider':  return g(`${name} site:degulesider.dk`);
    default:           return '';
  }
}

function renderVerifyPage(report: AlignmentReport | null, ov: Record<string, { verdict: string }>, client: string): string {
  const shell = (inner: string) =>
    `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Verifikation</title></head>` +
    `<body style="font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#f8fafc;max-width:680px;margin:0 auto;padding:40px 20px">${inner}</body></html>`;
  if (!report) return shell(`<p>Ingen alignment-data for "${escHtml(client)}".</p>`);

  const rows = report.platforms.filter(p => p.status === 'needs_verification' || ov[p.id]).map(p => {
    const cur = ov[p.id]?.verdict;
    const check = verifyCheckUrl(p.id, report);
    const radio = (v: string, label: string, color: string) =>
      `<label style="display:inline-flex;align-items:center;gap:6px;margin-right:18px;cursor:pointer;font-size:14px">` +
      `<input type="radio" name="v_${escHtml(p.id)}" value="${v}"${cur === v ? ' checked' : ''}>` +
      `<span style="color:${color}">${label}</span></label>`;
    return `<div style="padding:18px 0;border-bottom:1px solid #1e293b">` +
      `<div style="font-size:16px;font-weight:600;margin-bottom:8px">${escHtml(p.icon)} ${escHtml(p.name_da)}${cur ? ` <span style="font-size:12px;color:#94a3b8;font-weight:400">— registreret: ${escHtml(cur)}</span>` : ''}</div>` +
      (check ? `<div style="margin-bottom:12px"><a href="${escHtml(check)}" target="_blank" rel="noopener" style="color:#3b82f6;font-size:13px">→ Søg på ${escHtml(p.name_da)}</a></div>` : '') +
      `<div>${radio('exists', '✓ Findes', '#10b981')}${radio('missing', '✗ Findes ikke', '#ef4444')}${radio('differs', '⚠ Findes, men afviger', '#f59e0b')}</div></div>`;
  }).join('');

  if (!rows) {
    return shell(
      `<h1 style="font-size:22px;margin-bottom:4px">🔍 Alignment-verifikation</h1>` +
      `<p style="color:#94a3b8;margin-top:0">${escHtml(report.client.name)} · ${escHtml(report.client.domain)}</p>` +
      `<p style="color:#10b981">Alt bekræftet — intet at verificere ✓</p>` +
      `<p style="margin-top:20px"><a href="/?view=ops#alignment" style="color:#3b82f6">→ Se resultat på dashboard</a></p>`,
    );
  }

  return shell(
    `<h1 style="font-size:22px;margin-bottom:4px">🔍 Alignment-verifikation</h1>` +
    `<p style="color:#94a3b8;margin-top:0">${escHtml(report.client.name)} · ${escHtml(report.client.domain)}</p>` +
    `<p style="color:#64748b;font-size:13px;margin:-4px 0 16px">Vælg for hver platform, og tryk Gem — så lander du på det opdaterede resultat.</p>` +
    `<form method="POST" action="/api/verify/${encodeURIComponent(client)}">${rows}` +
    `<button type="submit" style="margin-top:22px;padding:12px 26px;border-radius:8px;border:none;background:#3b82f6;color:#fff;font-size:15px;font-weight:600;cursor:pointer">Gem og se resultat →</button>` +
    `</form>`,
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Auth check (skip for health endpoint)
    let auth: AuthIdentity = { type: 'ops' };
    if (path !== "/health") {
      const authResult = await checkAuth(request, env);
      if (authResult instanceof Response) return authResult;
      auth = authResult;
    }

    // Health check
    if (path === "/health") {
      return new Response("ok");
    }

    // API: Receive alignment report from script (ops only)
    if (path.match(/^\/api\/alignment\/[^/]+$/) && request.method === "POST") {
      if (auth.type !== 'ops') return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
      const clientId = path.split("/")[3];
      const body = await request.text();
      if (!body) return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        const report = JSON.parse(body) as AlignmentReport;
        // Validate required fields before writing to KV (CR-02)
        if (!report.generatedAt || typeof report.score?.total !== 'number' ||
            report.score.total < 0 || report.score.total > 100 ||
            !report.score.grade?.grade || !Array.isArray(report.platforms)) {
          return new Response(JSON.stringify({ error: "Invalid report shape" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }
        await env.DASHBOARD_KV.put(`alignment:${clientId}:latest`, body);
        // Append to history (dedup by date)
        const histRaw = await env.DASHBOARD_KV.get(`alignment:${clientId}:history`, "text");
        const hist: ScoreHistory = histRaw ? JSON.parse(histRaw) : { clientId, history: [] };
        const today = report.generatedAt.slice(0, 10);
        hist.history = hist.history.filter(h => h.date !== today);
        hist.history.push({ date: today, total: report.score.total, coverage: report.score.coverage, consistency: report.score.consistency, signals: report.score.signals });
        if (hist.history.length > 50) hist.history = hist.history.slice(-50);
        await env.DASHBOARD_KV.put(`alignment:${clientId}:history`, JSON.stringify(hist));
        return new Response(JSON.stringify({ ok: true, score: report.score.total, grade: report.score.grade.grade }), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON", detail: String(e) }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }

    // API: Get latest alignment report (ops or matching client)
    if (path.match(/^\/api\/alignment\/[^/]+$/) && request.method === "GET") {
      const clientId = path.split("/")[3];
      if (auth.type === 'client' && auth.clientId !== clientId) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
      }
      const [reportRaw, histRaw] = await Promise.all([
        env.DASHBOARD_KV.get(`alignment:${clientId}:latest`, "text"),
        env.DASHBOARD_KV.get(`alignment:${clientId}:history`, "text"),
      ]);
      if (!reportRaw) return new Response(JSON.stringify({ error: "No alignment data" }), { status: 404, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ report: JSON.parse(reportRaw), history: histRaw ? JSON.parse(histRaw) : null }), { headers: { "Content-Type": "application/json" } });
    }

    // API: human verification verdicts (slice 2, ops only) — read stored overrides
    if (path.match(/^\/api\/verify\/[^/]+$/) && request.method === "GET") {
      if (auth.type !== 'ops') return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { "Content-Type": "application/json" } });
      const client = path.split("/")[3];
      const raw = await env.DASHBOARD_KV.get(`alignment_override:${client}`, "text");
      return new Response(JSON.stringify({ overrides: raw ? JSON.parse(raw) : {} }), { headers: { "Content-Type": "application/json" } });
    }
    // API: record a human verdict for one platform (ops only). Form POST so the verify
    // page's buttons work without JS; GET pages stay side-effect-free (safe from Slack prefetch).
    // Record verdicts from the verify-page form (batch), then land on the updated
    // dashboard at the alignment section — the human sees the result in one shot.
    if (path.match(/^\/api\/verify\/[^/]+$/) && request.method === "POST") {
      if (auth.type !== 'ops') return new Response("Forbidden", { status: 403 });
      const client = path.split("/")[3];
      const form = await request.formData();
      const raw = await env.DASHBOARD_KV.get(`alignment_override:${client}`, "text");
      const ov = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      const now = new Date().toISOString();
      for (const id of ['trustpilot', 'krak', 'guleSider', 'facebook']) {
        const v = String(form.get(`v_${id}`) ?? '');
        if (['exists', 'missing', 'differs'].includes(v)) ov[id] = { verdict: v, at: now };
      }
      await env.DASHBOARD_KV.put(`alignment_override:${client}`, JSON.stringify(ov));
      return new Response(null, { status: 303, headers: { Location: `${url.origin}/?view=ops#alignment` } });
    }
    // Verification page (ops only) — Slack TODO links here; side-effect-free GET.
    if (path === "/verify" && request.method === "GET") {
      if (auth.type !== 'ops') return new Response("Forbidden", { status: 403 });
      const client = url.searchParams.get("client") ?? "";
      const [reportRaw, ovRaw] = await Promise.all([
        env.DASHBOARD_KV.get(`alignment:${client}:latest`, "text"),
        env.DASHBOARD_KV.get(`alignment_override:${client}`, "text"),
      ]);
      const report = reportRaw ? JSON.parse(reportRaw) as AlignmentReport : null;
      const ov = ovRaw ? JSON.parse(ovRaw) as Record<string, { verdict: string }> : {};
      return new Response(renderVerifyPage(report, ov, client), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    // API: Upload OtterlyAI prompts CSV
    if (path.match(/^\/api\/otterly\/[^/]+\/prompts$/) && request.method === "POST") {
      const client = path.split("/")[3];
      if (!client) return new Response("Missing client", { status: 400 });
      return handleOtterlyPromptsUpload(request, env, client);
    }

    // API: Upload OtterlyAI citations CSV
    if (path.match(/^\/api\/otterly\/[^/]+\/citations$/) && request.method === "POST") {
      const client = path.split("/")[3];
      if (!client) return new Response("Missing client", { status: 400 });
      return handleOtterlyCitationsUpload(request, env, client);
    }

    // API: Upload Baseline JSON
    if (path.startsWith("/api/baseline/") && request.method === "POST") {
      const client = path.split("/")[3];
      if (!client) return new Response("Missing client", { status: 400 });
      return handleBaselineUpload(request, env, client);
    }

    // API: Receive traffic event from Vercel Edge Proxy
    if (path.match(/^\/api\/traffic\/[^/]+$/) && request.method === "POST") {
      return handleTrafficEvent(request, env);
    }

    // API: Stats JSON
    if (path.startsWith("/api/stats/")) {
      const ds = env.AE_DATASET;
      const days = parseInt(url.searchParams.get("days") || "7");
      const [categories, bots] = await Promise.all([
        queryAE(env, queryCategoryBreakdown(ds, days)),
        queryAE(env, queryBotDetails(ds, days)),
      ]);
      return new Response(JSON.stringify({ categories, bots }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // API: DNS readiness check
    if (path.match(/^\/api\/dns-check\/[^/]+$/) && request.method === "GET") {
      const clientId = path.split("/")[3];
      const cfgRaw = await env.DASHBOARD_KV.get(`config:${clientId}`, "text");
      const cfg: ClientConfig = cfgRaw
        ? (() => { try { return JSON.parse(cfgRaw) as ClientConfig; } catch { return { domain: `${clientId}.dk`, activeSince: "" }; } })()
        : { domain: `${clientId}.dk`, activeSince: "" };
      try {
        const resp = await fetch(`https://${cfg.domain}/`, {
          headers: { "User-Agent": "FoundByAI-DNSCheck/1.0", "X-GEO-Check": "true" },
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        const geoActive = resp.headers.get("X-GEO-Layer") === "active";
        const dnsReady = resp.ok;
        const existing = await env.DASHBOARD_KV.get(`dns_ready_at:${clientId}`, "text");
        if (dnsReady && !existing) {
          await env.DASHBOARD_KV.put(`dns_ready_at:${clientId}`, new Date().toISOString());
          const origin = new URL(request.url).origin;
          ctx.waitUntil(Promise.all([
            notifySlack(env, `🌐 DNS ready: *${clientId}* (${cfg.domain}) — <${origin}/?view=ops|Dashboard>`),
            sendWelcomeEmail(env, clientId, origin),
          ]));
        }
        const dnsReadyAt = await env.DASHBOARD_KV.get(`dns_ready_at:${clientId}`, "text");
        return new Response(JSON.stringify({ ok: true, domain: cfg.domain, httpStatus: resp.status, geoActive, dnsReady, dnsReadyAt: dnsReadyAt || null }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, domain: cfg.domain, error: String(e), dnsReady: false }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // API: Audit CSV export
    if (path === "/api/export/ai-bot-visits.csv") {
      const days = parseInt(url.searchParams.get("days") || "7");
      const clientId = url.searchParams.get("client") || "virum";
      const csvConfigRaw = await env.DASHBOARD_KV.get(`config:${clientId}`, "text");
      const csvConfig: ClientConfig = csvConfigRaw
        ? (() => { try { return JSON.parse(csvConfigRaw) as ClientConfig; } catch { return { domain: "virumakupunktur.dk", activeSince: "" }; } })()
        : { domain: "virumakupunktur.dk", activeSince: "" };
      const endDate = new Date(); endDate.setDate(endDate.getDate() - 1);
      const startDate = new Date(); startDate.setDate(startDate.getDate() - days);
      const range = `${startDate.toISOString().slice(0, 10)} to ${endDate.toISOString().slice(0, 10)}`;
      const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";
      const logRows = await queryAE(env, queryAIBotLog(env.AE_DATASET, days));
      const STATUS_LABEL: Record<string, string> = { injected: "GEO Schema Injected", passthrough: "Content Served", passthrough_nonhtml: "Asset Served", skipped_non2xx: "Non-2xx Skipped" };
      const auditHeader = [
        `# GEO Effect — AI Bot Activity Report`,
        `# Client: ${csvConfig.domain}`,
        `# Client ID: ${clientId}`,
        `# Period: Last ${days} days (${range})`,
        `# Generated: ${generatedAt}`,
        `#`,
        `# Each record is an individual AI bot request captured at the network edge.`,
        `# Bot identifiers are standard user-agent strings used by each AI company:`,
        `#   ChatGPT-User  — OpenAI ChatGPT`,
        `#   OAI-SearchBot — OpenAI SearchGPT`,
        `#   PerplexityBot — Perplexity AI`,
        `#   ClaudeBot     — Anthropic Claude`,
        `#   GPTBot        — OpenAI training crawler`,
        `#`,
        `Timestamp,Bot,Page,Status`,
      ].join("\n");
      let csv = auditHeader + "\n";
      for (const r of logRows) {
        const ts = String(r.timestamp).slice(0, 19).replace(' ', 'T') + 'Z';
        const page = `"${String(r.page).replace(/"/g, '""')}"`;
        const status = STATUS_LABEL[String(r.geo_status)] ?? String(r.geo_status);
        csv += `${ts},${String(r.bot_name)},${page},${status}\n`;
      }
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="geo-audit-${csvConfig.domain}-${days}d.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    // Report: serve stored HTML report (client or ops auth)
    if (path.match(/^\/report\/[^/]+\/[^/]+$/) && request.method === "GET") {
      const parts = path.split("/");
      const clientId = parts[2];
      const date = parts[3];
      if (!/^[a-z0-9-]+$/.test(clientId) || !/^\d{8}$/.test(date)) {
        return new Response("Invalid request", { status: 400 });
      }
      // Auth: ops already checked above; also accept client token for this path
      if (auth.type !== 'ops') {
        const clientToken = await env.DASHBOARD_KV.get(`client_token:${clientId}`, "text");
        const urlToken = url.searchParams.get("token");
        const cookieClient = getCookie(request, `client_token_${clientId}`);
        const tokenMatch = clientToken && (cookieClient === clientToken || urlToken === clientToken);
        if (!tokenMatch) {
          return new Response(renderClientLoginPage(), { status: 401, headers: { "Content-Type": "text/html;charset=utf-8" } });
        }
        if (urlToken === clientToken && cookieClient !== clientToken) {
          const clean = new URL(request.url);
          clean.searchParams.delete("token");
          return new Response(null, {
            status: 302,
            headers: {
              Location: clean.pathname + clean.search,
              "Set-Cookie": `client_token_${clientId}=${clientToken}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
            },
          });
        }
      }
      const reportHtml = await env.DASHBOARD_KV.get(`report:${clientId}:${date}`, "text");
      if (!reportHtml) return new Response("Rapport ikke fundet", { status: 404, headers: { "Content-Type": "text/plain;charset=utf-8" } });
      return new Response(reportHtml, { headers: { "Content-Type": "text/html;charset=utf-8", "Cache-Control": "public, max-age=3600" } });
    }

    // Dashboard HTML
    const days = parseInt(url.searchParams.get("days") || "7");
    const view = url.searchParams.get("view") || "ops";
    const client = url.searchParams.get("client") || "virum";
    const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

    // Load client config (fallback to defaults)
    let config: ClientConfig = { domain: "virumakupunktur.dk", activeSince: "Jun 19, 2026" };
    const configRaw = await env.DASHBOARD_KV.get(`config:${client}`, "text");
    if (configRaw) {
      try { config = JSON.parse(configRaw) as ClientConfig; } catch { /* use default */ }
    }

    if (view === "client") {
      const [funnel, results, alignReport, dnsReadyAt, reportIndexRaw] = await Promise.all([
        renderClientFunnel(env, days, config),
        renderClientResults(env, client),
        loadAlignmentReport(env, client),
        env.DASHBOARD_KV.get(`dns_ready_at:${client}`, "text"),
        env.DASHBOARD_KV.get(`report_index:${client}`, "text"),
      ]);
      const reportIndex: ReportIndexEntry[] = reportIndexRaw ? (() => { try { return JSON.parse(reportIndexRaw) as ReportIndexEntry[]; } catch { return []; } })() : [];

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>AI Search Performance — ${escHtml(config.domain)}</title>
${renderStyles()}
</head>
<body>
${renderClientHeader(config, generatedAt, days, client)}
<div class="container">
<p class="page-label">AI Search Performance</p>
<h1>${escHtml(config.domain)}</h1>
${funnel}
${results}
${renderClientLayer3(alignReport, dnsReadyAt, reportIndex, client)}
<footer class="geo-footer">
  <div style="display:flex;align-items:center;font-size:13px"><span style="font-weight:600;color:var(--tx2)">Found</span><span style="display:inline-block;width:4px;height:4px;background:var(--accent);transform:rotate(45deg);margin:0 5px"></span><span style="color:var(--tx3)">by AI</span></div>
  <span class="timestamp">Designed by <a href="https://yi.studio" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px solid var(--line2)">yi.studio</a></span>
</footer>
</div>
</body>
</html>`;

      return new Response(html, {
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }

    // Ops view: all blocks
    const [block1, block2, block3, block4, block5, alignReportOps, alignHistoryOps, reportIndexRawOps] = await Promise.all([
      renderBlock1(env, days, config),
      renderBlock2(env, days),
      renderBlock3(env, client),
      renderBlock4(env, client),
      renderBlock5(env, days),
      loadAlignmentReport(env, client),
      loadScoreHistory(env, client),
      env.DASHBOARD_KV.get(`report_index:${client}`, "text"),
    ]);
    const reportIndexOps: ReportIndexEntry[] = reportIndexRawOps ? (() => { try { return JSON.parse(reportIndexRawOps) as ReportIndexEntry[]; } catch { return []; } })() : [];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>GEO Dashboard — ${escHtml(config.domain)}</title>
${renderStyles()}
</head>
<body>
${renderHeader(config, generatedAt, days, client)}
<div class="container">
<p class="page-label">GEO Effect</p>
<h1>Dashboard</h1>
${renderGeoHealthScoreCard(alignReportOps)}
${block1}
${block2}
${block3}
${block4}
${block5}
${renderBlock6(alignReportOps, alignHistoryOps, days, reportIndexOps, client)}
<footer class="geo-footer">
  <div style="display:flex;align-items:center;font-size:13px"><span style="font-weight:600;color:var(--tx2)">Found</span><span style="display:inline-block;width:4px;height:4px;background:var(--accent);transform:rotate(45deg);margin:0 5px"></span><span style="color:var(--tx3)">by AI</span></div>
  <span class="timestamp">Designed by <a href="https://yi.studio" target="_blank" rel="noopener" style="color:inherit;text-decoration:none;border-bottom:1px solid var(--line2)">yi.studio</a></span>
</footer>
</div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  },
};
