# 对齐系统开发进度快照

> 2026-06-23 · branch: `feature/clone-geo-layer`

## 已完成并 commit

| Phase | Commit | 内容 |
|---|---|---|
| 1 | `6ee96e8` | worker.ts 多客户化 + client magic link auth + /api/dns-check + client-profile.json + spec 文档 |
| 2 | `28f07ab` | 对齐脚本 13 个文件（6 平台检测 + NAP 比对 + 评分 + 报告生成 + sameAs 更新） |
| 3 | `fd7648c` | Dashboard Block 6 + Layer 3 + GEO Health Score 卡片 + POST/GET /api/alignment/:client |

## 已创建未 commit（Phase 4）

- `scripts/alignment/send-email.ts` — Resend 通知邮件（简短 + 链接到 client dashboard）
- `scripts/alignment/run.ts` — CLI 主入口，串联所有步骤，输出 GitHub Actions output

## 待完成

### Phase 5：GitHub Actions
文件路径：`.github/workflows/alignment.yml`

关键内容：
```yaml
on:
  schedule:
    - cron: '0 6 * * *'
  workflow_dispatch:
    inputs:
      client: { default: 'virum' }
      force:  { type: boolean, default: false }

jobs:
  alignment:
    steps:
      - checkout + pnpm install
      - run: pnpm tsx scripts/alignment/run.ts ${{ inputs.client || 'all' }} ${{ inputs.force && '--force' || '' }}
      - Slack notify: POST to SLACK_WEBHOOK_URL with score + dashboard link
      - wait 3h step (separate job) → send email job
```

GitHub Secrets 需要（README 提醒用户配置）：
- `OUTSCRAPER_API_KEY`
- `ANTHROPIC_API_KEY`
- `RESEND_API_KEY`
- `CF_KV_API_TOKEN` (未使用，KV 通过 Dashboard Worker API 写入)
- `DASHBOARD_TOKEN`
- `DASHBOARD_WORKER_URL`
- `SLACK_WEBHOOK_URL`

## 恢复开发指令（compact 后使用）

```
继续对齐系统开发。在 branch feature/clone-geo-layer 上：
1. git add scripts/alignment/send-email.ts scripts/alignment/run.ts && commit Phase 4
2. 写 .github/workflows/alignment.yml（Phase 5，含 cron + workflow_dispatch + Slack notify + 3h delay email job）
3. commit Phase 5
4. git push origin feature/clone-geo-layer
完整设计见 doc/product/alignment-system-complete-spec.md
```

## 注意事项

- `scripts/alignment/run.ts` 中 `::set-output` 语法已过时，GitHub Actions 应改用 `echo "score=X" >> $GITHUB_OUTPUT`
- `client-profile.json` 的 phone/address/email 是占位数据，需要用户用真实 virum 数据填充后才能运行
- Krak/GuleSider 的 HTML 解析是基于推断的 class 名，首次真实运行后可能需要调整选择器
- `compare-nap.ts` 使用 `claude-haiku-4-5-20251001`，成本极低（~$0.01/run）
