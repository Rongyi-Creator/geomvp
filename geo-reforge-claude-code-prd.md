# GEO Reforge — Claude Code 执行 PRD

> **目的**：构建一套可复用的"输入 URL → 输出 GEO 原生静态站"自动化工作流。
> **执行环境**：Claude Code (Sonnet 4.6)
> **项目位置**：`/Users/blake/Documents/geomvp`
> **验证案例**：https://virumakupunktur.dk/（one.com 建站器，丹麦语针灸诊所）
> **注意**：本 PRD 分两块交付——先建模板(块1)，再建自动化(块2)。块1 不依赖任何外部 API。

---

## 架构总览

```
geomvp/
├── template/                    ← 块1：可复用 GEO Astro 模板（产品核心资产）
│   ├── src/
│   │   ├── layouts/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── content/             ← 内容目录（从 data contract 读取）
│   │   ├── styles/
│   │   └── data/                ← business.json + colors.json
│   ├── public/
│   │   ├── llms.txt             ← 自动生成
│   │   └── robots.txt
│   ├── astro.config.mjs
│   ├── package.json
│   └── README.md
│
├── scripts/                     ← 块2：自动化脚本
│   ├── 01-check-compatibility.ts
│   ├── 02-scrape-site.ts
│   ├── 03-structure-content.ts
│   ├── 04-generate-site.ts
│   ├── 05-quality-check.ts
│   └── config.ts
│
├── clients/                     ← 每个客户的数据目录
│   └── virum-akupunktur/
│       ├── raw/                 ← 抓取的原始内容
│       ├── structured/          ← 结构化数据（符合 data contract）
│       └── site/                ← 生成的 Astro 项目（可部署）
│
└── CLAUDE.md                    ← Claude Code 项目规则
```

---

## 块 1：GEO Astro 模板

### 技术栈

| 层 | 选择 | 原因 |
|---|---|---|
| 框架 | Astro 5.x (SSG mode) | 零 JS by default = AI 爬虫完美读取 |
| 样式 | 纯 CSS + CSS Custom Properties | 简单、无构建依赖、配色切换靠变量 |
| 字体 | 系统字体栈 | 零网络请求、最快加载 |
| 图片 | Astro `<Image>` 组件 (自动 WebP + 响应式) | Core Web Vitals |
| 内容 | Astro Content Collections (Markdown + frontmatter) | 类型安全、与 CMS 天然兼容 |
| JSON-LD | 自定义 Astro 组件，从 business.json 自动渲染 | 零手动维护 |
| 构建输出 | 纯静态 HTML + CSS + 图片 | CF Pages 直接部署 |

### 不使用

- Tailwind（加构建复杂度，对简单站点过重）
- React/Vue/任何客户端框架（AI 爬虫不执行 JS）
- shadcn/ui（这不是 SaaS 仪表盘）
- 任何 CMS 运行时依赖（CMS 由 Sitepins 在外部处理）

---

### 页面结构（GEO 标准模板 v1）

所有页面共享一个 Layout，内含全局 JSON-LD + 语义化 HTML 骨架 + NAP footer。

#### 首页 `/`（index.astro）

```
┌─────────────────────────────────────────────────┐
│ <header>                                         │
│   Logo/业务名称    导航(Behandling|Priser|Om|Kontakt) │
│   电话号码（点击可拨）  Booking CTA 按钮          │
│ </header>                                        │
├─────────────────────────────────────────────────┤
│ <main>                                           │
│   <section id="hero">                            │
│     H1: 核心价值主张（含城市+服务关键词）         │
│     副标题: 1-2句差异化描述                       │
│     主CTA: Booking 按钮                          │
│   </section>                                     │
│                                                  │
│   <section id="services">                        │
│     H2: 服务概览                                 │
│     服务卡片网格 → 每张链接到 /ydelser/[slug]    │
│   </section>                                     │
│                                                  │
│   <section id="about-preview">                   │
│     H2: 关于从业者（简版）                        │
│     照片 + 2-3句介绍 + "了解更多"链接到 /om      │
│   </section>                                     │
│                                                  │
│   <section id="trust">                           │
│     信任信号: 从业年限 | RAB认证 | 保险覆盖      │
│     外部评价链接: → Google Reviews / Trustpilot   │
│   </section>                                     │
│                                                  │
│   <section id="location">                        │
│     H2: 位置与交通                                │
│     地址 + Google Maps embed + 交通指南           │
│   </section>                                     │
│                                                  │
│   <section id="cta-bottom">                      │
│     底部 CTA: 预约按钮 + 电话                    │
│   </section>                                     │
│ </main>                                          │
├─────────────────────────────────────────────────┤
│ <footer>                                         │
│   业务名称 | 完整地址 | 电话 | 邮件              │
│   营业时间 | 外部链接(Facebook/Trustpilot/GBP)   │
│   © 年份 业务名称                                │
│ </footer>                                        │
└─────────────────────────────────────────────────┘
```

**GEO 关键要求**：
- H1 必须包含：核心服务 + 城市名（例："Akupunktur i Virum — Smertebehandling uden medicin"）
- 前 200 词包含：业务名称、城市、核心服务类型、独特卖点
- NAP 在 footer 中与 JSON-LD 完全一致（逐字、含格式）

#### 服务总览页 `/ydelser/`（ydelser/index.astro）

- H1: "Behandlinger hos [业务名称]"
- 所有服务的卡片列表，分类展示
- 每张卡片链接到独立服务页

#### 服务详情页 `/ydelser/[slug]/`（ydelser/[...slug].astro）

```
H1: [服务名称] — [业务名称], [城市]
<article>
  服务描述（原文一字不改）
  --- 如果原页面有内容则显示以下区块，无内容则跳过 ---
  适合人群
  治疗过程
  常见问题（2-3个，FAQPage schema）
</article>
内部链接: → 相关服务页（交叉引用）
CTA: Booking 按钮
```

**GEO 关键要求**：
- 每个服务页有独立的 JSON-LD `Service` schema
- Meta title: "[服务名] i [城市] | [业务名称]"
- 空白页（原站无内容）保留但标注 `noindex`（避免被 AI 引擎抓到空页面）

#### 价格页 `/priser/`

- H1: "Priser og åbningstider — [业务名称]"
- 价格表（语义化 HTML `<table>` 或 `<dl>`）
- 营业时间（结构化列表）
- Booking CTA

**GEO 关键要求**：
- JSON-LD `openingHoursSpecification` 必须与页面可见内容一致
- 价格信息用 `Offer` schema 标记（可选，如果价格结构清晰）

#### 关于页 `/om/`

- H1: "Om [从业者名] — [业务名称]"
- 从业者介绍、资质、理念
- 照片
- 信任信号（证书、从业年限、保险覆盖）

#### 联系页 `/kontakt/`

- H1: "Kontakt [业务名称]"
- 完整 NAP
- 营业时间
- Google Maps embed
- 电话（`<a href="tel:...">`）
- 邮件（`<a href="mailto:...">`）
- 预订系统链接/嵌入
- 交通指南（停车、公交、火车）

#### FAQ 页 `/faq/`

- H1: "Ofte stillede spørgsmål — [业务名称]"
- 至少 5 个 Q&A（从现有内容提炼，不凭空生成）
- 每个 Q&A 用 `<details><summary>` 语义化

**GEO 关键要求**：
- 整页包裹在 `FAQPage` JSON-LD schema 中
- 每个问答项为 `Question` + `acceptedAnswer`

---

### JSON-LD 组件设计

创建 `src/components/JsonLd.astro`：

```astro
---
// 从 business.json 读取数据
import businessData from '../data/business.json';

interface Props {
  pageType?: 'home' | 'service' | 'faq' | 'contact' | 'about' | 'prices';
  serviceData?: { name: string; description: string; };
  faqItems?: Array<{ question: string; answer: string; }>;
}

const { pageType = 'home', serviceData, faqItems } = Astro.props;

// 基础 LocalBusiness schema（每个页面都有）
const localBusiness = {
  "@context": "https://schema.org",
  "@type": businessData.schemaType || "LocalBusiness",
  "name": businessData.name,
  "description": businessData.description,
  "url": businessData.website,
  "telephone": businessData.phone,
  "email": businessData.email,
  "address": {
    "@type": "PostalAddress",
    "streetAddress": businessData.address.street,
    "addressLocality": businessData.address.city,
    "postalCode": businessData.address.zip,
    "addressCountry": businessData.address.country
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": businessData.geo.lat,
    "longitude": businessData.geo.lng
  },
  "openingHoursSpecification": businessData.hours.map(h => ({
    "@type": "OpeningHoursSpecification",
    "dayOfWeek": h.day,
    "opens": h.open,
    "closes": h.close
  })),
  "sameAs": businessData.sameAs || []
};
---

<script type="application/ld+json" set:html={JSON.stringify(localBusiness)} />

{pageType === 'service' && serviceData && (
  <script type="application/ld+json" set:html={JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Service",
    "name": serviceData.name,
    "description": serviceData.description,
    "provider": { "@type": "LocalBusiness", "name": businessData.name }
  })} />
)}

{pageType === 'faq' && faqItems && (
  <script type="application/ld+json" set:html={JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": faqItems.map(item => ({
      "@type": "Question",
      "name": item.question,
      "acceptedAnswer": { "@type": "Answer", "text": item.answer }
    }))
  })} />
)}
```

---

### CSS 变量系统（配色切换）

`src/styles/theme.css`：

```css
:root {
  /* 配色变量 — 由 colors.json 决定，构建时注入 */
  --color-primary: #2E5E4E;
  --color-primary-light: #4A8B76;
  --color-primary-dark: #1D3D33;
  --color-bg: #FFFFFF;
  --color-bg-alt: #F8F9FA;
  --color-text: #1A1A1A;
  --color-text-muted: #6B7280;
  --color-accent: #D4A574;
  --color-border: #E5E7EB;

  /* 排版 — 固定不变 */
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-heading: var(--font-body);
  --font-size-base: 1rem;
  --font-size-lg: 1.125rem;
  --font-size-xl: 1.5rem;
  --font-size-2xl: 2rem;
  --font-size-3xl: 2.5rem;
  --line-height-body: 1.6;
  --line-height-heading: 1.2;

  /* 间距 — 固定不变 */
  --space-xs: 0.5rem;
  --space-sm: 1rem;
  --space-md: 1.5rem;
  --space-lg: 2rem;
  --space-xl: 3rem;
  --space-2xl: 4rem;
  --space-section: 5rem;

  /* 布局 — 固定不变 */
  --max-width: 1100px;
  --radius: 6px;
}

/* 移动端基准，桌面端适配 */
@media (min-width: 768px) {
  :root {
    --font-size-2xl: 2.5rem;
    --font-size-3xl: 3.5rem;
    --space-section: 6rem;
  }
}
```

**3 套配色**：构建脚本从 `colors.json` 读取，替换 `--color-*` 变量值。结构/字体/间距完全不变。

---

### llms.txt 自动生成

在 Astro 构建时，从 `business.json` + content collections 自动生成 `public/llms.txt`：

创建 `src/pages/llms.txt.ts`（Astro endpoint，输出纯文本）：

```typescript
import type { APIRoute } from 'astro';
import businessData from '../data/business.json';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const services = await getCollection('services');

  const content = `# ${businessData.name}

> ${businessData.description}

## Ydelser (Services)
${services.map(s => `- ${s.data.title}`).join('\n')}

## Beliggenhed (Location)
${businessData.address.street}, ${businessData.address.zip} ${businessData.address.city}, ${businessData.address.country}

## Kontakt
Telefon: ${businessData.phone}
Email: ${businessData.email}
Website: ${businessData.website}
Booking: ${businessData.bookingUrl || ''}

## Åbningstider (Opening Hours)
${businessData.hours.map(h => `${h.day}: ${h.open}–${h.close}`).join('\n')}

## Om (About)
${businessData.aboutSummary || ''}
`;

  return new Response(content, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
};
```

---

### robots.txt

`public/robots.txt`：

```
User-agent: *
Allow: /

# AI 爬虫显式允许
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

Sitemap: https://DOMAIN/sitemap-index.xml
```

---

### Data Contract（数据契约）

块2 的输出必须符合以下格式，块1 才能正确渲染。

#### `structured/business.json`

```json
{
  "name": "Virum Akupunktur",
  "schemaType": "MedicalBusiness",
  "description": "Godkendt kinesisk RAB akupunkturlæge i Virum. Specialiseret i smertebehandling, stress og allergier.",
  "phone": "+45 25 72 42 65",
  "email": "jie.luan@outlook.com",
  "website": "https://virumakupunktur.dk",
  "bookingUrl": "https://virumakupunktur.planway.com",
  "facebookUrl": "https://facebook.com/profile.php?id=100006357108954",
  "trustpilotUrl": "",
  "googleMapsUrl": "https://www.google.com/maps/search/?api=1&query=Virum+Akupunktur+Dalstrøget+78",
  "address": {
    "street": "Dalstrøget 78, 4",
    "city": "Dyssegård",
    "zip": "2870",
    "country": "DK"
  },
  "geo": {
    "lat": 55.7500,
    "lng": 12.4800
  },
  "hours": [
    { "day": "Monday", "open": "09:00", "close": "18:00" },
    { "day": "Tuesday", "open": "09:00", "close": "18:00" },
    { "day": "Wednesday", "open": "09:00", "close": "18:00" },
    { "day": "Thursday", "open": "09:00", "close": "18:00" },
    { "day": "Friday", "open": "09:00", "close": "18:00" },
    { "day": "Saturday", "open": "09:00", "close": "18:00", "note": "efter telefon aftale" },
    { "day": "Sunday", "open": "09:00", "close": "18:00", "note": "efter telefon aftale" }
  ],
  "practitioner": {
    "name": "Luan",
    "title": "Akupunkturlæge",
    "credentials": ["RAB-godkendt", "Uddannet i Traditionel Kinesisk Medicin"],
    "specialties": ["Smertebehandling", "Hovedpine", "Stress", "Allergi"]
  },
  "insurance": ["Sygeforsikringen Danmark", "PFA", "Danica", "Pensam", "AP Pension", "TopDanmark"],
  "sameAs": [],
  "aboutSummary": "Kinesisk RAB-godkendt akupunkturlæge i Virum med speciale i smertebehandling, hovedpine, søvnløshed, stress og allergi."
}
```

#### `structured/colors.json`

```json
{
  "source": "extracted from original site",
  "schemes": [
    {
      "id": "scheme-a",
      "name": "Original (modernized)",
      "colors": {
        "primary": "#2E5E4E",
        "primary-light": "#4A8B76",
        "primary-dark": "#1D3D33",
        "bg": "#FFFFFF",
        "bg-alt": "#F8F9FA",
        "text": "#1A1A1A",
        "text-muted": "#6B7280",
        "accent": "#D4A574",
        "border": "#E5E7EB"
      }
    },
    {
      "id": "scheme-b",
      "name": "Warm variant",
      "colors": { "..." : "..." }
    },
    {
      "id": "scheme-c",
      "name": "Cool variant",
      "colors": { "..." : "..." }
    }
  ]
}
```

#### `structured/pages/` 目录

每个页面一个 `.md` 文件，frontmatter 定义元数据：

```markdown
---
# structured/pages/index.md
slug: ""
title: "Virum Akupunktur — Smertebehandling i Virum"
description: "Godkendt kinesisk RAB akupunkturlæge i Virum. Sikre, effektive, afslappende smertebehandling uden medicin."
pageType: "home"
originalUrl: "https://virumakupunktur.dk/"
---

[原文内容，一字不改，Markdown 格式]
```

```markdown
---
# structured/pages/ydelser/smertebehandling.md
slug: "ydelser/smertebehandling"
title: "Smertebehandling i Virum | Virum Akupunktur"
description: "Effektiv akupunktur smertebehandling i Virum. Behandling af rygsmerter, nakkesmerter, hovedpine og kroniske smerter."
pageType: "service"
serviceName: "Smertebehandling"
serviceDescription: "Effektiv akupunktur mod akutte og kroniske smerter"
originalUrl: "https://virumakupunktur.dk/our-team/smertebehandling"
isEmpty: false
---

[原文内容，一字不改]
```

```markdown
---
# 空白页示例
slug: "ydelser/eksem"
title: "Eksem behandling i Virum | Virum Akupunktur"
description: "Akupunktur mod eksem i Virum."
pageType: "service"
serviceName: "Eksem"
serviceDescription: "Akupunktur mod eksem"
originalUrl: "https://virumakupunktur.dk/our-team/eksem"
isEmpty: true
---

<!-- 原站此页无内容 -->
```

#### `structured/faq.json`

```json
{
  "items": [
    {
      "question": "Hvad er akupunktur?",
      "answer": "[从原站 /our-team/hvad-er-akupunktur 页面提取的内容摘要]"
    },
    {
      "question": "Hvordan foregår en behandling?",
      "answer": "[从原站 /our-team/hvordan-foregar-en-behandling 提取]"
    },
    {
      "question": "Dækker min sundhedsforsikring akupunktur?",
      "answer": "Ja. Som RAB-godkendt akupunktør er behandlinger dækket af Sygeforsikringen Danmark, PFA, Danica, Pensam, AP Pension, TopDanmark og flere andre."
    },
    {
      "question": "Hvad koster en behandling?",
      "answer": "Første prøvebehandling: 450 kr. (ca. 75 min). Efterfølgende behandling: 600 kr. (ca. 60 min). Klippekort tilgængelige."
    },
    {
      "question": "Hvor ligger klinikken?",
      "answer": "Dalstrøget 78, 4, 2870 Dyssegård. Tæt på Vangede S-togstation (linje B) og buslinjer 164, 4A, 6A."
    }
  ]
}
```

**FAQ 提取原则**：只从原站已有内容中提炼。不凭空生成新问答。上面示例中第 3–5 条的答案文本都来自原站首页的价格/保险/交通信息。

---

## 块 2：自动化工作流

### 前提条件

块2 需要以下 API，如果暂时没有，用手动模式替代：

| 依赖 | 用途 | 手动替代 |
|---|---|---|
| Firecrawl API key | 整站抓取 | `curl` 逐页抓取 + 手动保存 |
| Anthropic API key | 内容结构化 | 粘贴到 Claude.ai 手动处理 |
| GitHub Personal Access Token | 自动创建 repo | 手动在 GitHub 网页创建 |

### Step 1：适配检测（01-check-compatibility）

**输入**：一个 URL
**逻辑**：
1. 用 Firecrawl（或 fetch）抓取首页 HTML
2. 检查：
   - 页面是否返回 200 状态码
   - 提取到的文本长度 > 200 字符（排除纯 JS 渲染的空壳）
   - 是否有 `<nav>` 或多个内部链接（排除单页应用/落地页）
   - 是否有联系信息（电话/地址/邮件至少一项）
   - 是否在登录墙后面
3. **输出**：
   - `compatible: true/false`
   - `page_count_estimate: number`（从导航链接估算）
   - `platform_guess: string`（从 meta-generator 或特征识别）
   - `warnings: string[]`（如"部分内容可能依赖 JS 渲染"）

### Step 2：整站抓取（02-scrape-site）

**输入**：一个 URL + 客户名（用于目录命名）
**逻辑**：
1. 使用 Firecrawl `/crawl` 端点抓取整站（或手动模式下逐页 curl）
2. 对每个页面保存：
   - `raw/pages/[slug].md`：Markdown 格式的页面内容
   - `raw/pages/[slug].meta.json`：URL、标题、meta description、图片列表
3. 下载所有图片到 `raw/images/`
   - 保持原始文件名
   - 记录 URL→本地路径映射到 `raw/image-map.json`
4. 记录整站导航结构到 `raw/sitemap.json`

**手动模式**：
```bash
# 逐页抓取（用 curl + 粘贴到 Claude.ai）
curl -s "https://virumakupunktur.dk/" > raw/pages/index.html
curl -s "https://virumakupunktur.dk/our-team/" > raw/pages/behandling.html
curl -s "https://virumakupunktur.dk/services" > raw/pages/priser.html
curl -s "https://virumakupunktur.dk/contact" > raw/pages/kontakt.html
# ... 对每个治疗子页面重复

# 提取图片 URL 列表
grep -oP 'src="[^"]*\.(jpg|jpeg|png|gif|webp|svg)[^"]*"' raw/pages/*.html | \
  sed 's/src="//;s/"//' | sort -u > raw/image-urls.txt

# 下载图片
wget -i raw/image-urls.txt -P raw/images/ --no-clobber
```

### Step 3：内容结构化（03-structure-content）

**输入**：`raw/` 目录的所有文件
**输出**：`structured/` 目录，符合上面定义的 data contract
**逻辑**：

1. **提取 business.json**：
   - 从首页/联系页提取 NAP、营业时间、电话、邮件、预订链接
   - 从 meta 标签提取 og:title、description
   - 从页面内容提取从业者信息、保险覆盖列表
   - 补全 geo 坐标（从 Google Maps embed URL 提取，或用 Geocoding API）
   - **不修改任何事实信息，只格式化**

2. **生成 pages/\*.md**：
   - 对每个原始页面生成一个 Markdown 文件
   - frontmatter 包含 slug、title（GEO 优化的 meta title）、description、pageType
   - 正文 = 原始文本内容，一字不改
   - 标记空白页 `isEmpty: true`

3. **生成 faq.json**：
   - 从 "Hvad er akupunktur" 和 "Hvordan foregår en behandling" 等页面提取 Q&A
   - 从价格/保险/位置信息构造常见问题（答案文本来自原站）
   - 不凭空生成

4. **生成 colors.json**：
   - 从原站 CSS/HTML 提取主色调
   - 生成 3 套配色变体：
     - Scheme A：原色现代化
     - Scheme B：暖色调变体
     - Scheme C：冷色调变体

**Claude API 提示词**（用于自动模式的 Step 3）：

```
你是一个网站内容提取专家。以下是一个丹麦语针灸诊所网站的原始 HTML 内容。

任务：将内容提取为结构化 JSON，严格遵守以下规则：
1. 一字不改原文内容——只做格式转换，不做任何编辑、翻译或改写
2. 空白页标记为 isEmpty: true
3. Meta title 格式："[页面主题] i [城市] | [业务名称]"
4. Meta description：每页唯一，包含城市+服务，≤155 字符
5. 从原站内容中提炼 FAQ（不凭空生成）
6. 保留所有外部链接（Planway booking、Google Maps、Facebook）

输出格式：[附上 data contract schema]

原始内容：
[粘贴 raw/ 内容]
```

### Step 4：生成站点（04-generate-site）

**输入**：`structured/` 目录 + `template/` 目录
**逻辑**：
1. 复制 `template/` 到 `clients/[name]/site/`
2. 将 `structured/business.json` 复制到 `site/src/data/`
3. 将 `structured/pages/*.md` 复制到 `site/src/content/`
4. 将 `structured/faq.json` 复制到 `site/src/data/`
5. 将 `raw/images/` 复制到 `site/src/assets/images/`（如果 Astro Image 组件需要）
6. 将 `structured/colors.json` 中的 3 套配色分别注入，构建 3 次
7. `npm install && npm run build`
8. 输出 3 个 `dist/` 目录（scheme-a/, scheme-b/, scheme-c/）

### Step 5：质检（05-quality-check）

**输入**：构建好的 `dist/` 目录
**逻辑**：
1. **JSON-LD 验证**：
   - 提取每页 `<head>` 中的 JSON-LD
   - 验证 `LocalBusiness` schema 是否完整（name/address/phone/hours 全部存在）
   - 验证 FAQ 页的 `FAQPage` schema
   - 验证服务页的 `Service` schema
2. **内容完整性**：
   - 对比原站页面数 vs 生成站页面数
   - 检查图片引用是否全部指向本地路径（不再引用 one.com CDN）
   - 检查所有外部链接（Planway booking）是否保留
3. **SEO 基础卫生**：
   - 每页有唯一的 `<title>` 和 `<meta name="description">`
   - 每页 H1 唯一
   - 所有图片有 alt 属性
   - `robots.txt` 存在且 AI 爬虫被允许
   - `llms.txt` 存在且包含业务核心信息
   - `sitemap.xml` 存在
4. **Lighthouse**（如果 CLI 可用）：
   - Performance ≥ 90
   - SEO ≥ 95
   - Accessibility ≥ 90
5. **输出**：`quality-report.json` + 终端摘要

---

## CLAUDE.md（给 Claude Code 的项目规则）

```markdown
# GEO Reforge — Project Rules

## 这个项目是什么
一套可复用的"输入URL → 输出GEO原生静态站"的工作流。
包含：Astro GEO 模板（块1）+ 自动化脚本（块2）。

## 绝对红线
1. **一字不改原则**：客户网站的文字内容只做格式转换，永不编辑、永不翻译、永不改写
2. **保留所有外部链接**：Planway/Booking 链接、Google Maps、Facebook 等原样保留
3. **不凭空生成内容**：FAQ 只从现有内容提炼；JSON-LD 只反映页面可见事实
4. **不修改 NAP**：名称/地址/电话从原站提取，不做核实/修正（用户负责准确性）
5. **空白页标 noindex**：原站的空白页保留但加 noindex meta（避免 AI 抓空壳）
6. **静态 HTML only**：构建输出不含任何客户端 JavaScript（AI 爬虫不渲染 JS）

## 技术约束
- Astro 5.x SSG 模式
- 纯 CSS（不用 Tailwind）
- 系统字体栈（不加载外部字体）
- 图片用 Astro `<Image>` 组件自动优化
- Content Collections 管理 Markdown 内容

## 构建顺序
1. 先完成块1（GEO 模板）并用硬编码的示例数据验证构建通过
2. 再完成块2（自动化脚本）
3. 用块2处理 virumakupunktur.dk 的真实数据，填入块1，验证端到端

## 目录规范
- template/ — 可复用模板（不含客户数据）
- scripts/ — 自动化脚本
- clients/[name]/raw/ — 原始抓取
- clients/[name]/structured/ — 结构化数据
- clients/[name]/site/ — 生成的 Astro 项目
```

---

## 执行顺序建议

```
Phase 1（块1，无需 API）:
  1. 创建 Astro 项目骨架 (template/)
  2. 实现 GEO 标准页面结构（所有页面模板）
  3. 实现 JSON-LD 组件
  4. 实现 CSS 变量系统 + 3 配色切换
  5. 实现 llms.txt 自动生成
  6. 用硬编码的 virum-akupunktur 示例数据验证构建
  7. 跑 Lighthouse，确认 Performance≥90 / SEO≥95

Phase 2（块2，需要 API 或手动替代）:
  1. 实现适配检测脚本
  2. 实现整站抓取脚本（Firecrawl / 手动 curl）
  3. 实现内容结构化脚本（Claude API / 手动）
  4. 实现站点生成脚本（复制模板 + 填数据 + 构建）
  5. 实现质检脚本
  6. 端到端测试：virumakupunktur.dk → 3 个可部署站点

Phase 3（验证）:
  选最佳方案 → 部署到 CF Pages → 接 Sitepins CMS → 记录全程工时和成本
```
