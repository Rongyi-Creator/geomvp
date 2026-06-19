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

---

## 12. Result Deliver — 效果交付页面设计

> 版本: 2026-06-19 | 状态: 方案已确定，Phase 1 开始实施

### 12.0 设计目标

为客户提供一个直观的、Server-Rendered 的效果仪表盘，展示 GEO Edge Proxy 的实际价值：
- **谁在访问** — AI bot 流量的实时统计
- **注入了什么** — GEO schema 注入覆盖率
- **效果如何** — AI 搜索引擎中的品牌可见性变化
- **对比基线** — 接入前 vs 接入后的关键指标

### 12.1 数据源架构

```
┌─────────────────────────────────────────────────────────────┐
│                    GEO Dashboard Worker                      │
│               (geo-dashboard.workers.dev)                    │
│                                                              │
│  GET /                    → 客户列表 / 登录                   │
│  GET /report/:client      → Server-Rendered HTML 效果报告     │
│  GET /api/stats/:client   → JSON（预留 future frontend）     │
│                                                              │
│  数据源:                                                      │
│  ├── Cloudflare Analytics Engine SQL API (实时, 免费)          │
│  ├── OtterlyAI CSV 导入 (手动, 每周更新)                       │
│  └── Baseline Snapshot (JSON, 存储在 KV 或 R2)                │
└─────────────────────────────────────────────────────────────┘
         ↑ writes                         ↑ reads
┌──────────────────────┐       ┌──────────────────────────────┐
│  GEO Proxy Worker    │       │  OtterlyAI Lite ($29/mo)     │
│  (geo-p0-virum)      │       │  15 search prompts           │
│                      │       │  每日追踪 4 AI 引擎            │
│  每个请求:            │       │  CSV 导出 → 手动上传           │
│  AE.writeDataPoint() │       └──────────────────────────────┘
│  记录 UA/bot/page    │
│  /geo-injected       │       ┌──────────────────────────────┐
└──────────────────────┘       │  Baseline Snapshot           │
                               │  接入前状态 JSON              │
                               │  Schema 覆盖: 0              │
                               │  Meta Desc 覆盖: 0            │
                               │  robots.txt: 无 AI 策略       │
                               └──────────────────────────────┘
```

### 12.2 成本规划（渐进式）

| 阶段 | 时间节点 | 功能 | 月成本 |
|------|----------|------|--------|
| Phase 1 | 现在 | Worker 加 Analytics Engine 写入 + UA 分类 | $0 |
| Phase 2 | DNS 接入后 1 周 | Dashboard Worker v1（Bot 统计 + 注入统计） | $0 |
| Phase 3 | 接入后 2 周 | OtterlyAI Lite 基线 + 首次 CSV 导入 Dashboard | $29 |
| Phase 4 | 3+ 客户时 | 升级 OtterlyAI Standard，API 自动拉取 | $189 |

**关键决策：** OtterlyAI Lite ($29/mo) 没有 API 访问权限，API 需要 Standard ($189/mo)。
单客户阶段用 CSV 手动导入即可，每周一次工作量可接受。3+ 客户时升级 Standard 实现全自动。

### 12.3 Analytics Engine 数据模型

#### wrangler.toml 配置

```toml
[[analytics_engine_datasets]]
binding = "GEO_ANALYTICS"
dataset = "geo_traffic"
```

#### 数据点结构（每请求写入一次）

```typescript
env.GEO_ANALYTICS.writeDataPoint({
  blobs: [
    // blob1: UA 类别 — "ai_retrieval" | "seo_crawler" | "ai_training" | "visitor"
    classifyUA(userAgent),
    // blob2: Bot 名称 — "OAI-SearchBot" | "Googlebot" | "unknown" 等
    identifyBot(userAgent),
    // blob3: 请求路径 — "/our-team/rygsmerter/"
    url.pathname,
    // blob4: GEO 注入状态 — "injected" | "passthrough" | "skipped_404"
    geoStatus,
    // blob5: 页面类型 — "service" | "home" | "faq" | "contact" | "unknown"
    pageType,
  ],
  doubles: [1],  // 计数
  indexes: [request.headers.get("cf-ray") ?? ""],
});
```

**写入特性:** 非阻塞，不影响请求延迟。

#### UA 分类逻辑

```
AI 检索 Bot（GEO 目标，高价值）:
  OAI-SearchBot     — OpenAI 搜索
  ChatGPT-User      — ChatGPT 浏览模式
  PerplexityBot     — Perplexity 搜索
  ClaudeBot         — Claude 搜索
  YouBot            — You.com 搜索
  Applebot          — Apple Intelligence

SEO 爬虫（传统 SEO，重要）:
  Googlebot         — Google 搜索
  Bingbot           — Bing 搜索
  YandexBot         — Yandex 搜索
  Baiduspider       — 百度搜索

AI 训练爬虫（已被 robots.txt 阻止，但仍可能访问）:
  GPTBot            — OpenAI 训练
  CCBot             — Common Crawl
  Google-Extended   — Google AI 训练
  anthropic-ai      — Anthropic 训练

普通访客:
  其他所有 UA
```

#### Dashboard 查询示例

```sql
-- 过去 7 天 AI bot 访问量按天聚合
SELECT
  toDate(timestamp) AS day,
  blob1 AS category,
  SUM(_sample_interval) AS visits
FROM geo_traffic
WHERE timestamp >= NOW() - INTERVAL '7' DAY
  AND blob1 IN ('ai_retrieval', 'seo_crawler')
GROUP BY day, category
ORDER BY day

-- Top 10 AI bot 最常访问的页面
SELECT
  blob3 AS page,
  blob2 AS bot,
  SUM(_sample_interval) AS visits
FROM geo_traffic
WHERE blob1 = 'ai_retrieval'
  AND timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY page, bot
ORDER BY visits DESC
LIMIT 10

-- GEO 注入成功率
SELECT
  blob4 AS status,
  SUM(_sample_interval) AS count
FROM geo_traffic
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY status

-- 各 AI 引擎访问量排名
SELECT
  blob2 AS bot_name,
  SUM(_sample_interval) AS visits
FROM geo_traffic
WHERE blob1 = 'ai_retrieval'
  AND timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY bot_name
ORDER BY visits DESC
```

### 12.4 Dashboard 页面设计（4 区块）

Dashboard 采用 Server-Rendered HTML + CSS + inline SVG，零客户端 JavaScript。

#### 区块 1: Bot Traffic Overview（实时，Analytics Engine）

展示内容:
- 大数字卡片: 今日 / 本周 / 本月总请求数
- 分类饼图 (inline SVG): AI Retrieval / SEO Crawlers / Training Bots / Normal Visitors
- Bot 明细表: 每个 bot 的访问次数（OAI-SearchBot, PerplexityBot, Googlebot 等）
- 日趋势: 按天聚合的访问量折线图 (inline SVG)

**核心价值:** "本月 PerplexityBot 访问了你的 32 个服务页面共 847 次" — 这是续费的核心证据，只有 Edge Proxy 能提供。

#### 区块 2: GEO Injection Stats（实时，Analytics Engine）

展示内容:
- 注入成功率: 注入页面数 / 总 HTML 请求数
- Schema 类型分布: MedicalBusiness / MedicalTherapy / FAQPage
- 热门 GEO 页面 Top 10（被 AI bot 访问且注入了 schema 的页面）
- 404 跳过页面列表

#### 区块 3: AI Search Visibility（周更，OtterlyAI 数据）

展示内容:
- Brand Visibility Index 趋势（从 CSV 导入）
- AI 引擎覆盖: 哪些引擎提到了品牌（ChatGPT / Perplexity / Google AIO 等）
- 被引用的 URL 列表
- 竞品对比（如有追踪）

**数据来源 (< 3 客户):** OtterlyAI Lite CSV 导出 → 手动上传到 R2/KV → Dashboard 读取
**数据来源 (≥ 3 客户):** OtterlyAI Standard API → `https://data.otterly.ai/v1` → Dashboard 自动拉取

OtterlyAI API 要点:
- Base URL: `https://data.otterly.ai/v1`
- 认证: Bearer token
- Standard 计划: 2,000 API requests/mo ($189/mo)
- 可拉取: Brand KPIs, Prompt coverage, Citation sources, Net Sentiment Score, 竞品对比

#### 区块 4: Baseline Comparison（基线对比）

展示内容:
- 接入前 vs 接入后对照表
- 关键指标变化:
  - Schema 覆盖: 0 页 → 38 页
  - Meta Description 覆盖: 0 页 → 38 页
  - robots.txt AI bot 策略: 无 → 检索 bot 放行 / 训练 bot 阻止
  - sitemap.xml: 无 → 38 URLs
  - Canonical URL: 缺失 → 全覆盖
- AI 搜索可见性评分变化（OtterlyAI 基线 vs 当前）

### 12.5 Dashboard 技术实现

```
Dashboard Worker 架构:
  geo-dashboard.blake-designing.workers.dev
  ├── 认证: 简单 Bearer token（初期）→ Cloudflare Access（后期）
  ├── 模板: Server-rendered HTML（Worker 内生成）
  ├── 样式: Inline CSS（系统字体栈，深色主题）
  ├── 图表: Inline SVG（饼图、折线图，零 JS）
  ├── 数据:
  │   ├── Analytics Engine SQL API → 实时 bot 统计
  │   ├── KV/R2 → OtterlyAI CSV 数据 + Baseline JSON
  │   └── (future) OtterlyAI API → 自动拉取
  └── 缓存: 5 分钟 edge cache（减少 SQL API 调用）
```

### 12.6 差异化分析

```
┌──────────────────────────────────────────────────────┐
│  我们独有 (Analytics Engine)     任何人可买 (OtterlyAI)  │
│  ─────────────────────           ──────────────────── │
│  "PerplexityBot 访问了你的        "你的品牌在 Perplexity │
│   32 个服务页 847 次"              搜索中可见度 72%"     │
│                                                      │
│  "OAI-SearchBot 最常访问          "ChatGPT 在回答关于   │
│   /smertebehandling/"              akupunktur 的问题时  │
│                                    引用了你 3 次"       │
│                                                      │
│  = 流量层面的证据                  = 结果层面的证据       │
│  = 实时，精确到每次请求            = 每日采样            │
│  = 只有 Edge Proxy 能提供          = 竞品也能买          │
└──────────────────────────────────────────────────────┘

两者结合 = 完整的 GEO 效果故事:
  "AI bot 确实在大量访问你的网站 (Part A)"
    +
  "AI 搜索引擎确实在向用户推荐你 (Part B)"
    +
  "这一切在接入我们的服务之前都不存在 (Part C)"
```

### 12.7 GEO 监控工具选型：OtterlyAI vs Airefs

> 调研日期: 2026-06-19 | 结论: 选用 OtterlyAI

#### 对比矩阵

| 维度 | OtterlyAI ($29/mo Lite) | Airefs ($24/mo Lite) |
|------|-------------------------|----------------------|
| AI 引擎覆盖 | **7 个**: ChatGPT, Perplexity, Google AIO, AI Mode, Gemini, Copilot, Claude | **2 个**: ChatGPT, Google AIO（其他需申请） |
| 追踪 Prompts | 15 (Lite) / 100 (Standard) / 400 (Premium) | 25 (Lite) / 60 (Pro) / 150 (Expert) |
| GEO Audit | ✅ 25+ 页面因素分析 | ❌ |
| 品牌情感分析 | ✅ 推荐/警告/否定分类 | ❌ |
| Citation 追踪 | ✅ 域名+URL 级别 | ✅ 来源级别 |
| Reddit 监控 | ❌ | ✅ |
| API 访问 | Standard ($189/mo) 起 | Lite ($24/mo) 即有基础 API |
| MCP Server | ✅ (Standard+) | ❌ |
| Looker Studio | ✅ (Standard+) | ❌ |
| CSV 导出 | ✅ 所有计划 | ✅ 所有计划 |
| Done-for-you 服务 | ❌ | ✅ ($249/mo 起) |
| 多国/多语言 | 50+ 国家 | 主要英语市场 |
| 丹麦市场 | ✅ 明确支持 DK | ⚠️ 未明确列出 |
| 行业验证 | Gartner Cool Vendor 2025, G2 4.9/5 (250+ reviews) | G2 4.9/5 (较少 reviews) |

#### 决策：OtterlyAI

**选择理由：**

1. **AI 引擎覆盖（决定性）** — 7 vs 2。Edge Proxy 专门为 PerplexityBot、ClaudeBot 优化了 robots.txt 放行策略，监控工具必须能看到这些引擎的数据才能证明效果。Airefs 只覆盖 ChatGPT + Google AIO，盲区太大。

2. **GEO Audit 与我们的服务直接对口** — OtterlyAI 的 GEO Audit 分析结构化数据、AI 可读性等 25+ 页面因素，正是 Edge Proxy 注入的内容。"Audit 前 vs Audit 后"可直接展示优化效果。

3. **丹麦市场覆盖** — OtterlyAI 支持 50+ 国家含丹麦，Airefs 主要面向英语市场。virumakupunktur.dk 是丹麦语网站。

4. **API/MCP 升级路径** — 扩展到 3+ 客户升级 Standard 时，OtterlyAI 有完整的 Public API (`data.otterly.ai/v1`) + MCP Server + Looker Studio connector。生态更成熟。

5. **品牌情感分析** — 能区分 AI 是"热情推荐"还是"附带警告"，对客户报告有说服力。

**Airefs 优势但不适用我们：**
- Reddit 监控和 Done-for-you 服务适合内容营销公司，不适合我们的技术 SaaS 模型
- Lite 即有 API 是优势，但 API 生态弱于 OtterlyAI

**成本路径：**
- 单客户: OtterlyAI Lite $29/mo (CSV 手动导入 Dashboard)
- 3+ 客户: OtterlyAI Standard $189/mo (API 自动拉取)
- 年付折扣: Lite $25/mo, Standard $160/mo
