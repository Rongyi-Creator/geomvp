# 对齐系统开发进度快照

> 更新 2026-06-24 · branch: `main`（feature/clone-geo-layer 已 merge）

## 已完成并 commit（main）

| Commit | 内容 |
|---|---|
| `6ee96e8` | Phase 1: worker 多客户化 + magic link auth + dns-check + client-profile.json |
| `28f07ab` | Phase 2: 对齐脚本 13 个文件（6 平台 + NAP 比对 + 评分 + 报告 + sameAs）|
| `fd7648c` | Phase 3: Dashboard Block 6 + Layer 3 + GEO Health Score + POST/GET /api/alignment |
| `80cbad9` | Phase 4: send-email.ts + run.ts（CLI 主入口）|
| `90a81b2` | Phase 5: .github/workflows/alignment.yml（cron + dispatch，send-email job 已注释）|
| `d567860` | feat: DNS ready Slack notify + welcome email（Worker notifySlack + sendWelcomeEmail）|
| `34cbd51` | fix(security): CR-01 IDOR + CR-02 write-before-validate + HI-01 + HI-04 |
| `536df39` | feat: structured client data 提交到 repo（business.json 等）|
| `c10198f` | fix: AlignmentScore interface 扁平化（breakdown → 直接字段）|
| `4c96341` | feat(client): 折线图替代柱状图 + 圆环进度条替代横向进度条 |

## 已上线并验证

- GitHub Actions GEO Alignment Check 跑通（virum，score=10/100，day1）
- 客户 magic link 可访问：`https://dashboard.foundbyai.dk/?view=client&client=virum&token=45faa895e5589237b2be4c2451c688b8`
- Worker 最新版本：`917d204d`（已部署 dashboard.foundbyai.dk）

## 🔴 根因已找到：score 卡 10/100 的真凶（2026-06-24）

**症状**：所有平台 ❌ 空白（无 error），Outscraper Usage History 显示有调用但 $0 扣费。

**根因**：Outscraper API 的 `async` 参数**默认 `true`**。异步模式下响应体是
`{ id, status:"Pending", results_location }` —— 不含数据。代码解析 `data.data?.[0] ?? []`
→ `undefined ?? []` → 空数组 → 无匹配 → `exists:false`；且 `resp.ok===true` 所以不写 error。
完美解释"全 ❌ 无报错 + 调用已发出但 $0"（异步排队未取结果）。

**修复**：所有 Outscraper 调用加 `async: 'false'`（同步保持连接直到拿到结果），
timeout 提至 60s（同步会阻塞 20-60s）。涉及文件：
- `platforms/google.ts`（maps/search）
- `platforms/krak.ts` / `gulesider.ts` / `facebook.ts`（google-search）
- `platforms/trustpilot.ts`：直连 dk.trustpilot.com 稳定 403，改用 Outscraper Google Search
  `site:trustpilot.com "name"`（rating/reviewCount 拿不到 → null，但不计分）

**下一步验证**：GitHub Actions 手动触发（带 force），预期 Google/Krak/GuleSider/Facebook
不再全空，score 显著上升。本地无法测（`.env.local` 无 OUTSCRAPER_API_KEY，仅 CI secret 有）。

## 待实现：客户 Dashboard UX 改进

### 核心决策
**去掉客户视角顶部的 `renderGeoHealthScoreCard` 面板**（ops 专用），只保留 Layer 3 里的圆环设计。理由：顶部面板缺乏上下文，客户看到"F"会误以为是我们的服务质量差；Layer 3 圆环面板与平台状态 + 行动建议一起出现，归因自然清晰。

### 具体改动（`edge/dashboard/src/worker.ts`）

**1. 移除客户 HTML 模板里的顶部面板**
```typescript
// 在 client view HTML 模板里，删除这一行（约第 1912 行）：
${renderGeoHealthScoreCard(alignReport)}
// 保留 ops view 里的调用不变（约第 1954 行）
```

**2. 重设计 Layer 3 圆环卡片（`renderClientLayer3`）**

布局：grade 字母（左）| 三个圆环（右），水平并排

圆环改动：
- 数字格式改为 `0/40`、`0/40`、`10/20`（带总分）
- SVG 放大：`120px`，r=46，circumference ≈ 289
- 圆环背景轨道颜色改为 `#334155`（比 #1e293b 更可见）
- 间距拉开：`gap:40px`
- 归因标签：Signalkvalitet 下方加 `✓ Sat af os`，另两项加 `Du kan forbedre`

**3. 圆环 SVG 参考代码（r=46）**
```typescript
const circ = 289.0; // 2π×46
// stroke-dasharray="${circ}" stroke-dashoffset="${(circ*(1-pct)).toFixed(1)}"
// background track: stroke="#334155"
// score text: "${score}/${max}"（两行或斜杠格式）
```

### 恢复指令（新 session）
```
继续 client dashboard UX 改进。文件：edge/dashboard/src/worker.ts
任务：
1. 删除 client HTML 模板里的 renderGeoHealthScoreCard 调用（约1912行，保留ops的约1954行）
2. 重设计 renderClientLayer3 圆环：
   - grade 字母左侧 | 三圆环右侧（flex row，gap:40px）
   - 圆环 SVG 120px，r=46，circ=289
   - 背景轨道 stroke="#334155"
   - 数字显示 "0/40" 格式
   - 归因标签：Signalkvalitet → "✓ Sat af os"，其余 → "Du kan forbedre"
3. pnpm tsc --noEmit && pnpm wrangler deploy
4. commit + push origin main
详见 doc/product/alignment-dev-progress.md
```

## 代码审查剩余问题（已知，暂缓）

| 优先级 | 问题 | 处理时机 |
|---|---|---|
| ✅ FIXED | Krak/GuleSider/Facebook/Trustpilot 全改 Outscraper Google Search | 2026-06-24 |
| ✅ FIXED | Scraper 误报"不存在"（async=true 真凶，见上） | 2026-06-24 |
| ✅ FIXED | Outscraper fetch 无 timeout（已加 60s） | 2026-06-24 |
| MEDIUM | Email 失败导致整个 run 失败 | 下次迭代 |

## 环境信息

- Worker URL: `https://geo-dashboard.blake-designing.workers.dev` = `https://dashboard.foundbyai.dk`
- client_token:virum — 存于 Cloudflare KV，勿提交
- client_email:virum = `jie.luan@outlook.com`
- GitHub Actions send-email job：已注释，内测期间不发邮件
