# The best PPT builder

本地单用户的 PPT Agent 网站。输入一句话后先完成背景调研和需求确认，再自动生成结构板、页级资料、策划稿、设计稿，并导出 PPTX。

按 [Sandun 在 linux.do 公开的思路](https://linux.do/t/topic/1782304) 复刻主链路。**与 SANDUN 官方产品无关**，不是 https://sandun.cc/ 的官方仓库。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

打开 http://localhost:3000

1. 先到「设置」填写文本模型、SVG 模型和搜索模型
2. 回首页输入主题，开始生成
3. 背景调研完成后，在「内容需求单」中确认系统推荐的关键答案
4. 空间结构板会把章节、页面、资料、内容策划、初稿和设计稿放在同一张可平移缩放的画布中；右侧 Script Desk 可按整套、章节或当前页生成修改提案，用户预览 diff 后再应用
5. 所有资料完成后，系统用一次文本模型调用生成整套 Deck Plan，再按共享字阶、网格、标题区和视觉槽位生成统一初稿
6. 全部初稿完成后进入第二个默认停顿点：选择内置风格与颜色，或上传 PPT、PPTX、PDF 提取视觉规律；确认后才生成最终设计稿
7. 编辑工作台通过「搜索 / 初稿 / 设计稿」查看同一页产物，右侧阶段卡展示整份进度并支持当前页改稿
8. 全部设计稿完成且每页通过 SVG 可渲染检查后，导出按钮才会启用，避免生成空页或缺页 PPTX

API Key 只存在本机 SQLite（`data/ppt-agent.db`），不会进仓库。

## 设置说明

- 文本模型、SVG 模型、搜索模型各用一套独立配置
- 协议：OpenAI Responses / Messages / Gemini `/v1beta/models` / `/v1/chat/completions`
- 搜索模型：与另外两套模型一样填写 Base URL、API Key、协议和模型名，并支持拉取模型列表；所选模型需要自身具备联网搜索能力
- Grok：搜索模型协议必须选择 OpenAI Responses，应用会启用 `web_search`、结构化来源和 SSE 流式接收；Chat Completions 只会生成普通文本，不能作为 Grok 联网搜索协议

通过兼容网关调用 Grok 时，搜索过程会在需求调研页和工作台右栏显示“请求已提交、正在搜索网页、正在整理来源”等实时状态。遇到限流、模型容量已满、临时不可用或网关超时，应用会自动退避重试，并显示等待秒数和重试次数；暂停项目会中止等待。HTTP 524 的 HTML 错误页会被收敛成简短提示。若多轮重试后仍持续出现 524，需要更换能透传 Responses SSE 的网关或直接使用 xAI 接口。

OpenAI Responses 请求会保留 system/user 角色，并传递页面生成所需的输出 token 上限。

## 架构与调用预算

- 模型、搜索等长任务不占用 HTTP 请求生命周期；动作接口登记任务后返回 `202`，同一项目由单 worker 串行处理
- 暂停、重跑和改稿会用项目级 `AbortSignal` 中止旧请求；改稿指令成功落库后才出队
- 页面先批量完成检索，再用一次文本模型生成 Deck Plan，随后批量生成初稿；用户确认设计参考后才批量生成设计稿，减少供应商并发容量错误
- 初始调研和每个内容页都只做一次复合搜索；封面、目录、章节和结尾复用项目级资料
- 大纲与最终内容页 SVG 保留原帖公开 Prompt 核心；内容页最终设计严格使用 Bento，封面、目录、章节和结尾使用独立页型提示词
- 参考稿只在本机保存和分析，最多 50MB、40 页，最多抽样 12 页；不把参考稿中的事实、Logo、品牌或图片带入新演示
- SVG 只有通过独立根节点提取、XML 解析和实际渲染检查后才算完成；历史坏稿可无损提取时自动修复，否则降为待重生成并阻止放映或导出
- 12 页、约 7 个内容页且使用内置风格的正常主链路目标约 35 次模型请求；上传参考稿只额外增加一次视觉分析调用
- 项目页只读取一次初始快照，之后通过 SSE 接收变化，不同时运行轮询

维护文档：

- [架构说明](./docs/architecture.md)
- [内部接口速查](./docs/integration-guide.md)
- [本地运行与排障](./docs/operator-runbook.md)
- [当前实现交接](./docs/handoff.md)

## 开发验证

应用运行支持 Node.js 20+；`npm test` 使用 Node.js 内置的 TypeScript strip-types，需要 Node.js 22.6+。

```bash
npm test
npm run typecheck
npm run build
```

测试只使用本地桩和纯函数，不会调用已配置的模型、搜索服务或读取用户项目数据库。

## 不会上传的内容

- `data/` 里的数据库（含 Key 和你的项目）
- `.env` / `.env.local`
- `node_modules`、`.next`
- `output/playwright/` 里的本地视觉 QA 产物

## 许可

MIT。LICENSE 文件见仓库根目录。
