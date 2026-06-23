# Found by AI — 对齐系统完整规格文档

> 版本: v1.1 · 2026-06-23  
> 状态: 设计已定稿，开发进行中  
> 覆盖范围: 技术设计 + 产品决策 + 开发计划 + 集成架构

---

## 一、系统定位

对齐系统是 Found by AI 平台的**第三个核心数据层**，与现有两层并列：

```
Layer 1: Bot Traffic (Cloudflare AE)     ← 已上线
Layer 2: AI Search Visibility (Otterly)  ← 已上线
Layer 3: Platform Alignment (本系统)     ← 开发中
```

**核心职责：** 定期检测客户在丹麦关键平台（Google、Trustpilot、Krak、De Gule Sider、Facebook）上的存在状态与 NAP 一致性，生成可操作报告，自动同步 sameAs，量化客户 GEO 健康度。

---

## 二、完整设计决策记录

以下决策均经过深度讨论后确定，不可在开发中任意变更。

### 2.1 运行环境

| 决策 | 结论 | 理由 |
|---|---|---|
| 脚本运行环境 | Node.js + GitHub Actions | 对齐检测约 40s，超 Cloudflare Worker 30s CPU 限制；Outscraper/Claude API key 不需进 Worker 环境 |
| 触发机制 | GitHub Actions cron + `workflow_dispatch` 手动触发 | cron 处理周期性，dispatch 处理临时追加 |
| 触发周期 | Day1 / Day4 / 每两周 | Day1=基线建立；Day4=平台缓存刷新窗口（Krak 需 2-5 天）；每两周=持续监控 |

**触发周期逻辑（脚本自判断）：**
```
读取 alignment:${clientId}:history
├─ 无历史 + dns_ready_at 存在 → 运行 Day1 检测
├─ 有历史，最后检测 < Day4 → 运行 Day4 跟进检测
└─ 有历史，距上次检测 ≥ 14 天 → 运行月度检测
```

### 2.2 sameAs 更新策略

**结论：与用户行为完全解耦，每次检测后自动同步。**

```
[检测运行] → 发现平台状态 → sameAs 直接写入已确认平台的 URL
                     ↓ 解耦
           [发送通知邮件给客户] → 客户按自己时间去修平台
                     ↓ 解耦
           [下次检测] → 重新观测 → 如平台已修正 → sameAs 自动更新
```

原则：`sameAs` 只包含**本次检测实际验证为 OK** 的平台 URL。客户无需"确认"，我们的定期检测就是验证机制。

### 2.3 分数展示位置

**两个 view 的顶部统一展示 GEO Health Score 卡片（大字等级 + 数字分数）。**

- Ops view: `Block 6` 在顶部增加分数卡片
- Client view: `Layer 3` 顶部为 Grade 大卡，下方展示详细内容
- 无数据时显示 `--` 占位，不显示空卡片

### 2.4 DNS Ready 检测

**Worker 内置检测 + 首次对齐自动触发。**

```
GET /api/dns-check/:client
→ fetch 客户域名，检查 response header 含 X-GEO-Layer: active
→ 确认后：KV.put("dns_ready_at:${clientId}", ISO_timestamp)
```

GitHub Actions 日常 cron 检查 `dns_ready_at` 存在但无 alignment history → 运行首次对齐。

Client view 状态显示：
- `dns_ready_at` 为空 → `⏳ Afventer DNS (typisk 24-48t)`
- `dns_ready_at` 存在 → `✅ GEO Layer aktiv · Dag N`

### 2.5 NAP 比对语言

**Claude 输出保持丹麦语，Ops view 结构标签用英语，Client view 全丹麦语。**

理由：NAP 字段本身是丹麦语，翻译会引入语义损失；你能读丹麦语；双语翻译增加 API 成本和出错风险。

### 2.6 报告交付方式

**Dashboard 为 source of truth，通知邮件为轻量触达机制。**

```
对齐检测完成
  ↓ 写入 KV
  ↓ Dashboard 自动更新（Block 6 + Layer 3）
  ↓ Slack 即时通知你（你 QA）
  ↓ 延迟 3 小时后 → 发送通知邮件给客户
     邮件内容：简短 + 得分 + "查看您的建议清单 →" 链接
     （链接指向 client view dashboard，非完整 HTML 报告）
```

QA 窗口：你在 Slack 收到通知后，有 3 小时在 Dashboard 查看 Block 6，发现问题可在 Actions 取消邮件 job 或手动重跑检测。

### 2.7 客户 Dashboard 访问安全

**Per-client token + Magic link，复用现有 cookie auth 机制。**

```
KV: client_token:virum → random 32-char hex（长期有效）

Magic link URL: /?view=client&client=virum&token=<client_token>
  ↓ 首次点击
设置 HttpOnly Secure Cookie（30天）
  ↓ 之后
直接 cookie 访问，URL 干净
```

- 客户 token 与 ops token 完全独立
- `view=client` 时只渲染 Layer 1-3，无法访问 ops 数据
- Magic link 内嵌在通知邮件中

### 2.8 多客户化时机

**现在做最小化（URL param 替换硬编码），30 分钟内完成。**

```typescript
// Before: const client = "virum"
// After:
const client = url.searchParams.get("client") || "virum";
```

Dashboard URL: `/?client=virum&days=7&view=ops`

不现在做的（等客户增多）：每客户独立 auth token UI、客户注册管理页、客户列表页。

### 2.9 ClientData 数据来源

**`clients/[name]/client-profile.json`（新建，手动填充 canonical NAP）**

注意：`business.json` 当前有大量 null 字段（phone、address.street 等），无法直接用于对齐。对齐系统需要完整 NAP，通过新建 `client-profile.json` 手动录入客户确认的准确信息。

`client-profile.json` 是对齐系统的 canonical source，优先级高于 `business.json`（后者服务于 GEO 模板生成）。

### 2.10 GitHub Actions 通知

**Slack webhook + GitHub Actions Job Summary。**

```yaml
- name: Notify operator
  run: |
    curl -X POST ${{ secrets.SLACK_WEBHOOK_URL }} \
      -H 'Content-type: application/json' \
      --data '{"text":"✅ Alignment 完成 — *${{ inputs.client }}* 得分 ${{ steps.align.outputs.score }}\n📬 邮件 3 小时后发送\n🔍 https://dashboard.foundbyai.dk/?client=${{ inputs.client }}"}'
```

---

## 三、数据架构

### 3.1 KV Namespace（DASHBOARD_KV，新增 key）

| Key | 内容 | 写入方 |
|---|---|---|
| `alignment:${clientId}:latest` | `AlignmentReport` JSON | alignment script |
| `alignment:${clientId}:history` | `ScoreHistory` JSON（历史分数数组） | alignment script |
| `dns_ready_at:${clientId}` | ISO timestamp | Dashboard Worker `/api/dns-check` |
| `client_token:${clientId}` | 32-char hex token | 初始化脚本（一次性） |

现有 key 不变：`config:${clientId}`、`otterly_prompts:${clientId}`、`baseline:${clientId}` 等。

### 3.2 ClientData（canonical source）

```typescript
// clients/[name]/client-profile.json
interface ClientProfile {
  id: string;                  // "virum"
  name: string;                // "Virum Akupunktur"
  domain: string;              // "virumakupunktur.dk"
  address: {
    street: string;            // "Dalstrøget 78, 4"
    zip: string;               // "2870"
    city: string;              // "Dyssegård"
    country: string;           // "DK"
  };
  phone: string;               // "+45 25 72 42 65"
  email: string;               // 客户邮箱（用于发送报告）
  industry: string;            // "akupunktur"
  hours: OpeningHour[];
  services: string[];
}
```

### 3.3 AlignmentReport（存入 KV）

```typescript
interface AlignmentReport {
  clientId: string;
  generatedAt: string;         // ISO timestamp
  runType: 'day1' | 'day4' | 'biweekly' | 'manual';
  client: { name: string; domain: string };
  score: {
    total: number;             // 0-100
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
    gradeLabel: string;        // Danish label
    gradeColor: string;        // hex color
    breakdown: {
      coverage: number;        // 0-40
      consistency: number;     // 0-40
      signals: number;         // 0-20
    };
  };
  platforms: PlatformStatus[];
  inconsistencies: NapComparison[];
  prioritizedActions: PrioritizedAction[];
  sameAsUpdated: string[];     // URLs 写入了 sameAs 的平台
}

interface ScoreHistory {
  clientId: string;
  history: Array<{
    date: string;
    runType: string;
    total: number;
    coverage: number;
    consistency: number;
    signals: number;
  }>;
}
```

---

## 四、文件结构

```
geomvp/
├── clients/
│   └── virum-akupunktur/
│       └── client-profile.json          ← 新建（canonical NAP data）
│
├── scripts/
│   └── alignment/
│       ├── types.ts                     ← 所有接口定义
│       ├── normalize.ts                 ← 电话/地址标准化
│       ├── scoring.ts                   ← 评分引擎（coverage/consistency/signals）
│       ├── compare-nap.ts               ← Claude API NAP 语义比对
│       ├── generate-report.ts           ← 报告数据组装
│       ├── update-geo-layer.ts          ← sameAs 写入 business.json
│       ├── send-email.ts                ← Resend 发送通知邮件
│       ├── check-all.ts                 ← 统一并行执行入口
│       ├── run.ts                       ← CLI 入口（被 GitHub Actions 调用）
│       ├── platforms/
│       │   ├── google.ts                ← Outscraper Google Maps API
│       │   ├── trustpilot.ts            ← fetch dk.trustpilot.com
│       │   ├── krak.ts                  ← fetch krak.dk
│       │   ├── gulesider.ts             ← fetch degulesider.dk
│       │   ├── facebook.ts              ← Google/Outscraper 搜索定位
│       │   └── website.ts               ← 客户网站自检
│       └── templates/
│           └── notify-email.html        ← 通知邮件模板（简短，含 dashboard 链接）
│
├── edge/dashboard/src/
│   └── worker.ts                        ← 新增：Block 6、Layer 3、3 个 API endpoint、多客户化
│
└── .github/
    └── workflows/
        └── alignment.yml                ← GitHub Actions 调度 + Slack 通知
```

---

## 五、Dashboard Worker 变更清单

### 5.1 新增 API Endpoints

| Method | Path | 功能 |
|---|---|---|
| `GET` | `/api/dns-check/:client` | 检测 DNS ready，写入 `dns_ready_at` |
| `POST` | `/api/alignment/:client` | 接收对齐结果，写入 KV（脚本调用） |
| `GET` | `/api/alignment/:client` | 返回最新 AlignmentReport JSON |

### 5.2 新增渲染 Block

**Block 6（Ops view）：**
- 顶部分数卡片（score breakdown 三维）
- 平台状态表（6 个平台，图标 + 状态 + NAP diff）
- NAP 不一致详情表（field / platform / 丹麦语描述）
- 优先行动列表（priority badge + 时间估算 + 链接）
- 历史趋势折线图（使用现有 `svgLineChart`）

**Layer 3（Client view）：**
- GEO Health Score 大字卡片（A-F 等级 + 颜色 + 分数）
- 平台状态行（简洁版，图标 + 状态文字）
- 前 3 条优先行动（丹麦语，含直达链接）
- DNS 状态行（`⏳` 或 `✅`）

**顶部 GEO Health Score 卡片（两个 view 共享）：**
- 从 `alignment:${client}:latest` 读取
- 无数据时显示 `--` 占位，不显示空卡片

### 5.3 多客户化改动

```typescript
// 所有 const client = "virum" 改为：
const client = url.searchParams.get("client") || "virum";
```

### 5.4 Client Magic Link Auth

```typescript
// 扩展 checkAuth：
// view=client 时，允许 client_token:${client} 对应的 token 通过
// 该 token 只能访问 client view，不能访问 ops view
```

---

## 六、GitHub Actions Workflow 设计

```yaml
# .github/workflows/alignment.yml

on:
  schedule:
    - cron: '0 6 * * *'   # 每天 06:00 UTC，脚本自判断哪些客户需要检测
  workflow_dispatch:
    inputs:
      client:
        description: 'Client ID (e.g. virum)'
        required: true
        default: 'virum'
      force:
        description: 'Force run regardless of schedule'
        type: boolean
        default: false

jobs:
  alignment:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: pnpm install
      - name: Run alignment check
        id: align
        env:
          OUTSCRAPER_API_KEY: ${{ secrets.OUTSCRAPER_API_KEY }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CLOUDFLARE_KV_API_TOKEN: ${{ secrets.CF_KV_API_TOKEN }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          DASHBOARD_TOKEN: ${{ secrets.DASHBOARD_TOKEN }}
          DASHBOARD_WORKER_URL: ${{ secrets.DASHBOARD_WORKER_URL }}
        run: pnpm tsx scripts/alignment/run.ts ${{ inputs.client || 'all' }} ${{ inputs.force && '--force' || '' }}
      - name: Notify operator (Slack)
        if: always()
        run: |
          curl -s -X POST ${{ secrets.SLACK_WEBHOOK_URL }} \
            -H 'Content-type: application/json' \
            --data "{\"text\":\"✅ Alignment 完成 — *${{ inputs.client || 'all' }}* 得分 ${{ steps.align.outputs.score }}\n📬 邮件 3 小时后发送\n🔍 ${{ secrets.DASHBOARD_WORKER_URL }}/?client=${{ inputs.client || 'virum' }}\"}"
```

---

## 七、开发阶段计划

### Phase 1：基础层（~1h）

- [x] 创建 `clients/virum-akupunktur/client-profile.json`（需填充 NAP 数据）
- [ ] `worker.ts` 多客户化（URL param 替换硬编码）
- [ ] `worker.ts` 新增 client magic link auth（`client_token:${clientId}`）
- [ ] `worker.ts` 新增 `/api/dns-check/:client` endpoint

**Commit:** `feat: multi-client dashboard + client magic link auth + dns-check endpoint`

### Phase 2：对齐脚本核心（~3h）

- [ ] `scripts/alignment/types.ts` — 所有接口
- [ ] `scripts/alignment/normalize.ts` — 标准化函数
- [ ] `scripts/alignment/platforms/` — 6 个平台检测器
- [ ] `scripts/alignment/check-all.ts` — Promise.allSettled 并行执行
- [ ] `scripts/alignment/compare-nap.ts` — Claude API NAP 比对
- [ ] `scripts/alignment/scoring.ts` — 三维评分引擎
- [ ] `scripts/alignment/generate-report.ts` — 报告组装
- [ ] `scripts/alignment/update-geo-layer.ts` — sameAs 同步到 business.json

**Commit:** `feat(alignment): core check engine — 6 platforms, NAP comparison, scoring`

### Phase 3：Dashboard 集成（~2h）

- [ ] `worker.ts` 新增 `POST /api/alignment/:client` endpoint
- [ ] `worker.ts` 新增 `GET /api/alignment/:client` endpoint  
- [ ] `worker.ts` 渲染 GEO Health Score 顶部卡片（两个 view）
- [ ] `worker.ts` 渲染 Block 6（ops view 完整对齐报告）
- [ ] `worker.ts` 渲染 Layer 3（client view 简洁版）

**Commit:** `feat(dashboard): alignment Block 6, Layer 3, GEO Health Score card`

### Phase 4：通知邮件（~1h）

- [ ] `scripts/alignment/templates/notify-email.html` — 简短通知模板（得分 + 链接）
- [ ] `scripts/alignment/send-email.ts` — Resend 发送逻辑（含 3h 延迟机制）
- [ ] `scripts/alignment/run.ts` — CLI 主入口，串联所有步骤

**Commit:** `feat(alignment): notification email + CLI runner`

### Phase 5：GitHub Actions（~30min）

- [ ] `.github/workflows/alignment.yml`

**Commit:** `feat: alignment GitHub Actions workflow + Slack notification`

---

## 八、环境变量清单

### scripts/alignment 需要（.env.local + GitHub Secrets）

```
OUTSCRAPER_API_KEY=       # Outscraper Google Maps API
ANTHROPIC_API_KEY=        # Claude API for NAP comparison
RESEND_API_KEY=           # Email delivery
CF_KV_API_TOKEN=          # Cloudflare KV REST API (写入 alignment 结果)
CF_ACCOUNT_ID=            # Cloudflare account
CF_KV_NAMESPACE_ID=       # DASHBOARD_KV namespace ID
DASHBOARD_WORKER_URL=     # https://dashboard.foundbyai.dk
DASHBOARD_TOKEN=          # Ops dashboard token (for POST /api/alignment/)
```

### GitHub Actions Secrets（需额外添加）

```
SLACK_WEBHOOK_URL=        # Slack incoming webhook URL
```

---

## 九、关键技术约束

1. **Outscraper 免费层**: 500 请求/月。当前 1 客户 × 月 2 次检测 = 2 请求/月，远低于上限。
2. **Claude API 成本**: 每次对齐约 1 次 API 调用，~$0.01-0.02/次，可忽略。
3. **Krak/De Gule Sider 限流**: 请求间隔 ≥ 2 秒，失败时标记 `status: 'unable_to_check'`，不阻塞整体。
4. **Facebook 无公开 API**: 通过 Google 搜索 `site:facebook.com` 定位，NAP 标记 `needs_manual_check`。
5. **sameAs 只写已验证平台**: `status === 'ok'` 的平台才进入 sameAs，其余排除。

---

## 十、已知前提条件

在运行首次对齐前，需要手动完成：

1. `clients/virum-akupunktur/client-profile.json` 填充完整 NAP 数据
2. Cloudflare KV 生成 `client_token:virum` 随机 token
3. GitHub Secrets 配置（见第八节）
4. Slack Webhook URL 创建

---

*文档由开发讨论整理，反映截至 2026-06-23 的完整设计决策。*
