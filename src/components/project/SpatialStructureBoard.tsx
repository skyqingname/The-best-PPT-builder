"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnNodeDrag,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDot,
  FileText,
  GripVertical,
  Image as ImageIcon,
  Layers3,
  LayoutTemplate,
  LoaderCircle,
  Map as MapIcon,
  MessageSquareText,
  Move,
  Palette,
  Pause,
  Play,
  Search,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import type {
  DeckPagePlanDTO,
  PageDTO,
  ProjectDTO,
  StructureProposalDTO,
} from "@/lib/client-types";

type Surface = "search" | "draft" | "design";
type Scope = "deck" | "section" | "page";
type BoardKind = "group" | "page" | "research" | "plan" | "draft" | "design";

interface BoardNodeData extends Record<string, unknown> {
  kind: BoardKind;
  title: string;
  pageId?: string;
  page?: PageDTO;
  pagePlan?: DeckPagePlanDTO;
  pageCount?: number;
  svg?: string;
  status?: string;
  surface?: Surface;
}

type BoardNode = Node<BoardNodeData>;

const nodeTypes = {
  group: StoryGroupNode,
  page: StoryPageNode,
  artifact: ArtifactNode,
};

const COLUMNS = {
  page: 34,
  research: 348,
  plan: 670,
  draft: 1000,
  design: 1342,
};

export function SpatialStructureBoard({
  project,
  error,
  onBack,
  onOpen,
  onEnter,
  onToggleRun,
  onReorder,
  onStructureChat,
  onApplyProposal,
  onDismissProposal,
}: {
  project: ProjectDTO;
  error: string;
  onBack: () => void;
  onOpen: (id: string, surface: Surface) => void;
  onEnter: () => void;
  onToggleRun: () => void;
  onReorder: (pageId: string, targetPageId: string) => void;
  onStructureChat: (input: { message: string; scope: Scope; scopeId: string }) => void;
  onApplyProposal: (proposalId: string) => void;
  onDismissProposal: (proposalId: string) => void;
}) {
  const storageKey = `ppt-agent:spatial-board:${project.id}`;
  const layout = useMemo(
    () => buildBoard(project, readPositions(storageKey)),
    [project, storageKey],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<BoardNode>(layout.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(layout.edges);
  const [selectedPageId, setSelectedPageId] = useState(project.pages[0]?.id ?? "");

  useEffect(() => {
    setNodes(buildBoard(project, readPositions(storageKey)).nodes);
    setEdges(buildBoard(project, readPositions(storageKey)).edges);
    setSelectedPageId((current) => project.pages.some((page) => page.id === current)
      ? current
      : project.pages[0]?.id ?? "");
  }, [project, setEdges, setNodes, storageKey]);

  const selectedPage = project.pages.find((page) => page.id === selectedPageId) ?? null;

  const onNodeClick = useCallback<NodeMouseHandler<BoardNode>>((_event, node) => {
    if (!node.data.pageId) return;
    setSelectedPageId(node.data.pageId);
  }, []);

  const onNodeDoubleClick = useCallback<NodeMouseHandler<BoardNode>>((_event, node) => {
    if (!node.data.pageId) return;
    onOpen(node.data.pageId, node.data.surface ?? bestSurface(node.data.page));
  }, [onOpen]);

  const onNodeDragStop = useCallback<OnNodeDrag<BoardNode>>((_event, node) => {
    const positions = readPositions(storageKey);
    positions[node.id] = node.position;
    writePositions(storageKey, positions);
    if (node.data.kind !== "page" || !node.parentId || node.position.x > 230) return;
    const peers = nodes.filter((item) => (
      item.id !== node.id && item.parentId === node.parentId && item.data.kind === "page"
    ));
    const target = peers.sort((a, b) => (
      Math.abs(a.position.y - node.position.y) - Math.abs(b.position.y - node.position.y)
    ))[0];
    if (!target?.data.pageId || !node.data.pageId || Math.abs(target.position.y - node.position.y) > 100) return;
    delete positions[node.id];
    delete positions[target.id];
    writePositions(storageKey, positions);
    onReorder(node.data.pageId, target.data.pageId);
  }, [nodes, onReorder, storageKey]);

  return (
    <div className="spatial-board-shell">
      <header className="spatial-board-header">
        <div className="flex min-w-0 items-center gap-3">
          <button className="spatial-icon-button" onClick={onBack} aria-label="返回首页">
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <div className="spatial-kicker">STORY SYSTEM / LIVE CANVAS</div>
            <div className="truncate text-[14px] font-semibold tracking-[-0.02em]">{project.title}</div>
          </div>
        </div>
        <div className="hidden items-center gap-5 lg:flex">
          <HeaderMetric label="页面" value={String(project.pages.length).padStart(2, "0")} />
          <HeaderMetric label="资料就绪" value={`${readyCount(project.pages, "searchStatus")}/${project.pages.length}`} />
          <HeaderMetric label="策划稿" value={`${readyCount(project.pages, "draftStatus")}/${project.pages.length}`} />
        </div>
        <div className="flex items-center gap-2">
          <button className="spatial-secondary-button" onClick={onToggleRun}>
            {project.status === "running" ? <Pause size={14} /> : <Play size={14} />}
            <span className="hidden sm:inline">{project.status === "running" ? "暂停" : "继续"}</span>
          </button>
          <button className="spatial-primary-button" onClick={onEnter}>
            打开编辑台
            <ArrowRight size={14} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1 bg-[#edf0f4]">
          <div className="spatial-canvas-caption">
            <div className="flex items-center gap-2">
              <Move size={13} />
              拖动画布探索 · 拖动页面卡调整章节内顺序 · 双击产物进入编辑
            </div>
            <span>{project.deckPlan?.status === "ready" ? "Deck Plan 已同步" : "Deck Plan 等待生成"}</span>
          </div>
          <ReactFlow<BoardNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onNodeDragStop={onNodeDragStop}
            fitView
            fitViewOptions={{ padding: 0.09, minZoom: 0.2, maxZoom: 0.82 }}
            minZoom={0.13}
            maxZoom={1.45}
            snapToGrid
            snapGrid={[10, 10]}
            selectionOnDrag
            panOnScroll
            proOptions={{ hideAttribution: true }}
            className="spatial-react-flow"
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} color="#b8c1cf" />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) => minimapColor((node.data as BoardNodeData).kind)}
              maskColor="rgba(237,240,244,.74)"
              className="spatial-minimap"
            />
            <Controls showInteractive={false} className="spatial-controls" />
          </ReactFlow>
        </main>

        <ScriptDesk
          project={project}
          selectedPage={selectedPage}
          error={error}
          onSelectPage={setSelectedPageId}
          onSend={onStructureChat}
          onApply={onApplyProposal}
          onDismiss={onDismissProposal}
        />
      </div>
    </div>
  );
}

function ScriptDesk({
  project,
  selectedPage,
  error,
  onSelectPage,
  onSend,
  onApply,
  onDismiss,
}: {
  project: ProjectDTO;
  selectedPage: PageDTO | null;
  error: string;
  onSelectPage: (pageId: string) => void;
  onSend: (input: { message: string; scope: Scope; scopeId: string }) => void;
  onApply: (proposalId: string) => void;
  onDismiss: (proposalId: string) => void;
}) {
  const [message, setMessage] = useState("");
  const [scope, setScope] = useState<Scope>("page");
  const sections = useMemo(() => Array.from(new Set(
    project.pages.map((page) => page.sectionTitle).filter((value): value is string => Boolean(value)),
  )), [project.pages]);
  const currentSection = selectedPage?.pageType === "section"
    ? selectedPage.title
    : selectedPage?.sectionTitle || sections[0] || "";
  const scopeId = scope === "page" ? selectedPage?.id || "" : scope === "section" ? currentSection : "";
  const proposal = project.structureProposal;
  const diff = useMemo(() => proposal ? summarizeDiff(project.pages, proposal) : null, [project.pages, proposal]);
  const canSend = Boolean(message.trim() && (scope === "deck" || scopeId));

  return (
    <aside className="script-desk">
      <div className="script-desk-head">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#14243a] text-white">
            <MessageSquareText size={17} />
          </span>
          <div>
            <div className="text-[13px] font-semibold">Script Desk</div>
            <div className="mt-0.5 text-[10px] text-[#8895a7]">用文本模型修改演示逻辑</div>
          </div>
        </div>
        <span className={statusPillClass(project.status)}>{statusLabel(project)}</span>
      </div>

      <div className="border-b border-[#e7ebf0] px-4 py-3">
        <div className="mb-2 text-[9px] font-semibold tracking-[0.14em] text-[#8c99aa]">修改范围</div>
        <div className="script-scope-switch">
          {(["deck", "section", "page"] as Scope[]).map((item) => (
            <button
              key={item}
              className={scope === item ? "active" : ""}
              onClick={() => setScope(item)}
            >
              {{ deck: "整套", section: "章节", page: "当前页" }[item]}
            </button>
          ))}
        </div>
        {scope === "page" && (
          <select
            className="script-scope-select"
            value={selectedPage?.id || ""}
            onChange={(event) => onSelectPage(event.target.value)}
          >
            {project.pages.map((page) => (
              <option key={page.id} value={page.id}>第 {page.sortOrder + 1} 页 · {page.title}</option>
            ))}
          </select>
        )}
        {scope === "section" && (
          <div className="script-scope-context"><Layers3 size={13} />{currentSection || "尚未选择章节"}</div>
        )}
      </div>

      <div className="custom-scroll flex-1 overflow-y-auto px-4 py-4">
        {project.structureChat.length === 0 && !proposal && (
          <div className="script-empty-state">
            <MapIcon size={22} />
            <div className="mt-3 text-[12px] font-semibold">直接描述你不满意的地方</div>
            <p className="mt-1.5 text-[10px] leading-5 text-[#8794a5]">
              例如：把第二章节的结论提前，把两页重复内容合并，并为案例页增加一张关系图。
            </p>
          </div>
        )}
        <div className="space-y-3">
          {project.structureChat.map((item) => (
            <div key={item.id} className={item.role === "user" ? "script-message-user" : "script-message-agent"}>
              <div className="text-[9px] font-semibold tracking-[0.1em] opacity-60">
                {item.role === "user" ? "YOU" : "STRUCTURE AGENT"}
              </div>
              <div className="mt-1.5 text-[11px] leading-[1.65]">{item.text}</div>
            </div>
          ))}
        </div>

        {proposal && diff && (
          <ProposalCard proposal={proposal} diff={diff} onApply={onApply} onDismiss={onDismiss} />
        )}
        {(error || project.errorText) && (
          <div className="mt-3 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-4 text-red-700">
            {error || project.errorText}
          </div>
        )}
      </div>

      <div className="script-composer">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="告诉 Agent 如何调整结构或内容…"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && canSend) {
              event.preventDefault();
              onSend({ message: message.trim(), scope, scopeId });
              setMessage("");
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span>模型只生成提案，应用前不会修改项目</span>
          <button
            disabled={!canSend}
            onClick={() => {
              onSend({ message: message.trim(), scope, scopeId });
              setMessage("");
            }}
            aria-label="发送结构修改要求"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}

function ProposalCard({
  proposal,
  diff,
  onApply,
  onDismiss,
}: {
  proposal: StructureProposalDTO;
  diff: ReturnType<typeof summarizeDiff>;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="proposal-card">
      <div className="flex items-start gap-2.5">
        <span className="proposal-card-icon"><Sparkles size={15} /></span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold">待应用的结构提案</div>
          <div className="mt-1 text-[10px] leading-4 text-[#718096]">{proposal.summary}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <DiffMetric label="新增" value={diff.added.length} />
        <DiffMetric label="移除" value={diff.removed.length} tone="red" />
        <DiffMetric label="改写" value={diff.changed.length} />
        <DiffMetric label="移动" value={diff.moved.length} />
      </div>
      <div className="mt-3 space-y-1.5">
        {diff.preview.map((item) => (
          <div key={item} className="proposal-change-row"><ChevronRight size={12} />{item}</div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button className="proposal-dismiss" onClick={() => onDismiss(proposal.id)}><X size={13} />忽略</button>
        <button className="proposal-apply" onClick={() => onApply(proposal.id)}><Check size={13} />应用并精确重算</button>
      </div>
    </div>
  );
}

function StoryGroupNode({ data }: NodeProps<BoardNode>) {
  return (
    <div className="story-group-node">
      <div className="spatial-node-handle story-group-handle">
        <div>
          <div className="text-[9px] font-semibold tracking-[0.2em] text-[#2b78e4]">SECTION FIELD</div>
          <div className="mt-1 max-w-[760px] truncate text-[18px] font-semibold tracking-[-0.035em]">{data.title}</div>
        </div>
        <div className="flex items-center gap-6 text-[9px] font-semibold tracking-[0.08em] text-[#8a96a6]">
          <span>STRUCTURE</span><span>RESEARCH</span><span>CONTENT PLAN</span><span>DRAFT</span><span>DESIGN</span>
        </div>
      </div>
    </div>
  );
}

function StoryPageNode({ data, selected }: NodeProps<BoardNode>) {
  const page = data.page;
  if (!page) return null;
  return (
    <div className={`story-page-node ${selected ? "selected" : ""}`}>
      <Handle type="source" position={Position.Right} className="spatial-handle" />
      <div className="spatial-node-handle flex items-center justify-between">
        <span className="flex items-center gap-1.5"><GripVertical size={12} />#{String(page.sortOrder + 1).padStart(2, "0")}</span>
        <span>{pageTypeLabel(page.pageType)}</span>
      </div>
      <div className="mt-3 line-clamp-2 min-h-[38px] text-[13px] font-semibold leading-[1.45] tracking-[-0.02em]">{page.title}</div>
      <div className="mt-2 line-clamp-2 text-[9px] leading-4 text-[#8390a2]">{page.bullets.slice(0, 2).join(" · ") || "叙事节奏页"}</div>
      <div className="mt-3 flex items-center gap-1.5">
        <ArtifactDot status={page.searchStatus} icon={<Search size={9} />} />
        <ArtifactDot status={page.draftStatus} icon={<FileText size={9} />} />
        <ArtifactDot status={page.designStatus} icon={<Palette size={9} />} />
      </div>
    </div>
  );
}

function ArtifactNode({ data, selected }: NodeProps<BoardNode>) {
  const isVisual = data.kind === "draft" || data.kind === "design";
  return (
    <div className={`artifact-node artifact-${data.kind} ${selected ? "selected" : ""}`}>
      <Handle type="target" position={Position.Left} className="spatial-handle" />
      {data.kind !== "design" && <Handle type="source" position={Position.Right} className="spatial-handle" />}
      <div className="flex items-center justify-between">
        <span className="artifact-node-label">{artifactLabel(data.kind)}</span>
        <StatusGlyph status={data.status || "empty"} />
      </div>
      {isVisual ? (
        data.svg ? (
          <img
            alt=""
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg)}`}
            className="mt-2 aspect-video w-full rounded-[7px] border border-[#e4e8ee] bg-white object-contain"
          />
        ) : (
          <div className="artifact-preview-empty"><ImageIcon size={17} />等待页面视觉</div>
        )
      ) : data.kind === "research" ? (
        <div className="mt-3">
          <div className="text-[19px] font-semibold tracking-[-0.04em]">{data.page?.sources.length || 0}<span className="ml-1 text-[9px] font-medium text-[#8c98a8]">条来源</span></div>
          <div className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-[#7c899a]">{data.page?.summaryMd || "等待页级检索"}</div>
        </div>
      ) : (
        <div className="mt-2.5">
          <div className="line-clamp-1 text-[11px] font-semibold">{data.pagePlan?.layout || "等待整套 Deck Plan"}</div>
          <div className="mt-1.5 line-clamp-2 text-[9px] leading-4 text-[#7d8999]">{data.pagePlan?.objective || "版式、配图与阅读顺序将在这里显示"}</div>
          <div className="mt-2 flex gap-1">
            {(data.pagePlan?.visualSlots ?? []).slice(0, 2).map((slot) => (
              <span key={`${slot.kind}-${slot.purpose}`} className="visual-slot-pill">{visualSlotLabel(slot.kind)}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function buildBoard(project: ProjectDTO, positions: Record<string, { x: number; y: number }>): {
  nodes: BoardNode[];
  edges: Edge[];
} {
  const groups = groupStory(project.pages);
  const plans = new Map(project.deckPlan?.pages.map((plan) => [plan.pageCode, plan]) ?? []);
  const nodes: BoardNode[] = [];
  const edges: Edge[] = [];
  let y = 80;
  groups.forEach((group, groupIndex) => {
    const groupId = `group:${group.key}`;
    const height = 86 + group.pages.length * 176 + 30;
    nodes.push({
      id: groupId,
      type: "group",
      position: positions[groupId] ?? { x: 80 + (groupIndex % 2) * 30, y },
      data: { kind: "group", title: group.title, pageCount: group.pages.length },
      style: { width: 1688, height },
      zIndex: -1,
      dragHandle: ".spatial-node-handle",
    });
    group.pages.forEach((page, index) => {
      const rowY = 82 + index * 176;
      const pageNodeId = `page:${page.id}`;
      const researchId = `research:${page.id}`;
      const planId = `plan:${page.id}`;
      const draftId = `draft:${page.id}`;
      const designId = `design:${page.id}`;
      nodes.push({
        id: pageNodeId,
        type: "page",
        parentId: groupId,
        extent: "parent",
        position: positions[pageNodeId] ?? { x: COLUMNS.page, y: rowY },
        data: { kind: "page", title: page.title, pageId: page.id, page, surface: bestSurface(page) },
        style: { width: 270, height: 148 },
        dragHandle: ".spatial-node-handle",
      });
      nodes.push(artifactNode(researchId, groupId, COLUMNS.research, rowY, page, "research", positions, plans.get(page.pageCode)));
      nodes.push(artifactNode(planId, groupId, COLUMNS.plan, rowY, page, "plan", positions, plans.get(page.pageCode)));
      nodes.push(artifactNode(draftId, groupId, COLUMNS.draft, rowY, page, "draft", positions, plans.get(page.pageCode)));
      nodes.push(artifactNode(designId, groupId, COLUMNS.design, rowY, page, "design", positions, plans.get(page.pageCode)));
      const chain = [pageNodeId, researchId, planId, draftId, designId];
      chain.slice(0, -1).forEach((source, chainIndex) => {
        const target = chain[chainIndex + 1];
        edges.push({
          id: `${source}->${target}`,
          source,
          target,
          type: "smoothstep",
          animated: [page.searchStatus, page.draftStatus, page.designStatus].includes("running"),
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#7ca8e8" },
          style: { stroke: "#9abbe7", strokeWidth: 1.4 },
        });
      });
    });
    y += height + 54;
  });
  return { nodes, edges };
}

function artifactNode(
  id: string,
  parentId: string,
  x: number,
  y: number,
  page: PageDTO,
  kind: Exclude<BoardKind, "group" | "page">,
  positions: Record<string, { x: number; y: number }>,
  pagePlan?: DeckPagePlanDTO,
): BoardNode {
  const status = kind === "research"
    ? page.searchStatus
    : kind === "plan"
      ? pagePlan ? "ready" : "empty"
      : kind === "draft"
        ? page.draftStatus
        : page.designStatus;
  return {
    id,
    type: "artifact",
    parentId,
    extent: "parent",
    draggable: false,
    position: positions[id] ?? { x, y },
    data: {
      kind,
      title: page.title,
      pageId: page.id,
      page,
      pagePlan,
      status,
      surface: kind === "research" ? "search" : kind === "draft" ? "draft" : "design",
      svg: kind === "draft" ? page.draftSvg : kind === "design" ? page.designSvg : "",
    },
    style: { width: kind === "research" ? 278 : kind === "plan" ? 288 : 298, height: 148 },
  };
}

function groupStory(pages: PageDTO[]) {
  const groups: Array<{ key: string; title: string; pages: PageDTO[] }> = [];
  pages.forEach((page) => {
    const key = page.pageType === "cover" || page.pageType === "toc"
      ? "opening"
      : page.pageType === "end"
        ? "ending"
        : page.pageType === "section"
          ? page.title
          : page.sectionTitle || "core";
    const title = key === "opening"
      ? "开场与演示路线"
      : key === "ending"
        ? "结论与行动收束"
        : page.pageType === "section" ? page.title : page.sectionTitle || "核心内容";
    const current = groups.find((group) => group.key === key);
    if (current) current.pages.push(page);
    else groups.push({ key, title, pages: [page] });
  });
  return groups;
}

function summarizeDiff(current: PageDTO[], proposal: StructureProposalDTO) {
  const currentById = new Map(current.map((page) => [page.id, page]));
  const proposedById = new Map(proposal.pages.map((page) => [page.id, page]));
  const added = proposal.pages.filter((page) => page.id.startsWith("new:"));
  const removed = current.filter((page) => !proposedById.has(page.id));
  const changed = proposal.pages.filter((page) => {
    const before = currentById.get(page.id);
    return before && (before.title !== page.title
      || before.sectionTitle !== page.sectionTitle
      || JSON.stringify(before.bullets) !== JSON.stringify(page.bullets));
  });
  const order = new Map(current.map((page, index) => [page.id, index]));
  const moved = proposal.pages.filter((page, index) => order.has(page.id) && order.get(page.id) !== index);
  const preview = [
    ...added.slice(0, 2).map((page) => `新增：${page.title}`),
    ...removed.slice(0, 2).map((page) => `移除：${page.title}`),
    ...changed.slice(0, 3).map((page) => `改写：${page.title}`),
    ...moved.slice(0, 2).map((page) => `移动：${page.title}`),
  ].slice(0, 5);
  return { added, removed, changed, moved, preview };
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return <div className="text-center"><div className="text-[13px] font-semibold">{value}</div><div className="mt-0.5 text-[8px] tracking-[0.12em] text-[#8a96a7]">{label}</div></div>;
}

function DiffMetric({ label, value, tone = "blue" }: { label: string; value: number; tone?: "blue" | "red" }) {
  return <div className={tone === "red" ? "diff-metric diff-red" : "diff-metric"}><span>{value}</span>{label}</div>;
}

function ArtifactDot({ status, icon }: { status: string; icon: ReactNode }) {
  return <span className={`artifact-dot status-${status}`}>{status === "ready" ? <Check size={9} /> : icon}</span>;
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "ready") return <Check size={13} className="text-[#23815d]" />;
  if (status === "running") return <LoaderCircle size={13} className="animate-spin text-[#2f80ff]" />;
  return <CircleDot size={12} className="text-[#aab4c1]" />;
}

function pageTypeLabel(type: PageDTO["pageType"]) {
  return ({ cover: "封面", toc: "目录", section: "章节", content: "内容", end: "结束" })[type];
}

function artifactLabel(kind: BoardKind) {
  return ({ group: "区段", page: "结构", research: "搜索资料", plan: "内容策划", draft: "初稿", design: "设计稿" })[kind];
}

function visualSlotLabel(kind: string) {
  return ({ diagram: "关系图", chart: "图表", svg_illustration: "SVG 配图", photo: "实拍图位", none: "纯文字" } as Record<string, string>)[kind] || kind;
}

function bestSurface(page?: PageDTO): Surface {
  if (page?.designSvg) return "design";
  if (page?.draftSvg) return "draft";
  return "search";
}

function readyCount(pages: PageDTO[], field: "searchStatus" | "draftStatus") {
  return pages.filter((page) => page[field] === "ready").length;
}

function statusLabel(project: ProjectDTO) {
  if (project.stage === "style_reference") return "等待风格确认";
  if (project.status === "running") return "Agent 工作中";
  if (project.status === "completed") return "全部就绪";
  return "可编辑";
}

function statusPillClass(status: string) {
  return status === "running" ? "script-status running" : "script-status";
}

function minimapColor(kind: BoardKind) {
  return ({ group: "#dbe3ed", page: "#17243a", research: "#dcecff", plan: "#dff2e8", draft: "#fff", design: "#d8e8ff" })[kind];
}

function readPositions(key: string): Record<string, { x: number; y: number }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") as Record<string, { x: number; y: number }>;
  } catch {
    return {};
  }
}

function writePositions(key: string, value: Record<string, { x: number; y: number }>) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
