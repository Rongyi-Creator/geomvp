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
- 包管理器：pnpm

## API Keys
- 放在 `.env.local`（gitignored，永不提交）
- 参考 `.env.example` 中的占位符

## 构建顺序
1. 先完成块1（GEO 模板）并用硬编码的示例数据验证构建通过
2. 再完成块2（自动化脚本）
3. 用块2处理 virumakupunktur.dk 的真实数据，填入块1，验证端到端

## 目录规范
- `template/` — 可复用模板（不含客户数据）
- `scripts/` — 自动化脚本（TypeScript）
- `clients/[name]/raw/` — 原始抓取（gitignored）
- `clients/[name]/structured/` — 结构化数据
- `clients/[name]/site/` — 生成的 Astro 项目

## Git 规范
- 每个里程碑完成后 commit
- commit message 用英文，格式：`type: description`
- 不推送：.env.local、clients/*/raw/、node_modules、dist
