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
3. 背景调研完成后，在「内容需求单」中确认系统推荐的关键答案；这是唯一默认停顿点
4. 结构板出现后，可编辑页面标题和要点，或调整页面顺序；提交需求后其它阶段会自动继续
5. 编辑工作台通过「搜索 / 初稿 / 设计稿」查看同一页的三个产物，右侧阶段卡展示整份进度并支持当前页改稿
6. 右侧可修改页数、受众、目的和设计风格，也可暂停或继续生成
7. 全部设计稿完成后，导出按钮才会启用，避免生成缺页 PPTX

API Key 只存在本机 SQLite（`data/ppt-agent.db`），不会进仓库。

## 设置说明

- 文本模型、SVG 模型、搜索模型各用一套独立配置
- 协议：OpenAI Responses / Messages / Gemini `/v1beta/models` / `/v1/chat/completions`
- 搜索模型：与另外两套模型一样填写 Base URL、API Key、协议和模型名，并支持拉取模型列表；所选模型需要自身具备联网搜索能力
- Grok：搜索模型协议必须选择 OpenAI Responses，应用会启用 `web_search`、结构化来源和 SSE 流式接收；Chat Completions 只会生成普通文本，不能作为 Grok 联网搜索协议

通过兼容网关调用 Grok 时，搜索过程会在需求调研页和工作台右栏显示“请求已提交、正在搜索网页、正在整理来源”等实时状态。遇到限流、模型容量已满、临时不可用或网关超时，应用会自动退避重试，并显示等待秒数和重试次数；暂停项目会中止等待。HTTP 524 的 HTML 错误页会被收敛成简短提示。若多轮重试后仍持续出现 524，需要更换能透传 Responses SSE 的网关或直接使用 xAI 接口。

OpenAI Responses 请求会保留 system/user 角色，并传递页面生成所需的输出 token 上限。

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
