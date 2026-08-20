# 内部接口速查

这些接口服务于同仓库前端，不是公开多租户 API。应用没有登录鉴权，只应在本机或可信网络使用。

## 项目动作

`POST /api/projects/:id/actions` 接受 JSON：

| `type` | 其它字段 | 行为 |
|---|---|---|
| `resume` | 无 | 唤醒项目 worker |
| `cancel` | 无 | 中止当前请求并暂停 |
| `confirmRequirements` | `assumptions` | 确认需求并排队生成大纲 |
| `updateAssumptions` | `assumptions` | 更新假设并按失效范围重跑 |
| `reorderPages` | `pageIds` | 更新页面顺序并重算受影响页面 |
| `chat` | `pageId`, `message`, `surface` | 排队解析当前页改稿要求 |
| `structureChat` | `message`, `scope`, `scopeId` | 按整套、章节或页面生成结构提案，不直接修改项目 |
| `applyStructureProposal` | `proposalId` | 用户确认后应用提案并精确失效下游 |
| `dismissStructureProposal` | `proposalId` | 忽略待应用提案 |
| `confirmDesignReference` | `mode`, `styleId`, `colorPreference` | 确认内置风格或已分析的上传参考，继续最终设计 |

会触发长任务的动作返回 `202` 和当前项目快照。任务完成情况从 SSE 获取，不应重复轮询项目接口。

## 项目 SSE

连接 `GET /api/projects/:id/events`，监听命名事件：

```js
const source = new EventSource(`/api/projects/${projectId}/events`);
source.addEventListener("project", (event) => {
  const project = JSON.parse(event.data);
  // 用完整快照替换本地项目状态
});
```

服务端只在真实状态变化时推送；保活帧是 comment。客户端断线后交给 `EventSource` 自动重连。

项目快照读取和 SSE 建连会先执行一次带页面指纹缓存的 SVG 完整性审计。可无损提取的历史混杂输出会被规范化；不可渲染稿件会被清空并降为 `stale`。这属于本地数据自修复，不会在读取接口内调用模型；需要重新生成时由用户发送 `resume`。

## 页面更新

`PATCH /api/projects/:id/pages/:pageId` 支持 `title`、`bullets`、`speakerNotes`。服务端必须确认页面属于 URL 中的项目，错配时返回 `400`。

## 上传设计参考

`POST /api/projects/:id/reference` 使用 `multipart/form-data`，字段名为 `file`。仅接受 `.ppt`、`.pptx`、`.pdf`，最大 50MB；服务端校验扩展名和文件签名，拒绝宏文件。接口保存版本化本地产物、登记一次视觉分析任务并返回 `202` 项目快照。

上传成功不等于允许生成设计稿。前端需等待 `designReference.status` 变为 `ready`，展示风格画像，再调用 `confirmDesignReference`。分析失败时项目主流程保持可用，用户可重新上传或改选内置风格。

项目快照额外包含 `deckPlan`、`designReference`、`structureProposal` 和 `structureChat`。这些字段来自项目 sidecar 与事件，不需要客户端自行拼接。

## 常见响应

| 状态码 | 含义 |
|---|---|
| `200` | 同步读取或更新完成 |
| `202` | 动作已登记，worker 在后台处理 |
| `400` | 参数、项目/页面归属或动作类型错误 |
| `404` | 项目不存在或 SSE 目标不存在 |
| `409` | 仍有设计稿未完成或完整性审计发现坏稿，不能导出 |

错误响应使用 `{ "error": "可读错误摘要" }`。上游 HTML 错误页不会原样透传到界面。
