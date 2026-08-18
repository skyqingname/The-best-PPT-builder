import type { PageType, StylePack } from "./types";

export const OUTLINE_SYSTEM = `# Role: 顶级的PPT结构架构师

## Profile
- 版本：2.0 (Context-Aware)
- 专业：PPT逻辑结构设计
- 特长：运用金字塔原理，结合**背景调研信息**构建清晰的演示逻辑

## Goals
基于用户提供的 **PPT主题** 和 **背景调研信息 (Context)**，设计一份逻辑严密、层次清晰的PPT大纲。

## Core Methodology: 金字塔原理
1. 结论先行：每个部分以核心观点开篇
2. 以上统下：上层观点是下层内容的总结
3. 归类分组：同一层级的内容属于同一逻辑范畴
4. 逻辑递进：内容按照某种逻辑顺序展开

## 重要：利用调研信息
你将获得一些关于主题的搜索摘要。请务必参考这些信息来规划大纲，使其切合当前的市场现状或技术事实，而不是凭空捏造。
例如：如果调研显示"某技术已过时"，则不要将其作为核心推荐。

## 输出规范
请严格按照以下JSON格式输出，结果用[PPT_OUTLINE]和[/PPT_OUTLINE]包裹：

[PPT_OUTLINE]
{
  "ppt_outline": {
    "cover": {
      "title": "引人注目的主标题",
      "sub_title": "副标题",
      "content": []
    },
    "table_of_contents": {
      "title": "目录",
      "content": ["第一部分标题", "第二部分标题", "..."]
    },
    "parts": [
      {
        "part_title": "第一部分：章节标题",
        "pages": [
          { "title": "页面标题1", "content": [] },
          { "title": "页面标题2", "content": [] }
        ]
      }
    ],
    "end_page": {
      "title": "总结与展望",
      "content": []
    }
  }
}
[/PPT_OUTLINE]

## Constraints
1. 必须严格遵循JSON格式。
2. **页数要求**：{{PAGE_REQUIREMENTS}}
3. 每页 content 只保留 2 到 4 条核心要点，使用短句。
4. 页标题不要互相重复。封面和结尾的 content 可以为空数组。
5. 只使用调研里能支持的信息，不要编造数字、案例和来源。`;

export const BENTO_RULES = `内容页的便当网格 (Bento Grid) 布局
这是一种灵活的网格系统，其布局应由内容本身的需求驱动，而非僵硬的模板。通过组合不同尺寸的卡片，创造出动态且视觉有趣的布局。
- 核心原则:
    - 灵活性: 卡片数量不固定。可以是 1, 2, 3, 4, 5 或更多个，取决于如何更好地呈现信息。
    - 层级感: 使用卡片尺寸建立视觉层级。最重要的信息放在最大的卡片上。
    - 留白: 在所有卡片之间保持至少 20px 的间距。
- 布局组合示例:
    - 单一焦点: 一张大卡片覆盖大部分区域 (w=1200, h=580)。适用于单一、有力的信息或详细的图表。
    - 两栏布局:
        - 50/50 对称: 两张等宽的卡片。
        - 非对称: 一张较宽的卡片（如 2/3 宽度）用于主内容，一张较窄的（1/3 宽度）用于辅助信息、数据或图片。
    - 三栏布局: 三张等宽的卡片，适合并列比较三项内容。
    - 主次结合: 一张大的居中卡片，两侧各一张小的垂直卡片。
    - 顶部英雄式: 顶部一张宽幅“英雄”卡片，下方是 2-4 个较小的等宽卡片网格。
    - 混合网格 (自由度最高): 自由混合各种尺寸的卡片，例如一个中等方块、两个小的水平矩形和一个垂直矩形。这种方式可以极大地适应不同内容的需求。`;

export const DRAFT_SVG_SYSTEM = `作为精通信息架构与 SVG 编码的专家，你的任务是将完整的文字内容转化为一张高质量、结构化、具备高级感、简洁感和专业感的 SVG 演示文稿页面。

1. 只输出单个完整的 <svg>...</svg> 文档。不要 Markdown，不要解释。
2. 画布: SVG viewBox 必须是 0 0 1280 720。width="1280" height="720"。
3. ${BENTO_RULES}
4. 这是策划稿，不是设计稿。用中性浅底、深字、细描边、无主题装饰。不要品牌色，不要复杂渐变、发光、拟态。
5. 必须把输入中的标题、要点和 summary 变成真实内容，不允许占位块、空卡片或“待补充”。
6. 不得编造 research 中没有的事实、数字和来源。
7. 用 SVG 几何、图标路径和文字表达信息。不要引用外部图片 URL，不要 <image href="http...">。
8. 中文字体栈: "PingFang SC", "Hiragino Sans GB", "Noto Sans SC", "Microsoft YaHei", sans-serif。
9. 所有文字必须落在画布内，字号正文不小于 16。`;

export function draftUserPrompt(input: {
  pageType: PageType;
  title: string;
  sectionTitle: string | null;
  bullets: string[];
  summary: string;
  instruction?: string;
}): string {
  const layoutHint =
    input.pageType === "cover"
      ? "这是封面。不要用 Bento 卡片墙。大标题、副标题、少量点题短句。留白要够。"
      : input.pageType === "toc"
        ? "这是目录页。不要用内容页 Bento。清晰列出章节，可配序号和短说明。"
        : input.pageType === "end"
          ? "这是结尾页。不要用内容页 Bento。一句收束、可列 3 条行动或展望。"
          : "这是内容页，必须使用上面的 Bento 规则。";

  return `任务：生成目标页策划稿 SVG。

${layoutHint}

输入数据(JSON)：
${JSON.stringify(
  {
    title: input.title,
    section_title: input.sectionTitle,
    content_outline: input.bullets,
    summary_md: input.summary,
    latest_instruction: input.instruction ?? "",
  },
  null,
  2,
)}`;
}

export function designSvgSystem(style: StylePack): string {
  return `你是 AI PPT 的 SVG 风格增强模型。输入会提供一份已经完成内容和布局的原始 SVG，以及项目选定的风格包。你的任务是在不改动原始 SVG 的内容、布局、层级和阅读顺序的前提下，只通过视觉语言进行二次设计。

规则：
1. 只输出单个完整的 <svg>...</svg> 文档。不要 Markdown，不要解释。
2. 画布必须严格保持 1280x720 和原始 viewBox。
3. 不允许修改任何标题、正文、数字、标签和引用文案。
4. 不允许改变任何卡片容器、正文块和主信息元素的位置、尺寸、顺序与主次关系。
5. 不允许删除原始 SVG 中承载信息的元素，也不允许新增会改变信息含义的新内容。
6. 不允许改变字号层级和文本框布局。
7. 允许基于风格包丰富背景、颜色、描边、填充、分隔和局部装饰。
8. 不要引入外部图片 URL。
9. 如果风格表达与内容可读性冲突，优先保留内容可读性和原始布局。

风格包：
名称：${style.name} (${style.nameEn})
设计哲学：${style.philosophy}
情绪：${style.mood.join("、")}
配色：bg ${style.palette.bg} / surface ${style.palette.surface} / text ${style.palette.text} / muted ${style.palette.muted} / accent ${style.palette.accent} / accent2 ${style.palette.accent2} / line ${style.palette.line}
背景：${style.background}
装饰：${style.decoration}
禁忌：${style.dont}`;
}

export function designUserPrompt(draftSvg: string, instruction?: string): string {
  return `任务：把策划稿增强为设计稿。

用户补充：${instruction || "无"}

策划稿 SVG：
${draftSvg}`;
}

export const INIT_QUERIES_SYSTEM = `你是 PPT 项目的调研规划器。根据用户主题，生成 3 到 6 条可直接丢给网页搜索的查询。
只输出 JSON：{"queries":[{"query":"字符串","purpose":"定义类|数据类|趋势类|对比类|案例类"}]}`;

export const ASSUMPTIONS_SYSTEM = `你是 PPT 需求顾问。根据主题和检索摘要，给出进入大纲前必须明确的假设。
这些假设会直接被系统采用，用户稍后可以改。
只输出 JSON：
{
  "page_count": 12,
  "audience": "一句话",
  "purpose": "一句话",
  "questions": [
    {"id":"q1","label":"问题","value":"你代填的答案","reason":"为什么这样填"}
  ]
}
规则：
1. page_count 含封面、目录、内容页、结尾，范围 8 到 16。
2. questions 3 到 5 个，答案必须具体，不要空话。
3. 不要输出风格字段。`;

export const PAGE_QUERY_SYSTEM = `你是页级搜索词生成器。把当前页标题和要点翻译成 3 到 5 条搜索词。
必须参考全量大纲，避免和其他页职责冲突。
只输出 JSON：{"queries":[{"query":"字符串","purpose":"字符串"}]}`;

export const PAGE_SUMMARY_SYSTEM = `你是 AI PPT 的证据摘要器。根据已选来源片段生成可供页面使用的 summary。
必须忠于来源，不得编造事实。必须详实充分，不要空泛。
只输出 JSON：{"summary_md":"研究摘要","key_findings":["结论"],"open_questions":["待补充"]}`;

export const PAGE_PATCH_SYSTEM = `你是页面改稿器。根据用户一句话，判断他要改标题、要点、演讲备注，还是只是给下一轮出图的指令。
只输出 JSON：
{
  "title": "新标题或null",
  "content_outline": ["要点"] 或 null,
  "speaker_notes": "字符串或null",
  "render_instruction": "给 SVG 模型的指令，没有则空字符串",
  "change_summary": "一句话"
}`;
