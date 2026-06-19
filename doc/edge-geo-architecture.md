# GEO Reforge — Edge Proxy 产品架构 & 技术方案

> 版本: 2026-06-19 draft
> 状态: 待可行性验证
> 前置调研: [Gemini Deep Research](./‎Google%20Gemini%2015.md)

---

## 1. 产品定位（一句话）

客户不改网站、不换主机、不碰代码——只改 DNS，就能让 AI 搜索引擎（ChatGPT、Perplexity、Google AI Overview）"看懂"并主动引用他们的网站。

---

## 2. 与当前克隆管道的关系

| | Clone Pipeline（现有） | Edge Pipeline（新增） |
|---|---|---|
| **原理** | Playwright 克隆原站 HTML → 离线注入 GEO → 部署静态副本 | Cloudflare Worker 实时代理原站 → 边缘飞行注入 GEO |
| **视觉保真度** | ~95%（按钮/字体/布局存在偏差） | **100%**（就是原站，无克隆动作） |
| **动态功能** | 丢失（预约表单、登录等全部失效） | **完整保留**（代理透传所有请求） |
| **新角色** | 降级为"数据提取 + 签约前演示" | **生产部署方案** |
| **共用模块** | `02-extract-geo.ts`（提取 business/services/FAQ） | 同左 |

---

## 3. 端到端流程

```
┌──────────────────────────────────────────────────────────────────┐
│ PHASE 1: 数据提取（沿用现有管道，一次性）                            │
│                                                                  │
│   输入: 客户 URL                                                  │
│     │                                                            │
│     ▼                                                            │
│   [01-clone-site.ts]  Playwright 渲染全站 → raw HTML              │
│     │                                                            │
│     ▼                                                            │
│   [02-extract-geo.ts] Claude API 提取结构化数据                    │
│     │                                                            │
│     ├──→ business.json   (商家名称/地址/坐标/营业时间)              │
│     ├──→ services.json   (32 项服务名称 + 描述)                    │
│     ├──→ faq.json        (5 条 Q&A)                              │
│     └──→ pages-meta.json (38 页的 meta title/description/type)   │
│                                                                  │
│   成本: Claude API ~$0.30-0.50 / 站                               │
│   耗时: ~5 分钟                                                   │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ PHASE 2: Worker 生成（新增，一次性）                                │
│                                                                  │
│   输入: Phase 1 的 JSON 数据                                      │
│     │                                                            │
│     ▼                                                            │
│   [generate-worker.ts]  生成该客户专属的 Cloudflare Worker 代码     │
│     │                                                            │
│     ├──→ worker.js          (HTMLRewriter 注入逻辑)               │
│     ├──→ wrangler.toml      (Worker 部署配置)                     │
│     ├──→ geo-data.json      (合并后的 GEO 数据，绑定为 KV 或内嵌)   │
│     └──→ robots.txt         (允许检索 bot，阻止训练 bot)           │
│                                                                  │
│   成本: $0（本地生成）                                              │
│   耗时: < 1 分钟                                                  │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ PHASE 3: 部署 + DNS 切换                                          │
│                                                                  │
│   3a. wrangler deploy → Worker 上线到 Cloudflare 边缘              │
│   3b. 客户 DNS 操作（二选一）:                                      │
│       ├── 方式 A: 将 nameserver 切到 Cloudflare（完整代理）          │
│       └── 方式 B: 添加 CNAME 记录指向 Worker 自定义域名              │
│   3c. SSL 证书自动签发（Cloudflare 管理）                           │
│   3d. 启用 Markdown for Agents（Cloudflare Dashboard 开关）        │
│                                                                  │
│   成本: Cloudflare Workers Free Tier = 10万请求/天（足够）           │
│         或 Workers Paid = $5/月 (1000万请求)                       │
│   耗时: DNS 生效 ~5 分钟至 48 小时                                  │
└──────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────────────┐
│ PHASE 4: 运行时（持续，每次请求）                                    │
│                                                                  │
│   浏览器/AI爬虫 → Cloudflare Edge → Worker 拦截                    │
│     │                                                            │
│     ├── 请求 /robots.txt → 返回动态生成的 robots.txt               │
│     ├── 请求 /sitemap.xml → 返回动态生成的 sitemap                 │
│     ├── Accept: text/markdown → Markdown for Agents 自动转换       │
│     └── 其他请求:                                                  │
│           │                                                       │
│           ▼                                                       │
│         fetch(原站 origin) → 拿到原始 HTML                         │
│           │                                                       │
│           ▼                                                       │
│         HTMLRewriter 流式处理:                                     │
│           ├── <html>     → 设置 lang="da"                         │
│           ├── <head>     → 注入 JSON-LD (LocalBusiness)           │
│           ├── <head>     → 注入/覆盖 meta title, description      │
│           ├── <head>     → 注入/覆盖 canonical, OG tags           │
│           ├── <head>     → 按页面类型注入 Service/FAQPage schema   │
│           ├── <footer>前 → 注入可见 FAQ 区块 (仅首页, 可选)         │
│           └── 透传其余内容（含 JS、表单、动态功能）                   │
│           │                                                       │
│           ▼                                                       │
│         返回增强后的 HTML（对所有访客一致，无 cloaking）              │
│                                                                  │
│   延迟增加: < 30ms（V8 isolate, 流式处理, 无需缓冲完整文档）         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Cloudflare Worker 技术细节

### 4.1 HTMLRewriter 注入点

```
                    原始 HTML 响应流
                         │
    ┌────────────────────┼────────────────────┐
    │ <html>             │                    │
    │   <head>           │ ← 注入区域 A       │
    │     <title>        │ ← 覆盖             │
    │     <meta>         │ ← 覆盖/新增        │
    │     <link canonical>← 覆盖              │
    │     ← JSON-LD LocalBusiness (每页)      │
    │     ← JSON-LD Service (服务页)          │
    │     ← JSON-LD FAQPage (FAQ 页)          │
    │     ← OG tags                           │
    │   </head>          │                    │
    │   <body>           │                    │
    │     ...原站内容...  │ ← 完全不动          │
    │     ← FAQ 可见区块  │ ← 注入区域 B (可选) │
    │     <footer>       │                    │
    │   </body>          │                    │
    │ </html>            │                    │
    └─────────────────────────────────────────┘
```

### 4.2 Worker 伪代码结构

```typescript
// worker.ts — Cloudflare Worker 核心逻辑
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── 静态路由: 拦截特殊路径 ──
    if (url.pathname === '/robots.txt') return serveRobotsTxt(env);
    if (url.pathname === '/sitemap.xml') return serveSitemap(env);

    // ── 代理原站 ──
    const originUrl = new URL(url.pathname + url.search, env.ORIGIN_HOST);
    const originResponse = await fetch(originUrl, {
      headers: request.headers,
      method: request.method,
      body: request.body,
    });

    // 非 HTML 响应 (CSS/JS/图片/API) → 直接透传
    const contentType = originResponse.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      return originResponse;
    }

    // ── HTML 响应 → HTMLRewriter 注入 GEO 层 ──
    const pageMeta = matchPageMeta(url.pathname, env.GEO_DATA);

    return new HTMLRewriter()
      .on('html',        new LangHandler('da'))
      .on('head',        new HeadInjector(pageMeta, env.GEO_DATA))
      .on('title',       new TitleRewriter(pageMeta))
      .on('meta[name="description"]', new MetaRewriter(pageMeta))
      .on('link[rel="canonical"]',    new CanonicalRewriter(url))
      // 可选: 首页注入可见 FAQ
      // .on('footer', new FaqSectionInjector(env.GEO_DATA.faq))
      .transform(originResponse);
  }
};
```

### 4.3 路径 → 页面类型映射

Worker 需要知道当前路径对应什么页面类型，才能注入正确的 schema。数据来源是 Phase 1 提取的 `pages-meta.json`：

```json
{
  "/": { "type": "home", "title": "Akupunktur i Dyssegård | Virum Akupunktur", "desc": "..." },
  "/our-team/eksem/": { "type": "service", "service": "Eksem", "title": "...", "desc": "..." },
  "/our-team/hvad-er-akupunktur/": { "type": "faq", "title": "...", "desc": "..." },
  "/contact/": { "type": "contact", "title": "...", "desc": "..." }
}
```

这份映射表约 5-10KB，直接内嵌在 Worker 代码中或存入 KV namespace。

---

## 5. DNS 切换方案深度分析

### 5.0 客户 DNS 现状（以 virumakupunktur.dk 为例）

```
Nameserver:  ns01.one.com, ns02.one.com
A record:    46.30.215.142
AAAA record: 2a02:2350:5:106:73:5f57:501:b179
www:         A 46.30.215.142（与裸域相同 IP）
MX records:  mx1-4.pub.mailpod13-cph3.one.com（4 条，one.com 邮件托管）
TXT records: 无
子域名:      无 mail/webmail/ftp 子域名
```

**关键集成：** one.com 同时提供网站托管和邮件托管。DNS 切换必须保证邮件不中断。

### 5.1 核心概念：Cloudflare 代理模式

Cloudflare 的每条 DNS 记录有两种模式：
- **🟠 橙色云（Proxied）**：流量经过 Cloudflare 边缘 → Worker 可处理 → 再到 origin
- **⚪ 灰色云（DNS-only）**：Cloudflare 仅做 DNS 解析，流量直达 origin，不经过 Worker

这意味着：**即使 nameserver 委托给 Cloudflare，也可以精确控制哪些流量经过代理、哪些直达 origin。**

### 5.2 三种方式对比

#### 方式 A: Nameserver 委托（⭐ 推荐）

```
Step 1: 在 Cloudflare 添加域名 → 自动扫描并导入全部现有 DNS 记录
Step 2: 验证导入的记录（尤其是 MX 邮件记录）
Step 3: 客户在 one.com 面板修改 nameserver:
          ns01.one.com → xxx.ns.cloudflare.com
          ns02.one.com → yyy.ns.cloudflare.com
Step 4: 初始状态：所有记录设为灰色云（DNS-only）
         → 此时功能 100% 等同于修改前，零影响
Step 5: 将 A/AAAA/www 记录切换为橙色云（Proxied）
         → Worker 开始处理网站流量，GEO 生效
         → MX 记录保持灰色云，邮件直达 one.com，不经过代理
```

| 影响项 | 影响程度 | 说明 |
|--------|---------|------|
| 网站访问 | **零影响** | origin 不变，Worker 透传所有内容 + 注入 GEO |
| 邮件收发 | **零影响** | MX 记录设为 DNS-only，邮件直达 one.com 邮件服务器 |
| 预约/表单 | **零影响** | Worker 透传所有非 HTML 请求（POST、API 调用） |
| SSL 证书 | **零影响** | Cloudflare 自动签发边缘证书；origin 的 Let's Encrypt 仍用于回源 |
| one.com 管理面板 | **无影响** | 网站编辑器、文件管理等依然可用 |

**独特优势 — 零风险渐进式迁移 + 即时回滚：**

```
灰色云模式（Step 4）  →  橙色云模式（Step 5）  →  回滚灰色云
      ↓                        ↓                        ↓
  零功能变化              GEO 生效                GEO 关闭，秒级恢复
  可充分测试              邮件不受影响             无需改 nameserver 回去
```

Step 4 → Step 5 的切换在 Cloudflare Dashboard 上是一个开关，**无需客户参与，即时生效，即时可回滚**。

**劣势：** 客户需要修改 nameserver（心理门槛最高的操作），但实际风险最低。

---

#### 方式 B: CNAME 局部代理

```
客户在 one.com DNS 面板添加:
  www  CNAME  geo-proxy-virum.workers.dev
```

| 影响项 | 影响程度 | 说明 |
|--------|---------|------|
| www 子域 | GEO 生效 | 流量经过 Worker |
| 裸域 (virumakupunktur.dk) | **无 GEO** | 裸域不支持 CNAME（DNS 标准限制），流量仍直达 one.com |
| 邮件 | 零影响 | 未触碰 MX 记录 |

**致命缺陷：** 大多数用户访问裸域（virumakupunktur.dk），不带 www。裸域没有 GEO = 大部分流量无效。对于 AI 爬虫也是如此——它们通常从裸域开始抓取。

**结论：不推荐。GEO 覆盖不完整，产品价值打折。**

---

#### 方式 C: Cloudflare for SaaS

```
我们的 Cloudflare 账户:
  创建 Custom Hostname: virumakupunktur.dk

客户在 one.com DNS 面板:
  @    CNAME  geo-proxy.our-platform.com    ← ⚠️ one.com 可能不支持
  www  CNAME  geo-proxy.our-platform.com
  _cf-custom-hostname  TXT  <验证码>
```

| 影响项 | 影响程度 | 说明 |
|--------|---------|------|
| 裸域 | **取决于 one.com 是否支持 root CNAME** | 标准 DNS 不允许裸域 CNAME |
| 邮件 | 零影响 | 未触碰 MX |
| 成本 | $2/月/hostname | Cloudflare for SaaS 费用 |

**问题：** one.com 作为基础型托管商，大概率不支持 ALIAS/ANAME 记录（仅 Cloudflare、Route 53、DNSimple 等高级 DNS 支持）。裸域 CNAME 不可用 = 退化为方式 B。

**结论：技术上不如方式 A 可靠，且有额外成本。仅在客户坚决拒绝修改 nameserver 时作为备选。**

---

### 5.3 推荐决策及理由

**推荐方式 A（Nameserver 委托）**。理由：

1. **对已有功能影响最小** — 初始灰色云模式 = 零功能变化，经过验证后再开启代理
2. **裸域 + www 完整覆盖** — 方式 B/C 都有裸域问题
3. **邮件安全隔离** — MX 记录永远不经过代理，直达 one.com 邮件服务器
4. **即时回滚** — 橙色云 → 灰色云一键切换，秒级恢复，无需客户操作
5. **零额外成本** — Cloudflare Free 计划即可（方式 C 需 $2/月/域名）
6. **解锁全部 Cloudflare 功能** — WAF、Bot Management、Markdown for Agents

**心理门槛应对：** "修改 nameserver" 听起来可怕，但实际操作只需客户在 one.com 面板改两行文字。向客户强调：
- one.com 的网站、邮件、所有功能继续正常工作
- 我们会先用灰色云模式验证一切正常，再开启 GEO
- 随时可一键关闭 GEO 回到原状，无需客户操作
- 如果完全退出服务，改回 one.com 的 nameserver 即可 100% 恢复原状

### 5.4 SaaS 服务控制机制

Worker 作为边缘代理层，支持多种粒度的服务控制：

```
层级 1 — Worker 路由关闭:    Cloudflare Dashboard 移除 Worker 路由
                              效果: 流量直达 origin，GEO 完全关闭，网站正常
层级 2 — Worker 内部开关:    代码中设置 passthrough 模式
                              效果: Worker 仅透传，不注入任何 GEO 信号
层级 3 — 灰色云回退:         A/AAAA 记录切回 DNS-only
                              效果: 等同于未接入 Cloudflare，流量直达 origin
层级 4 — 完全退出:           客户改回 one.com 的 nameserver
                              效果: 100% 恢复到接入前状态
```

**SaaS 模型的技术基础：** 客户付费期间，Worker 提供 GEO 层；停止付费，关闭 Worker 路由即可。客户网站不受任何影响，仅失去 AI 搜索可见性增强。这是一个干净的、可逆的、按价值收费的 SaaS 模型。

---

## 6. robots.txt 策略

基于 Gemini 调研，区分检索 bot（要放行）和训练 bot（要阻止）：

```
# ── 允许: AI 检索/引用 bot（GEO 目标）──
User-agent: OAI-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

# ── 阻止: LLM 训练爬虫（无引用价值）──
User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: *
Allow: /

Sitemap: https://virumakupunktur.com/sitemap.xml
```

---

## 7. FAQ 处理策略

### 仅 JSON-LD（当前做法）

```
<head>
  <script type="application/ld+json">
  { "@type": "FAQPage", "mainEntity": [...] }
  </script>
</head>
<body>
  <!-- 页面上没有可见的 Q&A 文字 -->
</body>
```

- 风险: Google 称之为 "schema cosplay" — schema 描述了页面上不存在的内容
- GEO 效果: 有限。LLM 生成回答时依赖可见文本，不仅是 JSON-LD

### JSON-LD + 可见内容（推荐）

```
<head>
  <script type="application/ld+json">
  { "@type": "FAQPage", "mainEntity": [...] }
  </script>
</head>
<body>
  ...原站内容...
  <!-- Worker 注入的可见 FAQ 区块 -->
  <section class="geo-faq" itemscope itemtype="https://schema.org/FAQPage">
    <h2>Ofte stillede spørgsmål</h2>
    <details itemscope itemprop="mainEntity" itemtype="https://schema.org/Question">
      <summary itemprop="name">Hvad er akupunktur?</summary>
      <div itemprop="acceptedAnswer" itemscope itemtype="https://schema.org/Answer">
        <p itemprop="text">Akupunktur er en flere tusinde år gammel...</p>
      </div>
    </details>
    ...
  </section>
  <footer>...</footer>
</body>
```

- 风险: 零。schema 与可见内容完全匹配
- GEO 效果: 最高。LLM 可直接从文本提取答案，JSON-LD 提供结构化确认
- 注意: FAQ 文字从原站内容提炼（extract 步骤），不是凭空生成，不违反"一字不改"

### 安全边界

| FAQ 放置位置 | 是否安全 | 原因 |
|---|---|---|
| FAQ 页面（有对应可见内容） | 安全 | schema 映射可见文本 |
| 服务页面（有对应治疗说明） | 安全 | Service schema 映射可见服务描述 |
| 首页（无可见 FAQ 文字） | **仅 JSON-LD 有风险** | schema cosplay |
| 首页 + Worker 注入可见 FAQ 区块 | 安全 | schema 映射注入的可见文本 |

---

## 8. 关键风险 & 待验证问题

以下是可能"堵死"方案的已知风险点，需要逐一验证：

### 8.1 Origin 回源问题

| 风险 | 详情 | 验证方法 |
|---|---|---|
| **Builder 平台阻止非浏览器请求** | one.com / Wix / Squarespace 可能检测 User-Agent 或 IP，拒绝来自 Cloudflare 的 fetch 请求 | `curl -H "User-Agent: Mozilla/5.0" https://virumakupunktur.dk/` 从 Cloudflare Worker 发起，检查是否返回完整 HTML |
| **CORS / 安全头阻止** | 原站可能设置了限制跨域请求的头 | 检查原站响应头中的 `X-Frame-Options`、`Content-Security-Policy` |
| **IP 频率限制** | Cloudflare Worker 的出口 IP 可能被原站的 WAF 限流 | 压测：从 Worker 连续请求原站 100 次，观察是否被限 |
| **SPA 渲染** | 如果原站是纯 SPA（JS 渲染全部内容），Worker 拿到的 HTML 是空壳 | 检查 `curl` 返回的 HTML 是否包含可见文本内容 |

**virum-akupunktur 特殊情况**: 该站基于 one.com builder，已知部分内容由 JS 渲染。Worker fetch 拿到的可能是空壳 HTML。这是最大的风险点。

**如果 origin 返回空壳 HTML**:
- Worker 代理模式失效（注入 GEO 到空 HTML 没意义）
- 需要回退到 Clone Pipeline（Playwright 预渲染 → 部署静态版本）
- 或者用 Cloudflare Workers + Browser Rendering API（Cloudflare 的无头浏览器）

### 8.2 DNS 切换阻力

| 风险 | 详情 | 缓解 |
|---|---|---|
| **客户不愿改 nameserver** | 涉及信任和技术门槛 | 用方式 C（Cloudflare for SaaS），客户只需加 CNAME |
| **客户域名注册商限制** | 部分注册商不允许修改 nameserver 或 CNAME | 提前检查客户的注册商 |
| **DNS 生效延迟** | TTL 可能导致最长 48 小时过渡期 | 提前降低 TTL → 切换 → 等待生效 |
| **邮件 MX 记录影响** | 如果切 nameserver 到 Cloudflare，需要同步迁移 MX 记录 | 在 Cloudflare 中复制原有 MX 记录 |

### 8.3 重复内容

| 风险 | 详情 | 缓解 |
|---|---|---|
| **Origin 默认子域名泄露** | `client-brand.squarespace.com` 仍可访问，AI 爬虫可能发现两份内容 | Worker 注入 self-referencing canonical；联系 builder 平台关闭默认子域名 |
| **Canonical 冲突** | 原站 HTML 可能已有 canonical 标签指向旧 URL | HTMLRewriter 覆盖现有 canonical |

### 8.4 Cloudflare 限制

| 风险 | 详情 | 验证 |
|---|---|---|
| **Workers Free Tier 限制** | 10万请求/天，Worker 大小 1MB，CPU 时间 10ms/请求 | 估算客户日均流量是否超限 |
| **HTMLRewriter 功能边界** | 只能操作 HTML 标签，不能执行复杂 DOM 查询（如 "找到第3个 div 的子元素"） | 验证能否可靠定位注入点（<head>, <footer>） |
| **Cloudflare Bot Management 误杀** | 默认 "Block AI Bots" 可能阻止 GPTBot 等 | 部署后必须检查 WAF 设置，关闭全局 AI bot 阻止 |

### 8.5 成本

| 项目 | Free Tier | Workers Paid ($5/月) |
|---|---|---|
| 请求数 | 10万/天 | 1000万/月 |
| Worker 大小 | 1 MB | 10 MB |
| KV 读取 | 10万/天 | 1000万/月 |
| CPU 时间 | 10ms/请求 | 30ms/请求 |
| Custom Domains | 无限 | 无限 |
| **每客户成本** | **$0** | **$5/月 覆盖所有客户** |

---

## 9. 与当前管道的兼容性

```
                    现有代码                     新增代码
                    ────────                     ────────
数据提取:
  scripts/clone/01-clone-site.ts    ← 保留，仍用于抓取原站
  scripts/clone/02-extract-geo.ts   ← 保留，仍用 Claude API 提取数据

静态部署 (Clone Pipeline):
  scripts/clone/03-inject-geo.ts    ← 保留，作为备用/演示方案
  scripts/clone/04-quality-check.ts ← 保留

边缘部署 (Edge Pipeline):
  scripts/edge/generate-worker.ts   ← 新增：读取 geo-data → 生成 Worker 代码
  scripts/edge/deploy-worker.ts     ← 新增：调用 wrangler deploy
  scripts/edge/verify-geo.ts        ← 新增：验证部署后 GEO 信号是否生效

Worker 模板:
  edge/worker-template/             ← 新增
    ├── src/index.ts                     Worker 入口
    ├── src/rewriters/                   HTMLRewriter handlers
    │     ├── head-injector.ts           JSON-LD + meta 注入
    │     ├── title-rewriter.ts          <title> 覆盖
    │     ├── canonical-rewriter.ts      canonical 覆盖
    │     └── faq-injector.ts            可见 FAQ 区块注入
    ├── src/routes/                      静态路由
    │     ├── robots.ts                  动态 robots.txt
    │     └── sitemap.ts                 动态 sitemap.xml
    ├── wrangler.toml.template           部署配置模板
    └── package.json
```

---

## 10. 最终判断标准

在投入开发前，需要验证以下 3 个前提条件。任何一个不通过，方案需要调整：

| # | 验证项 | 通过标准 | 验证方法 | 状态 |
|---|---|---|---|---|
| **V1** | Worker 能从 origin 拿到完整 HTML | curl 返回的 HTML 包含页面主体文字内容（不是空壳等待 JS 渲染） | 从 Cloudflare Worker 发 fetch 到 `virumakupunktur.dk`，检查响应 body | **已通过** (2026-06-19, 13 项 curl + P0 线上部署) |
| **V2** | HTMLRewriter 能可靠定位注入点 | 能匹配 `<head>`, `<title>`, `<meta>`, `<link rel=canonical>` | 写一个最小 Worker，对真实页面做注入，检查输出 | **已通过** (2026-06-19, `geo-p0-virum.blake-designing.workers.dev` 线上验证) |
| **V3** | 客户愿意做 DNS 切换 | 至少一种 DNS 方式（nameserver / CNAME / CF for SaaS）客户可以接受 | 与客户沟通 | **待验证** |

### 如果 V1 失败（origin 返回空壳 HTML）

回退方案:

```
Plan B-1: Cloudflare Browser Rendering API
  Worker 调用 Cloudflare 内置的无头浏览器渲染页面
  拿到渲染后的 HTML → HTMLRewriter 注入 GEO
  问题: Browser Rendering 有请求限额，延迟增加 2-5 秒

Plan B-2: 混合架构
  静态页面: Worker 代理 origin（有内容的页面）
  SPA 页面: Worker 从预渲染缓存（Clone Pipeline 的 dist/）返回
  问题: 需要维护两套数据源，复杂度高

Plan B-3: 回退到 Clone Pipeline
  放弃实时代理，用现有方案部署静态克隆版
  用 Cloudflare Pages 托管 dist/
  问题: 回到视觉保真度和动态功能丢失的问题
```

---

## 11. llms.txt → Markdown for Agents 迁移

Gemini 调研确认 llms.txt 已失效（0.1% AI bot 访问率）。替代方案：

```
旧方案: 生成 llms.txt 静态文件 → 放在根目录
新方案: Cloudflare Dashboard → 启用 "Markdown for Agents"

效果: 当 AI bot 发送 Accept: text/markdown 请求头时
      Cloudflare 自动将 HTML 转换为 Markdown 返回
      token 使用量降低 ~80%，AI 引擎更高效地理解内容
```

Worker 中不需要额外代码。这是 Cloudflare 平台级功能，按域名开关即可。

**但 llms.txt 仍可保留作为兼容层**（极低成本），因为部分小众工具仍在读取。
