# The best PPT builder

本地单用户的 PPT Agent 网站。输入一句话，自动跑完调研、假设、大纲便利贴、页级检索、策划稿、设计稿，并导出 PPTX。

按 [Sandun 在 linux.do 公开的思路](https://linux.do/t/topic/1782304) 复刻主链路。**与 SANDUN 官方产品无关**，不是 https://sandun.cc/ 的官方仓库。

## 本地运行

需要 Node.js 20+。

```bash
npm install
npm run dev
```

打开 http://localhost:3000

1. 先到「设置」填写文本模型、SVG 模型、搜索 Key
2. 回首页输入主题，开始生成

API Key 只存在本机 SQLite（`data/ppt-agent.db`），不会进仓库。

## 设置说明

- 文本模型、SVG 模型各用一把 Key
- 协议：OpenAI Responses / Messages / Gemini `/v1beta/models` / `/v1/chat/completions`
- 搜索：Tavily 或博查，一把 Key

## 不会上传的内容

- `data/` 里的数据库（含 Key 和你的项目）
- `.env` / `.env.local`
- `node_modules`、`.next`

## 许可

MIT。LICENSE 文件见仓库根目录。
