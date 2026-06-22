# GEO Reforge — 商业化上线计划
> 版本 v0.1 · 2026-06-22 · 内部讨论稿

---

## 一、产品是什么

**GEO Reforge** 是一个「GEO 层即服务」（GEO-as-a-Service）产品。

GEO（Generative Engine Optimization）是 SEO 在 AI 时代的进化版：当用户向 ChatGPT、Perplexity、Claude 等 AI 引擎提问「哥本哈根最好的针灸师在哪里」时，AI 的回答取决于它抓取到的网页内容质量——而不是关键词排名。

**GEO Reforge 做的事：** 在客户现有网站和互联网之间插入一个透明的边缘代理层（Edge Proxy），在 AI 爬虫访问时实时注入结构化内容（JSON-LD schema、语义化标记）。对普通人类访客完全透明，无感知。

### 核心价值主张

```
客户无需改网站，只需改一行 DNS → AI 引擎开始准确推荐他们的业务
```

### 已验证数据（virumakupunktur.dk，部署 3 天）

| 指标 | 数据 |
|------|------|
| AI 爬虫访问次数 | 12 次（ChatGPT-User、ClaudeBot、PerplexityBot 等） |
| SEO 爬虫 | 15 次 |
| 真实访客 | 110 次（完全透明通过，零影响） |
| GEO Schema 注入成功率 | 100% |

---

## 二、技术架构（客户视角）

```
客户现在:
用户浏览器 → 客户网站（one.com / 自建）

部署 GEO Reforge 后:
用户浏览器 → [GEO Edge Proxy] → 客户网站（one.com / 自建）
                    ↑
              AI 爬虫在这里得到增强内容
              普通访客完全透明通过
```

### DNS 要求（唯一技术门槛）

客户需要将域名的 **A 记录** 从当前托管商 IP 改为 GEO Reforge 的边缘代理 IP。

```
修改前：example.dk  A  185.xxx.xxx.xxx（one.com 服务器）
修改后：example.dk  A  76.xxx.xxx.xxx（GEO Reforge 边缘节点）
```

**生效时间：** DNS 传播通常 5–30 分钟，最长 48 小时。  
**可逆性：** 随时可以改回，零风险。

### 兼容性要求

| 平台 | 兼容性 | 原因 |
|------|--------|------|
| **one.com** | ✅ 完美兼容 | DNS A 记录可自由修改 |
| **标准 VPS / cPanel** | ✅ 完美兼容 | 同上 |
| **WordPress（自托管）** | ✅ 兼容 | 同上 |
| **Wix** | ❌ 不兼容 | DNS 锁定，无法修改 A 记录 |
| **Shopify** | ❌ 不兼容 | 同上 |
| **Squarespace** | ❌ 不兼容 | 同上 |
| **已有完整 JSON-LD** | ⚠️ 低价值 | GEO 效益有限 |

---

## 三、目标市场

### 为什么是「本地健康/wellness 独立执业者」

1. **高 AI 搜索意图**：用户向 AI 问「哥本哈根背痛治疗推荐」的频率远高于搜索引擎
2. **独立从业者为主**：无连锁品牌的技术团队，DNS 修改对他们不复杂但通常未完成
3. **网站简单**：大量使用 one.com 建站器（完美兼容），无 JSON-LD，GEO 增益空间大
4. **有具体 case study**：virumakupunktur.dk 的真实数据可以直接作为销售材料

### 首批目标行业（哥本哈根）

| 优先级 | 行业 | 丹麦语搜索词 | 理由 |
|--------|------|-------------|------|
| 🥇 1 | 针灸 | `Akupunktur` | 有现成 case study，冷邮件转化率最高 |
| 🥈 2 | 脊椎治疗师 | `Kiropraktor` | 极相似客群，AI 搜索「背痛」意图强 |
| 🥉 3 | 心理咨询师 | `Psykolog`, `Psykoterapeut` | 高度个性化推荐场景（"专注焦虑的治疗师"） |
| 4 | 理疗师 | `Fysioterapeut` | 受伤/术后人群首问 AI |

### 为什么从哥本哈根开始

- 市场密度最高，同类诊所集中，竞争意识强
- virum 位于哥本哈根大区，案例地理相关性强
- 后续 in-person 跟进成本最低
- 数字化意识高于其他丹麦城市，更易接受新工具

---

## 四、客户获取流水线

### 数据来源：Outscraper（Google Maps Scraper）

**工具：** Outscraper Google Maps Scraper  
**免费额度：** 500 条/月（无需绑卡）  
**成本：** 超出后约 $3 / 1000 条

**抓取参数配置：**
```
Mode: Plain queries（开启）
Query: Akupunktur / Kiropraktor / Psykolog
Location: Copenhagen, Denmark
Limit: 50-100（测试阶段）
Email enhance: 跳过（自建脚本提取）
```

### 自动化脚本流水线

```
scripts/marketing/
├── 01-fetch-leads.ts         → Outscraper CSV → 过滤（有网站+评分≥3.5）
│                                 + 自动 fetch /kontakt 页提取邮箱
│                                 → raw-leads.json
│
├── 02-check-compatibility.ts → 批量检测每个网站：
│                                 · DNS A 记录可否修改（<meta generator> 识别平台）
│                                 · 是否已有 JSON-LD
│                                 · 网站是否活跃（HTTP 200）
│                                 · SSL 状态
│                                 → leads-scored.json（A/B/C 评级）
│
├── 03-rank-leads.ts          → 综合评分排序
│                                 兼容性 40% + Google 评分 20%
│                                 + 评论数 20% + 行业匹配 20%
│                                 → leads-ranked.json
│
└── 04-send-invites.ts        → Resend API 发送个性化冷邮件
                                  附 virumakupunktur.dk 案例数据
```

### A/B/C 评级标准

| 评级 | 条件 | 行动 |
|------|------|------|
| **A** | one.com 或标准托管 + 无 JSON-LD + 活跃网站 | 立即外联，优先签约 |
| **B** | WordPress 自托管 + 无 JSON-LD | 外联，说明可能需要额外配置 |
| **C** | Wix/Shopify + 或已有 JSON-LD + 不活跃 | 暂不外联，存档待后 |

---

## 五、客户 Onboarding 流程（D 方案）

### 核心设计理念

> **「两步上线」**：确认内容 + 修改 DNS。一个页面，两个操作，完成部署。

### 流程图

```
1. 销售转化（邮件/电话）
        ↓
2. 后台：抓取客户网站内容 → 构建 GEO layer（待激活状态）
        ↓
3. 给客户发送「激活邮件」（无需注册/登录）
        ↓
4. 客户打开「两步激活页面」
   ┌─────────────────────────────────────────────┐
   │  Step 1：确认您的业务信息                    │
   │  ┌─────────────────────────┐                │
   │  │ 业务名称: Virum Akupunktur│  [可编辑]     │
   │  │ 地址: Dalstrøget 78...  │  [可编辑]     │
   │  │ 电话: +45 25 72 42 65   │  [可编辑]     │
   │  │ 营业时间: Mon-Fri 9-18  │  [可编辑]     │
   │  └─────────────────────────┘                │
   │  ☑ 我确认以上信息准确，授权 GEO Reforge      │
   │    使用该内容进行 AI 搜索优化                 │
   │                                              │
   │  Step 2：将您的 DNS A 记录指向以下 IP        │
   │  ┌─────────────────────────┐                │
   │  │ 76.xxx.xxx.xxx          │  [一键复制]    │
   │  └─────────────────────────┘                │
   │  one.com 操作指南：[查看图文教程] →           │
   │                                             │
   │           [✓ 完成，我已修改 DNS]             │
   └─────────────────────────────────────────────┘
        ↓
5. GEO layer 激活（实时检测 DNS 传播）
        ↓
6. 客户收到「已上线」确认邮件 + Dashboard 查看链接
```

### D 方案的关键优势

| 维度 | 说明 |
|------|------|
| **内容责任转移** | Step 1 的勾选 + 时间戳记录，法律依据清晰 |
| **最低摩擦** | 无需注册、无需下载、无需学习，一个链接搞定 |
| **价值可见化** | 客户在确认前看到 GEO 将注入的完整内容（"wow moment"） |
| **DNS 教育内嵌** | 不需要客户事先了解 DNS，操作指南就在页面上 |
| **自动激活检测** | 系统轮询 DNS 传播，传播完成自动激活，无需客户再操作 |

### 技术实现要点

- **激活页面**：一次性 Token URL（无需登录），有效期 7 天
- **内容编辑**：字段可编辑，保存到 `config:{client}` KV，修改后立即更新 GEO layer
- **DNS 检测**：后台每 5 分钟 resolve 一次客户域名，检测 A 记录是否切换
- **平台教程**：针对 one.com / cPanel / Namecheap 等提供专属图文教程（Notion 页面即可）

---

## 六、开发路线图

### P1（获客 + 基础 Onboarding）

```
P1-1  两步激活页面（D 方案）
      · GET /activate/:token → 展示业务内容确认 + DNS 指引
      · PUT /activate/:token → 保存确认 + 标记待激活
      · 后台 DNS 轮询检测
      预计工时：2-3 天

P1-2  Lead 获取脚本
      · scripts/marketing/01-fetch-leads.ts
      · Outscraper CSV → 清洗 → 提取邮箱（fetch /kontakt）
      · 输出：raw-leads.json
      预计工时：半天

P1-3  兼容性批量检测脚本
      · scripts/marketing/02-check-compatibility.ts
      · 平台识别 + JSON-LD 检测 + A 记录可改性
      · 输出：leads-scored.json（A/B/C）
      预计工时：半天
```

### P2（增长基础设施）

```
P2-1  Landing Page（独立仓库）
      · 产品价值主张 + case study（virum 数据）
      · Waitlist CTA
      · geomvp 提供：POST /api/waitlist → KV 存储
      · 独立仓库，设计与产品逻辑分离
      预计工时：设计 1 天 + API 2h

P2-2  冷邮件外联
      · scripts/marketing/04-send-invites.ts
      · Resend API（免费 100 封/天）
      · 丹麦语模板（基于 virum case study）
      预计工时：半天
```

### P3（产品化）

```
P3-1  Dashboard 统一域名 + JWT 认证
      · 当前 dashboard 仅有 Bearer token，安全性不足
      · 域名：dash.geo-reforge.com
      · 时机：第 3-5 个付费客户后

P3-2  多客户管理
      · 当前硬编码 client = "virum"
      · 扩展为动态 client 路由
```

---

## 七、开放问题（待讨论）

1. **定价模型**：月费制 vs 按效果（AI 引用次数）付费？前期建议月费（简单、可预期）
2. **D 方案的内容编辑深度**：首版只做 NAP + 营业时间，还是包括服务列表？
3. **DNS 激活失败处理**：客户改了 DNS 但操作错误——客服流程是什么？
4. **平台教程制作**：one.com 用户占比预估多少？需要为其他平台制作教程吗？
5. **邮件外联合规**：丹麦 GDPR 对冷邮件的要求——需要律师意见还是有成熟实践参考？
6. **Landing Page 域名**：`geo-reforge.com` 是否已注册？还是先用 `georeforge.dk`（更本地化）？

---

## 八、成功指标（前 30 天）

| 指标 | 目标 |
|------|------|
| Leads 抓取（A 级） | ≥ 50 条（哥本哈根针灸/脊椎） |
| 冷邮件发出 | ≥ 30 封 |
| 回复率 | ≥ 10%（3 封以上） |
| Demo 完成 | ≥ 2 次 |
| 付费客户 | 1 个（除 virum 外） |

---

*文档维护：blake.designing@gmail.com · 仓库：geomvp/doc/geo-reforge-go-to-market.md*
