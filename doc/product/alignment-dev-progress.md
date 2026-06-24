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

**第一轮修复（async=false 同步）暴露了两个新问题**（run 28122105982 日志）：
1. `results.find is not a function` —— google-search 响应里 `data[0]` 是**对象** `{query, organic_results:[...]}`，不是数组。结果在 `.organic_results`，字段是 `description` 不是 `snippet`。
2. Google(maps) + Facebook **60s 超时** —— 同步模式 maps/search 重 + 4 个并发同步连接在 Outscraper 端排队，撑爆 60s。

**第二轮修复（最终方案）**：改用 Outscraper 官方推荐的**异步 submit→poll** 模式。
- 新增 `scripts/alignment/outscraper.ts`：`outscraperRequest()` 提交 async=true，拿 `results_location` 轮询到 Success（poll 3s，timeout 120s）；`googleSearch()` 便捷封装返回 `organic_results`。
- 5 个平台全部改用它，删掉重复的 fetch/parse 样板。google.ts 包 try/catch 让超时返回带细节的 errorGoogle 而非泛化 reject。
- 解决超时（轮询不占长连接）+ 解决解析（统一正确的 `data[0].organic_results` 路径）。

**下一步验证**：GitHub Actions 手动触发（带 force），预期 Krak/GuleSider/Facebook/Trustpilot
不再 `results.find` 报错，Google 不再超时。本地无法测（`.env.local` 无 OUTSCRAPER_API_KEY，仅 CI secret 有）。

## ✅ 已完成：客户 Dashboard UX 改进

**核心决策**：客户视角去掉顶部 `renderGeoHealthScoreCard`（ops 专用），只留 Layer 3 圆环。客户看"F"会误以为是我们服务差；圆环和平台状态+行动建议一起出现归因更清晰。

- 客户视角不调用 `renderGeoHealthScoreCard`（worker.ts ~1966 只有 renderClientLayer3）— commit `4c96341` 已完成
- `renderClientLayer3` 圆环重设计（grade 字母左 | 三圆环右，120px r=46 circ=289，背景 #334155，`score/max` 格式，归因标签）— commit `4c96341` 已完成
- **NAP 诚实处理**（2026-06-24, commit `85a6057`）：Google 没找到时 consistency 结构性=0 属"未测量"非"错误"，NAP 圆环改灰 `—` + "Afventer Google-profil"，不显示血红 0/40。判定条件 `consistency===0 && googleStatus!=='ok'`。ops 视角保留原始数字。

**待办**：worker 改动已 commit+push，但 `wrangler deploy` 被权限拦截（生产部署）。需手动跑 `cd edge/dashboard && npx wrangler deploy` 上线（或在会话里 `! npx wrangler deploy`）。

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
