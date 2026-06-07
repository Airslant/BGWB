"use client";

import {
  ArrowLeft,
  ArrowRight,
  Grid2X2,
  ImageOff,
  Keyboard,
  LayoutTemplate,
  ListOrdered,
  Loader2,
  Check,
  Minus,
  MousePointer2,
  PanelTop,
  Palette,
  Plus,
  Search,
  Share2,
  Square,
  StickyNote,
  Table2,
  Trash2,
  Type,
  X,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import Link from "next/link";
import { type CSSProperties, type FormEvent, MouseEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import { createId } from "@/lib/id";
import { getGameDisplayName, UI_COPY } from "@/lib/i18n";
import {
  BOARD_ANNOTATION_COLORS,
  BOARD_ANNOTATION_FONT_SIZES,
  BOARD_ANNOTATION_LINE_WIDTHS,
  BOARD_STATUSES,
  MAX_VIEWPORT_SCALE,
  MIN_VIEWPORT_SCALE,
  VIEWPORT_SCALE_BASE,
  type BggSearchResult,
  type Board,
  type BoardAnnotation,
  type BoardAnnotationColor,
  type BoardAnnotationFontSize,
  type BoardAnnotationKind,
  type BoardAnnotationLineWidth,
  type BoardAnnotationStyle,
  type BoardItem,
  type BoardSavePayload,
  type CardCoverMode,
  type GameSnapshot,
  type Locale,
  type Viewport
} from "@/lib/types";

import { LanguageSelect, useLocale } from "./use-locale";
import { BggAttribution, BggIcon, getBggGameUrl } from "./bgg-branding";

const CARD_WIDTH = 176;
const DEFAULT_COVER_RATIO = 0.72;
const A4_COVER_RATIO = 1 / 1.414;
const TOPN_DEFAULT_COUNT = 10;
const TOPN_DEFAULT_COLUMNS = 5;
const TOPN_MAX_COUNT = 100;
const TOPN_MAX_COLUMNS = 20;
const TOPN_MAX_ROWS = 100;
const TOPN_CELL_WIDTH = CARD_WIDTH + 48;
const TOPN_CELL_HEIGHT = Math.round(CARD_WIDTH / DEFAULT_COVER_RATIO + 76);
const TABLE_DEFAULT_ROWS = 4;
const TABLE_DEFAULT_COLUMNS = 4;
const TABLE_MAX_ROWS = 20;
const TABLE_MAX_COLUMNS = 20;
const TABLE_CELL_WIDTH = TOPN_CELL_WIDTH;
const TABLE_CELL_HEIGHT = TOPN_CELL_HEIGHT;
const HOT_TO_LAME_ROW_COUNT = 5;
const HOT_TO_LAME_DEFAULT_WIDTH = 2160;
const HOT_TO_LAME_DEFAULT_HEIGHT = HOT_TO_LAME_ROW_COUNT * TOPN_CELL_HEIGHT;
const TEXT_LAYER_PRIORITY = 1;
const GAME_CARD_LAYER_PRIORITY = 2;
const COMPONENT_LAYER_PRIORITY = 3;
const LAYER_Z_INDEX_STEP = 10000;
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: VIEWPORT_SCALE_BASE };
const CONTEXT_MENU_WIDTH = 224;
const CONTEXT_MENU_HEIGHT = 188;
const AUTOSAVE_DEBOUNCE_MS = 1200;
const MIN_ANNOTATION_SIZE = 36;
const MIN_HOT_TO_LAME_WIDTH = 280;
const SNAP_THRESHOLD_PX = 8;
const STYLEBAR_ESTIMATED_WIDTH = 900;
const MOBILE_VIEW_MEDIA_QUERY = "(max-width: 900px)";
const MOBILE_DOUBLE_TAP_MS = 320;
const MOBILE_TAP_MOVE_THRESHOLD = 12;
const VIEWPORT_STORAGE_PREFIX = "bgwb.boardViewport.";
const LOCAL_VIEWPORT_SAVE_DEBOUNCE_MS = 160;
const DEFAULT_ANNOTATION_SIZE: Record<BoardAnnotationKind, { width: number; height: number }> = {
  text: { width: 220, height: 72 },
  sticky: { width: 220, height: 140 },
  section: { width: 440, height: 240 },
  rectangle: { width: 240, height: 150 },
  line: { width: 180, height: 0 },
  arrow: { width: 180, height: 0 },
  quadrant: { width: 560, height: 380 },
  hotToLame: { width: HOT_TO_LAME_DEFAULT_WIDTH, height: HOT_TO_LAME_DEFAULT_HEIGHT },
  topN: { width: TOPN_DEFAULT_COLUMNS * TOPN_CELL_WIDTH, height: Math.ceil(TOPN_DEFAULT_COUNT / TOPN_DEFAULT_COLUMNS) * TOPN_CELL_HEIGHT },
  table: { width: TABLE_DEFAULT_COLUMNS * TABLE_CELL_WIDTH, height: TABLE_DEFAULT_ROWS * TABLE_CELL_HEIGHT }
};
const ANNOTATION_COLOR_THEME: Record<BoardAnnotationColor, { label: string; stroke: string; fill: string }> = {
  ink: { label: "Ink", stroke: "#1a1815", fill: "26, 24, 21" },
  moss: { label: "Moss", stroke: "#3f6f5a", fill: "63, 111, 90" },
  brick: { label: "Brick", stroke: "#b44934", fill: "180, 73, 52" },
  navy: { label: "Navy", stroke: "#23466d", fill: "35, 70, 109" },
  amber: { label: "Amber", stroke: "#c48222", fill: "196, 130, 34" },
  cream: { label: "Cream", stroke: "#fffaf0", fill: "255, 250, 240" }
};

type DragState =
  | { type: "none" }
  | {
      type: "pan";
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
    }
  | {
      type: "item";
      itemId: string;
      offsetX: number;
      offsetY: number;
    }
  | {
      type: "annotation-move";
      annotationIds: string[];
      startClientX: number;
      startClientY: number;
      originals: Array<{ id: string; x: number; y: number }>;
    }
  | {
      type: "annotation-resize";
      annotationId: string;
      startWorldX: number;
      startWorldY: number;
      startWidth: number;
      startHeight: number;
    }
  | {
      type: "annotation-width-extend";
      annotationId: string;
      startWorldX: number;
      startWidth: number;
    }
  | {
      type: "annotation-line-end";
      annotationId: string;
      endpoint: "start" | "end";
    }
  | {
      type: "annotation-create";
      annotationId: string;
      kind: BoardAnnotationKind;
      startWorldX: number;
      startWorldY: number;
    };

type BoardClientProps = {
  boardId: string;
  apiPath?: string;
  backHref?: string;
  mode?: "edit" | "view";
};

type UiCopy = (typeof UI_COPY)[Locale];
type ContextMenuState = {
  itemId: string;
  x: number;
  y: number;
};
type QuadrantText = {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
};
type TopNConfig = {
  count: number;
  order: "ascending" | "descending";
  rows: number;
  columns: number;
};
type TableConfig = {
  rows: number;
  columns: number;
};
type TemplateTool = "template-sticky" | "template-hot-to-lame" | "template-quadrant" | "template-top-n" | "template-table";
type DirectAnnotationTool = Exclude<BoardAnnotationKind, "sticky" | "quadrant" | "hotToLame" | "topN" | "table">;
type CanvasTool = "select" | DirectAnnotationTool | TemplateTool;
type ShortcutToolAction = CanvasTool | "addGame" | "templateMenu";
type StageSize = { width: number; height: number };
type WorldRect = { x: number; y: number; width: number; height: number };
type TouchPoint = { clientX: number; clientY: number };
type MobileTapCandidate = { itemId: string; pointerId: number; clientX: number; clientY: number; time: number };
type MobilePinchState = {
  startDistance: number;
  startViewport: Viewport;
  startWorldX: number;
  startWorldY: number;
};
type SnapGuide =
  | { orientation: "vertical"; position: number; start: number; end: number }
  | { orientation: "horizontal"; position: number; start: number; end: number };

const TOOL_SHORTCUTS: Record<CanvasTool, string> = {
  select: "V",
  text: "T",
  section: "S",
  rectangle: "R",
  line: "L",
  arrow: "A",
  "template-sticky": "N",
  "template-hot-to-lame": "D",
  "template-quadrant": "Q",
  "template-top-n": "O",
  "template-table": "G"
};
const TEMPLATE_MENU_SHORTCUT = "M";
const ADD_GAME_SHORTCUT = "B";
const TOOL_ACTION_BY_SHORTCUT: Record<string, ShortcutToolAction> = {
  v: "select",
  b: "addGame",
  t: "text",
  s: "section",
  r: "rectangle",
  l: "line",
  a: "arrow",
  m: "templateMenu",
  n: "template-sticky",
  d: "template-hot-to-lame",
  q: "template-quadrant",
  o: "template-top-n",
  g: "template-table"
};

type WebKitGestureEvent = Event & {
  clientX: number;
  clientY: number;
  scale: number;
};
type SaveOptions = {
  keepalive?: boolean;
};
type CoverRatioState = {
  url: string;
  ratio: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function moveIdsToEnd<T extends { id: string }>(entries: T[], ids: Set<string>) {
  const movingEntries = entries.filter((entry) => ids.has(entry.id));

  if (movingEntries.length === 0) {
    return entries;
  }

  return [...entries.filter((entry) => !ids.has(entry.id)), ...movingEntries];
}

function getLayerZIndex(priority: number, index: number) {
  return (COMPONENT_LAYER_PRIORITY + 1 - priority) * LAYER_Z_INDEX_STEP + index;
}

function getAnnotationLayerPriority(annotation: BoardAnnotation) {
  return annotation.kind === "text" ? TEXT_LAYER_PRIORITY : COMPONENT_LAYER_PRIORITY;
}

function formatPlayers(game: GameSnapshot, unit: string) {
  if (!game.minPlayers && !game.maxPlayers) {
    return "";
  }

  if (game.minPlayers && game.maxPlayers && game.minPlayers !== game.maxPlayers) {
    return `${game.minPlayers}-${game.maxPlayers} ${unit}`;
  }

  return `${game.minPlayers ?? game.maxPlayers} ${unit}`;
}

function formatPlayTime(game: GameSnapshot, unit: string) {
  if (game.minPlayTime && game.maxPlayTime && game.minPlayTime !== game.maxPlayTime) {
    return `${game.minPlayTime}-${game.maxPlayTime} ${unit}`;
  }

  if (game.playingTime) {
    return `${game.playingTime} ${unit}`;
  }

  return "";
}

function formatRating(game: GameSnapshot) {
  if (!game.averageRating || game.averageRating <= 0) {
    return "";
  }

  return game.averageRating.toFixed(1);
}

function InfoRow({ label, value }: { label: string; value: string | number | undefined }) {
  if (!value) {
    return null;
  }

  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function clearNativeSelection() {
  window.getSelection()?.removeAllRanges();
}

function getViewportStorageKey(boardId: string) {
  return `${VIEWPORT_STORAGE_PREFIX}${boardId}`;
}

function sanitizeLocalViewport(value: unknown): Viewport | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const viewport = value as Partial<Viewport>;
  const x = viewport.x;
  const y = viewport.y;
  const scale = viewport.scale;

  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof scale !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(scale)
  ) {
    return null;
  }

  return {
    x,
    y,
    scale: clamp(scale, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE)
  };
}

function readStoredViewport(boardId: string) {
  try {
    return sanitizeLocalViewport(JSON.parse(window.localStorage.getItem(getViewportStorageKey(boardId)) ?? "null"));
  } catch {
    return null;
  }
}

function writeStoredViewport(boardId: string, viewport: Viewport) {
  try {
    window.localStorage.setItem(getViewportStorageKey(boardId), JSON.stringify(viewport));
  } catch {
    // Local view restoration is a convenience only; ignore quota or privacy-mode failures.
  }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const updateMatches = () => setMatches(mediaQuery.matches);

    updateMatches();
    mediaQuery.addEventListener("change", updateMatches);

    return () => {
      mediaQuery.removeEventListener("change", updateMatches);
    };
  }, [query]);

  return matches;
}

function getPointDistance(a: TouchPoint, b: TouchPoint) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function getPointCenter(a: TouchPoint, b: TouchPoint) {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2
  };
}

function getFirstTwoTouchPoints(points: Map<number, TouchPoint>) {
  const values = Array.from(points.values());

  if (values.length < 2) {
    return null;
  }

  return [values[0], values[1]] as const;
}

function createQuadrantText(topLeft: string, topRight: string, bottomLeft: string, bottomRight: string): QuadrantText {
  return { topLeft, topRight, bottomLeft, bottomRight };
}

function parseQuadrantText(value: string): QuadrantText {
  if (!value.trim()) {
    return createQuadrantText("", "", "", "");
  }

  try {
    const parsed = JSON.parse(value) as Partial<QuadrantText>;

    return createQuadrantText(
      typeof parsed.topLeft === "string" ? parsed.topLeft : "",
      typeof parsed.topRight === "string" ? parsed.topRight : "",
      typeof parsed.bottomLeft === "string" ? parsed.bottomLeft : "",
      typeof parsed.bottomRight === "string" ? parsed.bottomRight : ""
    );
  } catch {
    return createQuadrantText(value, "", "", "");
  }
}

function serializeQuadrantText(value: QuadrantText) {
  return JSON.stringify({
    topLeft: value.topLeft.slice(0, 220),
    topRight: value.topRight.slice(0, 220),
    bottomLeft: value.bottomLeft.slice(0, 220),
    bottomRight: value.bottomRight.slice(0, 220)
  });
}

function normalizeTopNConfig(config: Partial<TopNConfig>): TopNConfig {
  const countValue = typeof config.count === "number" && Number.isFinite(config.count) ? config.count : TOPN_DEFAULT_COUNT;
  const columnValue =
    typeof config.columns === "number" && Number.isFinite(config.columns) ? config.columns : Math.min(countValue, TOPN_DEFAULT_COLUMNS);
  const count = Math.round(clamp(countValue, 1, TOPN_MAX_COUNT));
  const order = config.order === "descending" ? "descending" : "ascending";
  const columns = Math.round(clamp(columnValue, 1, TOPN_MAX_COLUMNS));
  const rowValue =
    typeof config.rows === "number" && Number.isFinite(config.rows) ? config.rows : Math.ceil(count / Math.max(columns, 1));
  const rows = Math.round(clamp(rowValue, 1, TOPN_MAX_ROWS));

  if (rows * columns >= count) {
    return { count, order, rows, columns };
  }

  return { count, order, rows: Math.min(TOPN_MAX_ROWS, Math.ceil(count / columns)), columns };
}

function parseTopNConfig(value: string): TopNConfig {
  if (!value.trim()) {
    return normalizeTopNConfig({});
  }

  try {
    return normalizeTopNConfig(JSON.parse(value) as Partial<TopNConfig>);
  } catch {
    return normalizeTopNConfig({});
  }
}

function serializeTopNConfig(value: Partial<TopNConfig>) {
  return JSON.stringify(normalizeTopNConfig(value));
}

function updateTopNConfig(current: TopNConfig, patch: Partial<TopNConfig>): TopNConfig {
  const next = { ...current, ...patch };

  if (patch.count !== undefined) {
    const count = Math.round(clamp(patch.count, 1, TOPN_MAX_COUNT));
    const columns = Math.round(clamp(current.columns, 1, TOPN_MAX_COLUMNS));

    return normalizeTopNConfig({
      ...next,
      count,
      columns,
      rows: Math.ceil(count / columns)
    });
  }

  if (patch.columns !== undefined) {
    const columns = Math.round(clamp(patch.columns, 1, TOPN_MAX_COLUMNS));

    return normalizeTopNConfig({
      ...next,
      columns,
      rows: Math.ceil(current.count / columns)
    });
  }

  if (patch.rows !== undefined) {
    const rows = Math.round(clamp(patch.rows, 1, TOPN_MAX_ROWS));

    return normalizeTopNConfig({
      ...next,
      rows,
      columns: Math.ceil(current.count / rows)
    });
  }

  return normalizeTopNConfig(next);
}

function getTopNPreferredSize(config: TopNConfig, previous?: { width: number; height: number; config: TopNConfig }) {
  const cellWidth = previous ? Math.max(previous.width / previous.config.columns, TOPN_CELL_WIDTH) : TOPN_CELL_WIDTH;
  const cellHeight = previous ? Math.max(previous.height / previous.config.rows, TOPN_CELL_HEIGHT) : TOPN_CELL_HEIGHT;

  return {
    width: config.columns * cellWidth,
    height: config.rows * cellHeight
  };
}

function normalizeTableConfig(config: Partial<TableConfig>): TableConfig {
  const rowValue = typeof config.rows === "number" && Number.isFinite(config.rows) ? config.rows : TABLE_DEFAULT_ROWS;
  const columnValue = typeof config.columns === "number" && Number.isFinite(config.columns) ? config.columns : TABLE_DEFAULT_COLUMNS;

  return {
    rows: Math.round(clamp(rowValue, 1, TABLE_MAX_ROWS)),
    columns: Math.round(clamp(columnValue, 1, TABLE_MAX_COLUMNS))
  };
}

function parseTableConfig(value: string): TableConfig {
  if (!value.trim()) {
    return normalizeTableConfig({});
  }

  try {
    return normalizeTableConfig(JSON.parse(value) as Partial<TableConfig>);
  } catch {
    return normalizeTableConfig({});
  }
}

function serializeTableConfig(value: Partial<TableConfig>) {
  return JSON.stringify(normalizeTableConfig(value));
}

function updateTableConfig(current: TableConfig, patch: Partial<TableConfig>): TableConfig {
  return normalizeTableConfig({ ...current, ...patch });
}

function getTablePreferredSize(config: TableConfig, previous?: { width: number; height: number; config: TableConfig }) {
  const cellWidth = previous ? Math.max(previous.width / previous.config.columns, TABLE_CELL_WIDTH) : TABLE_CELL_WIDTH;
  const cellHeight = previous ? Math.max(previous.height / previous.config.rows, TABLE_CELL_HEIGHT) : TABLE_CELL_HEIGHT;

  return {
    width: config.columns * cellWidth,
    height: config.rows * cellHeight
  };
}

function getDefaultAnnotationStyle(kind: BoardAnnotationKind): BoardAnnotationStyle {
  return {
    color: kind === "sticky" ? "amber" : kind === "section" ? "moss" : kind === "quadrant" ? "navy" : "ink",
    lineWidth: 2,
    fontSize: kind === "section" || kind === "hotToLame" || kind === "topN" || kind === "table" ? 24 : 18,
    fill: kind === "sticky" || kind === "section",
    fillOpacity: kind === "sticky" ? 0.2 : kind === "section" ? 0.12 : 0
  };
}

function createAnnotationFromBase(
  kind: BoardAnnotationKind,
  x: number,
  y: number,
  overrides: Partial<Omit<BoardAnnotation, "id" | "kind" | "createdAt" | "updatedAt" | "style">> & {
    style?: Partial<BoardAnnotationStyle>;
  } = {}
): BoardAnnotation {
  const base = createAnnotation(kind, x, y);

  return {
    ...base,
    ...overrides,
    style: {
      ...base.style,
      ...(overrides.style ?? {})
    }
  };
}

function createAnnotation(kind: BoardAnnotationKind, x: number, y: number): BoardAnnotation {
  const now = new Date().toISOString();
  const size = DEFAULT_ANNOTATION_SIZE[kind];

  return {
    id: createId(),
    kind,
    x,
    y,
    width: size.width,
    height: size.height,
    text: "",
    style: getDefaultAnnotationStyle(kind),
    createdAt: now,
    updatedAt: now
  };
}

function createTemplateAnnotations(template: TemplateTool, x: number, y: number, t: UiCopy): BoardAnnotation[] {
  if (template === "template-sticky") {
    return [createAnnotation("sticky", x, y)];
  }

  if (template === "template-hot-to-lame") {
    return [
      createAnnotationFromBase("hotToLame", x, y, {
        width: HOT_TO_LAME_DEFAULT_WIDTH,
        height: HOT_TO_LAME_DEFAULT_HEIGHT,
        text: "",
        style: { color: "ink", fill: false, fillOpacity: 0, fontSize: 24, lineWidth: 2 }
      })
    ];
  }

  if (template === "template-quadrant") {
    return [
      createAnnotationFromBase("quadrant", x, y, {
        width: 560,
        height: 380,
        text: serializeQuadrantText(createQuadrantText(t.quadrantOne, t.quadrantTwo, t.quadrantThree, t.quadrantFour)),
        style: { color: "navy", fill: false, fillOpacity: 0, fontSize: 18, lineWidth: 2 }
      })
    ];
  }

  if (template === "template-top-n") {
    const topNSize = DEFAULT_ANNOTATION_SIZE.topN;

    return [
      createAnnotationFromBase("topN", x, y, {
        width: topNSize.width,
        height: topNSize.height,
        text: serializeTopNConfig({ count: TOPN_DEFAULT_COUNT, order: "ascending", rows: 2, columns: TOPN_DEFAULT_COLUMNS }),
        style: { color: "ink", fill: false, fillOpacity: 0, fontSize: 24, lineWidth: 2 }
      })
    ];
  }

  const tableSize = DEFAULT_ANNOTATION_SIZE.table;

  return [
    createAnnotationFromBase("table", x, y, {
      width: tableSize.width,
      height: tableSize.height,
      text: serializeTableConfig({ rows: TABLE_DEFAULT_ROWS, columns: TABLE_DEFAULT_COLUMNS }),
      style: { color: "ink", fill: false, fillOpacity: 0, fontSize: 24, lineWidth: 2 }
    })
  ];
}

function isLinearAnnotation(annotation: BoardAnnotation) {
  return annotation.kind === "line" || annotation.kind === "arrow";
}

function getAnnotationBounds(annotation: Pick<BoardAnnotation, "x" | "y" | "width" | "height">) {
  const left = Math.min(annotation.x, annotation.x + annotation.width);
  const top = Math.min(annotation.y, annotation.y + annotation.height);
  const width = Math.abs(annotation.width);
  const height = Math.abs(annotation.height);

  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    centerX: left + width / 2,
    centerY: top + height / 2
  };
}

function getAnnotationGroupBounds(annotations: Array<Pick<BoardAnnotation, "x" | "y" | "width" | "height">>) {
  const bounds = annotations.map(getAnnotationBounds);

  if (bounds.length === 0) {
    return null;
  }

  const left = Math.min(...bounds.map((entry) => entry.left));
  const right = Math.max(...bounds.map((entry) => entry.right));
  const top = Math.min(...bounds.map((entry) => entry.top));
  const bottom = Math.max(...bounds.map((entry) => entry.bottom));

  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

function getAnnotationResizeMax(annotation: BoardAnnotation) {
  if (annotation.kind === "topN" || annotation.kind === "table") {
    return { width: 12000, height: 12000 };
  }

  if (annotation.kind === "hotToLame") {
    return { width: 5000, height: 4000 };
  }

  return { width: 2200, height: 1600 };
}

function canAnnotationUseFill(annotation: BoardAnnotation) {
  return annotation.kind === "sticky" || annotation.kind === "section" || annotation.kind === "rectangle";
}

function getAnnotationSnap(
  selectedAnnotations: BoardAnnotation[],
  otherAnnotations: BoardAnnotation[],
  viewportScale: number
): { dx: number; dy: number; guides: SnapGuide[] } {
  type SnapTarget = { value: number; start: number; end: number };
  const movingBounds = getAnnotationGroupBounds(selectedAnnotations);

  if (!movingBounds || otherAnnotations.length === 0) {
    return { dx: 0, dy: 0, guides: [] };
  }

  const threshold = SNAP_THRESHOLD_PX / viewportScale;
  const verticalTargets: SnapTarget[] = otherAnnotations.flatMap((annotation) => {
    const bounds = getAnnotationBounds(annotation);

    return [
      { value: bounds.left, start: bounds.top, end: bounds.bottom },
      { value: bounds.centerX, start: bounds.top, end: bounds.bottom },
      { value: bounds.right, start: bounds.top, end: bounds.bottom }
    ];
  });
  const horizontalTargets: SnapTarget[] = otherAnnotations.flatMap((annotation) => {
    const bounds = getAnnotationBounds(annotation);

    return [
      { value: bounds.top, start: bounds.left, end: bounds.right },
      { value: bounds.centerY, start: bounds.left, end: bounds.right },
      { value: bounds.bottom, start: bounds.left, end: bounds.right }
    ];
  });
  const movingXAnchors = [movingBounds.left, movingBounds.centerX, movingBounds.right];
  const movingYAnchors = [movingBounds.top, movingBounds.centerY, movingBounds.bottom];
  let bestX: { delta: number; target: SnapTarget } | null = null;
  let bestY: { delta: number; target: SnapTarget } | null = null;

  for (const target of verticalTargets) {
    for (const anchor of movingXAnchors) {
      const delta = target.value - anchor;

      if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
        bestX = { delta, target };
      }
    }
  }

  for (const target of horizontalTargets) {
    for (const anchor of movingYAnchors) {
      const delta = target.value - anchor;

      if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
        bestY = { delta, target };
      }
    }
  }

  const dx = bestX?.delta ?? 0;
  const dy = bestY?.delta ?? 0;
  const snappedBounds = {
    left: movingBounds.left + dx,
    right: movingBounds.right + dx,
    top: movingBounds.top + dy,
    bottom: movingBounds.bottom + dy
  };
  const guides: SnapGuide[] = [];

  if (bestX) {
    guides.push({
      orientation: "vertical",
      position: bestX.target.value,
      start: Math.min(bestX.target.start, snappedBounds.top) - 40,
      end: Math.max(bestX.target.end, snappedBounds.bottom) + 40
    });
  }

  if (bestY) {
    guides.push({
      orientation: "horizontal",
      position: bestY.target.value,
      start: Math.min(bestY.target.start, snappedBounds.left) - 40,
      end: Math.max(bestY.target.end, snappedBounds.right) + 40
    });
  }

  return { dx, dy, guides };
}

function getStylebarPosition(
  selectedAnnotations: BoardAnnotation[],
  viewport: Viewport,
  stage: HTMLDivElement | null
): CSSProperties | undefined {
  const bounds = getAnnotationGroupBounds(selectedAnnotations);
  const rect = stage?.getBoundingClientRect();

  if (!bounds || !rect || typeof window === "undefined") {
    return undefined;
  }

  const selectedLeft = rect.left + viewport.x + bounds.left * viewport.scale;
  const selectedTop = rect.top + viewport.y + bounds.top * viewport.scale;
  const selectedCenter = rect.left + viewport.x + bounds.centerX * viewport.scale;
  const selectedBottom = rect.top + viewport.y + bounds.bottom * viewport.scale;
  const preferredTop = selectedTop - 62;
  const top = preferredTop > 82 ? preferredTop : selectedBottom + 14;
  const left = clamp(selectedCenter - STYLEBAR_ESTIMATED_WIDTH / 2, 72, window.innerWidth - STYLEBAR_ESTIMATED_WIDTH - 16);

  return {
    left,
    top: clamp(top, 82, window.innerHeight - 70),
    bottom: "auto"
  };
}

function getItemWorldRect(item: BoardItem): WorldRect {
  const width = CARD_WIDTH * item.scale;
  const height = (CARD_WIDTH / DEFAULT_COVER_RATIO + 72) * item.scale;

  return {
    x: item.x,
    y: item.y,
    width,
    height
  };
}

function getAnnotationWorldRect(annotation: BoardAnnotation): WorldRect {
  const bounds = getAnnotationBounds(annotation);

  return {
    x: bounds.left,
    y: bounds.top,
    width: Math.max(bounds.width, MIN_ANNOTATION_SIZE),
    height: Math.max(bounds.height, MIN_ANNOTATION_SIZE)
  };
}

function getVisibleWorldRect(viewport: Viewport, stageSize: StageSize): WorldRect {
  return {
    x: -viewport.x / viewport.scale,
    y: -viewport.y / viewport.scale,
    width: stageSize.width / viewport.scale,
    height: stageSize.height / viewport.scale
  };
}

function getMinimapBounds(items: BoardItem[], annotations: BoardAnnotation[], viewport: Viewport, stageSize: StageSize): WorldRect {
  const rects = [
    getVisibleWorldRect(viewport, stageSize),
    ...items.map(getItemWorldRect),
    ...annotations.map(getAnnotationWorldRect)
  ];
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const padding = Math.max(160, Math.max(right - left, bottom - top) * 0.08);

  return {
    x: left - padding,
    y: top - padding,
    width: Math.max(right - left + padding * 2, 1),
    height: Math.max(bottom - top + padding * 2, 1)
  };
}

function getAnnotationCssVars(style: BoardAnnotationStyle): CSSProperties {
  const color = ANNOTATION_COLOR_THEME[style.color] ?? ANNOTATION_COLOR_THEME.ink;

  return {
    "--annotation-stroke": color.stroke,
    "--annotation-fill": `rgba(${color.fill}, ${style.fill ? style.fillOpacity : 0})`,
    "--annotation-font-size": `${style.fontSize}px`,
    "--annotation-line-width": style.lineWidth
  } as CSSProperties;
}

function getToolIcon(tool: CanvasTool) {
  if (tool === "select") {
    return <MousePointer2 size={18} />;
  }
  if (tool === "text") {
    return <Type size={18} />;
  }
  if (tool === "template-sticky") {
    return <StickyNote size={18} />;
  }
  if (tool === "section") {
    return <PanelTop size={18} />;
  }
  if (tool === "rectangle") {
    return <Square size={18} />;
  }
  if (tool === "line") {
    return <Minus size={18} />;
  }
  if (tool === "template-hot-to-lame") {
    return <ArrowRight size={18} />;
  }
  if (tool === "template-quadrant") {
    return <Grid2X2 size={18} />;
  }
  if (tool === "template-top-n") {
    return <ListOrdered size={18} />;
  }
  if (tool === "template-table") {
    return <Table2 size={18} />;
  }
  return <ArrowRight size={18} />;
}

function isTemplateTool(tool: CanvasTool): tool is TemplateTool {
  return tool.startsWith("template-");
}

function isDirectAnnotationTool(tool: CanvasTool): tool is DirectAnnotationTool {
  return tool !== "select" && !isTemplateTool(tool);
}

function getShortcutTitle(label: string, shortcut: string) {
  return `${label} (${shortcut})`;
}

function normalizeShortcutKey(event: KeyboardEvent) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase();
}

function shouldReturnToSelectAfterCreate(kind: BoardAnnotationKind) {
  return kind !== "line";
}

export function BoardClient({ apiPath, backHref, boardId, mode = "edit" }: BoardClientProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>(DEFAULT_VIEWPORT);
  const annotationsRef = useRef<BoardAnnotation[]>([]);
  const dragRef = useRef<DragState>({ type: "none" });
  const gestureScaleRef = useRef(1);
  const handPanKeyPressedRef = useRef(false);
  const activeTouchPointersRef = useRef<Map<number, TouchPoint>>(new Map());
  const mobilePinchRef = useRef<MobilePinchState | null>(null);
  const mobileTapCandidateRef = useRef<MobileTapCandidate | null>(null);
  const lastMobileTapRef = useRef<Omit<MobileTapCandidate, "pointerId"> | null>(null);
  const { locale, setLocale, t } = useLocale();
  const isMobileView = useMediaQuery(MOBILE_VIEW_MEDIA_QUERY);

  const [title, setTitle] = useState<string>(t.appTitle);
  const [shareId, setShareId] = useState("");
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });
  const [items, setItems] = useState<BoardItem[]>([]);
  const [annotations, setAnnotations] = useState<BoardAnnotation[]>([]);
  const [createdAt, setCreatedAt] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [shareMessage, setShareMessage] = useState("");
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [isTemplateOpen, setIsTemplateOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isMinimapOpen, setIsMinimapOpen] = useState(true);
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [mobileDetailsItemId, setMobileDetailsItemId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const isReadOnly = mode === "view";
  const canEdit = !isReadOnly && !isMobileView;
  const boardApiPath = withBasePath(apiPath ?? `/api/boards/${boardId}`);
  const boardBackHref = backHref ?? "/boards";
  const latestBoardRef = useRef({
    title,
    viewport,
    items,
    annotations
  });
  const autosaveTimerRef = useRef<number | null>(null);
  const localViewportSaveTimerRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const isDirtyRef = useRef(false);
  const changeVersionRef = useRef(0);
  const hasLoadedBoardRef = useRef(false);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    if (isLoading || loadError || !hasLoadedBoardRef.current) {
      return;
    }

    if (localViewportSaveTimerRef.current) {
      window.clearTimeout(localViewportSaveTimerRef.current);
    }

    localViewportSaveTimerRef.current = window.setTimeout(() => {
      writeStoredViewport(boardId, viewportRef.current);
      localViewportSaveTimerRef.current = null;
    }, LOCAL_VIEWPORT_SAVE_DEBOUNCE_MS);

    return () => {
      if (localViewportSaveTimerRef.current) {
        window.clearTimeout(localViewportSaveTimerRef.current);
        localViewportSaveTimerRef.current = null;
      }
    };
  }, [boardId, isLoading, loadError, viewport]);

  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const stageElement = stage;

    function updateStageSize() {
      const rect = stageElement.getBoundingClientRect();
      setStageSize({ width: rect.width, height: rect.height });
    }

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(stageElement);

    return () => {
      resizeObserver.disconnect();
    };
  }, [isLoading, loadError]);

  useEffect(() => {
    annotationsRef.current = annotations;
  }, [annotations]);

  useEffect(() => {
    latestBoardRef.current = {
      title,
      viewport,
      items,
      annotations
    };
  }, [annotations, items, title, viewport]);

  useEffect(() => {
    if (mobileDetailsItemId && !items.some((item) => item.id === mobileDetailsItemId)) {
      setMobileDetailsItemId(null);
    }
  }, [items, mobileDetailsItemId]);

  useEffect(() => {
    if (!isMobileView) {
      return;
    }

    clearNativeSelection();
    activeTouchPointersRef.current.clear();
    mobilePinchRef.current = null;
    mobileTapCandidateRef.current = null;
    lastMobileTapRef.current = null;
    dragRef.current = { type: "none" };
    setContextMenu(null);
    setIsAddOpen(false);
    setIsShortcutsOpen(false);
    setIsTemplateOpen(false);
    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);
    setSnapGuides([]);
    setIsPanning(false);
  }, [isMobileView]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const buildCompactBoardPayload = useCallback((): BoardSavePayload => {
    const currentBoard = latestBoardRef.current;

    return {
      title: currentBoard.title,
      items: currentBoard.items.map((item) => ({
        id: item.id,
        bggId: item.bggId,
        x: item.x,
        y: item.y,
        scale: item.scale,
        coverMode: item.coverMode,
        note: item.note,
        status: item.status
      })),
      annotations: currentBoard.annotations
    };
  }, []);

  const persistBoard = useCallback(
    async (options: SaveOptions = {}) => {
      if (!canEdit) {
        return;
      }

      clearAutosaveTimer();

      if (isSavingRef.current) {
        pendingSaveRef.current = true;
        return;
      }

      if (!isDirtyRef.current) {
        return;
      }

      isSavingRef.current = true;
      pendingSaveRef.current = false;
      const saveVersion = changeVersionRef.current;
      let shouldSaveAgain = false;
      setSaveState("saving");

      try {
        const response = await fetch(`${boardApiPath}?locale=${encodeURIComponent(locale)}`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(buildCompactBoardPayload()),
          keepalive: options.keepalive
        });
        const payload = (await response.json()) as { board?: Board; error?: string };

        if (!response.ok || !payload.board) {
          throw new Error(payload.error ?? t.searchFailed);
        }

        const hasNewerChanges = changeVersionRef.current !== saveVersion || pendingSaveRef.current;

        setUpdatedAt(payload.board.updatedAt);
        setShareId(payload.board.shareId);

        if (hasNewerChanges) {
          isDirtyRef.current = true;
          shouldSaveAgain = true;
          setIsDirty(true);
          setSaveState("idle");
        } else {
          const currentViewport = viewportRef.current;
          latestBoardRef.current = {
            title: payload.board.title,
            viewport: currentViewport,
            items: payload.board.items,
            annotations: payload.board.annotations ?? []
          };
          setTitle(payload.board.title);
          setItems(payload.board.items);
          setAnnotations(payload.board.annotations ?? []);
          setCreatedAt(payload.board.createdAt);
          setShareId(payload.board.shareId);
          setIsDirty(false);
          isDirtyRef.current = false;
          setSaveState("saved");
        }
      } catch (error) {
        console.error(error);
        pendingSaveRef.current = false;
        isDirtyRef.current = true;
        setIsDirty(true);
        setSaveState("error");
      } finally {
        isSavingRef.current = false;

        if (shouldSaveAgain) {
          pendingSaveRef.current = false;
          void persistBoard();
        }
      }
    },
    [boardApiPath, buildCompactBoardPayload, canEdit, clearAutosaveTimer, locale, t.searchFailed]
  );

  const scheduleAutosave = useCallback(() => {
    if (!canEdit) {
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistBoard();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [canEdit, clearAutosaveTimer, persistBoard]);

  const markDirty = useCallback(() => {
    if (!canEdit) {
      return;
    }

    changeVersionRef.current += 1;
    isDirtyRef.current = true;
    setIsDirty(true);
    setSaveState((currentState) => (currentState === "saving" ? currentState : "idle"));
    scheduleAutosave();
  }, [canEdit, scheduleAutosave]);

  useEffect(() => {
    if (!canEdit) {
      return;
    }

    function flushPendingSave() {
      if (isDirtyRef.current && !isSavingRef.current) {
        void persistBoard({ keepalive: true });
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        flushPendingSave();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", flushPendingSave);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", flushPendingSave);
      clearAutosaveTimer();
    };
  }, [canEdit, clearAutosaveTimer, persistBoard]);

  useEffect(() => {
    let cancelled = false;

    async function loadBoard() {
      setIsLoading(true);
      setLoadError("");
      hasLoadedBoardRef.current = false;

      try {
        const response = await fetch(`${boardApiPath}?locale=${encodeURIComponent(locale)}`);
        const payload = (await response.json()) as { board?: Board; error?: string };

        if (!response.ok || !payload.board) {
          throw new Error(payload.error ?? t.detailFailed);
        }

        if (cancelled) {
          return;
        }

        const initialViewport = readStoredViewport(boardId) ?? payload.board.viewport;
        setTitle(payload.board.title);
        setViewport(initialViewport);
        setItems(payload.board.items);
        setAnnotations(payload.board.annotations ?? []);
        setCreatedAt(payload.board.createdAt);
        setUpdatedAt(payload.board.updatedAt);
        setShareId(payload.board.shareId);
        latestBoardRef.current = {
          title: payload.board.title,
          viewport: initialViewport,
          items: payload.board.items,
          annotations: payload.board.annotations ?? []
        };
        hasLoadedBoardRef.current = true;
        setSelectedAnnotationIds([]);
        setEditingAnnotationId(null);
        clearAutosaveTimer();
        pendingSaveRef.current = false;
        isDirtyRef.current = false;
        changeVersionRef.current = 0;
        setIsDirty(false);
        setSaveState("idle");
      } catch (error) {
        if (!cancelled) {
          hasLoadedBoardRef.current = false;
          setLoadError(error instanceof Error ? error.message : t.detailFailed);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadBoard();

    return () => {
      cancelled = true;
    };
  }, [boardApiPath, boardId, clearAutosaveTimer, locale, t.detailFailed]);

  const clientToWorld = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    const currentViewport = viewportRef.current;

    if (!rect) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - rect.left - currentViewport.x) / currentViewport.scale,
      y: (clientY - rect.top - currentViewport.y) / currentViewport.scale
    };
  }, []);

  const zoomAtClientPoint = useCallback(
    (clientX: number, clientY: number, multiplier: number) => {
      const rect = stageRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      const currentViewport = viewportRef.current;
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const nextScale = clamp(currentViewport.scale * multiplier, MIN_VIEWPORT_SCALE, MAX_VIEWPORT_SCALE);
      const worldX = (localX - currentViewport.x) / currentViewport.scale;
      const worldY = (localY - currentViewport.y) / currentViewport.scale;

      if (nextScale === currentViewport.scale) {
        return;
      }

      setViewport({
        x: localX - worldX * nextScale,
        y: localY - worldY * nextScale,
        scale: nextScale
      });
    },
    []
  );

  const zoomBy = useCallback(
    (multiplier: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      const clientX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
      const clientY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

      zoomAtClientPoint(clientX, clientY, multiplier);
    },
    [zoomAtClientPoint]
  );

  useEffect(() => {
    const stage = stageRef.current;

    function handlePointerMove(event: globalThis.PointerEvent) {
      if (isMobileView && event.pointerType === "touch" && activeTouchPointersRef.current.has(event.pointerId)) {
        activeTouchPointersRef.current.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY
        });

        if (mobilePinchRef.current) {
          const stageRect = stageRef.current?.getBoundingClientRect();
          const touchPoints = getFirstTwoTouchPoints(activeTouchPointersRef.current);

          if (!stageRect || !touchPoints) {
            return;
          }

          const [firstPoint, secondPoint] = touchPoints;
          const pinch = mobilePinchRef.current;
          const distance = Math.max(1, getPointDistance(firstPoint, secondPoint));
          const center = getPointCenter(firstPoint, secondPoint);
          const nextScale = clamp(
            pinch.startViewport.scale * (distance / pinch.startDistance),
            MIN_VIEWPORT_SCALE,
            MAX_VIEWPORT_SCALE
          );
          const localX = center.clientX - stageRect.left;
          const localY = center.clientY - stageRect.top;

          setViewport({
            x: localX - pinch.startWorldX * nextScale,
            y: localY - pinch.startWorldY * nextScale,
            scale: nextScale
          });
          return;
        }
      }

      const drag = dragRef.current;

      if (drag.type === "none") {
        return;
      }

      if (drag.type === "pan") {
        const nextViewport = {
          ...viewportRef.current,
          x: drag.startX + event.clientX - drag.startClientX,
          y: drag.startY + event.clientY - drag.startClientY
        };

        setViewport(nextViewport);
        return;
      }

      if (drag.type === "annotation-move") {
        const rawDx = (event.clientX - drag.startClientX) / viewportRef.current.scale;
        const rawDy = (event.clientY - drag.startClientY) / viewportRef.current.scale;
        const now = new Date().toISOString();
        const selectedIds = new Set(drag.annotationIds);
        const movedAnnotations = annotationsRef.current
          .filter((annotation) => selectedIds.has(annotation.id))
          .map((annotation) => {
            const original = drag.originals.find((entry) => entry.id === annotation.id);

            return original
              ? {
                  ...annotation,
                  x: original.x + rawDx,
                  y: original.y + rawDy
                }
              : annotation;
          });
        const otherAnnotations = annotationsRef.current.filter((annotation) => !selectedIds.has(annotation.id));
        const snap = getAnnotationSnap(movedAnnotations, otherAnnotations, viewportRef.current.scale);
        const dx = rawDx + snap.dx;
        const dy = rawDy + snap.dy;

        setAnnotations((currentAnnotations) =>
          moveIdsToEnd(
            currentAnnotations.map((annotation) => {
              const original = drag.originals.find((entry) => entry.id === annotation.id);

              return original
                ? {
                    ...annotation,
                    x: original.x + dx,
                    y: original.y + dy,
                    updatedAt: now
                  }
                : annotation;
            }),
            selectedIds
          )
        );
        setSnapGuides(snap.guides);
        markDirty();
        return;
      }

      if (drag.type === "annotation-resize") {
        const world = clientToWorld(event.clientX, event.clientY);
        const dx = world.x - drag.startWorldX;
        const dy = world.y - drag.startWorldY;
        const now = new Date().toISOString();

        setAnnotations((currentAnnotations) =>
          currentAnnotations.map((annotation) => {
            if (annotation.id !== drag.annotationId) {
              return annotation;
            }

            const resizeMax = getAnnotationResizeMax(annotation);

            return {
              ...annotation,
              width: clamp(drag.startWidth + dx, MIN_ANNOTATION_SIZE, resizeMax.width),
              height: clamp(drag.startHeight + dy, MIN_ANNOTATION_SIZE, resizeMax.height),
              updatedAt: now
            };
          })
        );
        markDirty();
        return;
      }

      if (drag.type === "annotation-width-extend") {
        const world = clientToWorld(event.clientX, event.clientY);
        const dx = world.x - drag.startWorldX;
        const now = new Date().toISOString();

        setAnnotations((currentAnnotations) =>
          currentAnnotations.map((annotation) =>
            annotation.id === drag.annotationId
              ? {
                  ...annotation,
                  width: clamp(drag.startWidth + dx, MIN_HOT_TO_LAME_WIDTH, 2600),
                  updatedAt: now
                }
              : annotation
          )
        );
        markDirty();
        return;
      }

      if (drag.type === "annotation-line-end") {
        const world = clientToWorld(event.clientX, event.clientY);
        const now = new Date().toISOString();

        setAnnotations((currentAnnotations) =>
          currentAnnotations.map((annotation) => {
            if (annotation.id !== drag.annotationId) {
              return annotation;
            }

            if (drag.endpoint === "start") {
              const endX = annotation.x + annotation.width;
              const endY = annotation.y + annotation.height;

              return {
                ...annotation,
                x: world.x,
                y: world.y,
                width: endX - world.x,
                height: endY - world.y,
                updatedAt: now
              };
            }

            return {
              ...annotation,
              width: world.x - annotation.x,
              height: world.y - annotation.y,
              updatedAt: now
            };
          })
        );
        markDirty();
        return;
      }

      if (drag.type === "annotation-create") {
        const world = clientToWorld(event.clientX, event.clientY);
        const now = new Date().toISOString();

        setAnnotations((currentAnnotations) =>
          currentAnnotations.map((annotation) => {
            if (annotation.id !== drag.annotationId) {
              return annotation;
            }

            if (drag.kind === "line" || drag.kind === "arrow") {
              return {
                ...annotation,
                width: world.x - drag.startWorldX,
                height: world.y - drag.startWorldY,
                updatedAt: now
              };
            }

            return {
              ...annotation,
              x: Math.min(drag.startWorldX, world.x),
              y: Math.min(drag.startWorldY, world.y),
              width: Math.max(Math.abs(world.x - drag.startWorldX), MIN_ANNOTATION_SIZE),
              height: Math.max(Math.abs(world.y - drag.startWorldY), MIN_ANNOTATION_SIZE),
              updatedAt: now
            };
          })
        );
        markDirty();
        return;
      }

      const world = clientToWorld(event.clientX, event.clientY);
      const movingItemIds = new Set([drag.itemId]);

      setItems((currentItems) =>
        moveIdsToEnd(
          currentItems.map((item) =>
            item.id === drag.itemId
              ? {
                  ...item,
                  x: world.x - drag.offsetX,
                  y: world.y - drag.offsetY
                }
              : item
          ),
          movingItemIds
        )
      );
      markDirty();
    }

    function handlePointerUp(event: globalThis.PointerEvent) {
      const drag = dragRef.current;

      if (isMobileView && event.pointerType === "touch") {
        const tapCandidate = mobileTapCandidateRef.current;

        if (tapCandidate?.pointerId === event.pointerId) {
          const travel = Math.hypot(event.clientX - tapCandidate.clientX, event.clientY - tapCandidate.clientY);
          const now = Date.now();

          if (travel <= MOBILE_TAP_MOVE_THRESHOLD) {
            const lastTap = lastMobileTapRef.current;
            const isDoubleTap =
              Boolean(lastTap) &&
              lastTap?.itemId === tapCandidate.itemId &&
              now - lastTap.time <= MOBILE_DOUBLE_TAP_MS &&
              Math.hypot(event.clientX - lastTap.clientX, event.clientY - lastTap.clientY) <= MOBILE_TAP_MOVE_THRESHOLD * 2;

            if (isDoubleTap) {
              setMobileDetailsItemId(tapCandidate.itemId);
              lastMobileTapRef.current = null;
            } else {
              lastMobileTapRef.current = {
                itemId: tapCandidate.itemId,
                clientX: event.clientX,
                clientY: event.clientY,
                time: now
              };
            }
          }

          mobileTapCandidateRef.current = null;
        }

        activeTouchPointersRef.current.delete(event.pointerId);

        if (activeTouchPointersRef.current.size < 2) {
          mobilePinchRef.current = null;
        }
      }

      if (drag.type === "annotation-create" && (drag.kind === "line" || drag.kind === "arrow")) {
        setAnnotations((currentAnnotations) =>
          currentAnnotations.map((annotation) =>
            annotation.id === drag.annotationId && Math.hypot(annotation.width, annotation.height) < MIN_ANNOTATION_SIZE
              ? {
                  ...annotation,
                  width: DEFAULT_ANNOTATION_SIZE[drag.kind].width,
                  height: DEFAULT_ANNOTATION_SIZE[drag.kind].height,
                  updatedAt: new Date().toISOString()
                }
              : annotation
          )
        );
      }

      if (drag.type === "annotation-create" && shouldReturnToSelectAfterCreate(drag.kind)) {
        setActiveTool("select");
      }

      dragRef.current = { type: "none" };
      setSnapGuides([]);
      setIsPanning(false);
    }

    function handleNativeWheel(event: globalThis.WheelEvent) {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const normalizedDelta = clamp(-event.deltaY / 80, -8, 8);
      zoomAtClientPoint(event.clientX, event.clientY, Math.exp(normalizedDelta * 0.12));
    }

    function handleGestureStart(event: Event) {
      event.preventDefault();
      gestureScaleRef.current = (event as WebKitGestureEvent).scale || 1;
    }

    function handleGestureChange(event: Event) {
      const gestureEvent = event as WebKitGestureEvent;
      const previousScale = gestureScaleRef.current || 1;
      const nextScale = gestureEvent.scale || previousScale;

      event.preventDefault();
      gestureScaleRef.current = nextScale;
      zoomAtClientPoint(gestureEvent.clientX, gestureEvent.clientY, nextScale / previousScale);
    }

    function handleGestureEnd() {
      gestureScaleRef.current = 1;
    }

    if (stage) {
      stage.addEventListener("wheel", handleNativeWheel, { passive: false });

      if (!isMobileView) {
        stage.addEventListener("gesturestart", handleGestureStart, { passive: false });
        stage.addEventListener("gesturechange", handleGestureChange, { passive: false });
        stage.addEventListener("gestureend", handleGestureEnd);
      }
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);

      if (stage) {
        stage.removeEventListener("wheel", handleNativeWheel);
        stage.removeEventListener("gesturestart", handleGestureStart);
        stage.removeEventListener("gesturechange", handleGestureChange);
        stage.removeEventListener("gestureend", handleGestureEnd);
      }
    };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (isShortcutsOpen) {
          event.preventDefault();
          setIsShortcutsOpen(false);
        } else if (isAddOpen) {
          event.preventDefault();
          setIsAddOpen(false);
        } else if (contextMenu) {
          event.preventDefault();
          setContextMenu(null);
        } else if (isEditableTarget(event.target)) {
          return;
        } else if (editingAnnotationId) {
          event.preventDefault();
          setEditingAnnotationId(null);
        } else if (activeTool !== "select") {
          event.preventDefault();
          setActiveTool("select");
          setIsTemplateOpen(false);
        } else {
          event.preventDefault();
          setSelectedAnnotationIds([]);
        }
        return;
      }

      if (event.isComposing || isEditableTarget(event.target) || event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }

      if (isAddOpen || contextMenu || isShortcutsOpen) {
        return;
      }

      if (normalizeShortcutKey(event) === "h") {
        event.preventDefault();
        handPanKeyPressedRef.current = true;
        return;
      }

      if (canEdit && (event.key === "Delete" || event.key === "Backspace") && selectedAnnotationIds.length > 0) {
        event.preventDefault();
        const selectedIds = new Set(selectedAnnotationIds);
        setAnnotations((currentAnnotations) => currentAnnotations.filter((annotation) => !selectedIds.has(annotation.id)));
        setSelectedAnnotationIds([]);
        setEditingAnnotationId(null);
        markDirty();
        return;
      }

      if (event.key === "-") {
        event.preventDefault();
        zoomBy(0.9);
        return;
      }

      if (event.key === "=" || event.key === "+") {
        event.preventDefault();
        zoomBy(1.1);
        return;
      }

      if (canEdit) {
        const shortcutAction = TOOL_ACTION_BY_SHORTCUT[normalizeShortcutKey(event)];

        if (shortcutAction) {
          event.preventDefault();

          if (shortcutAction === "addGame") {
            setIsTemplateOpen(false);
            setIsShortcutsOpen(false);
            setContextMenu(null);
            setIsAddOpen(true);
            return;
          }

          if (shortcutAction === "templateMenu") {
            setContextMenu(null);
            setIsShortcutsOpen(false);
            setIsTemplateOpen((isOpen) => !isOpen);
            return;
          }

          setContextMenu(null);
          setIsTemplateOpen(false);
          setActiveTool(shortcutAction);
        }
      }
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (normalizeShortcutKey(event) === "h") {
        handPanKeyPressedRef.current = false;
      }
    }

    function handleWindowBlur() {
      handPanKeyPressedRef.current = false;
    }
  }, [
    activeTool,
    clientToWorld,
    contextMenu,
    editingAnnotationId,
    canEdit,
    isAddOpen,
    isMobileView,
    isShortcutsOpen,
    markDirty,
    selectedAnnotationIds,
    zoomAtClientPoint,
    zoomBy
  ]);

  function shouldStartCanvasPan(event: PointerEvent<HTMLElement>) {
    return event.button === 1 || (event.button === 0 && handPanKeyPressedRef.current);
  }

  function startMobileTouchGesture(event: PointerEvent<HTMLElement>) {
    if (!isMobileView || event.pointerType !== "touch") {
      return false;
    }

    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    setContextMenu(null);
    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);

    activeTouchPointersRef.current.set(event.pointerId, {
      clientX: event.clientX,
      clientY: event.clientY
    });

    const cardElement = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(".game-card") : null;

    if (activeTouchPointersRef.current.size === 1) {
      mobileTapCandidateRef.current = cardElement?.dataset.itemId
        ? {
            itemId: cardElement.dataset.itemId,
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
            time: Date.now()
          }
        : null;
      mobilePinchRef.current = null;
      dragRef.current = {
        type: "pan",
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: viewportRef.current.x,
        startY: viewportRef.current.y
      };
      setIsPanning(true);
      return true;
    }

    const touchPoints = getFirstTwoTouchPoints(activeTouchPointersRef.current);
    const stageRect = stageRef.current?.getBoundingClientRect();

    if (touchPoints && stageRect) {
      const [firstPoint, secondPoint] = touchPoints;
      const currentViewport = viewportRef.current;
      const center = getPointCenter(firstPoint, secondPoint);
      const localX = center.clientX - stageRect.left;
      const localY = center.clientY - stageRect.top;

      mobilePinchRef.current = {
        startDistance: Math.max(1, getPointDistance(firstPoint, secondPoint)),
        startViewport: currentViewport,
        startWorldX: (localX - currentViewport.x) / currentViewport.scale,
        startWorldY: (localY - currentViewport.y) / currentViewport.scale
      };
      mobileTapCandidateRef.current = null;
      dragRef.current = { type: "none" };
      setIsPanning(true);
    }

    return true;
  }

  function startCanvasPan(event: PointerEvent<HTMLElement>) {
    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    setContextMenu(null);
    dragRef.current = {
      type: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewportRef.current.x,
      startY: viewportRef.current.y
    };
    setIsPanning(true);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (startMobileTouchGesture(event)) {
      return;
    }

    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (!isEditableTarget(event.target)) {
      event.preventDefault();
      clearNativeSelection();
    }

    setContextMenu(null);

    const target = event.target;

    if (isEditableTarget(target)) {
      return;
    }

    if (target instanceof HTMLElement && target.closest(".annotation-stylebar, .canvas-tool-rail")) {
      return;
    }

    if (activeTool === "select" && target instanceof HTMLElement && target.closest(".game-card, .annotation-object")) {
      return;
    }

    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);

    if (canEdit && isTemplateTool(activeTool)) {
      const world = clientToWorld(event.clientX, event.clientY);
      const nextAnnotations = createTemplateAnnotations(activeTool, world.x, world.y, t);
      const nextAnnotationIds = nextAnnotations.map((annotation) => annotation.id);

      setAnnotations((currentAnnotations) => [...currentAnnotations, ...nextAnnotations]);
      setSelectedAnnotationIds(nextAnnotationIds);
      markDirty();

      if (activeTool === "template-sticky") {
        setEditingAnnotationId(nextAnnotations[0]?.id ?? null);
      }

      setActiveTool("select");
      dragRef.current = { type: "none" };
      return;
    }

    if (canEdit && isDirectAnnotationTool(activeTool)) {
      const world = clientToWorld(event.clientX, event.clientY);
      const nextAnnotation = createAnnotation(activeTool, world.x, world.y);

      setAnnotations((currentAnnotations) => [...currentAnnotations, nextAnnotation]);
      setSelectedAnnotationIds([nextAnnotation.id]);
      markDirty();

      if (nextAnnotation.kind === "text" || nextAnnotation.kind === "section") {
        setEditingAnnotationId(nextAnnotation.id);
      }

      dragRef.current = {
        type: "annotation-create",
        annotationId: nextAnnotation.id,
        kind: nextAnnotation.kind,
        startWorldX: world.x,
        startWorldY: world.y
      };
      return;
    }

    startCanvasPan(event);
  }

  function startItemDrag(event: PointerEvent<HTMLElement>, item: BoardItem) {
    if (startMobileTouchGesture(event)) {
      return;
    }

    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (!canEdit || activeTool !== "select") {
      return;
    }

    if (event.button !== 0) {
      return;
    }

    const target = event.target;

    if (target instanceof HTMLElement && target.closest("[data-no-drag='true']")) {
      return;
    }

    setContextMenu(null);
    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    const world = clientToWorld(event.clientX, event.clientY);
    dragRef.current = {
      type: "item",
      itemId: item.id,
      offsetX: world.x - item.x,
      offsetY: world.y - item.y
    };
  }

  function updateItem(itemId: string, updater: (item: BoardItem) => BoardItem) {
    if (!canEdit) {
      return;
    }

    setItems((currentItems) => currentItems.map((item) => (item.id === itemId ? updater(item) : item)));
    markDirty();
  }

  function removeItem(itemId: string) {
    if (!canEdit) {
      return;
    }

    setItems((currentItems) => currentItems.filter((item) => item.id !== itemId));
    setContextMenu(null);
    markDirty();
  }

  function updateAnnotations(annotationIds: string[], updater: (annotation: BoardAnnotation) => BoardAnnotation) {
    if (!canEdit || annotationIds.length === 0) {
      return;
    }

    const selectedIds = new Set(annotationIds);
    setAnnotations((currentAnnotations) =>
      currentAnnotations.map((annotation) => (selectedIds.has(annotation.id) ? updater(annotation) : annotation))
    );
    markDirty();
  }

  function removeSelectedAnnotations() {
    if (!canEdit || selectedAnnotationIds.length === 0) {
      return;
    }

    const selectedIds = new Set(selectedAnnotationIds);
    setAnnotations((currentAnnotations) => currentAnnotations.filter((annotation) => !selectedIds.has(annotation.id)));
    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);
    markDirty();
  }

  function setSelectedAnnotationStyle(patch: Partial<BoardAnnotationStyle>) {
    const now = new Date().toISOString();
    updateAnnotations(selectedAnnotationIds, (annotation) => ({
      ...annotation,
      style: {
        ...annotation.style,
        ...("fill" in patch || "fillOpacity" in patch
          ? canAnnotationUseFill(annotation)
            ? patch
            : {
                ...patch,
                fill: false,
                fillOpacity: 0
              }
          : patch)
      },
      updatedAt: now
    }));
  }

  function setSelectedTopNConfig(patch: Partial<TopNConfig>) {
    const now = new Date().toISOString();
    updateAnnotations(selectedAnnotationIds, (annotation) => {
      if (annotation.kind !== "topN") {
        return annotation;
      }

      const currentConfig = parseTopNConfig(annotation.text);
      const nextConfig = updateTopNConfig(currentConfig, patch);
      const preferredSize = getTopNPreferredSize(nextConfig, {
        width: annotation.width,
        height: annotation.height,
        config: currentConfig
      });
      const resizeMax = getAnnotationResizeMax(annotation);

      return {
        ...annotation,
        width: clamp(preferredSize.width, MIN_ANNOTATION_SIZE, resizeMax.width),
        height: clamp(preferredSize.height, MIN_ANNOTATION_SIZE, resizeMax.height),
        text: serializeTopNConfig(nextConfig),
        updatedAt: now
      };
    });
  }

  function setSelectedTableConfig(patch: Partial<TableConfig>) {
    const now = new Date().toISOString();
    updateAnnotations(selectedAnnotationIds, (annotation) => {
      if (annotation.kind !== "table") {
        return annotation;
      }

      const currentConfig = parseTableConfig(annotation.text);
      const nextConfig = updateTableConfig(currentConfig, patch);
      const preferredSize = getTablePreferredSize(nextConfig, {
        width: annotation.width,
        height: annotation.height,
        config: currentConfig
      });
      const resizeMax = getAnnotationResizeMax(annotation);

      return {
        ...annotation,
        width: clamp(preferredSize.width, MIN_ANNOTATION_SIZE, resizeMax.width),
        height: clamp(preferredSize.height, MIN_ANNOTATION_SIZE, resizeMax.height),
        text: serializeTableConfig(nextConfig),
        updatedAt: now
      };
    });
  }

  function startAnnotationDrag(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) {
    if (startMobileTouchGesture(event)) {
      return;
    }

    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (!canEdit || activeTool !== "select" || event.button !== 0 || isEditableTarget(event.target)) {
      return;
    }

    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    setContextMenu(null);
    setEditingAnnotationId(null);

    const nextSelectedIds = event.shiftKey
      ? selectedAnnotationIds.includes(annotation.id)
        ? selectedAnnotationIds
        : [...selectedAnnotationIds, annotation.id]
      : selectedAnnotationIds.includes(annotation.id)
        ? selectedAnnotationIds
        : [annotation.id];

    setSelectedAnnotationIds(nextSelectedIds);
    dragRef.current = {
      type: "annotation-move",
      annotationIds: nextSelectedIds,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originals: annotations
        .filter((currentAnnotation) => nextSelectedIds.includes(currentAnnotation.id))
        .map((currentAnnotation) => ({
          id: currentAnnotation.id,
          x: currentAnnotation.x,
          y: currentAnnotation.y
        }))
    };
  }

  function startAnnotationResize(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) {
    if (startMobileTouchGesture(event)) {
      return;
    }

    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (!canEdit || activeTool !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    const world = clientToWorld(event.clientX, event.clientY);
    setSelectedAnnotationIds([annotation.id]);
    setEditingAnnotationId(null);
    dragRef.current = {
      type: "annotation-resize",
      annotationId: annotation.id,
      startWorldX: world.x,
      startWorldY: world.y,
      startWidth: annotation.width,
      startHeight: annotation.height
    };
  }

  function startAnnotationWidthExtend(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) {
    if (startMobileTouchGesture(event)) {
      return;
    }

    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (!canEdit || activeTool !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    const world = clientToWorld(event.clientX, event.clientY);
    setSelectedAnnotationIds([annotation.id]);
    setEditingAnnotationId(null);
    dragRef.current = {
      type: "annotation-width-extend",
      annotationId: annotation.id,
      startWorldX: world.x,
      startWidth: annotation.width
    };
  }

  function startLineEndpointDrag(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation, endpoint: "start" | "end") {
    if (shouldStartCanvasPan(event)) {
      startCanvasPan(event);
      return;
    }

    if (!canEdit || activeTool !== "select" || event.button !== 0) {
      return;
    }

    event.preventDefault();
    clearNativeSelection();
    event.stopPropagation();
    setSelectedAnnotationIds([annotation.id]);
    setEditingAnnotationId(null);
    dragRef.current = {
      type: "annotation-line-end",
      annotationId: annotation.id,
      endpoint
    };
  }

  function openItemContextMenu(event: MouseEvent<HTMLElement>, item: BoardItem) {
    event.preventDefault();
    event.stopPropagation();

    if (!canEdit) {
      return;
    }

    setContextMenu({
      itemId: item.id,
      x: clamp(event.clientX, 8, Math.max(8, window.innerWidth - CONTEXT_MENU_WIDTH - 8)),
      y: clamp(event.clientY, 8, Math.max(8, window.innerHeight - CONTEXT_MENU_HEIGHT - 8))
    });
  }

  function setItemCoverMode(itemId: string, coverMode: CardCoverMode) {
    updateItem(itemId, (item) => ({
      ...item,
      coverMode
    }));
    setContextMenu(null);
  }

  async function handleLocaleChange(nextLocale: Locale) {
    if (nextLocale === locale) {
      return;
    }

    if (isDirtyRef.current) {
      await persistBoard();

      if (isDirtyRef.current) {
        return;
      }
    }

    setLocale(nextLocale);
  }

  function selectCanvasTool(tool: CanvasTool) {
    if (!canEdit) {
      return;
    }

    setActiveTool(tool);
    setContextMenu(null);
    setIsTemplateOpen(false);
  }

  function openAddGameDialog() {
    if (!canEdit) {
      return;
    }

    setContextMenu(null);
    setIsShortcutsOpen(false);
    setIsTemplateOpen(false);
    setIsAddOpen(true);
  }

  function navigateMinimap(nextViewport: Viewport) {
    setViewport(nextViewport);
  }

  function addGamesToBoard(games: GameSnapshot[]) {
    if (!canEdit || games.length === 0) {
      return;
    }

    const rect = stageRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const world = clientToWorld(centerX, centerY);
    const columns = Math.min(4, Math.ceil(Math.sqrt(games.length)));
    const rows = Math.ceil(games.length / columns);
    const gapX = 34;
    const gapY = 56;
    const itemWidth = CARD_WIDTH;
    const itemHeight = Math.round(CARD_WIDTH / DEFAULT_COVER_RATIO) + 62;
    const totalWidth = columns * itemWidth + (columns - 1) * gapX;
    const totalHeight = rows * itemHeight + (rows - 1) * gapY;

    const nextItems: BoardItem[] = games.map((game, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);

      return {
        id: createId(),
        bggId: game.bggId,
        x: world.x - totalWidth / 2 + column * (itemWidth + gapX),
        y: world.y - totalHeight / 2 + row * (itemHeight + gapY),
        scale: 1,
        note: "",
        status: "无",
        coverMode: "native",
        gameSnapshot: game
      };
    });

    setItems((currentItems) => [...currentItems, ...nextItems]);
    markDirty();
    setIsAddOpen(false);
  }

  function addGameToBoard(game: GameSnapshot) {
    addGamesToBoard([game]);
  }

  function handleTitleChange(value: string) {
    if (!canEdit) {
      return;
    }

    setTitle(value.slice(0, 20));
    markDirty();
  }

  async function shareBoard() {
    if (!shareId) {
      return;
    }

    const url = new URL(withBasePath(`/s/${shareId}`), window.location.origin).toString();

    function showShareMessage(message: string) {
      setShareMessage(message);
      window.setTimeout(() => {
        setShareMessage("");
      }, 2200);
    }

    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
    }

    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API is not available.");
      }

      await navigator.clipboard.writeText(url);
      showShareMessage(t.shareCopied);
      return;
    } catch (error) {
      console.warn("Could not copy share link automatically:", error);
    }

    window.prompt(t.shareCopyPrompt, url);
    showShareMessage(t.shareCopyManual);
  }

  if (isLoading) {
    return (
      <main className="board-empty-state">
        <Loader2 className="spin" size={28} />
        {t.loadingBoard}
      </main>
    );
  }

  const contextMenuItem = contextMenu ? items.find((item) => item.id === contextMenu.itemId) : undefined;
  const selectedAnnotations = annotations.filter((annotation) => selectedAnnotationIds.includes(annotation.id));
  const textAnnotations = annotations.filter((annotation) => getAnnotationLayerPriority(annotation) === TEXT_LAYER_PRIORITY);
  const componentAnnotations = annotations.filter((annotation) => getAnnotationLayerPriority(annotation) === COMPONENT_LAYER_PRIORITY);
  const stylebarPosition = getStylebarPosition(selectedAnnotations, viewport, stageRef.current);
  const mobileDetailsItem = mobileDetailsItemId ? items.find((item) => item.id === mobileDetailsItemId) : null;

  if (loadError) {
    return (
      <main className="board-empty-state">
        <h1>{t.boardOpenFailed}</h1>
        <p>{loadError}</p>
        <Link className="button secondary" href={isReadOnly ? "/" : "/login"}>
          <ArrowLeft size={18} />
          {t.backHome}
        </Link>
      </main>
    );
  }

  return (
    <main className={`board-shell${isMobileView ? " is-mobile-view" : ""}`}>
      <header className="board-toolbar">
        <div className="toolbar-left">
          <Link className="icon-button" href={boardBackHref} title={t.backHome}>
            <ArrowLeft size={18} />
          </Link>
          <div className="title-block">
            <input
              aria-label={t.boardTitleLabel}
              className="title-input"
              maxLength={20}
              readOnly={!canEdit}
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
            />
            <span>{isReadOnly ? t.publicShare : shareId ? `${t.shareLink} /s/${shareId}` : ""}</span>
          </div>
        </div>

        <div className="toolbar-actions">
          <LanguageSelect label={t.language} locale={locale} onChange={handleLocaleChange} />
          {canEdit ? (
            <ShortcutHelp
              isOpen={isShortcutsOpen}
              t={t}
              onClose={() => setIsShortcutsOpen(false)}
              onToggle={() => setIsShortcutsOpen((isOpen) => !isOpen)}
            />
          ) : null}
          {!isMobileView ? (
            <>
              <button
                aria-pressed={isMinimapOpen}
                className={`icon-button${isMinimapOpen ? " is-active" : ""}`}
                type="button"
                onClick={() => setIsMinimapOpen((isOpen) => !isOpen)}
                title={isMinimapOpen ? t.hideMinimap : t.showMinimap}
              >
                <Grid2X2 size={18} />
              </button>
              <button className="icon-button" type="button" onClick={() => zoomBy(0.9)} title={t.zoomOut}>
                <ZoomOut size={18} />
              </button>
              <span className="zoom-pill">{Math.round((viewport.scale / VIEWPORT_SCALE_BASE) * 100)}%</span>
              <button className="icon-button" type="button" onClick={() => zoomBy(1.1)} title={t.zoomIn}>
                <ZoomIn size={18} />
              </button>
            </>
          ) : null}
          {!isReadOnly && shareId ? (
            <button className="button secondary board-share-button" type="button" onClick={shareBoard}>
              <Share2 size={18} />
              <span>{t.shareBoard}</span>
            </button>
          ) : null}
          {shareMessage ? <span className="copy-hint toolbar-copy-hint">{shareMessage}</span> : null}
        </div>
      </header>

      {isMobileView ? <div className="mobile-view-notice">{t.mobileViewOnlyNotice}</div> : null}

      {canEdit ? (
        <>
          <CanvasToolRail
            activeTool={activeTool}
            isTemplateOpen={isTemplateOpen}
            t={t}
            onAddGame={openAddGameDialog}
            onSelectTool={selectCanvasTool}
            onToggleTemplateMenu={() => {
              setContextMenu(null);
              setIsShortcutsOpen(false);
              setIsTemplateOpen((isOpen) => !isOpen);
            }}
          />
          {selectedAnnotations.length > 0 ? (
            <AnnotationStyleBar
              onDelete={removeSelectedAnnotations}
              onStyleChange={setSelectedAnnotationStyle}
              onTableConfigChange={setSelectedTableConfig}
              onTopNConfigChange={setSelectedTopNConfig}
              position={stylebarPosition}
              selectedAnnotations={selectedAnnotations}
              t={t}
            />
          ) : null}
        </>
      ) : null}

      {!isMobileView && isMinimapOpen && stageSize.width > 0 && stageSize.height > 0 ? (
        <BoardMinimap
          annotations={annotations}
          items={items}
          stageSize={stageSize}
          t={t}
          viewport={viewport}
          onNavigate={navigateMinimap}
        />
      ) : null}

      <section
        ref={stageRef}
        className={`canvas-stage${isPanning ? " is-panning" : ""}${activeTool !== "select" && canEdit ? " is-tool-active" : ""}`}
        onPointerDown={handleStagePointerDown}
      >
        <div className="canvas-grid" />
        <div
          className="canvas-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
          }}
        >
          {textAnnotations.map((annotation, index) => (
            <AnnotationObject
              annotation={annotation}
              editingId={editingAnnotationId}
              key={annotation.id}
              zIndex={getLayerZIndex(TEXT_LAYER_PRIORITY, index)}
              onDoubleClick={setEditingAnnotationId}
              onLineEndpointDrag={startLineEndpointDrag}
              onPointerDown={startAnnotationDrag}
              onWidthExtendStart={startAnnotationWidthExtend}
              onResizeStart={startAnnotationResize}
              onTextChange={(annotationId, text) =>
                updateAnnotations([annotationId], (currentAnnotation) => ({
                  ...currentAnnotation,
                  text,
                  updatedAt: new Date().toISOString()
                }))
              }
              readOnly={!canEdit}
              selected={selectedAnnotationIds.includes(annotation.id)}
              t={t}
            />
          ))}
          {items.map((item, index) => (
            <GameCard
              item={item}
              key={item.id}
              locale={locale}
              mobileDetailsEnabled={isMobileView}
              zIndex={getLayerZIndex(GAME_CARD_LAYER_PRIORITY, index)}
              onContextMenu={openItemContextMenu}
              onDragStart={startItemDrag}
              onMobileDetailsOpen={setMobileDetailsItemId}
              onRemove={removeItem}
              onUpdate={updateItem}
              readOnly={!canEdit}
              t={t}
            />
          ))}
          {componentAnnotations.map((annotation, index) => (
            <AnnotationObject
              annotation={annotation}
              editingId={editingAnnotationId}
              key={annotation.id}
              zIndex={getLayerZIndex(COMPONENT_LAYER_PRIORITY, index)}
              onDoubleClick={setEditingAnnotationId}
              onLineEndpointDrag={startLineEndpointDrag}
              onPointerDown={startAnnotationDrag}
              onWidthExtendStart={startAnnotationWidthExtend}
              onResizeStart={startAnnotationResize}
              onTextChange={(annotationId, text) =>
                updateAnnotations([annotationId], (currentAnnotation) => ({
                  ...currentAnnotation,
                  text,
                  updatedAt: new Date().toISOString()
                }))
              }
              readOnly={!canEdit}
              selected={selectedAnnotationIds.includes(annotation.id)}
              t={t}
            />
          ))}
          {snapGuides.map((guide) => (
            <SnapGuideLine guide={guide} key={`${guide.orientation}-${guide.position}-${guide.start}-${guide.end}`} scale={viewport.scale} />
          ))}
        </div>

        {items.length === 0 && canEdit ? (
          <button className="empty-canvas-cta" type="button" onClick={openAddGameDialog}>
            <Plus size={20} />
            {t.emptyBoard}
          </button>
        ) : null}
      </section>

      <footer className="board-footer">
        {!isMobileView ? (
          <div className="board-save-status">
            <span>{isReadOnly ? t.publicShare : saveState === "saving" ? t.saving : saveState === "error" ? t.saveFailed : isDirty ? t.unsaved : t.synced}</span>
            {saveState === "error" && canEdit ? (
              <button className="footer-retry" type="button" onClick={() => void persistBoard()}>
                {t.retrySave}
              </button>
            ) : null}
          </div>
        ) : null}
        <BggAttribution />
      </footer>

      {contextMenu && contextMenuItem && canEdit ? (
        <CardContextMenu
          item={contextMenuItem}
          onClose={() => setContextMenu(null)}
          onRemove={removeItem}
          onSetCoverMode={setItemCoverMode}
          t={t}
          x={contextMenu.x}
          y={contextMenu.y}
        />
      ) : null}

      {isAddOpen && canEdit ? (
        <SearchDialog
          locale={locale}
          onClose={() => setIsAddOpen(false)}
          onSelect={addGameToBoard}
          onSelectMany={addGamesToBoard}
          t={t}
        />
      ) : null}

      {mobileDetailsItem ? (
        <MobileGameDetailsSheet item={mobileDetailsItem} locale={locale} onClose={() => setMobileDetailsItemId(null)} t={t} />
      ) : null}
    </main>
  );
}

function BoardMinimap({
  annotations,
  items,
  onNavigate,
  stageSize,
  t,
  viewport
}: {
  annotations: BoardAnnotation[];
  items: BoardItem[];
  onNavigate: (viewport: Viewport) => void;
  stageSize: StageSize;
  t: UiCopy;
  viewport: Viewport;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const isDraggingRef = useRef(false);
  const width = 180;
  const height = 126;
  const bounds = getMinimapBounds(items, annotations, viewport, stageSize);
  const minimapScale = Math.min(width / bounds.width, height / bounds.height);
  const offsetX = (width - bounds.width * minimapScale) / 2;
  const offsetY = (height - bounds.height * minimapScale) / 2;
  const visibleRect = getVisibleWorldRect(viewport, stageSize);
  const itemRects = items.map(getItemWorldRect);
  const annotationRects = annotations.map(getAnnotationWorldRect);

  function worldToMinimap(rect: WorldRect) {
    return {
      x: offsetX + (rect.x - bounds.x) * minimapScale,
      y: offsetY + (rect.y - bounds.y) * minimapScale,
      width: Math.max(2, rect.width * minimapScale),
      height: Math.max(2, rect.height * minimapScale)
    };
  }

  function navigateFromPointer(event: PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();

    if (!rect) {
      return;
    }

    const localX = clamp(event.clientX - rect.left, offsetX, offsetX + bounds.width * minimapScale);
    const localY = clamp(event.clientY - rect.top, offsetY, offsetY + bounds.height * minimapScale);
    const worldX = bounds.x + (localX - offsetX) / minimapScale;
    const worldY = bounds.y + (localY - offsetY) / minimapScale;

    onNavigate({
      scale: viewport.scale,
      x: stageSize.width / 2 - worldX * viewport.scale,
      y: stageSize.height / 2 - worldY * viewport.scale
    });
  }

  return (
    <aside className="board-minimap" aria-label={t.minimap}>
      <div className="board-minimap-title">{t.minimap}</div>
      <svg
        ref={svgRef}
        className="board-minimap-map"
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          isDraggingRef.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          navigateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (isDraggingRef.current) {
            navigateFromPointer(event);
          }
        }}
        onPointerUp={(event) => {
          isDraggingRef.current = false;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <rect className="board-minimap-bg" x={0} y={0} width={width} height={height} rx={8} />
        {annotationRects.map((rect, index) => {
          const miniRect = worldToMinimap(rect);

          return <rect className="board-minimap-annotation" key={`annotation-${index}`} {...miniRect} rx={2} />;
        })}
        {itemRects.map((rect, index) => {
          const miniRect = worldToMinimap(rect);

          return <rect className="board-minimap-card" key={`item-${index}`} {...miniRect} rx={2} />;
        })}
        <rect className="board-minimap-viewport" {...worldToMinimap(visibleRect)} aria-label={t.minimapViewport} rx={3} />
      </svg>
    </aside>
  );
}

function CanvasToolRail({
  activeTool,
  isTemplateOpen,
  onAddGame,
  onSelectTool,
  onToggleTemplateMenu,
  t
}: {
  activeTool: CanvasTool;
  isTemplateOpen: boolean;
  onAddGame: () => void;
  onSelectTool: (tool: CanvasTool) => void;
  onToggleTemplateMenu: () => void;
  t: UiCopy;
}) {
  const tools: Array<{ id: CanvasTool; label: string }> = [
    { id: "select", label: t.selectTool },
    { id: "text", label: t.textTool },
    { id: "section", label: t.sectionTool },
    { id: "rectangle", label: t.rectangleTool },
    { id: "line", label: t.lineTool },
    { id: "arrow", label: t.arrowTool }
  ];
  const templateTools: Array<{ id: TemplateTool; label: string }> = [
    { id: "template-sticky", label: t.stickyTool },
    { id: "template-hot-to-lame", label: t.hotToLameTemplate },
    { id: "template-quadrant", label: t.quadrantTemplate },
    { id: "template-top-n", label: t.topNTemplate },
    { id: "template-table", label: t.tableTemplate }
  ];
  const isTemplateActive = templateTools.some((tool) => tool.id === activeTool);

  function selectTemplate(tool: TemplateTool) {
    onSelectTool(tool);
  }

  return (
    <aside className="canvas-tool-rail" aria-label={t.boardTools}>
      {tools.map((tool) => (
        <button
          aria-label={getShortcutTitle(tool.label, TOOL_SHORTCUTS[tool.id])}
          className={`tool-button${activeTool === tool.id ? " is-active" : ""}`}
          key={tool.id}
          type="button"
          title={getShortcutTitle(tool.label, TOOL_SHORTCUTS[tool.id])}
          onClick={() => onSelectTool(tool.id)}
        >
          {getToolIcon(tool.id)}
        </button>
      ))}
      <div className="template-tool-wrapper">
        <button
          aria-expanded={isTemplateOpen}
          aria-label={getShortcutTitle(t.templateTool, TEMPLATE_MENU_SHORTCUT)}
          className={`tool-button${isTemplateActive || isTemplateOpen ? " is-active" : ""}`}
          type="button"
          title={getShortcutTitle(t.templateTool, TEMPLATE_MENU_SHORTCUT)}
          onClick={onToggleTemplateMenu}
        >
          <LayoutTemplate size={18} />
        </button>

        {isTemplateOpen ? (
          <div className="template-tool-menu" role="menu" aria-label={t.templateTool}>
            {templateTools.map((tool) => (
              <button
                aria-checked={activeTool === tool.id}
                className={`template-tool-item${activeTool === tool.id ? " is-active" : ""}`}
                key={tool.id}
                role="menuitemradio"
                type="button"
                title={getShortcutTitle(tool.label, TOOL_SHORTCUTS[tool.id])}
                onClick={() => selectTemplate(tool.id)}
              >
                {getToolIcon(tool.id)}
                <span>{tool.label}</span>
                <kbd>{TOOL_SHORTCUTS[tool.id]}</kbd>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="tool-rail-separator" />
      <button
        aria-label={getShortcutTitle(t.addGame, ADD_GAME_SHORTCUT)}
        className="tool-button"
        type="button"
        title={getShortcutTitle(t.addGame, ADD_GAME_SHORTCUT)}
        onClick={onAddGame}
      >
        <Plus size={18} />
      </button>
    </aside>
  );
}

function ShortcutHelp({
  isOpen,
  onClose,
  onToggle,
  t
}: {
  isOpen: boolean;
  onClose: () => void;
  onToggle: () => void;
  t: UiCopy;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const toolShortcuts = [
    { label: t.selectTool, keys: [TOOL_SHORTCUTS.select, "Esc"] },
    { label: t.addGame, keys: [ADD_GAME_SHORTCUT] },
    { label: t.textTool, keys: [TOOL_SHORTCUTS.text] },
    { label: t.sectionTool, keys: [TOOL_SHORTCUTS.section] },
    { label: t.rectangleTool, keys: [TOOL_SHORTCUTS.rectangle] },
    { label: t.lineTool, keys: [TOOL_SHORTCUTS.line] },
    { label: t.arrowTool, keys: [TOOL_SHORTCUTS.arrow] }
  ];
  const templateShortcuts = [
    { label: t.templateTool, keys: [TEMPLATE_MENU_SHORTCUT] },
    { label: t.stickyTool, keys: [TOOL_SHORTCUTS["template-sticky"]] },
    { label: t.hotToLameTemplate, keys: [TOOL_SHORTCUTS["template-hot-to-lame"]] },
    { label: t.quadrantTemplate, keys: [TOOL_SHORTCUTS["template-quadrant"]] },
    { label: t.topNTemplate, keys: [TOOL_SHORTCUTS["template-top-n"]] },
    { label: t.tableTemplate, keys: [TOOL_SHORTCUTS["template-table"]] }
  ];
  const viewShortcuts = [
    { label: t.panCanvas, keys: [t.middleMouseDrag, t.holdHDrag] },
    { label: t.zoomOut, keys: ["-"] },
    { label: t.zoomIn, keys: ["=", "+"] },
    { label: t.deleteAnnotation, keys: ["Delete", "Backspace"] },
    { label: t.shortcutCancel, keys: ["Esc"] }
  ];

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: globalThis.PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="shortcut-help" ref={panelRef}>
      <button
        aria-expanded={isOpen}
        aria-label={t.shortcutHelp}
        className="icon-button"
        type="button"
        title={t.shortcutHelp}
        onClick={onToggle}
      >
        <Keyboard size={18} />
      </button>

      {isOpen ? (
        <section className="shortcut-panel" aria-label={t.shortcutHelp}>
          <div className="shortcut-panel-heading">
            <h2>{t.shortcutHelp}</h2>
          </div>
          <ShortcutGroup items={toolShortcuts} title={t.shortcutToolsGroup} />
          <ShortcutGroup items={templateShortcuts} title={t.shortcutTemplatesGroup} />
          <ShortcutGroup items={viewShortcuts} title={t.shortcutViewGroup} />
        </section>
      ) : null}
    </div>
  );
}

function ShortcutGroup({ items, title }: { items: Array<{ label: string; keys: string[] }>; title: string }) {
  return (
    <div className="shortcut-group">
      <h3>{title}</h3>
      <div className="shortcut-list">
        {items.map((item) => (
          <div className="shortcut-row" key={item.label}>
            <span>{item.label}</span>
            <span className="shortcut-keys">
              {item.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AnnotationStyleBar({
  onDelete,
  onStyleChange,
  onTableConfigChange,
  onTopNConfigChange,
  position,
  selectedAnnotations,
  t
}: {
  onDelete: () => void;
  onStyleChange: (patch: Partial<BoardAnnotationStyle>) => void;
  onTableConfigChange: (patch: Partial<TableConfig>) => void;
  onTopNConfigChange: (patch: Partial<TopNConfig>) => void;
  position: CSSProperties | undefined;
  selectedAnnotations: BoardAnnotation[];
  t: UiCopy;
}) {
  const activeStyle = selectedAnnotations[0]?.style ?? getDefaultAnnotationStyle("text");
  const showFillControl = selectedAnnotations.some(canAnnotationUseFill);
  const selectedTopN = selectedAnnotations.length === 1 && selectedAnnotations[0]?.kind === "topN" ? selectedAnnotations[0] : null;
  const topNConfig = selectedTopN ? parseTopNConfig(selectedTopN.text) : null;
  const selectedTable = selectedAnnotations.length === 1 && selectedAnnotations[0]?.kind === "table" ? selectedAnnotations[0] : null;
  const tableConfig = selectedTable ? parseTableConfig(selectedTable.text) : null;
  const showFontSizeControl = selectedAnnotations.some((annotation) => annotation.kind !== "table");

  return (
    <div className="annotation-stylebar" data-no-drag="true" aria-label={t.annotationStyle} style={position}>
      <div className="stylebar-group" aria-label={t.annotationColor}>
        <Palette size={16} />
        {BOARD_ANNOTATION_COLORS.map((color) => (
          <button
            aria-label={ANNOTATION_COLOR_THEME[color].label}
            className={`color-swatch${activeStyle.color === color ? " is-active" : ""}`}
            key={color}
            style={{ "--swatch-color": ANNOTATION_COLOR_THEME[color].stroke } as CSSProperties}
            type="button"
            title={ANNOTATION_COLOR_THEME[color].label}
            onClick={() => onStyleChange({ color })}
          />
        ))}
      </div>

      <div className="stylebar-group" aria-label={t.lineWidth}>
        {BOARD_ANNOTATION_LINE_WIDTHS.map((lineWidth) => (
          <button
            className={`style-chip${activeStyle.lineWidth === lineWidth ? " is-active" : ""}`}
            key={lineWidth}
            type="button"
            onClick={() => onStyleChange({ lineWidth })}
          >
            {lineWidth}
          </button>
        ))}
      </div>

      {showFontSizeControl ? (
        <div className="stylebar-group" aria-label={t.fontSize}>
          {BOARD_ANNOTATION_FONT_SIZES.map((fontSize) => (
            <button
              className={`style-chip${activeStyle.fontSize === fontSize ? " is-active" : ""}`}
              key={fontSize}
              type="button"
              onClick={() => onStyleChange({ fontSize })}
            >
              {fontSize}
            </button>
          ))}
        </div>
      ) : null}

      {showFillControl ? (
        <button
          className={`style-chip wide${activeStyle.fill ? " is-active" : ""}`}
          type="button"
          onClick={() =>
            onStyleChange({
              fill: !activeStyle.fill,
              fillOpacity: activeStyle.fill ? 0 : 0.14
            })
          }
        >
          {t.fillStyle}
        </button>
      ) : null}

      {topNConfig ? (
        <>
          <label className="topn-style-control">
            <span>{t.topCount}</span>
            <input
              max={TOPN_MAX_COUNT}
              min={1}
              type="number"
              value={topNConfig.count}
              onChange={(event) => onTopNConfigChange({ count: Number(event.target.value) })}
            />
          </label>

          <div className="stylebar-group" aria-label={t.topOrder}>
            <button
              className={`style-chip wide${topNConfig.order === "ascending" ? " is-active" : ""}`}
              type="button"
              onClick={() => onTopNConfigChange({ order: "ascending" })}
            >
              {t.topAscending}
            </button>
            <button
              className={`style-chip wide${topNConfig.order === "descending" ? " is-active" : ""}`}
              type="button"
              onClick={() => onTopNConfigChange({ order: "descending" })}
            >
              {t.topDescending}
            </button>
          </div>

          <label className="topn-style-control compact">
            <span>{t.topRows}</span>
            <input
              max={TOPN_MAX_ROWS}
              min={1}
              type="number"
              value={topNConfig.rows}
              onChange={(event) => onTopNConfigChange({ rows: Number(event.target.value) })}
            />
          </label>

          <label className="topn-style-control compact">
            <span>{t.topColumns}</span>
            <input
              max={TOPN_MAX_COLUMNS}
              min={1}
              type="number"
              value={topNConfig.columns}
              onChange={(event) => onTopNConfigChange({ columns: Number(event.target.value) })}
            />
          </label>
        </>
      ) : null}

      {tableConfig ? (
        <>
          <label className="topn-style-control compact">
            <span>{t.topRows}</span>
            <input
              max={TABLE_MAX_ROWS}
              min={1}
              type="number"
              value={tableConfig.rows}
              onChange={(event) => onTableConfigChange({ rows: Number(event.target.value) })}
            />
          </label>

          <label className="topn-style-control compact">
            <span>{t.topColumns}</span>
            <input
              max={TABLE_MAX_COLUMNS}
              min={1}
              type="number"
              value={tableConfig.columns}
              onChange={(event) => onTableConfigChange({ columns: Number(event.target.value) })}
            />
          </label>
        </>
      ) : null}

      <button className="icon-button compact danger" type="button" title={t.deleteAnnotation} onClick={onDelete}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function SnapGuideLine({ guide, scale }: { guide: SnapGuide; scale: number }) {
  if (guide.orientation === "vertical") {
    return (
      <div
        className="snap-guide snap-guide-vertical"
        style={{
          left: guide.position,
          top: guide.start,
          height: guide.end - guide.start,
          width: 1 / scale
        }}
      />
    );
  }

  return (
    <div
      className="snap-guide snap-guide-horizontal"
      style={{
        left: guide.start,
        top: guide.position,
        width: guide.end - guide.start,
        height: 1 / scale
      }}
    />
  );
}

function TopNAnnotationObject({
  annotation,
  onPointerDown,
  onResizeStart,
  readOnly,
  selected,
  styleVars
}: {
  annotation: BoardAnnotation;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  readOnly: boolean;
  selected: boolean;
  styleVars: CSSProperties;
}) {
  const config = parseTopNConfig(annotation.text);
  const entries = Array.from({ length: config.count }, (_, index) =>
    config.order === "ascending" ? index + 1 : config.count - index
  );

  return (
    <div
      className={`annotation-object annotation-topn-object${selected ? " is-selected" : ""}`}
      data-no-drag="true"
      onPointerDown={(event) => onPointerDown(event, annotation)}
      style={{
        ...styleVars,
        "--topn-rows": config.rows,
        "--topn-columns": config.columns,
        left: annotation.x,
        top: annotation.y,
        width: annotation.width,
        height: annotation.height
      } as CSSProperties}
    >
      <div className="topn-grid" aria-hidden="true">
        {entries.map((rank) => (
          <div className="topn-cell" key={`${config.order}-${rank}`}>
            <span>#{rank}</span>
          </div>
        ))}
      </div>

      {selected && !readOnly ? (
        <button
          aria-label="调整组件大小"
          className="annotation-resize-handle"
          type="button"
          onPointerDown={(event) => onResizeStart(event, annotation)}
        />
      ) : null}
    </div>
  );
}

function TableAnnotationObject({
  annotation,
  onPointerDown,
  onResizeStart,
  readOnly,
  selected,
  styleVars
}: {
  annotation: BoardAnnotation;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  readOnly: boolean;
  selected: boolean;
  styleVars: CSSProperties;
}) {
  const config = parseTableConfig(annotation.text);
  const cells = Array.from({ length: config.rows * config.columns }, (_, index) => index);

  return (
    <div
      className={`annotation-object annotation-table-object${selected ? " is-selected" : ""}`}
      data-no-drag="true"
      onPointerDown={(event) => onPointerDown(event, annotation)}
      style={{
        ...styleVars,
        "--table-rows": config.rows,
        "--table-columns": config.columns,
        left: annotation.x,
        top: annotation.y,
        width: annotation.width,
        height: annotation.height
      } as CSSProperties}
    >
      <div className="table-grid" aria-hidden="true">
        {cells.map((cell) => (
          <div className="table-cell" key={cell} />
        ))}
      </div>

      {selected && !readOnly ? (
        <button
          aria-label="调整组件大小"
          className="annotation-resize-handle"
          type="button"
          onPointerDown={(event) => onResizeStart(event, annotation)}
        />
      ) : null}
    </div>
  );
}

function HotToLameAnnotationObject({
  annotation,
  onPointerDown,
  onResizeStart,
  onWidthExtendStart,
  readOnly,
  selected,
  styleVars
}: {
  annotation: BoardAnnotation;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onWidthExtendStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  readOnly: boolean;
  selected: boolean;
  styleVars: CSSProperties;
}) {
  const rows = [
    { label: "夯", className: "hot" },
    { label: "顶级", className: "top" },
    { label: "人上人", className: "elite" },
    { label: "NPC", className: "npc" },
    { label: "拉完了", className: "lame" }
  ];
  const rowHeight = Math.max(annotation.height / rows.length, 1);
  const labelWidth = clamp(rowHeight * 1.18, 128, Math.max(128, annotation.width - 180));
  const labelFontSize = clamp(annotation.style.fontSize * 2.35, 26, Math.max(26, rowHeight * 0.56));

  return (
    <div
      className={`annotation-object annotation-hot-object${selected ? " is-selected" : ""}`}
      data-no-drag="true"
      onPointerDown={(event) => onPointerDown(event, annotation)}
      style={{
        ...styleVars,
        "--hot-label-width": `${labelWidth}px`,
        "--hot-label-font-size": `${labelFontSize}px`,
        left: annotation.x,
        top: annotation.y,
        width: annotation.width,
        height: annotation.height
      } as CSSProperties}
    >
      <div className="hot-tier-table" aria-hidden="true">
        {rows.map((row) => (
          <div className="hot-tier-row" key={row.label}>
            <div className={`hot-tier-label ${row.className}`}>{row.label}</div>
            <div className="hot-tier-list" />
          </div>
        ))}
      </div>

      {selected && !readOnly ? (
        <>
          <button
            aria-label="延长列表"
            className="annotation-width-extend-handle"
            type="button"
            onPointerDown={(event) => onWidthExtendStart(event, annotation)}
          />
          <button
            aria-label="调整组件大小"
            className="annotation-resize-handle"
            type="button"
            onPointerDown={(event) => onResizeStart(event, annotation)}
          />
        </>
      ) : null}
    </div>
  );
}

function QuadrantAnnotationObject({
  annotation,
  isEditing,
  onDoubleClick,
  onPointerDown,
  onResizeStart,
  onTextChange,
  readOnly,
  selected,
  styleVars,
  t
}: {
  annotation: BoardAnnotation;
  isEditing: boolean;
  onDoubleClick: (annotationId: string | null) => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onTextChange: (annotationId: string, text: string) => void;
  readOnly: boolean;
  selected: boolean;
  styleVars: CSSProperties;
  t: UiCopy;
}) {
  const text = parseQuadrantText(annotation.text);
  const axisPadding = Math.min(26, Math.max(8, annotation.width / 4), Math.max(8, annotation.height / 4));
  const centerX = annotation.width / 2;
  const centerY = annotation.height / 2;
  const textInset = Math.min(18, Math.max(10, Math.min(annotation.width, annotation.height) / 22));
  const cells: Array<{ key: keyof QuadrantText; className: string; label: string }> = [
    { key: "topLeft", className: "top-left", label: t.quadrantOne },
    { key: "topRight", className: "top-right", label: t.quadrantTwo },
    { key: "bottomLeft", className: "bottom-left", label: t.quadrantThree },
    { key: "bottomRight", className: "bottom-right", label: t.quadrantFour }
  ];

  function updateCell(key: keyof QuadrantText, value: string) {
    onTextChange(
      annotation.id,
      serializeQuadrantText({
        ...text,
        [key]: value
      })
    );
  }

  return (
    <div
      className={`annotation-object annotation-quadrant-object${selected ? " is-selected" : ""}`}
      data-no-drag="true"
      onBlurCapture={(event) => {
        const nextFocus = event.relatedTarget instanceof Node ? event.relatedTarget : null;

        if (isEditing && !event.currentTarget.contains(nextFocus)) {
          onDoubleClick(null);
        }
      }}
      onDoubleClick={() => {
        if (!readOnly) {
          onDoubleClick(annotation.id);
        }
      }}
      onPointerDown={(event) => onPointerDown(event, annotation)}
      style={{
        ...styleVars,
        "--quadrant-cell-inset": `${textInset}px`,
        "--quadrant-axis-gap": `${Math.max(14, annotation.style.lineWidth * 5)}px`,
        left: annotation.x,
        top: annotation.y,
        width: annotation.width,
        height: annotation.height
      } as CSSProperties}
    >
      <svg
        aria-hidden="true"
        className="annotation-quadrant-svg"
        preserveAspectRatio="none"
        viewBox={`0 0 ${annotation.width} ${annotation.height}`}
      >
        <defs>
          <marker id={`quadrant-arrow-${annotation.id}`} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        <line
          markerEnd={`url(#quadrant-arrow-${annotation.id})`}
          x1={axisPadding}
          x2={annotation.width - axisPadding}
          y1={centerY}
          y2={centerY}
        />
        <line
          markerEnd={`url(#quadrant-arrow-${annotation.id})`}
          x1={centerX}
          x2={centerX}
          y1={annotation.height - axisPadding}
          y2={axisPadding}
        />
        <text x={annotation.width - axisPadding / 2} y={centerY - 10}>
          X
        </text>
        <text x={centerX + 10} y={axisPadding - 2}>
          Y
        </text>
      </svg>

      {cells.map((cell) => {
        const value = text[cell.key];

        return (
          <div className={`quadrant-text-cell ${cell.className}`} key={cell.key}>
            {isEditing ? (
              <textarea
                aria-label={cell.label}
                className="quadrant-text-editor"
                data-no-drag="true"
                maxLength={220}
                placeholder={cell.label}
                value={value}
                onChange={(event) => updateCell(cell.key, event.target.value)}
                onPointerDown={(event) => event.stopPropagation()}
              />
            ) : value.trim() || !readOnly ? (
              <div className="quadrant-text-content">{value}</div>
            ) : null}
          </div>
        );
      })}

      {selected && !readOnly ? (
        <button
          aria-label={t.resizeAnnotation}
          className="annotation-resize-handle"
          type="button"
          onPointerDown={(event) => onResizeStart(event, annotation)}
        />
      ) : null}
    </div>
  );
}

function AnnotationObject({
  annotation,
  editingId,
  onDoubleClick,
  onLineEndpointDrag,
  onPointerDown,
  onResizeStart,
  onTextChange,
  onWidthExtendStart,
  readOnly,
  selected,
  t,
  zIndex
}: {
  annotation: BoardAnnotation;
  editingId: string | null;
  onDoubleClick: (annotationId: string | null) => void;
  onLineEndpointDrag: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation, endpoint: "start" | "end") => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onTextChange: (annotationId: string, text: string) => void;
  onWidthExtendStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  readOnly: boolean;
  selected: boolean;
  t: UiCopy;
  zIndex: number;
}) {
  const isEditing = editingId === annotation.id && !readOnly;
  const styleVars = {
    ...getAnnotationCssVars(annotation.style),
    "--layer-z-index": zIndex
  } as CSSProperties;

  if (annotation.kind === "topN") {
    return (
      <TopNAnnotationObject
        annotation={annotation}
        onPointerDown={onPointerDown}
        onResizeStart={onResizeStart}
        readOnly={readOnly}
        selected={selected}
        styleVars={styleVars}
      />
    );
  }

  if (annotation.kind === "table") {
    return (
      <TableAnnotationObject
        annotation={annotation}
        onPointerDown={onPointerDown}
        onResizeStart={onResizeStart}
        readOnly={readOnly}
        selected={selected}
        styleVars={styleVars}
      />
    );
  }

  if (annotation.kind === "hotToLame") {
    return (
      <HotToLameAnnotationObject
        annotation={annotation}
        onPointerDown={onPointerDown}
        onResizeStart={onResizeStart}
        onWidthExtendStart={onWidthExtendStart}
        readOnly={readOnly}
        selected={selected}
        styleVars={styleVars}
      />
    );
  }

  if (annotation.kind === "quadrant") {
    return (
      <QuadrantAnnotationObject
        annotation={annotation}
        isEditing={isEditing}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onResizeStart={onResizeStart}
        onTextChange={onTextChange}
        readOnly={readOnly}
        selected={selected}
        styleVars={styleVars}
        t={t}
      />
    );
  }

  if (isLinearAnnotation(annotation)) {
    const bounds = getAnnotationBounds(annotation);
    const safeWidth = Math.max(bounds.width, 1);
    const safeHeight = Math.max(bounds.height, 1);
    const x1 = annotation.width >= 0 ? 0 : safeWidth;
    const x2 = annotation.width >= 0 ? safeWidth : 0;
    const y1 = annotation.height >= 0 ? 0 : safeHeight;
    const y2 = annotation.height >= 0 ? safeHeight : 0;

    return (
      <div
        className={`annotation-object annotation-line-object annotation-${annotation.kind}${selected ? " is-selected" : ""}`}
        data-no-drag="true"
        onPointerDown={(event) => onPointerDown(event, annotation)}
        style={{
          ...styleVars,
          left: bounds.left,
          top: bounds.top,
          width: safeWidth,
          height: safeHeight
        }}
      >
        <svg className="annotation-line-svg" viewBox={`0 0 ${safeWidth} ${safeHeight}`} preserveAspectRatio="none">
          {annotation.kind === "arrow" ? (
            <defs>
              <marker id={`arrow-${annotation.id}`} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
                <path d="M 0 0 L 8 4 L 0 8 z" />
              </marker>
            </defs>
          ) : null}
          <line
            markerEnd={annotation.kind === "arrow" ? `url(#arrow-${annotation.id})` : undefined}
            x1={x1}
            x2={x2}
            y1={y1}
            y2={y2}
          />
        </svg>
        {selected && !readOnly ? (
          <>
            <button
              aria-label={t.resizeStart}
              className="annotation-line-handle start"
              style={{ left: x1, top: y1 }}
              type="button"
              onPointerDown={(event) => onLineEndpointDrag(event, annotation, "start")}
            />
            <button
              aria-label={t.resizeEnd}
              className="annotation-line-handle end"
              style={{ left: x2, top: y2 }}
              type="button"
              onPointerDown={(event) => onLineEndpointDrag(event, annotation, "end")}
            />
          </>
        ) : null}
      </div>
    );
  }

  const isTextual = annotation.kind === "text" || annotation.kind === "sticky" || annotation.kind === "section";
  const shouldHideEmptyReadOnlyText = readOnly && isTextual && !annotation.text.trim() && annotation.kind === "text";

  if (shouldHideEmptyReadOnlyText) {
    return null;
  }

  return (
    <div
      className={`annotation-object annotation-box annotation-${annotation.kind}${selected ? " is-selected" : ""}`}
      data-no-drag="true"
      onDoubleClick={() => {
        if (isTextual && !readOnly) {
          onDoubleClick(annotation.id);
        }
      }}
      onPointerDown={(event) => onPointerDown(event, annotation)}
      style={{
        ...styleVars,
        left: annotation.x,
        top: annotation.y,
        width: annotation.width,
        height: annotation.height
      }}
    >
      {isTextual ? (
        isEditing ? (
          <textarea
            autoFocus
            className="annotation-text-editor"
            data-no-drag="true"
            maxLength={500}
            placeholder={t.annotationPlaceholder}
            value={annotation.text}
            onBlur={() => onDoubleClick(null)}
            onChange={(event) => onTextChange(annotation.id, event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
          />
        ) : annotation.text.trim() || !readOnly ? (
          <div className="annotation-text-content">{annotation.text || t.annotationPlaceholder}</div>
        ) : null
      ) : null}
      {selected && !readOnly ? (
        <button
          aria-label={t.resizeAnnotation}
          className="annotation-resize-handle"
          type="button"
          onPointerDown={(event) => onResizeStart(event, annotation)}
        />
      ) : null}
    </div>
  );
}

function MobileGameDetailsSheet({
  item,
  locale,
  onClose,
  t
}: {
  item: BoardItem;
  locale: Locale;
  onClose: () => void;
  t: UiCopy;
}) {
  const game = item.gameSnapshot;
  const displayName = getGameDisplayName(game, locale);
  const coverUrl = compactCoverCandidates(game)[0];
  const players = formatPlayers(game, t.people);
  const playTime = formatPlayTime(game, t.minutes);
  const rating = formatRating(game);
  const displayCategories = game.localizedCategories?.[locale] ?? game.categories;
  const displayMechanics = game.localizedMechanics?.[locale] ?? game.mechanics;
  const displayDescription = game.localizedDescription?.[locale] || game.description;

  return (
    <div className="mobile-details-backdrop" onClick={onClose}>
      <aside
        aria-label={t.mobileGameDetails}
        className="mobile-details-sheet"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mobile-details-header">
          <div>
            <h2>{displayName}</h2>
            <span>BGG #{game.bggId}</span>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title={t.closeDetails} aria-label={t.closeDetails}>
            <X size={18} />
          </button>
        </div>

        <div className="mobile-details-body">
          {coverUrl ? (
            <img className="mobile-details-cover" alt={displayName} src={withBasePath(coverUrl)} />
          ) : (
            <div className="mobile-details-cover mobile-details-cover-placeholder">
              <ImageOff size={26} />
              {t.noCover}
            </div>
          )}

          <div className="info-grid">
            <InfoRow label={t.year} value={game.yearPublished} />
            <InfoRow label={t.players} value={players} />
            <InfoRow label={t.playTime} value={playTime} />
            <InfoRow label={t.age} value={game.minAge ? `${game.minAge}+` : ""} />
            <InfoRow label={t.rating} value={rating} />
            <InfoRow label={t.status} value={t.statusLabels[item.status]} />
          </div>

          <InfoRow label={t.designers} value={game.designers.join(" / ")} />
          <InfoRow label={t.categories} value={displayCategories.join(" / ")} />
          <InfoRow label={t.mechanics} value={displayMechanics.join(" / ")} />
          <InfoRow label={t.note} value={item.note} />
          {displayDescription ? <p className="game-description">{displayDescription}</p> : null}
        </div>
      </aside>
    </div>
  );
}

function GameCard({
  item,
  locale,
  mobileDetailsEnabled,
  onContextMenu,
  onDragStart,
  onMobileDetailsOpen,
  onRemove,
  onUpdate,
  readOnly,
  t,
  zIndex
}: {
  item: BoardItem;
  locale: Locale;
  mobileDetailsEnabled: boolean;
  onContextMenu: (event: MouseEvent<HTMLElement>, item: BoardItem) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: BoardItem) => void;
  onMobileDetailsOpen: (itemId: string) => void;
  onRemove: (itemId: string) => void;
  onUpdate: (itemId: string, updater: (item: BoardItem) => BoardItem) => void;
  readOnly: boolean;
  t: UiCopy;
  zIndex: number;
}) {
  const game = item.gameSnapshot;
  const displayName = getGameDisplayName(game, locale);
  const coverCandidates = compactCoverCandidates(game);
  const coverCandidatesKey = coverCandidates.join("\n");
  const [coverCandidateIndex, setCoverCandidateIndex] = useState(0);
  const coverUrl = coverCandidates[coverCandidateIndex];
  const coverMode = item.coverMode ?? "native";
  const coverRatioKey = coverUrl ?? "";
  const [nativeCoverRatio, setNativeCoverRatio] = useState<CoverRatioState>({
    url: coverRatioKey,
    ratio: DEFAULT_COVER_RATIO
  });
  const measuredNativeCoverRatio = nativeCoverRatio.url === coverRatioKey ? nativeCoverRatio.ratio : DEFAULT_COVER_RATIO;
  const coverRatio = coverMode === "uniform" ? A4_COVER_RATIO : measuredNativeCoverRatio;
  const players = formatPlayers(game, t.people);
  const playTime = formatPlayTime(game, t.minutes);
  const rating = formatRating(game);
  const displayCategories = game.localizedCategories?.[locale] ?? game.categories;
  const displayMechanics = game.localizedMechanics?.[locale] ?? game.mechanics;
  const displayDescription = game.localizedDescription?.[locale] || game.description;

  useEffect(() => {
    setCoverCandidateIndex(0);
  }, [coverCandidatesKey]);

  return (
    <article
      className="game-card"
      data-item-id={item.id}
      onContextMenu={(event) => onContextMenu(event, item)}
      onClick={(event) => {
        if (mobileDetailsEnabled && event.detail >= 2) {
          event.preventDefault();
          onMobileDetailsOpen(item.id);
        }
      }}
      onDoubleClick={(event) => {
        if (mobileDetailsEnabled) {
          event.preventDefault();
          onMobileDetailsOpen(item.id);
        }
      }}
      onPointerDown={(event) => onDragStart(event, item)}
      style={{
        "--layer-z-index": zIndex,
        left: item.x,
        top: item.y,
        transform: `scale(${item.scale})`
      } as CSSProperties}
    >
      <div
        className={`cover-frame cover-frame-${coverMode}`}
        style={{
          "--cover-aspect-ratio": coverRatio
        } as CSSProperties}
      >
        {coverUrl ? (
          <img
            alt={displayName}
            draggable={false}
            key={coverUrl}
            src={withBasePath(coverUrl)}
            onError={() => {
              setCoverCandidateIndex((index) => Math.min(index + 1, coverCandidates.length));
            }}
            onLoad={(event) => {
              const { naturalHeight, naturalWidth } = event.currentTarget;

              if (naturalWidth > 0 && naturalHeight > 0) {
                setNativeCoverRatio({
                  url: coverRatioKey,
                  ratio: naturalWidth / naturalHeight
                });
              }
            }}
          />
        ) : (
          <div className="cover-placeholder">
            <ImageOff size={26} />
            {t.noCover}
          </div>
        )}
        {item.status !== "无" ? <span className="status-badge">{t.statusLabels[item.status]}</span> : null}
      </div>

      <div className="card-caption">
        <strong>{displayName}</strong>
        {game.yearPublished ? <span>{game.yearPublished}</span> : null}
      </div>

      <div className="card-popover" data-no-drag="true">
        <div className="popover-heading">
          <div>
            <strong>{displayName}</strong>
            <span>BGG #{game.bggId}</span>
          </div>
          <div className="popover-heading-actions">
            <a
              aria-label={t.openOnBgg}
              className="icon-button"
              href={getBggGameUrl(game.bggId)}
              rel="noreferrer"
              target="_blank"
              title={t.openOnBgg}
            >
              <BggIcon />
            </a>
            {!readOnly ? (
              <button className="icon-button danger" type="button" onClick={() => onRemove(item.id)} title={t.removeGame}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="info-grid">
          <InfoRow label={t.year} value={game.yearPublished} />
          <InfoRow label={t.players} value={players} />
          <InfoRow label={t.playTime} value={playTime} />
          <InfoRow label={t.age} value={game.minAge ? `${game.minAge}+` : ""} />
          <InfoRow label={t.rating} value={rating} />
        </div>

        <InfoRow label={t.designers} value={game.designers.join(" / ")} />
        <InfoRow label={t.categories} value={displayCategories.join(" / ")} />
        <InfoRow label={t.mechanics} value={displayMechanics.join(" / ")} />

        {displayDescription ? <p className="game-description">{displayDescription}</p> : null}

        {!readOnly ? (
          <>
            <label className="field-control">
              <span>{t.status}</span>
              <select
                value={item.status}
                onChange={(event) =>
                  onUpdate(item.id, (currentItem) => ({
                    ...currentItem,
                    status: event.target.value as BoardItem["status"]
                  }))
                }
              >
                {BOARD_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t.statusLabels[status]}
                  </option>
                ))}
              </select>
            </label>

            <label className="field-control">
              <span>{t.note}</span>
              <textarea
                maxLength={240}
                placeholder={t.notePlaceholder}
                value={item.note}
                onChange={(event) =>
                  onUpdate(item.id, (currentItem) => ({
                    ...currentItem,
                    note: event.target.value
                  }))
                }
              />
            </label>

            <div className="popover-actions">
              <button
                className="icon-button"
                type="button"
                onClick={() =>
                  onUpdate(item.id, (currentItem) => ({
                    ...currentItem,
                    scale: clamp(currentItem.scale - 0.1, 0.7, 1.6)
                  }))
                }
                title={t.zoomOut}
              >
                <Minus size={16} />
              </button>
              <span>{Math.round(item.scale * 100)}%</span>
              <button
                className="icon-button"
                type="button"
                onClick={() =>
                  onUpdate(item.id, (currentItem) => ({
                    ...currentItem,
                    scale: clamp(currentItem.scale + 0.1, 0.7, 1.6)
                  }))
                }
                title={t.zoomIn}
              >
                <Plus size={16} />
              </button>
            </div>
          </>
        ) : item.note ? (
          <InfoRow label={t.note} value={item.note} />
        ) : null}
      </div>
    </article>
  );
}

function CardContextMenu({
  item,
  onClose,
  onRemove,
  onSetCoverMode,
  t,
  x,
  y
}: {
  item: BoardItem;
  onClose: () => void;
  onRemove: (itemId: string) => void;
  onSetCoverMode: (itemId: string, coverMode: CardCoverMode) => void;
  t: UiCopy;
  x: number;
  y: number;
}) {
  const currentCoverMode = item.coverMode ?? "native";

  return (
    <div className="card-context-menu-backdrop" role="presentation" onContextMenu={(event) => event.preventDefault()} onPointerDown={onClose}>
      <div
        aria-label={t.cardMenu}
        className="card-context-menu"
        data-no-drag="true"
        role="menu"
        style={{ left: x, top: y }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="context-menu-label">{t.coverRatio}</div>
        <button className="context-menu-item" role="menuitemradio" type="button" aria-checked={currentCoverMode === "native"} onClick={() => onSetCoverMode(item.id, "native")}>
          <span>{t.nativeCoverRatio}</span>
          {currentCoverMode === "native" ? <Check size={15} /> : null}
        </button>
        <button className="context-menu-item" role="menuitemradio" type="button" aria-checked={currentCoverMode === "uniform"} onClick={() => onSetCoverMode(item.id, "uniform")}>
          <span>{t.uniformCoverRatio}</span>
          {currentCoverMode === "uniform" ? <Check size={15} /> : null}
        </button>
        <div className="context-menu-separator" />
        <button className="context-menu-item danger" role="menuitem" type="button" onClick={() => onRemove(item.id)}>
          <span>{t.removeGame}</span>
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

function isAbortLikeError(error: unknown) {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    error instanceof Error &&
    (error.name === "AbortError" || error.message === "The operation was aborted.")
  );
}

async function readJsonPayload<T>(response: Response, fallbackError: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.toLowerCase().includes("application/json")) {
    throw new Error(fallbackError);
  }

  return response.json() as Promise<T>;
}

function getFriendlyErrorMessage(error: unknown, fallbackError: string) {
  if (!(error instanceof Error)) {
    return fallbackError;
  }

  return error.message === "The string did not match the expected pattern." ? fallbackError : error.message;
}

function compactCoverCandidates(game: GameSnapshot) {
  return Array.from(
    new Set([game.localThumbnail, game.localImage, game.thumbnail, game.image].filter((url): url is string => Boolean(url)))
  );
}

function mergeSearchResult(existing: BggSearchResult, incoming: BggSearchResult): BggSearchResult {
  return {
    ...existing,
    thingType:
      existing.thingType === "boardgameexpansion" || incoming.thingType === "boardgameexpansion"
        ? "boardgameexpansion"
        : existing.thingType ?? incoming.thingType,
    yearPublished: existing.yearPublished ?? incoming.yearPublished,
    rank: existing.rank ?? incoming.rank,
    averageRating: existing.averageRating ?? incoming.averageRating,
    canonicalName: existing.canonicalName || incoming.canonicalName,
    displayName: existing.displayName || incoming.displayName,
    localizedName: existing.localizedName || incoming.localizedName,
    matchedAlias: existing.matchedAlias || incoming.matchedAlias
  };
}

function dedupeBggSearchResults(results: BggSearchResult[]) {
  const byBggId = new Map<string, BggSearchResult>();

  for (const result of results) {
    const existing = byBggId.get(result.bggId);
    byBggId.set(result.bggId, existing ? mergeSearchResult(existing, result) : result);
  }

  return Array.from(byBggId.values());
}

function SearchDialog({
  locale,
  onClose,
  onSelect,
  onSelectMany,
  t
}: {
  locale: Locale;
  onClose: () => void;
  onSelect: (game: GameSnapshot) => void;
  onSelectMany: (games: GameSnapshot[]) => void;
  t: UiCopy;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BggSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addingIds, setAddingIds] = useState<string[]>([]);
  const [selectedResultIds, setSelectedResultIds] = useState<string[]>([]);
  const [lastSearchedQuery, setLastSearchedQuery] = useState("");
  const isComposingRef = useRef(false);
  const searchAbortControllerRef = useRef<AbortController | null>(null);
  const searchRequestIdRef = useRef(0);
  const isAdding = addingIds.length > 0;
  const selectedResults = results.filter((result) => selectedResultIds.includes(result.bggId));

  useEffect(() => {
    return () => {
      searchAbortControllerRef.current?.abort();
    };
  }, []);

  function handleQueryChange(value: string) {
    searchRequestIdRef.current += 1;
    searchAbortControllerRef.current?.abort();
    setQuery(value);
    setResults([]);
    setSelectedResultIds([]);
    setSearchError("");
    setLastSearchedQuery("");
    setIsSearching(false);
  }

  async function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isComposingRef.current) {
      return;
    }

    const trimmedQuery = query.trim();

    if (trimmedQuery.length < 2) {
      handleQueryChange(query);
      return;
    }

    searchAbortControllerRef.current?.abort();
    const controller = new AbortController();
    searchAbortControllerRef.current = controller;
    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setIsSearching(true);
    setSearchError("");
    setResults([]);
    setSelectedResultIds([]);
    setLastSearchedQuery("");

    try {
      const response = await fetch(
        withBasePath(`/api/bgg/search?q=${encodeURIComponent(trimmedQuery)}&locale=${encodeURIComponent(locale)}`),
        {
          signal: controller.signal
        }
      );
      const payload = await readJsonPayload<{ results?: BggSearchResult[]; error?: string }>(response, t.searchFailed);

      if (requestId !== searchRequestIdRef.current) {
        return;
      }

      if (!response.ok) {
        throw new Error(payload.error ?? t.searchFailed);
      }

      setResults(dedupeBggSearchResults(payload.results ?? []));
      setLastSearchedQuery(trimmedQuery);
    } catch (error) {
      if (requestId === searchRequestIdRef.current && !controller.signal.aborted && !isAbortLikeError(error)) {
        setSearchError(getFriendlyErrorMessage(error, t.searchFailed));
      }
    } finally {
      if (searchAbortControllerRef.current === controller) {
        searchAbortControllerRef.current = null;
      }

      if (requestId === searchRequestIdRef.current && !controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  }

  async function fetchGameDetail(result: BggSearchResult) {
    const response = await fetch(withBasePath(`/api/bgg/things/${result.bggId}?locale=${encodeURIComponent(locale)}`));
    const payload = await readJsonPayload<{ game?: GameSnapshot; error?: string }>(response, t.detailFailed);

    if (!response.ok || !payload.game) {
      throw new Error(payload.error ?? t.detailFailed);
    }

    return payload.game;
  }

  function toggleResultSelection(bggId: string) {
    setSelectedResultIds((currentIds) => (
      currentIds.includes(bggId) ? currentIds.filter((id) => id !== bggId) : [...currentIds, bggId]
    ));
  }

  async function selectResult(result: BggSearchResult) {
    if (isAdding) {
      return;
    }

    setAddingIds([result.bggId]);
    setSearchError("");

    try {
      const game = await fetchGameDetail(result);
      setAddingIds([]);
      onSelect(game);
    } catch (error) {
      setAddingIds([]);

      if (!isAbortLikeError(error)) {
        setSearchError(getFriendlyErrorMessage(error, t.detailFailed));
      }
    }
  }

  async function addSelectedResults() {
    if (selectedResults.length === 0 || isAdding) {
      return;
    }

    setAddingIds(selectedResults.map((result) => result.bggId));
    setSearchError("");

    try {
      const games: GameSnapshot[] = [];

      for (const result of selectedResults) {
        games.push(await fetchGameDetail(result));
      }

      setAddingIds([]);
      onSelectMany(games);
    } catch (error) {
      setAddingIds([]);

      if (!isAbortLikeError(error)) {
        setSearchError(getFriendlyErrorMessage(error, t.detailFailed));
      }
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="search-dialog" aria-label={t.addGame} onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-heading">
          <div>
            <h2>{t.addGame}</h2>
            <p>{t.searchIntro}</p>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title={t.backHome}>
            ×
          </button>
        </div>

        <form className="search-field" role="search" onSubmit={handleSearchSubmit}>
          <Search size={18} />
          <input
            autoFocus
            placeholder={t.searchPlaceholder}
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onCompositionEnd={() => {
              isComposingRef.current = false;
            }}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
          />
          {isSearching ? <Loader2 className="spin" size={18} /> : null}
        </form>

        {searchError ? <p className="error-text">{searchError}</p> : null}

        {results.length > 0 ? (
          <div className="search-bulk-actions">
            <span>{t.selectedResultsCount.replace("{count}", String(selectedResults.length))}</span>
            <button className="button secondary" disabled={selectedResults.length === 0 || isAdding} type="button" onClick={addSelectedResults}>
              {isAdding && selectedResults.length > 0 ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
              {t.addSelectedResults}
            </button>
          </div>
        ) : null}

        <div className="search-results">
          {results.map((result) => {
            const resultName = result.displayName || result.name;
            const canonicalName = result.canonicalName && result.canonicalName !== resultName ? result.canonicalName : "";
            const resultMeta = [result.yearPublished, result.thingType === "boardgameexpansion" ? t.expansion : ""]
              .filter(Boolean)
              .join(" · ");
            const isSelected = selectedResultIds.includes(result.bggId);
            const isResultAdding = addingIds.includes(result.bggId);

            return (
              <div className={`result-row${isSelected ? " is-selected" : ""}`} key={result.bggId}>
                <label className="result-select" aria-label={t.selectResult.replace("{name}", resultName)}>
                  <input
                    checked={isSelected}
                    disabled={isAdding}
                    type="checkbox"
                    onChange={() => toggleResultSelection(result.bggId)}
                  />
                </label>
                <button className="result-content" disabled={isAdding} type="button" onClick={() => toggleResultSelection(result.bggId)}>
                  <strong>{resultName}</strong>
                  {resultMeta ? <em>{resultMeta}</em> : null}
                  {result.matchedAlias ? <small>{t.aliasPrefix}: {result.matchedAlias}</small> : null}
                  {canonicalName ? <small>{t.originalName}: {canonicalName}</small> : null}
                </button>
                <button className="icon-button result-add-button" disabled={isAdding} type="button" onClick={() => selectResult(result)} title={t.addGame}>
                  {isResultAdding ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
                </button>
              </div>
            );
          })}

          {lastSearchedQuery === query.trim() && !isSearching && !searchError && results.length === 0 ? (
            <div className="result-empty">{t.noResults}</div>
          ) : null}
        </div>

        <BggAttribution className="dialog-attribution" />
      </section>
    </div>
  );
}
