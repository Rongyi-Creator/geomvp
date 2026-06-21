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
  height = 200
): string {
  const pad = { top: 20, right: 20, bottom: 30, left: 50 };
  const w = width - pad.left - pad.right;
  const h = height - pad.top - pad.bottom;

  let maxY = 0;
  for (const s of series) {
    for (const p of s.points) {
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (maxY === 0) maxY = 1;

  let svg = `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:${width}px">`;
  svg += `<rect width="${width}" height="${height}" fill="#0f172a" rx="8"/>`;

  // Grid lines
  for (let i = 0; i <= 4; i++) {
    const y = pad.top + (h * i) / 4;
    const val = Math.round(maxY * (1 - i / 4));
    svg += `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#1e293b" stroke-width="1"/>`;
    svg += `<text x="${pad.left - 8}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${val}</text>`;
  }

  // X labels
  const step = xLabels.length > 1 ? w / (xLabels.length - 1) : 0;
  for (let i = 0; i < xLabels.length; i++) {
    const x = pad.left + step * i;
    svg += `<text x="${x}" y="${height - 5}" text-anchor="middle" fill="#64748b" font-size="9">${xLabels[i]}</text>`;
  }

  // Lines
  for (const s of series) {
    if (s.points.length === 0) continue;
    const pts = s.points
      .map((p) => {
        const x = pad.left + (p.x / Math.max(xLabels.length - 1, 1)) * w;
        const y = pad.top + h - (p.y / maxY) * h;
        return `${x},${y}`;
      })
      .join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round"/>`;
    for (const p of s.points) {
      const x = pad.left + (p.x / Math.max(xLabels.length - 1, 1)) * w;
      const y = pad.top + h - (p.y / maxY) * h;
      svg += `<circle cx="${x}" cy="${y}" r="3" fill="${s.color}"/>`;
    }
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
.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px}
.header-right{text-align:right}
.live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#10b981;margin-right:6px}
.timestamp{font-size:12px;color:#64748b}
@media(max-width:768px){.grid-2,.grid-3,.grid-4{grid-template-columns:1fr}.pie-container{flex-direction:column}}
</style>`;
}

function renderHeader(client: string, generatedAt: string): string {
  return `<div class="header">
<div>
  <h1>GEO Effect Dashboard</h1>
  <div class="subtitle">${escHtml(client)} — Edge Proxy Analytics</div>
</div>
<div class="header-right">
  <div><span class="live-dot"></span>Live Data</div>
  <div class="timestamp">Generated: ${escHtml(generatedAt)}</div>
</div>
</div>`;
}

function renderStatCard(value: string, label: string, sub?: string): string {
  return `<div class="card">
<div class="stat-value">${value}</div>
<div class="stat-label">${label}</div>
${sub ? `<div class="stat-sub">${sub}</div>` : ""}
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

async function renderBlock1(env: Env, days: number): Promise<string> {
  const ds = env.AE_DATASET;
  const [categoryRows, botRows, trendRows, totalRows] = await Promise.all([
    queryAE(env, queryCategoryBreakdown(ds, days)),
    queryAE(env, queryBotDetails(ds, days)),
    queryAE(env, queryDailyTrend(ds, days)),
    queryAE(env, queryTotalRequests(ds, days)),
  ]);

  const total = totalRows.length > 0 ? Number(totalRows[0].total) || 0 : 0;
  const aiTotal = categoryRows
    .filter((r) => r.category === "ai_retrieval")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);
  const seoTotal = categoryRows
    .filter((r) => r.category === "seo_crawler")
    .reduce((s, r) => s + (Number(r.visits) || 0), 0);

  // Pie chart data
  const pieData = categoryRows.map((r) => ({
    label: LABELS[r.category as string] ?? String(r.category),
    value: Number(r.visits) || 0,
    color: COLORS[r.category as string] ?? "#6b7280",
  }));

  // Daily trend → line chart
  const dayMap = new Map<string, Record<string, number>>();
  for (const r of trendRows) {
    const day = String(r.day).slice(0, 10);
    if (!dayMap.has(day)) dayMap.set(day, {});
    const m = dayMap.get(day)!;
    m[r.category as string] = (m[r.category as string] || 0) + (Number(r.visits) || 0);
  }
  const sortedDays = [...dayMap.keys()].sort();
  const xLabels = sortedDays.map((d) => d.slice(5));
  const lineSeries = ["ai_retrieval", "seo_crawler"].map((cat) => ({
    label: LABELS[cat],
    color: COLORS[cat],
    points: sortedDays.map((d, i) => ({ x: i, y: dayMap.get(d)?.[cat] || 0 })),
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
<div class="grid grid-3" style="margin-bottom:20px">
  ${renderStatCard(fmt(total), "Total Requests", `Last ${days} days`)}
  ${renderStatCard(fmt(aiTotal), "AI Retrieval Bots", "ChatGPT, Perplexity, Claude…")}
  ${renderStatCard(fmt(seoTotal), "SEO Crawlers", "Googlebot, Bingbot…")}
</div>
<div class="grid grid-2">
  <div class="card">
    <h3>Traffic Distribution</h3>
    <div class="pie-container">
      <div class="pie-chart">${svgPieChart(pieData)}</div>
      <div class="pie-legend">
        ${pieData.map((d) => `<div class="legend-item"><div class="legend-dot" style="background:${d.color}"></div>${escHtml(d.label)}: ${fmt(d.value)}</div>`).join("")}
      </div>
    </div>
  </div>
  <div class="card">
    <h3>Bot Detail</h3>
    ${botTable}
  </div>
</div>
<div class="card" style="margin-top:20px">
  <h3>Daily Trend (AI Retrieval + SEO)</h3>
  ${sortedDays.length > 0 ? svgLineChart(lineSeries, xLabels) : `<div class="empty">No trend data yet — data appears after DNS switch</div>`}
</div>
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

async function renderBlock3(env: Env, client: string): Promise<string> {
  const [promptsRaw, citationsRaw] = await Promise.all([
    env.DASHBOARD_KV.get(`otterly_prompts:${client}`, "text"),
    env.DASHBOARD_KV.get(`otterly_citations:${client}`, "text"),
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
  if (promptsRaw) try { prompts = JSON.parse(promptsRaw); } catch { /* invalid */ }
  if (citationsRaw) try { citations = JSON.parse(citationsRaw); } catch { /* invalid */ }

  const updatedAt = prompts?.updatedAt || citations?.updatedAt || "";

  // ── Stat cards ──
  let statsHtml = `<div class="grid grid-4" style="margin-bottom:20px">`;
  if (prompts) {
    statsHtml += renderStatCard(`${prompts.brandMentioned}/${prompts.total}`, "Brand Mentioned", "Prompts mentioning brand");
    statsHtml += renderStatCard(`${prompts.domainCited}/${prompts.total}`, "Domain Cited", "Prompts citing domain");
  }
  if (citations) {
    statsHtml += renderStatCard(fmt(citations.total), "Total Citations", "All AI citations tracked");
    const share = citations.total > 0 ? ((citations.myDomainCitations / citations.total) * 100).toFixed(1) : "0";
    statsHtml += renderStatCard(fmt(citations.myDomainCitations), "My Citations", `${share}% share`);
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
<div class="timestamp" style="margin-bottom:16px">Last updated: ${escHtml(updatedAt)}</div>
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

async function renderBlock4(env: Env): Promise<string> {
  const raw = await env.DASHBOARD_KV.get("baseline:virum", "text");

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

function checkAuth(request: Request, env: Env): Response | null {
  const token = env.DASHBOARD_TOKEN;
  if (!token) return null;

  const auth = request.headers.get("Authorization");
  const cookieToken = getCookie(request, "dashboard_token");
  const urlToken = new URL(request.url).searchParams.get("token");

  if (auth === `Bearer ${token}` || cookieToken === token) {
    return null;
  }

  if (urlToken === token) {
    const cleanUrl = new URL(request.url);
    cleanUrl.searchParams.delete("token");
    return new Response(null, {
      status: 302,
      headers: {
        Location: cleanUrl.pathname + cleanUrl.search,
        "Set-Cookie": `dashboard_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000`,
      },
    });
  }

  return new Response(renderLoginPage(), {
    status: 401,
    headers: { "Content-Type": "text/html;charset=utf-8" },
  });
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
      const authResponse = checkAuth(request, env);
      if (authResponse) return authResponse;
    }

    // Health check
    if (path === "/health") {
      return new Response("ok");
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

    // API: Stats JSON (for future frontend)
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

    // Dashboard HTML
    const days = parseInt(url.searchParams.get("days") || "7");
    const client = "virum";
    const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

    const [block1, block2, block3, block4, block5] = await Promise.all([
      renderBlock1(env, days),
      renderBlock2(env, days),
      renderBlock3(env, client),
      renderBlock4(env),
      renderBlock5(env, days),
    ]);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>GEO Dashboard — ${escHtml(client)}</title>
${renderStyles()}
</head>
<body>
<div class="container">
${renderHeader(client, generatedAt)}
${block1}
${block2}
${block3}
${block4}
${block5}
<div style="text-align:center;padding:24px 0;color:#475569;font-size:12px">
  GEO Reforge Edge Proxy — Dashboard v1.0
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
