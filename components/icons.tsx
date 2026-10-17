"use client";

import type { CSSProperties } from "react";
import {
  AlignHorizontalSpaceAround,
  AppWindow,
  ArrowDown,
  ArrowRight,
  Check,
  ChevronRight,
  ChevronsUpDown,
  CircleDot,
  Code,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  Heading1,
  Image,
  LayoutGrid,
  LayoutList,
  Layers,
  LoaderCircle,
  Lock,
  LockOpen,
  MapPin,
  Minus,
  Monitor,
  MousePointerClick,
  Music,
  NotebookText,
  Navigation,
  Play,
  Plus,
  RectangleEllipsis,
  Redo2,
  RotateCcw,
  Shapes,
  Smartphone,
  Square,
  SquareCheck,
  SquareDashed,
  SquarePlay,
  Tablet,
  Trash2,
  TriangleAlert,
  Type,
  Undo2,
  TvMinimalPlay,
  X,
  Link2,
  ToggleRight,
  type LucideIcon,
} from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  box: Square,
  text: Type,
  heading: Heading1,
  button: MousePointerClick,
  image: Image,
  divider: Minus,
  code: Code,
  plus: Plus,
  trash: Trash2,
  copy: Copy,
  eye: Eye,
  eyeOff: EyeOff,
  lock: Lock,
  unlock: LockOpen,
  chevron: ChevronRight,
  undo: Undo2,
  redo: Redo2,
  desktop: Monitor,
  tablet: Tablet,
  mobileL: Smartphone,
  mobile: Smartphone,
  play: Play,
  download: Download,
  check: Check,
  warning: TriangleAlert,
  close: X,
  page: FileText,
  loader: LoaderCircle,
  layers: Layers,
  reset: RotateCcw,
  flowV: ArrowDown,
  flowH: ArrowRight,
  flowGrid: LayoutGrid,
  flowNone: SquareDashed,
  gap: AlignHorizontalSpaceAround,
  shapes: Shapes,
  input: RectangleEllipsis,
  textarea: NotebookText,
  select: ChevronsUpDown,
  checkbox: SquareCheck,
  radio: CircleDot,
  file: FileUp,
  video: SquarePlay,
  audio: Music,
  youtube: TvMinimalPlay,
  map: MapPin,
  embed: AppWindow,
  list: LayoutList,
  submit: Navigation,
  link: Link2,
  switch: ToggleRight,
};

export function Icon({
  name,
  size = 14,
  style,
  className,
  title,
}: {
  name: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
  title?: string;
}) {
  const C = MAP[name] ?? Square;
  const rotate = name === "mobileL";
  return (
    <C
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      className={className}
      style={rotate ? { ...style, transform: "rotate(90deg)" } : style}
      aria-label={title}
    />
  );
}
