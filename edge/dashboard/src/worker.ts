interface Env {
  ACCOUNT_ID: string;
  AE_DATASET: string;
  CF_API_TOKEN: string;
  DASHBOARD_TOKEN: string;
  DASHBOARD_KV: KVNamespace;
  GEO_TRAFFIC: AnalyticsEngineDataset;
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
  ai_retrieval: "#10b981",
  seo_crawler: "#3b82f6",
  ai_training: "#f59e0b",
  visitor: "#6b7280",
};

const LABELS: Record<string, string> = {
  ai_retrieval: "AI Retrieval",
  seo_crawler: "SEO Crawlers",
  ai_training: "AI Training",
  visitor: "Visitors",
};

function svgPieChart(data: { label: string; value: number; color: string }[]): string {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="100" r="90" fill="#1e293b" stroke="#334155" stroke-width="2"/><text x="100" y="105" text-anchor="middle" fill="#94a3b8" font-size="14">No data</text></svg>`;

  let svg = `<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">`;
  let cumAngle = -90;

  for (const d of data) {
    if (d.value === 0) continue;
    const pct = d.value / total;
    const angle = pct * 360;

    if (pct >= 0.999) {
      svg += `<circle cx="100" cy="100" r="90" fill="${d.color}"/>`;
    } else {
      const startRad = (cumAngle * Math.PI) / 180;
      const endRad = ((cumAngle + angle) * Math.PI) / 180;
      const x1 = 100 + 90 * Math.cos(startRad);
      const y1 = 100 + 90 * Math.sin(startRad);
      const x2 = 100 + 90 * Math.cos(endRad);
      const y2 = 100 + 90 * Math.sin(endRad);
      const largeArc = angle > 180 ? 1 : 0;
      svg += `<path d="M100,100 L${x1},${y1} A90,90 0 ${largeArc},1 ${x2},${y2} Z" fill="${d.color}"/>`;
    }
    cumAngle += angle;
  }

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
  const legendH = interactive ? 0 : 28;
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

  let svgBody = `<rect width="${width}" height="${totalH}" fill="#0f172a" rx="8"/>`;

  // Static legend (non-interactive only)
  if (!interactive) {
    let legendX = pad.left;
    for (const s of series) {
      svgBody += `<circle cx="${legendX + 5}" cy="16" r="5" fill="${s.color}"/>`;
      svgBody += `<text x="${legendX + 14}" y="20" fill="#cbd5e1" font-size="11">${s.label}</text>`;
      legendX += s.label.length * 7 + 30;
    }
  }

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    svgBody += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#1e293b" stroke-width="1"/>`;
    svgBody += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${val}</text>`;
  }

  // X labels (thin when many)
  const step = xLabels.length > 1 ? w / (xLabels.length - 1) : 0;
  const labelSkip = Math.max(1, Math.ceil(xLabels.length / 8));
  for (let i = 0; i < xLabels.length; i++) {
    if (i % labelSkip !== 0 && i !== xLabels.length - 1) continue;
    const x = pad.left + step * i;
    svgBody += `<text x="${x}" y="${height - 5}" text-anchor="middle" fill="#64748b" font-size="9">${xLabels[i]}</text>`;
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
  svg += `<rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>`;

  // Legend
  let legendX = pad.left;
  for (const [name, color] of allBots) {
    svg += `<circle cx="${legendX + 5}" cy="16" r="5" fill="${color}"/>`;
    svg += `<text x="${legendX + 14}" y="20" fill="#cbd5e1" font-size="10">${name}</text>`;
    legendX += name.length * 6.5 + 28;
  }

  // Grid
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#1e293b" stroke-width="1"/>`;
    svg += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${val}</text>`;
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
    svg += `<text x="${x + barW / 2}" y="${height - 5}" text-anchor="middle" fill="#64748b" font-size="9">${d.label}</text>`;
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
  return `<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0f172a;color:#e2e8f0;line-height:1.5}
.container{max-width:1200px;margin:0 auto;padding:24px}
h1{font-size:28px;font-weight:700;margin-bottom:8px}
h2{font-size:20px;font-weight:600;margin-bottom:16px;color:#f8fafc;border-bottom:2px solid #1e293b;padding-bottom:8px}
h3{font-size:16px;font-weight:600;margin-bottom:12px;color:#cbd5e1}
.subtitle{color:#94a3b8;font-size:14px;margin-bottom:32px}
.grid{display:grid;gap:24px;margin-bottom:32px}
.grid-2{grid-template-columns:1fr 1fr}
.grid-3{grid-template-columns:1fr 1fr 1fr}
.grid-4{grid-template-columns:1fr 1fr 1fr 1fr}
.card{background:#1e293b;border-radius:12px;padding:24px;border:1px solid #334155}
.stat-value{font-size:36px;font-weight:800;color:#f8fafc}
.stat-label{font-size:13px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px}
.stat-sub{font-size:12px;color:#64748b;margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;padding:10px 12px;color:#94a3b8;font-weight:500;border-bottom:1px solid #334155;font-size:12px;text-transform:uppercase;letter-spacing:0.5px}
td{padding:10px 12px;border-bottom:1px solid #1e293b}
.badge{display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600}
.badge-green{background:#065f46;color:#6ee7b7}
.badge-blue{background:#1e3a5f;color:#93c5fd}
.badge-amber{background:#78350f;color:#fcd34d}
.badge-gray{background:#374151;color:#9ca3af}
.badge-red{background:#7f1d1d;color:#fca5a5}
.section{margin-bottom:40px}
.pie-container{display:flex;align-items:center;gap:24px}
.pie-chart{width:160px;height:160px;flex-shrink:0}
.pie-legend{display:flex;flex-direction:column;gap:8px}
.legend-item{display:flex;align-items:center;gap:8px;font-size:13px}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.empty{color:#64748b;font-style:italic;padding:20px 0;text-align:center}
.bar{height:8px;border-radius:4px;background:#334155;overflow:hidden}
.bar-fill{height:100%;border-radius:4px}
.status-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #1e293b}
.status-row:last-child{border:none}
.change-up{color:#10b981}
.change-down{color:#ef4444}
.change-neutral{color:#94a3b8}
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}
.header-right{text-align:right}
.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;margin-right:6px}
.timestamp{font-size:12px;color:#64748b}
.time-nav{display:flex;gap:6px;margin-bottom:28px}
.time-pill{padding:5px 14px;border-radius:9999px;font-size:12px;font-weight:600;border:1px solid #334155;background:transparent;color:#94a3b8;cursor:pointer;text-decoration:none}
.time-pill:hover{border-color:#475569;color:#cbd5e1}
.time-pill.active{background:#3b82f6;border-color:#3b82f6;color:#fff}
.data-source{font-size:11px;color:#475569;margin-top:12px}
.data-source a{color:#64748b;text-decoration:underline}
@media(max-width:768px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.pie-container{flex-direction:column}}
.insight-banner{background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:12px;padding:20px 24px;margin-bottom:24px}
.insight-banner h3{color:#f8fafc;font-size:18px;margin-bottom:4px}
.insight-banner p{color:#94a3b8;font-size:14px;line-height:1.5}
.layer-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:8px;font-weight:600}
</style>
<script>
function geoToggle(cid,sid){var chart=document.getElementById(cid);if(!chart)return;var allG=chart.querySelectorAll('.geo-series');var allB=chart.querySelectorAll('.geo-lb');var target=document.getElementById(cid+'-'+sid);var isSolo=target&&target.getAttribute('data-solo')==='1';if(isSolo){allG.forEach(function(g){g.style.display='';g.removeAttribute('data-solo')});allB.forEach(function(b){b.style.opacity='1'})}else{allG.forEach(function(g){g.style.display='none';g.removeAttribute('data-solo')});allB.forEach(function(b){b.style.opacity='0.35'});if(target){target.style.display='';target.setAttribute('data-solo','1')}var ab=chart.querySelector('.geo-lb[data-sid="'+sid+'"]');if(ab)ab.style.opacity='1'}}
</script>`;
}

function renderTimeNav(days: number, view: string, client: string = "virum"): string {
  const presets = [
    { d: 7, label: "7D" },
    { d: 14, label: "14D" },
    { d: 30, label: "30D" },
    { d: 90, label: "90D" },
  ];
  const clientParam = client !== "virum" ? `&client=${encodeURIComponent(client)}` : "";
  const viewParam = view !== "ops" ? `&view=${view}` : "";
  return `<div class="time-nav">${presets.map(p =>
    `<a href="?days=${p.d}${clientParam}${viewParam}" class="time-pill${p.d === days ? " active" : ""}">${p.label}</a>`
  ).join("")}</div>`;
}

function renderHeader(config: ClientConfig, generatedAt: string, days: number, client: string = "virum"): string {
  return `<div class="header">
<div>
  <h1>GEO Effect Dashboard</h1>
  <div class="subtitle">${escHtml(config.domain)} — GEO active since ${escHtml(config.activeSince)}</div>
</div>
<div class="header-right">
  <div><span class="live-dot"></span>Live Data</div>
  <div class="timestamp">Generated: ${escHtml(generatedAt)}</div>
</div>
</div>
${renderTimeNav(days, "ops", client)}`;
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
<div style="margin-top:8px;font-size:12px;color:#94a3b8;line-height:1.4">${insight}</div>
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

  return `<div class="section">
<h2>1. Bot Traffic Overview</h2>
<div class="grid grid-4" style="margin-bottom:20px">
  ${renderStatCard(fmt(total), "Total Requests", `${fmt(aiTotal)} AI · ${fmt(seoTotal)} SEO · ${fmt(visitorTotal)} visitors`)}
  ${renderStatCard(fmt(aiTotal), "AI Retrieval Bots", "ChatGPT, Perplexity, Claude…")}
  ${renderStatCard(fmt(seoTotal), "SEO Crawlers", "Googlebot, Bingbot…")}
  ${renderStatCard(fmt(visitorTotal), "Visitors Served", "Transparent passthrough — zero friction")}
</div>
<div class="grid grid-2">
  <div class="card">
    <h3>Traffic Distribution</h3>
    <div class="pie-container">
      <div class="pie-chart">${svgPieChart(pieData)}</div>
      <div class="pie-legend">
        ${pieData.map((d) => `<div class="legend-item"><div class="legend-dot" style="background:${d.color}"></div>${escHtml(d.label)}: ${fmt(d.value)}</div>`).join("")}
        <div style="font-size:11px;color:#475569;margin-top:8px;line-height:1.4">Bot traffic only — ${fmt(visitorTotal)} human visitors served transparently via the same proxy.</div>
      </div>
    </div>
  </div>
  <div class="card">
    <h3>Bot Detail</h3>
    ${botTable}
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
    { label: "GEO Injected", value: injected, color: "#10b981" },
    { label: "Passthrough (no match)", value: passthrough, color: "#f59e0b" },
    { label: "Non-HTML (assets)", value: nonHtml, color: "#3b82f6" },
    { label: "Skipped (non-2xx)", value: skipped, color: "#ef4444" },
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
<h2>2. GEO Injection Stats</h2>
<div class="grid grid-4" style="margin-bottom:20px">
  ${renderStatCard(`${rate}%`, "Injection Rate", "HTML pages with GEO schema")}
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
        return `<div class="status-row">
          <span>${s.label}</span>
          <span style="display:flex;align-items:center;gap:8px">
            <span style="width:120px"><div class="bar"><div class="bar-fill" style="width:${pct}%;background:${s.color}"></div></div></span>
            <span style="min-width:60px;text-align:right">${fmt(s.value)}</span>
          </span>
        </div>`;
      })
      .join("")}
  </div>
  <div class="card">
    <h3>Top GEO Pages (AI Bot Visits)</h3>
    ${topPagesTable}
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
<h2>3. AI Search Visibility</h2>
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
    competitorsHtml = `<table>
<thead><tr><th>#</th><th>Competitor</th><th>Mentioned</th><th>Cited</th></tr></thead>
<tbody>${prompts.competitors.map((c, i) => `<tr><td>${i + 1}</td><td>${escHtml(c.name)}</td><td>${c.mentioned}</td><td>${c.cited}</td></tr>`).join("")}</tbody></table>`;
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
  let myUrlsHtml = `<div class="empty">No domain citations found</div>`;
  if (citations && citations.myUrls.length > 0) {
    myUrlsHtml = `<table>
<thead><tr><th>URL</th><th>Engine</th><th>Pos</th><th>Prompt</th><th>Date</th></tr></thead>
<tbody>${citations.myUrls
      .map(
        (u) =>
          `<tr><td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.url)}</td><td style="text-transform:capitalize">${escHtml(u.engine)}</td><td>#${u.position}</td><td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(u.prompt)}</td><td>${escHtml(u.date)}</td></tr>`
      )
      .join("")}</tbody></table>`;
  }

  // ── Top cited domains bar chart ──
  let topDomainsHtml = "";
  if (citations && citations.topDomains.length > 0) {
    const maxCit = citations.topDomains[0].citations;
    topDomainsHtml = `<div class="card" style="margin-top:20px">
  <h3>Top Cited Domains</h3>
  ${citations.topDomains
    .slice(0, 10)
    .map((d) => {
      const pct = maxCit > 0 ? (d.citations / maxCit) * 100 : 0;
      const isMine = d.domain.includes("virumakupunktur");
      return `<div class="status-row">
        <span${isMine ? ` style="color:#10b981;font-weight:600"` : ""}>${escHtml(d.domain)}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <span style="width:120px"><div class="bar"><div class="bar-fill" style="width:${pct}%;background:${isMine ? "#10b981" : "#3b82f6"}"></div></div></span>
          <span style="min-width:40px;text-align:right">${d.citations}</span>
        </span>
      </div>`;
    })
    .join("")}
</div>`;
  }

  return `<div class="section">
<h2>3. AI Search Visibility <span class="badge badge-amber" style="font-size:11px;vertical-align:middle">OtterlyAI</span></h2>
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
<div class="card" style="margin-top:20px">
  <h3>My Domain Citations</h3>
  ${myUrlsHtml}
</div>
${topDomainsHtml}
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
<h2>4. Baseline Comparison</h2>
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
<h2>5. GEO Coverage Gaps <span class="badge badge-red" style="font-size:11px;vertical-align:middle">Action needed</span></h2>
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
  "ChatGPT-User": "#10b981",
  "PerplexityBot": "#8b5cf6",
  "ClaudeBot": "#f59e0b",
  "OAI-SearchBot": "#3b82f6",
  "GPTBot": "#6366f1",
};
const AI_BOT_DEFAULT_COLOR = "#64748b";

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
  <div style="font-size:12px;color:#64748b;margin-bottom:8px">Each bar shows which AI assistants visited your site that day</div>
  ${chartDays.length > 0 ? svgStackedBarChart(chartDays, activationIdx) : '<div class="empty">Data will appear once AI bots start visiting</div>'}
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
  <div style="font-size:12px;color:#64748b;margin-bottom:12px">AI visibility ranking in your market</div>
  <div class="status-row" style="border-bottom:2px solid #334155">
    <span style="color:#10b981;font-weight:600">Your Business</span>
    <span style="display:flex;align-items:center;gap:8px">
      <span style="width:160px"><div class="bar"><div class="bar-fill" style="width:${prompts ? ((prompts.brandMentioned + prompts.domainCited) / maxMentions) * 100 : 0}%;background:#10b981"></div></div></span>
      <span style="min-width:80px;text-align:right;color:#10b981">${prompts ? prompts.brandMentioned + prompts.domainCited : 0} mentions</span>
    </span>
  </div>
  ${topN.map((c) => {
    const total = c.mentioned + c.cited;
    const pct = (total / maxMentions) * 100;
    return `<div class="status-row">
      <span>${escHtml(c.name)}</span>
      <span style="display:flex;align-items:center;gap:8px">
        <span style="width:160px"><div class="bar"><div class="bar-fill" style="width:${pct}%;background:#3b82f6"></div></div></span>
        <span style="min-width:80px;text-align:right">${total} mentions</span>
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

function renderClientHeader(config: ClientConfig, generatedAt: string, days: number, client: string = "virum"): string {
  return `<div class="header">
<div>
  <h1 style="font-size:24px">Your AI Search Performance</h1>
  <div class="subtitle">${escHtml(config.domain)} — GEO active since ${escHtml(config.activeSince)}</div>
</div>
<div class="header-right">
  <div><span class="live-dot"></span>Live Data</div>
  <div class="timestamp">Updated: ${escHtml(generatedAt)}</div>
</div>
</div>
${renderTimeNav(days, "client", client)}`;
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

async function checkAuth(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  const view = url.searchParams.get("view") || "ops";
  const client = url.searchParams.get("client") || "virum";
  const urlToken = url.searchParams.get("token");
  const opsToken = env.DASHBOARD_TOKEN;

  // Ops token: Bearer header or ops cookie → full access
  const cookieOps = getCookie(request, "dashboard_token");
  if (opsToken && (request.headers.get("Authorization") === `Bearer ${opsToken}` || cookieOps === opsToken)) {
    return null;
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
      if (cookieClient === clientToken) return null;

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
interface AlignmentScore { total: number; grade: AlignmentScoreGrade; breakdown: { coverage: number; consistency: number; signals: number; }; }
interface AlignmentPlatform { id: string; name_da: string; icon: string; status: string; statusText_da: string; issues: string[]; actionUrl: string | null; actionText_da: string | null; }
interface AlignmentAction { priority: number; action_da: string; timeEstimate_da: string; impactText_da: string; url: string; }
interface AlignmentReport { clientId: string; generatedAt: string; runType: string; client: { name: string; domain: string }; score: AlignmentScore; platforms: AlignmentPlatform[]; inconsistencies: { platform: string; field: string; match: string; diffDescription: string; }[]; prioritizedActions: AlignmentAction[]; sameAsUpdated: string[]; }
interface ScoreHistoryEntry { date: string; total: number; coverage: number; consistency: number; signals: number; }
interface ScoreHistory { clientId: string; history: ScoreHistoryEntry[]; }

async function loadAlignmentReport(env: Env, client: string): Promise<AlignmentReport | null> {
  const raw = await env.DASHBOARD_KV.get(`alignment:${client}:latest`, "text");
  if (!raw) return null;
  try { return JSON.parse(raw) as AlignmentReport; } catch { return null; }
}

async function loadScoreHistory(env: Env, client: string): Promise<ScoreHistory | null> {
  const raw = await env.DASHBOARD_KV.get(`alignment:${client}:history`, "text");
  if (!raw) return null;
  try { return JSON.parse(raw) as ScoreHistory; } catch { return null; }
}

function renderGeoHealthScoreCard(report: AlignmentReport | null): string {
  if (!report) {
    return `<div class="card" style="text-align:center;padding:20px 24px;margin-bottom:24px">
  <div style="font-size:14px;color:#64748b">GEO Health Score — checking platforms soon</div>
</div>`;
  }
  const { total, grade, breakdown } = report.score;
  const coveragePct  = (breakdown.coverage / 40) * 100;
  const consistPct   = (breakdown.consistency / 40) * 100;
  const signalsPct   = (breakdown.signals / 20) * 100;
  return `<div class="card" style="display:flex;align-items:center;gap:32px;padding:20px 28px;margin-bottom:24px;flex-wrap:wrap">
  <div style="text-align:center;min-width:80px">
    <div style="font-size:56px;font-weight:900;color:${escHtml(grade.color)};line-height:1">${escHtml(String(grade.grade))}</div>
    <div style="font-size:22px;font-weight:700;color:#f8fafc">${total}</div>
    <div style="font-size:12px;color:#94a3b8">${escHtml(grade.label_da)}</div>
  </div>
  <div style="flex:1;min-width:200px">
    <div style="font-size:13px;font-weight:600;color:#cbd5e1;margin-bottom:10px">GEO Health Score</div>
    <div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:3px"><span>Platformdækning</span><span>${breakdown.coverage}/40</span></div>
      <div style="background:#1e293b;border-radius:4px;height:6px"><div style="background:#3b82f6;border-radius:4px;height:6px;width:${coveragePct.toFixed(0)}%"></div></div>
    </div>
    <div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:3px"><span>NAP-konsistens</span><span>${breakdown.consistency}/40</span></div>
      <div style="background:#1e293b;border-radius:4px;height:6px"><div style="background:#8b5cf6;border-radius:4px;height:6px;width:${consistPct.toFixed(0)}%"></div></div>
    </div>
    <div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#64748b;margin-bottom:3px"><span>Signalkvalitet</span><span>${breakdown.signals}/20</span></div>
      <div style="background:#1e293b;border-radius:4px;height:6px"><div style="background:#f59e0b;border-radius:4px;height:6px;width:${signalsPct.toFixed(0)}%"></div></div>
    </div>
  </div>
  <div style="font-size:11px;color:#475569;align-self:flex-end">${escHtml(report.runType)} · ${escHtml(report.generatedAt.slice(0, 10))}</div>
</div>`;
}

function renderBlock6(report: AlignmentReport | null, history: ScoreHistory | null): string {
  if (!report) {
    return `<div class="section"><h2>6. Platform Alignment</h2><div class="card"><div class="empty">No alignment data yet — run <code>pnpm tsx scripts/alignment/run.ts virum</code> to check</div></div></div>`;
  }

  const statusColor: Record<string, string> = { ok: '#10b981', warning: '#f59e0b', missing: '#ef4444', error: '#ef4444', unable_to_check: '#64748b' };

  const platformRows = report.platforms.map(p => {
    const color = statusColor[p.status] ?? '#64748b';
    const issueHtml = p.issues.length ? `<ul style="margin:4px 0 0 16px;font-size:12px;color:#f59e0b">${p.issues.map(i => `<li>${escHtml(i)}</li>`).join('')}</ul>` : '';
    const actionHtml = p.actionUrl ? `<a href="${escHtml(p.actionUrl)}" style="font-size:12px;color:#3b82f6;white-space:nowrap">${escHtml(p.actionText_da ?? 'Open →')}</a>` : '';
    return `<tr>
      <td style="font-size:18px;width:36px">${escHtml(p.icon)}</td>
      <td style="font-weight:500">${escHtml(p.name_da)}</td>
      <td><span style="color:${color};font-size:13px">${escHtml(p.statusText_da)}</span>${issueHtml}</td>
      <td style="text-align:right">${actionHtml}</td>
    </tr>`;
  }).join('');

  const napRows = report.inconsistencies.filter(c => c.match === 'major_diff' || c.match === 'minor_diff').map(c =>
    `<tr><td>${escHtml(c.field)}</td><td>${escHtml(c.platform)}</td><td style="color:#ea580c;font-size:13px">${escHtml(c.diffDescription)}</td></tr>`
  ).join('');

  const actionRows = report.prioritizedActions.slice(0, 5).map(a =>
    `<tr><td><span class="badge badge-blue">${a.priority}</span></td><td>${escHtml(a.action_da)}</td><td style="color:#64748b;font-size:12px">${escHtml(a.timeEstimate_da)}</td><td style="font-size:12px;color:#94a3b8">${escHtml(a.impactText_da)}</td></tr>`
  ).join('');

  // History trend
  let historyHtml = '';
  if (history && history.history.length > 1) {
    const pts = history.history.slice(-10);
    const xLabels = pts.map(p => p.date.slice(5));
    const series = [{ label: 'Total', color: '#3b82f6', points: pts.map((p, i) => ({ x: i, y: p.total })) }];
    historyHtml = `<div class="card" style="margin-top:20px"><h3>Score History</h3>${svgLineChart(series, xLabels, 600, 180)}</div>`;
  }

  const sameAsHtml = report.sameAsUpdated.length
    ? `<div style="margin-top:12px;font-size:12px;color:#64748b">sameAs synced: ${report.sameAsUpdated.map(u => `<a href="${escHtml(u)}" style="color:#475569">${escHtml(new URL(u).hostname)}</a>`).join(' · ')}</div>`
    : '';

  return `<div class="section">
<h2>6. Platform Alignment</h2>
<div class="card" style="margin-bottom:20px">
  <table><thead><tr><th></th><th>Platform</th><th>Status</th><th></th></tr></thead><tbody>${platformRows}</tbody></table>
</div>
${napRows ? `<div class="card" style="margin-bottom:20px"><h3>NAP Inconsistencies</h3><table><thead><tr><th>Field</th><th>Platform</th><th>Problem (DA)</th></tr></thead><tbody>${napRows}</tbody></table></div>` : ''}
${actionRows ? `<div class="card" style="margin-bottom:20px"><h3>Prioritized Actions</h3><table><thead><tr><th>#</th><th>Action</th><th>Time</th><th>Impact</th></tr></thead><tbody>${actionRows}</tbody></table></div>` : ''}
${historyHtml}${sameAsHtml}
</div>`;
}

function renderClientLayer3(report: AlignmentReport | null, dnsReadyAt: string | null): string {
  const dnsStatus = dnsReadyAt
    ? `<div style="font-size:13px;color:#10b981;margin-bottom:16px">✅ GEO Layer aktiv siden ${escHtml(dnsReadyAt.slice(0, 10))}</div>`
    : `<div style="font-size:13px;color:#94a3b8;margin-bottom:16px">⏳ Afventer DNS-opsætning (typisk 24-48t)</div>`;

  if (!report) {
    return `<div class="section">
<div class="layer-label">Layer 3 — Platformtilpasning</div>
${dnsStatus}
<div class="card"><div class="empty"><p style="font-size:15px;margin-bottom:6px">Din første alignment-rapport er på vej</p><p style="font-size:13px;color:#64748b">Vi tjekker dine platforme inden for 24 timer efter aktivering.</p></div></div>
</div>`;
  }

  const { total, grade } = report.score;
  const statusIcon: Record<string, string> = { ok: '✅', warning: '⚠️', missing: '❌', unable_to_check: '—', error: '⚠️' };

  const platformList = report.platforms.map(p =>
    `<div class="status-row"><span>${escHtml(p.icon)} ${escHtml(p.name_da)}</span><span style="font-size:13px;color:${p.status === 'ok' ? '#10b981' : p.status === 'missing' ? '#ef4444' : '#f59e0b'}">${statusIcon[p.status] ?? '—'} ${escHtml(p.statusText_da)}</span></div>`
  ).join('');

  const topActions = report.prioritizedActions.slice(0, 3).map((a, i) =>
    `<div style="background:#0f172a;border-radius:8px;padding:14px 16px;margin-bottom:8px">
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px">
        <span style="background:#3b82f6;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:10px">${i + 1}</span>
        <span style="font-size:14px;font-weight:600;color:#f8fafc">${escHtml(a.action_da)}</span>
      </div>
      <div style="font-size:12px;color:#64748b;padding-left:32px">${escHtml(a.timeEstimate_da)} · ${escHtml(a.impactText_da)}</div>
      ${a.url ? `<div style="padding-left:32px;margin-top:4px"><a href="${escHtml(a.url)}" style="font-size:12px;color:#3b82f6">Gå til platform →</a></div>` : ''}
    </div>`
  ).join('');

  return `<div class="section">
<div class="layer-label">Layer 3 — Platformtilpasning</div>
${dnsStatus}
<div class="insight-banner">
  <h3 style="color:${escHtml(grade.color)}">${escHtml(String(grade.grade))} — ${total}/100 · ${escHtml(grade.label_da)}</h3>
  <p>Vi har tjekket dine oplysninger på ${report.platforms.length} platforme. Herunder ser du status og hvad du kan gøre for at forbedre din AI-synlighed.</p>
</div>
<div class="card" style="margin-bottom:20px"><h3>Platformstatus</h3>${platformList}</div>
${topActions ? `<h2 style="font-size:16px;color:#f8fafc;margin:0 0 12px">Anbefalede handlinger</h2>${topActions}` : ''}
<div style="font-size:11px;color:#475569;margin-top:12px">Rapport genereret ${escHtml(report.generatedAt.slice(0, 10))} · Næste check om 2 uger</div>
</div>`;
}

// ── Main Worker ──

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Favicon
    if (path === "/favicon.ico") {
      return new Response(null, { status: 204 });
    }

    // Auth check (skip for health endpoint)
    if (path !== "/health") {
      const authResponse = await checkAuth(request, env);
      if (authResponse) return authResponse;
    }

    // Health check
    if (path === "/health") {
      return new Response("ok");
    }

    // API: Receive alignment report from script
    if (path.match(/^\/api\/alignment\/[^/]+$/) && request.method === "POST") {
      const clientId = path.split("/")[3];
      const body = await request.text();
      if (!body) return new Response(JSON.stringify({ error: "Empty body" }), { status: 400, headers: { "Content-Type": "application/json" } });
      try {
        const report = JSON.parse(body) as AlignmentReport;
        await env.DASHBOARD_KV.put(`alignment:${clientId}:latest`, body);
        // Append to history
        const histRaw = await env.DASHBOARD_KV.get(`alignment:${clientId}:history`, "text");
        const hist: ScoreHistory = histRaw ? JSON.parse(histRaw) : { clientId, history: [] };
        hist.history.push({ date: report.generatedAt.slice(0, 10), total: report.score.total, coverage: report.score.breakdown.coverage, consistency: report.score.breakdown.consistency, signals: report.score.breakdown.signals });
        if (hist.history.length > 50) hist.history = hist.history.slice(-50);
        await env.DASHBOARD_KV.put(`alignment:${clientId}:history`, JSON.stringify(hist));
        return new Response(JSON.stringify({ ok: true, score: report.score.total, grade: report.score.grade.grade }), { headers: { "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ error: "Invalid JSON", detail: String(e) }), { status: 400, headers: { "Content-Type": "application/json" } });
      }
    }

    // API: Get latest alignment report
    if (path.match(/^\/api\/alignment\/[^/]+$/) && request.method === "GET") {
      const clientId = path.split("/")[3];
      const [reportRaw, histRaw] = await Promise.all([
        env.DASHBOARD_KV.get(`alignment:${clientId}:latest`, "text"),
        env.DASHBOARD_KV.get(`alignment:${clientId}:history`, "text"),
      ]);
      if (!reportRaw) return new Response(JSON.stringify({ error: "No alignment data" }), { status: 404, headers: { "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ report: JSON.parse(reportRaw), history: histRaw ? JSON.parse(histRaw) : null }), { headers: { "Content-Type": "application/json" } });
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
      const [funnel, results, alignReport, dnsReadyAt] = await Promise.all([
        renderClientFunnel(env, days, config),
        renderClientResults(env, client),
        loadAlignmentReport(env, client),
        env.DASHBOARD_KV.get(`dns_ready_at:${client}`, "text"),
      ]);

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
<div class="container">
${renderClientHeader(config, generatedAt, days, client)}
${renderGeoHealthScoreCard(alignReport)}
${funnel}
${results}
${renderClientLayer3(alignReport, dnsReadyAt)}
<div style="text-align:center;padding:24px 0;color:#475569;font-size:12px">
  Powered by GEO Reforge
</div>
</div>
</body>
</html>`;

      return new Response(html, {
        headers: {
          "Content-Type": "text/html;charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    // Ops view: all blocks
    const [block1, block2, block3, block4, block5, alignReportOps, alignHistoryOps] = await Promise.all([
      renderBlock1(env, days, config),
      renderBlock2(env, days),
      renderBlock3(env, client),
      renderBlock4(env, client),
      renderBlock5(env, days),
      loadAlignmentReport(env, client),
      loadScoreHistory(env, client),
    ]);

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
<div class="container">
${renderHeader(config, generatedAt, days, client)}
${renderGeoHealthScoreCard(alignReportOps)}
${block1}
${block2}
${block3}
${block4}
${block5}
${renderBlock6(alignReportOps, alignHistoryOps)}
<div style="text-align:center;padding:24px 0;color:#475569;font-size:12px">
  GEO Reforge Edge Proxy — Dashboard v2.1
</div>
</div>
</body>
</html>`;

    return new Response(html, {
      headers: {
        "Content-Type": "text/html;charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
