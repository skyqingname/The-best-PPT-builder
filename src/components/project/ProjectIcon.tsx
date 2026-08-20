import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  LayoutDashboard,
  Mic2,
  MousePointer2,
  Palette,
  PauseCircle,
  Pencil,
  PlayCircle,
  Search,
  Send,
  Settings,
  Sparkles,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";

export type ProjectIconName =
  | "arrow"
  | "back"
  | "board"
  | "check"
  | "close"
  | "cursor"
  | "down"
  | "download"
  | "edit"
  | "file"
  | "mic"
  | "palette"
  | "pause"
  | "play"
  | "search"
  | "send"
  | "settings"
  | "sparkle"
  | "target"
  | "up";

const icons: Record<ProjectIconName, LucideIcon> = {
  arrow: ArrowRight,
  back: ArrowLeft,
  board: LayoutDashboard,
  check: Check,
  close: X,
  cursor: MousePointer2,
  down: ChevronDown,
  download: Download,
  edit: Pencil,
  file: FileText,
  mic: Mic2,
  palette: Palette,
  pause: PauseCircle,
  play: PlayCircle,
  search: Search,
  send: Send,
  settings: Settings,
  sparkle: Sparkles,
  target: Target,
  up: ChevronUp,
};

export function ProjectIcon({
  name,
  size = 16,
  className,
}: {
  name: ProjectIconName;
  size?: number;
  className?: string;
}) {
  const Glyph = icons[name];
  return <Glyph size={size} strokeWidth={1.8} className={className} aria-hidden />;
}
