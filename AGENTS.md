# AGENTS.md

本项目的产品与技术真源是 [`CLAUDE.md`](./CLAUDE.md)。开始工作前必须完整阅读并遵守它；若行为约定需要调整，先更新 `CLAUDE.md`，再修改代码。

## 目录约定

- `src/app/`：Next.js 页面与 API 路由。
- `src/components/`：客户端界面组件。
- `src/lib/`：流水线、存储、模型、搜索、导出等领域逻辑。
- `tests/`：不访问真实模型、搜索服务或用户数据库的回归测试。
- `data/`：本机 SQLite 数据，仅保留 `.gitkeep`；数据库、WAL 和密钥不得提交。
- `output/playwright/`：浏览器视觉 QA 的临时截图与追踪文件；不得提交，验收后可由用户决定是否清理。
- `docs/`：需要独立维护的架构、接口或运维文档；没有实际读者需求时不创建空文档。

## 修改纪律

- 不修改数据库 schema，除非用户明确批准迁移方案。
- 页面级操作必须同时校验 `projectId` 与 `pageId`，不得只按页面 ID 写入。
- 长任务必须按项目串行执行；取消、重跑和编辑不得产生并发写入。
- 页面失效范围使用 `search -> draft -> design` 阶段表达，禁止用一个布尔值无差别重跑全链路。
- 不调用真实模型或搜索 API 做自动化测试，除非用户明确授权。

## 验证

修改后至少运行：

```bash
npm test
npm run typecheck
npm run build
```

涉及导出时，再用最小 SVG 生成 PPTX，并验证压缩包完整且 LibreOffice 可以打开或转换。
