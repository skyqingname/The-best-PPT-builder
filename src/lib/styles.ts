import type { StylePack } from "./types";

export const STYLE_PACKS: StylePack[] = [
  {
    id: "imperial-minimal",
    name: "朱红宫墙",
    nameEn: "Imperial Minimalist",
    mood: ["故宫红", "宫廷美学", "极简主义", "文化底蕴"],
    philosophy: "宫廷礼序压成现代平面。少色、大留白、一条强调红。",
    palette: {
      bg: "#F6F1E8",
      surface: "#FFFDF8",
      text: "#3B1F1A",
      muted: "#7A5A52",
      accent: "#9A1B1F",
      accent2: "#C4A574",
      line: "#E6D5C5",
    },
    background: "暖米纸色或浅宣纸底，不要做旧斑驳。",
    decoration: "细线、小印章块、竖向标题栏。圆角克制。",
    dont: "不要霓虹、不要大渐变、不要把红色铺满整页。",
  },
  {
    id: "tech-noir",
    name: "夜航科技",
    nameEn: "Tech Noir",
    mood: ["科技", "冷静", "未来感"],
    philosophy: "深底、细线、少量荧光青。表达清晰高于炫技。",
    palette: {
      bg: "#0B0E14",
      surface: "#151A22",
      text: "#EEF3F8",
      muted: "#9AA6B2",
      accent: "#3EE0C5",
      accent2: "#7B8CFF",
      line: "#243040",
    },
    background: "深黑或暗灰纯底，允许极弱暗色渐变。",
    decoration: "细霓虹描边、几何分割，发光面积很小。",
    dont: "不要多色霓虹混战，不要让装饰压过文字。",
  },
  {
    id: "swiss-editorial",
    name: "瑞士秩序",
    nameEn: "Swiss Editorial",
    mood: ["大胆", "秩序", "平面冲击"],
    philosophy: "功能主义。网格、大字号、硬边、信号红。",
    palette: {
      bg: "#F4F4F0",
      surface: "#FFFFFF",
      text: "#111111",
      muted: "#5C5C5C",
      accent: "#E10600",
      accent2: "#111111",
      line: "#111111",
    },
    background: "大面积纯色块，允许黑白反转。",
    decoration: "粗线、色块切分、极少圆角。",
    dont: "不要渐变、不要阴影、不要拟态、不要花哨图标。",
  },
  {
    id: "brand-clean",
    name: "专业蓝",
    nameEn: "Brand Clean",
    mood: ["专业", "可信", "现代"],
    philosophy: "企业汇报默认皮肤。稳定、干净、可连续输出。",
    palette: {
      bg: "#F5F7FA",
      surface: "#FFFFFF",
      text: "#1B2430",
      muted: "#5B6775",
      accent: "#1664FF",
      accent2: "#0F2C59",
      line: "#D7DEE7",
    },
    background: "白底或浅灰底，强调区可用很浅的蓝。",
    decoration: "细色条、线性图标、轻卡片描边。",
    dont: "不要额外引入高饱和杂色，不要整页渐变。",
  },
  {
    id: "ink-paper",
    name: "纸本墨色",
    nameEn: "Ink Paper",
    mood: ["克制", "编辑感", "纸质"],
    philosophy: "像一本印得好的中文小册子。墨、纸、栏。",
    palette: {
      bg: "#EFE8DC",
      surface: "#F7F1E6",
      text: "#1C1915",
      muted: "#6B6358",
      accent: "#1C1915",
      accent2: "#8A3B12",
      line: "#D4CBBB",
    },
    background: "轻微纸色，不要做旧做脏。",
    decoration: "栏线、页码感小标记、衬线标题。",
    dont: "不要科技蓝、不要玻璃拟态、不要卡通插画。",
  },
  {
    id: "warm-sand",
    name: "暖沙咨询",
    nameEn: "Warm Sand",
    mood: ["咨询", "温和", "高端"],
    philosophy: "顾问材料：暖灰、沙色、一条深橄榄强调。",
    palette: {
      bg: "#F3EEE6",
      surface: "#FFFbf5",
      text: "#2A2622",
      muted: "#6F675E",
      accent: "#3F4F3A",
      accent2: "#C9844A",
      line: "#E2D8CA",
    },
    background: "暖沙或浅石色纯底。",
    decoration: "软卡片、细分隔、少量陶土点缀。",
    dont: "不要冷蓝科技风，不要过圆的气泡卡。",
  },
];

export function getStylePack(id: string | null | undefined): StylePack {
  return STYLE_PACKS.find((item) => item.id === id) ?? STYLE_PACKS[3];
}

export function pickStyleForTopic(topic: string): StylePack {
  const text = topic.toLowerCase();
  if (/故宫|宫廷|国风|文化|旅游|攻略|茶|酒/.test(text)) {
    return STYLE_PACKS[0];
  }
  if (/ai|模型|芯片|智能|saas|api|云|数据/.test(text)) {
    return STYLE_PACKS[1];
  }
  if (/设计|艺术|展览|品牌视觉/.test(text)) {
    return STYLE_PACKS[2];
  }
  if (/财报|咨询|战略|组织|管理|投资/.test(text)) {
    return STYLE_PACKS[5];
  }
  if (/企业介绍|公司|产品介绍|方案/.test(text)) {
    return STYLE_PACKS[3];
  }
  return STYLE_PACKS[3];
}
