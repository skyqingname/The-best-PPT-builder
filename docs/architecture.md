# 架构说明

## 目标与边界

这是一个本机单用户的 Next.js 全栈应用。浏览器负责操作和展示，SQLite 保存配置、项目、页面与事件，本进程 worker 串行执行搜索、策划和设计。它不依赖 Redis、PostgreSQL、向量库或外部任务队列。

## 主数据流

```text
一句话主题
  -> 项目级联网调研（1 次）
  -> 内容需求单（1 次文本模型）
  -> 用户确认
  -> 大纲结构板（1 次文本模型）
  -> 所有内容页检索
  -> 整套 Deck Plan（1 次文本模型）
  -> 所有页面初稿
  -> 用户确认内置风格 / 上传参考稿（可选 1 次视觉分析）
  -> 所有页面设计稿
  -> SVG + PNG fallback 的 PPTX
```

阶段采用 `research -> planning -> draft -> style_reference -> design` 依赖链。标题或要点变化从检索失效；排序变化保留搜索，但使 Deck Plan 与受影响页面下游失效；初稿指令只失效初稿和设计；风格变化回到设计参考确认，只失效设计。

12 页、约 7 个内容页且使用内置风格的正常主链路目标约 35 次模型请求：前置 3 次、内容页每页 3 次、固定页每页 2 次、整套 Deck Plan 1 次。上传参考稿再增加 1 次视觉分析。封面、目录、章节和结尾复用项目级资料，不做页级搜索。

## Worker 与取消

- 每个项目最多一个 worker；重复唤醒合并为一次后续运行。
- HTTP 动作只校验、登记并唤醒 worker，返回 `202` 项目快照，不等待模型完成。
- 模型和搜索请求绑定项目级 `AbortSignal`。暂停、改稿或新版本到来会中止旧请求。
- 页面改稿与结构对话使用内存队列；中止时保留待重试指令。单次对话或参考稿分析失败只记录局部失败，不把整个 PPT 项目标记为失败。
- 页面按“检索 → Deck Plan → 初稿 → 参考确认 → 设计稿”批量串行处理，避免同一供应商并发容量错误。

## Sidecar 产物与参考文件

SQLite 继续保存项目、页面、事件和本机模型配置，不做 schema 迁移。跨页与版本化产物放在 `data/artifacts/<projectId>/`：

- `deck-plan.json`：共享视觉合同与逐页内容/视觉计划。
- `structure-proposals.json`：Script Desk 生成、等待用户确认的结构提案。
- `reference-state.json`：设计参考状态与风格画像。
- `references/<uploadId>/`：原始 PPT/PPTX/PDF、隔离转换结果和抽样预览。

参考文件最大 50MB、最多 40 页，抽样不超过 12 页。PPT/PPTX 经隔离的 LibreOffice 用户目录转 PDF，PDF 由 Poppler 低分辨率渲染；视觉分析只提取版式、配色、图文关系和页型规律，不把参考内容当事实来源。

## 模型与搜索边界

`src/lib/model-gateway.ts` 对业务层暴露文本、JSON 和 SVG 三种调用，统一处理协议、Responses SSE、超时、错误净化、取消和短退避重试。`src/lib/search.ts` 负责联网搜索、来源结构校验、URL 正文补抓和 24 小时进程内缓存。

搜索模型与文本、SVG 模型一样使用 Base URL、API Key、协议和模型名。Grok 联网搜索必须使用 Responses 协议，开启 `web_search` 工具并流式接收事件。

## 提示词分层与 SVG 质量门禁

- 大纲层原样保留原帖公开的「顶级的 PPT 结构架构师」与 `[PPT_OUTLINE]` JSON 核心，工程规则只追加具体性、事实边界与禁用套话。
- Deck Plan 层一次生成整套共享字阶、网格、边距、标题区、卡片几何、图形语言，以及每页布局、阅读顺序和 `diagram / chart / svg_illustration / photo` 视觉槽位。
- 策划层接收 Deck Plan，负责固定真实内容、信息层级、图表/流程/配图区域和版式。封面、目录、章节、结尾使用专用提示词；内容页使用清爽的 Bento 策划规则。
- 设计层中，内容页必须包含原帖公开的 Bento Grid 与整页 SVG 核心；固定页不使用 Bento。设计只在事实、阅读顺序和主要分区不变的前提下应用内置风格或参考稿画像，不能退化成只换颜色。
- `extractSvg` 从代码围栏或混杂输出中逐个寻找独立 SVG 根节点，避免模型在解释文字里提前提到 `<svg>` 时发生贪婪截取。候选必须是单根 XML、固定 1280×720 画布，并拒绝脚本、`foreignObject`、外部图片、占位文案和模板元数据。
- 候选通过 Resvg 解析和低分辨率渲染探针后才能标记为 `ready`；没有可见文案、无法渲染或近似空白的结果视为失败。首次返回不合格时，模型网关只追加一次带错误原因的修复调用；第二次仍失败则停止该页。
- 项目读取、worker 继续和导出前执行带指纹缓存的历史稿件审计。能提取真实根节点时直接规范化存储；无法修复时清空坏稿并将对应阶段降为 `stale`。导出缓存以每页更新时间组合为版本，避免页面已变化但复用旧 PPTX。

## 前端边界

- `HomeScreen`：项目入口，一次读取 `/api/bootstrap`。
- `RequirementsFlow`：背景调研与内容需求确认。
- `SpatialStructureBoard`：React Flow 空间故事板，展示结构、资料、Deck Plan、初稿和设计稿，并提供语义排序。
- `DesignReferenceGate`：最终设计前的内置风格/颜色选择、PPT/PPTX/PDF 上传与风格画像确认。
- `ProjectExperience`：工作台组合与页面选择。
- `useProjectController`：一次项目快照 + 单条 SSE 连接，集中管理写操作。
- `ProjectIcon`：唯一功能图标入口，映射到 Lucide。

界面不并行开启轮询。项目变化通过命名为 `project` 的 SSE 事件推送完整快照；15 秒保活使用 SSE comment，不触发前端状态更新。

## 内部路由

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/bootstrap` | GET | 首页所需的配置状态与项目列表 |
| `/api/projects` | GET / POST | 项目列表与创建项目 |
| `/api/projects/:id` | GET | 单个项目快照 |
| `/api/projects/:id/actions` | POST | 暂停、继续、确认需求、改稿、排序等动作 |
| `/api/projects/:id/events` | GET | 项目快照 SSE |
| `/api/projects/:id/pages/:pageId` | PATCH | 更新页面标题、要点或备注 |
| `/api/projects/:id/reference` | POST | 上传并排队分析 PPT/PPTX/PDF 视觉参考 |
| `/api/projects/:id/export` | GET | 导出完整 PPTX |
| `/api/settings` | GET / PUT | 本机模型配置 |
| `/api/settings/models` | POST | 按配置拉取模型列表 |

页面更新路由同时校验项目 ID 和页面 ID。导出要求每页设计稿都处于 `ready`，重复下载同一项目版本时复用有界内存缓存。
