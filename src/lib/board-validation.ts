import {
  BOARD_ANNOTATION_COLORS,
  BOARD_ANNOTATION_FONT_SIZES,
  BOARD_ANNOTATION_KINDS,
  BOARD_ANNOTATION_LINE_WIDTHS,
  BOARD_STATUSES,
  type Board,
  type BoardAnnotation,
  type BoardAnnotationColor,
  type BoardAnnotationFontSize,
  type BoardAnnotationKind,
  type BoardAnnotationLineWidth,
  type BoardAnnotationStyle,
  type BoardItem,
  type BoardItemSavePayload,
  type BoardSavePayload,
  type BoardStatus,
  type CardCoverMode,
  type GameSnapshot,
  type Viewport
} from "./types";
import { createId } from "./id";

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const DEFAULT_STATUS: BoardStatus = "拥有";
const DEFAULT_ANNOTATION_COLOR: BoardAnnotationColor = "ink";
const DEFAULT_ANNOTATION_LINE_WIDTH: BoardAnnotationLineWidth = 2;
const DEFAULT_ANNOTATION_FONT_SIZE: BoardAnnotationFontSize = 18;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function toFiniteNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeViewport(value: unknown): Viewport {
  if (!value || typeof value !== "object") {
    return DEFAULT_VIEWPORT;
  }

  const viewport = value as Partial<Viewport>;

  return {
    x: toFiniteNumber(viewport.x, DEFAULT_VIEWPORT.x),
    y: toFiniteNumber(viewport.y, DEFAULT_VIEWPORT.y),
    scale: clamp(toFiniteNumber(viewport.scale, DEFAULT_VIEWPORT.scale), 0.35, 2.2)
  };
}

function sanitizeText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function sanitizeStatus(value: unknown): BoardStatus {
  return BOARD_STATUSES.includes(value as BoardStatus) ? (value as BoardStatus) : DEFAULT_STATUS;
}

function sanitizeCoverMode(value: unknown): CardCoverMode {
  return value === "uniform" ? "uniform" : "native";
}

function sanitizeAnnotationKind(value: unknown): BoardAnnotationKind {
  return BOARD_ANNOTATION_KINDS.includes(value as BoardAnnotationKind) ? (value as BoardAnnotationKind) : "text";
}

function sanitizeAnnotationColor(value: unknown): BoardAnnotationColor {
  return BOARD_ANNOTATION_COLORS.includes(value as BoardAnnotationColor) ? (value as BoardAnnotationColor) : DEFAULT_ANNOTATION_COLOR;
}

function sanitizeAnnotationLineWidth(value: unknown): BoardAnnotationLineWidth {
  return BOARD_ANNOTATION_LINE_WIDTHS.includes(value as BoardAnnotationLineWidth)
    ? (value as BoardAnnotationLineWidth)
    : DEFAULT_ANNOTATION_LINE_WIDTH;
}

function sanitizeAnnotationFontSize(value: unknown): BoardAnnotationFontSize {
  return BOARD_ANNOTATION_FONT_SIZES.includes(value as BoardAnnotationFontSize)
    ? (value as BoardAnnotationFontSize)
    : DEFAULT_ANNOTATION_FONT_SIZE;
}

function getDefaultAnnotationStyle(kind: BoardAnnotationKind): BoardAnnotationStyle {
  return {
    color:
      kind === "sticky" ? "amber" : kind === "section" ? "moss" : kind === "quadrant" ? "navy" : DEFAULT_ANNOTATION_COLOR,
    lineWidth: DEFAULT_ANNOTATION_LINE_WIDTH,
    fontSize:
      kind === "section" || kind === "hotToLame" || kind === "topN" || kind === "table"
        ? 24
        : kind === "quadrant"
          ? 18
          : DEFAULT_ANNOTATION_FONT_SIZE,
    fill: kind === "sticky" || kind === "section",
    fillOpacity: kind === "sticky" ? 0.2 : kind === "section" ? 0.12 : 0
  };
}

function sanitizeAnnotationStyle(value: unknown, kind: BoardAnnotationKind): BoardAnnotationStyle {
  const style = value && typeof value === "object" ? (value as Partial<BoardAnnotationStyle>) : {};
  const fallback = getDefaultAnnotationStyle(kind);

  return {
    color: sanitizeAnnotationColor(style.color ?? fallback.color),
    lineWidth: sanitizeAnnotationLineWidth(style.lineWidth ?? fallback.lineWidth),
    fontSize: sanitizeAnnotationFontSize(style.fontSize ?? fallback.fontSize),
    fill: typeof style.fill === "boolean" ? style.fill : fallback.fill,
    fillOpacity: clamp(toFiniteNumber(style.fillOpacity, fallback.fillOpacity), 0, 0.35)
  };
}

function minimalGameSnapshot(bggId: string): GameSnapshot {
  return {
    bggId,
    name: `BGG #${bggId}`,
    designers: [],
    categories: [],
    mechanics: []
  };
}

function sanitizeStringList(value: unknown, maxLength = 80) {
  return Array.isArray(value)
    ? value.map((entry) => sanitizeText(entry, maxLength)).filter(Boolean).slice(0, 8)
    : [];
}

function sanitizeGameSnapshot(value: unknown, bggId: string, fallback?: GameSnapshot): GameSnapshot {
  const snapshot = value && typeof value === "object" ? (value as Partial<GameSnapshot>) : fallback;
  const name = sanitizeText(snapshot?.name, 160) || fallback?.name || `BGG #${bggId}`;

  return {
    ...(fallback ?? minimalGameSnapshot(bggId)),
    ...(snapshot ?? {}),
    bggId,
    name,
    designers: sanitizeStringList(snapshot?.designers ?? fallback?.designers),
    categories: sanitizeStringList(snapshot?.categories ?? fallback?.categories),
    mechanics: sanitizeStringList(snapshot?.mechanics ?? fallback?.mechanics)
  };
}

function sanitizeItem(
  value: unknown,
  existingById: Map<string, BoardItem>,
  existingByBggId: Map<string, BoardItem>
): BoardItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Partial<BoardItemSavePayload>;
  const itemId = sanitizeText(item.id, 80) || createId();
  const incomingSnapshot = item.gameSnapshot && typeof item.gameSnapshot === "object" ? item.gameSnapshot : undefined;
  const bggId = sanitizeText(item.bggId ?? incomingSnapshot?.bggId, 32);

  if (!bggId) {
    return null;
  }

  const existingItem = existingById.get(itemId) ?? existingByBggId.get(bggId);

  return {
    id: itemId,
    bggId,
    x: toFiniteNumber(item.x, 0),
    y: toFiniteNumber(item.y, 0),
    scale: clamp(toFiniteNumber(item.scale, 1), 0.7, 1.6),
    coverMode: sanitizeCoverMode(item.coverMode),
    note: sanitizeText(item.note, 240),
    status: sanitizeStatus(item.status),
    gameSnapshot: sanitizeGameSnapshot(incomingSnapshot, bggId, existingItem?.gameSnapshot)
  };
}

function sanitizeAnnotation(value: unknown, existingById: Map<string, BoardAnnotation>): BoardAnnotation | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const annotation = value as Partial<BoardAnnotation>;
  const annotationId = sanitizeText(annotation.id, 80) || createId();
  const existingAnnotation = existingById.get(annotationId);
  const kind = sanitizeAnnotationKind(annotation.kind ?? existingAnnotation?.kind);
  const textMaxLength = kind === "quadrant" ? 1200 : 500;
  const dimensionLimit = kind === "topN" || kind === "table" ? 12000 : 5000;
  const now = new Date().toISOString();

  return {
    id: annotationId,
    kind,
    x: clamp(toFiniteNumber(annotation.x, existingAnnotation?.x ?? 0), -100000, 100000),
    y: clamp(toFiniteNumber(annotation.y, existingAnnotation?.y ?? 0), -100000, 100000),
    width: clamp(toFiniteNumber(annotation.width, existingAnnotation?.width ?? 180), -dimensionLimit, dimensionLimit),
    height: clamp(toFiniteNumber(annotation.height, existingAnnotation?.height ?? 80), -dimensionLimit, dimensionLimit),
    text: sanitizeText(annotation.text ?? existingAnnotation?.text, textMaxLength),
    style: sanitizeAnnotationStyle(annotation.style ?? existingAnnotation?.style, kind),
    createdAt: sanitizeText(annotation.createdAt, 40) || existingAnnotation?.createdAt || now,
    updatedAt: now
  };
}

export function sanitizeBoardPayload(boardId: string, existing: Board, payload: unknown): Board {
  const incoming = payload && typeof payload === "object" ? (payload as BoardSavePayload) : {};
  const existingById = new Map(existing.items.map((item) => [item.id, item]));
  const existingByBggId = new Map(existing.items.map((item) => [item.bggId, item]));
  const existingAnnotationsById = new Map((existing.annotations ?? []).map((annotation) => [annotation.id, annotation]));
  const items = Array.isArray(incoming.items)
    ? incoming.items
        .map((item) => sanitizeItem(item, existingById, existingByBggId))
        .filter((item): item is BoardItem => Boolean(item))
        .slice(0, 300)
    : existing.items;
  const annotations = Array.isArray(incoming.annotations)
    ? incoming.annotations
        .map((annotation) => sanitizeAnnotation(annotation, existingAnnotationsById))
        .filter((annotation): annotation is BoardAnnotation => Boolean(annotation))
        .slice(0, 500)
    : existing.annotations;

  return {
    ...existing,
    id: boardId,
    title: sanitizeText(incoming.title, 20) || existing.title,
    viewport: incoming.viewport ? sanitizeViewport(incoming.viewport) : existing.viewport,
    items,
    annotations
  };
}
