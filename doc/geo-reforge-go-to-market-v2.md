# Found by AI — Go-To-Market v2.0

> 版本 v2.0 · 2026-06-22 · 执行文档
> 品牌: foundbyai.dk
> 内部仓库: geomvp
> 状态: 全部决策已对齐,可执行

---

## 一、产品定义(一句话)

客户不改网站、不换主机——只改一行 DNS,AI 搜索引擎就开始推荐他们的业务。

**技术实现**: Edge Proxy(Vercel Edge Middleware)在客户现有网站和互联网之间插入透明代理层,实时注入 JSON-LD schema + 优化 meta + robots.txt + sitemap。对人类访客完全透明。

**已验证数据(virumakupunktur.dk,部署 3 天)**:

| 指标 | 数据 |
|---|---|
| AI 检索爬虫访问 | 12 次(ChatGPT-User 9, PerplexityBot 4, ClaudeBot 1, OAI-SearchBot 1) |
| GEO Schema 注入成功率 | 100%(73 页) |
| AI 品牌提及率 | 2/15 prompt(从 0 起步) |
| AI 域名引用率 | 5/15 prompt |
| 真实访客影响 | 零(111 次访问完全透明通过) |
| Otterly 竞品排名 | 同品类第 2(13% domain coverage) |

---

## 二、定价

| 项目 | 金额 |
|---|---|
| 免费试用 | 30 天(需验证信用卡) |
| 月费 | 199 DKK/月(约 €27) |
| 合约 | 无锁定,随时取消 |
| 扣费提醒 | 首次扣费前 7 天邮件通知 |
| 退款政策 | 30 天内不满意全额退 |

**支付**: Stripe Billing,支持 MobilePay + 信用卡。`trial_period_days: 30`。

**锚点话术**: "Robin/Eniro 收 600 kr/月并锁 12 个月。Found by AI 收 199 kr/月,随时取消,效果更好。"

---

## 三、目标市场

### 首批行业(哥本哈根)

| 优先级 | 行业 | 丹麦语搜索词 | 理由 |
|---|---|---|---|
| 🥇 | 针灸 | Akupunktur | 有 case study + Otterly 基线数据 |
| 🥈 | 脊椎治疗 | Kiropraktor | 同画像(RAB/受保护、保险报销、独立执业) |
| 🥉 | 心理咨询 | Psykolog, Psykoterapeut | 高度个性化 AI 推荐场景 |

### 合格客户筛选条件

| 条件 | 必须 | 理由 |
|---|---|---|
| 有网站 | ✅ | 产品前提 |
| 托管在 one.com 或标准 VPS | ✅ | DNS A 记录可改 |
| 网站无 JSON-LD | ✅ | GEO 增量空间 |
| Google 评分 ≥ 3.5 | 建议 | 低分商户即使被 AI 推荐也不利 |
| 不在 Wix/Shopify/Squarespace | ✅ | DNS 锁定,不兼容 |

---

## 四、用户旅程(完整流程)

### Phase 0: Lead 生成(后台,用户不可见)

```
Outscraper 抓取 Google Maps 数据(Akupunktur/Kiropraktor/Psykolog, Copenhagen)
    ↓
01-fetch-leads.ts: CSV → 过滤(有网站 + 评分≥3.5) + 抓取邮箱
    ↓
02-check-compatibility.ts: 平台识别 + JSON-LD 检测 + A 记录可改性
    ↓
03-rank-leads.ts: A/B/C 评级排序
    ↓
A 级 leads → 进入邮件队列
```

### Phase 1: 冷邮件触达

**发送工具**: Resend(免费 100 封/天,自定义域名 foundbyai.dk)

**邮件模板(丹麦语)**:

```
Emne: [商户名] mangler i ChatGPTs anbefalinger for København

Hej [名字],

Jeg testede i dag, hvad ChatGPT svarer, når man søger 
"bedste [行业] i København". Din konkurrent [竞争对手名] 
bliver anbefalet — men [商户名] dukker ikke op.

Årsagen er teknisk: din hjemmeside mangler et "AI-læsbart 
lag" som ChatGPT og Perplexity kræver for at anbefale dig.

Vi har analyseret [domæne] og kan tilføje dette lag — 
uden at ændre noget på din hjemmeside.

→ Se hvad AI mangler om din virksomhed:
  https://foundbyai.dk/activate/[token]

De første 30 dage er gratis.

Venlig hilsen,
Blake
foundbyai.dk

---
Ønsker du ikke at høre fra os? Afmeld her: [link]
```

**关键设计**:
- 主题行包含商户名 + ChatGPT
- 竞争对手真名(从 Outscraper 数据获取)
- 零技术术语
- CTA 是"看看 AI 缺了什么"(好奇心),不是"买我的产品"
- GDPR 合规:退订链接 + B2B 商业邮箱 + 业务相关内容

### Phase 2: 激活页面(foundbyai.dk/activate/[token])

**认证机制**: 邮件中的链接包含唯一 token(绑定 client_id + 邮箱)。点击即"登录",无需注册/密码。Token 有效期 7 天,过期后需重新发送。

**页面结构(三步流程)**:

```
┌──────────────────────────────────────────────────┐
│  foundbyai.dk/activate/[token]                   │
│                                                  │
│  ┌─────────────────────────────────────────────┐ │
│  │ Din hjemmeside: virumakupunktur.dk           │ │
│  │ AI-synlighedsscore: ██░░░░░░░░ 2/10         │ │
│  │ Dine konkurrenter i gennemsnit: ██████░ 7/10│ │
│  └─────────────────────────────────────────────┘ │
│                                                  │
│  ─── TRIN 1/3: Bekræft dine oplysninger ───      │
│                                                  │
│  状态: 页面加载时触发 Claude API 提取             │
│  显示: "Analyserer din hjemmeside..." 加载动画    │
│  完成后:                                         │
│  ┌─────────────────────────────────┐             │
│  │ Virksomhedsnavn: [可编辑]      │             │
│  │ Adresse: [可编辑]              │             │
│  │ Telefon: [可编辑]              │             │
│  │ Åbningstider: [可编辑]         │             │
│  │ Ydelser: [可展开/编辑]         │             │
│  │                                │             │
│  │ 🔒 Domæne: virumakupunktur.dk │ [锁定]      │
│  │ 🔒 Nuværende hosting: one.com │ [锁定]      │
│  └─────────────────────────────────┘             │
│  ☑ Ovenstående er korrekt og må bruges til       │
│    AI-søgeoptimering.                            │
│                               [BEKRÆFT ✓]       │
│                                                  │
│  ─── TRIN 2/3: Aktiver GEO Layer ───             │
│  (Trin 1 完成后解锁)                              │
│                                                  │
│  De første 30 dage er helt gratis.               │
│  Herefter 199 kr/md. Opsig når som helst.        │
│  Du får besked 7 dage før første betaling.        │
│                                                  │
│       [ START GRATIS PRØVEPERIODE ]              │
│       → Stripe Checkout (信用卡/MobilePay)       │
│                                                  │
│  Ved at aktivere accepterer du vores             │
│  privatlivspolitik og servicevilkår.             │
│                                                  │
│  ─── TRIN 3/3: Forbind din hjemmeside ───        │
│  (Trin 2 完成后解锁)                              │
│                                                  │
│  Tilføj denne A-record i din DNS:                │
│  ┌───────────────────────┐                       │
│  │ 76.xxx.xxx.xxx        │ [KOPIÉR]             │
│  └───────────────────────┘                       │
│                                                  │
│  Vi har registreret at din side er hos one.com.  │
│  📖 Sådan ændrer du DNS hos one.com [SE GUIDE →] │
│                                                  │
│  Status: ⏳ Venter på DNS-ændring...             │
│  (Vi tjekker automatisk hvert 5. minut)          │
│                                                  │
│  ─── DNS 验证通过后 ───                           │
│                                                  │
│  ✅ Dit GEO Layer er nu aktivt!                   │
│  → Se dit dashboard: [GÅ TIL DASHBOARD]         │
│                                                  │
└──────────────────────────────────────────────────┘
```

**技术要点**:
- 内容提取在用户点击链接时触发(不是发邮件时),加载状态增加感知价值
- 编辑内容暂存在服务端 draft 状态,付款前不持久化
- Stripe Checkout 会话在 Trin 2 按钮点击时创建
- DNS 轮询:后台每 5 分钟 resolve 客户域名,检测 A 记录是否切换
- DNS 验证通过 → 自动激活 GEO 层 → 发送确认邮件 → 无需用户再操作
- DNS 修改 = 所有权验证(能改 A 记录 = 控制域名)

### Phase 3: 上线后(持续)

| 频率 | 动作 | 渠道 |
|---|---|---|
| 实时 | GEO 层运行,AI 爬虫获取增强内容 | 自动(Edge Proxy) |
| 每日 | Dashboard 更新 bot 访问数据 | 自动(Vercel logs) |
| 每周 | Otterly 数据更新到 Dashboard | 手动(你截图/导入) |
| 每月 | 月度报告邮件(AI 提及率 + 竞品对比 + 建议) | 半自动(模板+手动数据) |
| 按需 | 客户修改业务信息 → JSON-LD 更新 | Dashboard 自助 → 你审核 → 重新部署 |

---

## 五、Lead 获取自动化

### 工具链

| 工具 | 用途 | 成本 |
|---|---|---|
| Outscraper | Google Maps 数据抓取 | 免费 500 条/月 |
| Resend | 邮件发送 | 免费 100 封/天 |
| Stripe | 支付 | 1.4% + 1.8 DKK/笔(丹麦卡) |
| Otterly AI Lite | AI 可见度监测 | $29/月(覆盖 3 客户 × 5 prompt) |
| Vercel | Edge Proxy 托管 | 免费(100 万次/月) |
| Claude API | 内容提取 | ~$0.50/站 |

### 脚本流水线

```
scripts/marketing/
├── 01-fetch-leads.ts         Outscraper CSV → 清洗 → 提取邮箱 → raw-leads.json
├── 02-check-compatibility.ts 平台识别 + JSON-LD + A 记录可改性 → leads-scored.json
├── 03-rank-leads.ts          综合评分(兼容性40% + 评分20% + 评论数20% + 行业20%)
└── 04-send-invites.ts        Resend API → 个性化丹麦语邮件(含 token link)
```

### A/B/C 评级

| 级别 | 条件 | 行动 |
|---|---|---|
| **A** | one.com 或标准托管 + 无 JSON-LD + 活跃 + 评分≥3.5 | 立即外联 |
| **B** | WordPress 自托管 + 无 JSON-LD | 外联,备注可能需额外配置 |
| **C** | Wix/Shopify/已有 JSON-LD/不活跃 | 不外联,存档 |

---

## 六、经济模型

### 单客户经济

| 项目 | 金额 |
|---|---|
| **月费收入** | 199 DKK |
| **COGS** | |
| — Otterly 分摊(Lite $29 ÷ 3 客户) | ~70 DKK |
| — Vercel 托管 | 0 DKK |
| — Claude API(一次性提取,摊月) | ~3 DKK |
| — Stripe 手续费(1.4%+1.8kr) | ~5 DKK |
| **月 COGS 合计** | ~78 DKK |
| **月毛利** | ~121 DKK |
| **毛利率** | ~61% |

### 规模化场景

| 客户数 | MRR | Otterly 层级 | 月 COGS | 月毛利 |
|---|---|---|---|---|
| 3 | 597 DKK | Lite $29 | 234 DKK | 363 DKK |
| 10 | 1,990 DKK | Standard $189 × 1 | 1,130 DKK | 860 DKK |
| 20 | 3,980 DKK | Standard $189 × 1 | 1,600 DKK | 2,380 DKK |
| 50 | 9,950 DKK | Standard $189 × 2 | 4,170 DKK | 5,780 DKK |

> 注:10 客户起 Otterly 升级 Standard($189/月,100 prompt ÷ 5/客户 = 20 客户)。COGS 含 Otterly + Stripe 手续费。Vercel 和 Claude API 边际成本趋零。

### 你的时间投入

| 阶段 | 每客户工时 | 内容 |
|---|---|---|
| Onboarding | ~1h | 邮件沟通 + 内容审核 + DNS 协助 |
| 月度维护 | ~15min | Otterly 数据更新 + 月报 |
| 年度 | ~1h | 内容刷新 + GEO 策略调整(可收费) |

---

## 七、监测配置(Otterly)

### 分配策略

| 层级 | 客户数 | Prompt/客户 | Otterly 计划 | 月费 |
|---|---|---|---|---|
| ≤3 客户 | 1–3 | 5 | Lite($29) | ~200 DKK |
| 4–10 客户 | 4–10 | 5 | Lite × 2($58) | ~400 DKK |
| 11–20 客户 | 11–20 | 5 | Standard($189) | ~1,300 DKK |

### 每客户 5 prompt 设计原则

| # | 类型 | 示例(针灸) | 目的 |
|---|---|---|---|
| 1 | 宽泛本地发现 | Kan du anbefale en god [行业] i København? | 基线锚点 |
| 2 | 精确区域 | [行业] i [客户所在区域名] | 命中本地地名 |
| 3 | 核心服务+位置 | [核心服务] i København – hvem er bedst? | 服务匹配 |
| 4 | 差异化卖点 | [差异点，如保险覆盖/特殊资质] i København | 卖点验证 |
| 5 | 品牌查询 | [商户名] – hvad siger folk om dem? | 品牌感知 |

---

## 八、法律文件(最小可行)

### 上线前必须有

| 文件 | 位置 | 内容要点 |
|---|---|---|
| Privatlivspolitik | foundbyai.dk/privacy | 收集数据(邮箱/域名/业务信息)、用途(GEO优化)、存储(EU/Cloudflare/Vercel)、GDPR 权利 |
| Servicevilkår | foundbyai.dk/terms | 订阅条款、30天免费、随时取消、**不保证排名**(硬约束)、DNS修改为客户自愿行为 |
| Cookie-politik | foundbyai.dk/cookies | 极简——产品本身几乎不用 cookie |

### "不保证排名"条款(必须显眼)

> "Found by AI optimerer din hjemmesides tekniske læsbarhed for AI-søgemaskiner. Vi garanterer IKKE placering i specifikke AI-svar eller søgeresultater. AI-motorers anbefalinger afhænger af mange faktorer uden for vores kontrol."

---

## 九、开发路线图

### P1: 获客基础设施(本周)

| 编号 | 任务 | 预计工时 | 产出 |
|---|---|---|---|
| P1-1 | Lead 获取脚本(Outscraper → 清洗 → 评级) | 1 天 | leads-ranked.json |
| P1-2 | 兼容性检测脚本(平台识别 + JSON-LD) | 半天 | leads-scored.json |
| P1-3 | 冷邮件模板(丹麦语 × 3 行业) | 半天 | 3 个邮件模板 |
| P1-4 | Resend 配置(foundbyai.dk 域名验证) | 2h | 可发送状态 |

### P2: 激活页面(下周)

| 编号 | 任务 | 预计工时 | 产出 |
|---|---|---|---|
| P2-1 | 激活页面 UI(三步流程) | 2 天 | /activate/[token] 页面 |
| P2-2 | 内容提取 API(Claude API 调用) | 半天 | POST /api/extract → draft 数据 |
| P2-3 | Stripe Checkout 集成 | 半天 | 订阅创建 + 试用期 |
| P2-4 | DNS 轮询检测 | 2h | 自动激活逻辑 |
| P2-5 | 确认邮件(上线通知) | 2h | Resend 模板 |

### P3: 法律 + Landing Page(第三周)

| 编号 | 任务 | 预计工时 | 产出 |
|---|---|---|---|
| P3-1 | 隐私政策 + 服务条款(丹麦语) | 半天 | /privacy + /terms |
| P3-2 | Landing page(foundbyai.dk 首页) | 1 天 | 产品介绍 + case study + CTA |
| P3-3 | one.com DNS 修改图文教程 | 2h | Notion/MD 页面,嵌入激活流程 |

### P4: 增长(第四周起)

| 编号 | 任务 | 预计工时 | 产出 |
|---|---|---|---|
| P4-1 | 发送首批冷邮件(30 封,A 级 leads) | 半天 | 发送记录 |
| P4-2 | 跟进回复 + 安排 demo | 按需 | 转化记录 |
| P4-3 | 第二批冷邮件(如果首批有效) | 半天 | 扩大发送 |
| P4-4 | 多客户 Worker 动态路由(第 3 个客户前) | 1 天 | 动态 client 配置 |

---

## 十、前 30 天成功指标

| 指标 | 目标 | 衡量方式 |
|---|---|---|
| A 级 Leads | ≥ 50 条 | leads-ranked.json 中 A 级数量 |
| 冷邮件发出 | ≥ 30 封 | Resend 发送记录 |
| 邮件打开率 | ≥ 40% | Resend analytics |
| 链接点击率 | ≥ 15% | 激活页面访问数 |
| 激活页面完成 Step 1 | ≥ 5 | 确认内容的客户数 |
| 完成 Step 2(付款) | ≥ 2 | Stripe 订阅数 |
| 完成 Step 3(DNS,全流程) | ≥ 1 | GEO 层在线客户数(除 virum) |
| **终极指标:第一个陌生付费客户** | **1 人** | **从收到邮件到 GEO 上线的完整闭环** |

---

## 十一、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 客户不会改 DNS | 高 | 流程卡在 Step 3 | one.com 专属图文教程 + 15 分钟视频通话协助(已付费客户值得) |
| AI 提及率在 30 天内无明显变化 | 中 | 试用期结束前客户取消 | 月报强调 baseline 对比(Schema 0→38) + 竞品排名("你已经领先 3 家竞争对手") |
| 冷邮件回复率 <5% | 中 | 获客成本过高 | 调整邮件 hook(测试不同竞争对手名/不同行业) + 增加个性化程度 |
| one.com 更改 HTML 结构 | 低 | HTMLRewriter 选择器失效 | 页面存活监控 + 选择器自动测试(每周) |
| 竞品出现同类产品 | 低(短期) | 价格竞争 | 先发优势 + 客户关系 + 丹麦语本地化 |

---

*文档维护: blake · foundbyai.dk · 仓库: geomvp/docs/geo-reforge-go-to-market-v2.md*
