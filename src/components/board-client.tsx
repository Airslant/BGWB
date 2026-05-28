"use client";

import {
  ArrowLeft,
  ArrowRight,
  ImageOff,
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
  Trash2,
  Type,
  ZoomIn,
  ZoomOut
} from "lucide-react";
import Link from "next/link";
import { type CSSProperties, MouseEvent, PointerEvent, useCallback, useEffect, useRef, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import { createId } from "@/lib/id";
import { getGameDisplayName, UI_COPY } from "@/lib/i18n";
import {
  BOARD_ANNOTATION_COLORS,
  BOARD_ANNOTATION_FONT_SIZES,
  BOARD_ANNOTATION_LINE_WIDTHS,
  BOARD_STATUSES,
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
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, scale: 1 };
const CONTEXT_MENU_WIDTH = 224;
const CONTEXT_MENU_HEIGHT = 188;
const AUTOSAVE_DEBOUNCE_MS = 1200;
const MIN_ANNOTATION_SIZE = 36;
const SNAP_THRESHOLD_PX = 8;
const STYLEBAR_ESTIMATED_WIDTH = 520;
const DEFAULT_ANNOTATION_SIZE: Record<BoardAnnotationKind, { width: number; height: number }> = {
  text: { width: 220, height: 72 },
  sticky: { width: 220, height: 140 },
  section: { width: 440, height: 240 },
  rectangle: { width: 240, height: 150 },
  line: { width: 180, height: 0 },
  arrow: { width: 180, height: 0 }
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
type CanvasTool = "select" | BoardAnnotationKind;
type SnapGuide =
  | { orientation: "vertical"; position: number; start: number; end: number }
  | { orientation: "horizontal"; position: number; start: number; end: number };

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

function getDefaultAnnotationStyle(kind: BoardAnnotationKind): BoardAnnotationStyle {
  return {
    color: kind === "sticky" ? "amber" : kind === "section" ? "moss" : "ink",
    lineWidth: 2,
    fontSize: kind === "section" ? 24 : 18,
    fill: kind === "sticky" || kind === "section",
    fillOpacity: kind === "sticky" ? 0.2 : kind === "section" ? 0.12 : 0
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
  if (tool === "sticky") {
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
  return <ArrowRight size={18} />;
}

export function BoardClient({ apiPath, backHref, boardId, mode = "edit" }: BoardClientProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>(DEFAULT_VIEWPORT);
  const annotationsRef = useRef<BoardAnnotation[]>([]);
  const dragRef = useRef<DragState>({ type: "none" });
  const gestureScaleRef = useRef(1);
  const { locale, setLocale, t } = useLocale();

  const [title, setTitle] = useState<string>(t.appTitle);
  const [shareId, setShareId] = useState("");
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
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
  const [shareCopied, setShareCopied] = useState(false);
  const [activeTool, setActiveTool] = useState<CanvasTool>("select");
  const [selectedAnnotationIds, setSelectedAnnotationIds] = useState<string[]>([]);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([]);
  const isReadOnly = mode === "view";
  const boardApiPath = withBasePath(apiPath ?? `/api/boards/${boardId}`);
  const boardBackHref = backHref ?? "/boards";
  const latestBoardRef = useRef({
    title,
    viewport,
    items,
    annotations
  });
  const autosaveTimerRef = useRef<number | null>(null);
  const isSavingRef = useRef(false);
  const pendingSaveRef = useRef(false);
  const isDirtyRef = useRef(false);
  const changeVersionRef = useRef(0);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

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
      viewport: currentBoard.viewport,
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
          latestBoardRef.current = {
            title: payload.board.title,
            viewport: payload.board.viewport,
            items: payload.board.items,
            annotations: payload.board.annotations ?? []
          };
          setTitle(payload.board.title);
          setViewport(payload.board.viewport);
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
    [boardApiPath, buildCompactBoardPayload, clearAutosaveTimer, locale, t.searchFailed]
  );

  const scheduleAutosave = useCallback(() => {
    if (isReadOnly) {
      return;
    }

    clearAutosaveTimer();
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistBoard();
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [clearAutosaveTimer, isReadOnly, persistBoard]);

  const markDirty = useCallback(() => {
    if (isReadOnly) {
      return;
    }

    changeVersionRef.current += 1;
    isDirtyRef.current = true;
    setIsDirty(true);
    setSaveState((currentState) => (currentState === "saving" ? currentState : "idle"));
    scheduleAutosave();
  }, [isReadOnly, scheduleAutosave]);

  useEffect(() => {
    if (isReadOnly) {
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
  }, [clearAutosaveTimer, isReadOnly, persistBoard]);

  useEffect(() => {
    let cancelled = false;

    async function loadBoard() {
      setIsLoading(true);
      setLoadError("");

      try {
        const response = await fetch(`${boardApiPath}?locale=${encodeURIComponent(locale)}`);
        const payload = (await response.json()) as { board?: Board; error?: string };

        if (!response.ok || !payload.board) {
          throw new Error(payload.error ?? t.detailFailed);
        }

        if (cancelled) {
          return;
        }

        setTitle(payload.board.title);
        setViewport(payload.board.viewport);
        setItems(payload.board.items);
        setAnnotations(payload.board.annotations ?? []);
        setCreatedAt(payload.board.createdAt);
        setUpdatedAt(payload.board.updatedAt);
        setShareId(payload.board.shareId);
        latestBoardRef.current = {
          title: payload.board.title,
          viewport: payload.board.viewport,
          items: payload.board.items,
          annotations: payload.board.annotations ?? []
        };
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
  }, [boardApiPath, clearAutosaveTimer, locale, t.detailFailed]);

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
      const nextScale = clamp(currentViewport.scale * multiplier, 0.35, 2.2);
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
      markDirty();
    },
    [markDirty]
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
        markDirty();
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
          })
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
          currentAnnotations.map((annotation) =>
            annotation.id === drag.annotationId
              ? {
                  ...annotation,
                  width: clamp(drag.startWidth + dx, MIN_ANNOTATION_SIZE, 2200),
                  height: clamp(drag.startHeight + dy, MIN_ANNOTATION_SIZE, 1600),
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
      setItems((currentItems) =>
        currentItems.map((item) =>
          item.id === drag.itemId
            ? {
                ...item,
                x: world.x - drag.offsetX,
                y: world.y - drag.offsetY
              }
            : item
        )
      );
      markDirty();
    }

    function handlePointerUp() {
      const drag = dragRef.current;

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
      stage.addEventListener("gesturestart", handleGestureStart, { passive: false });
      stage.addEventListener("gesturechange", handleGestureChange, { passive: false });
      stage.addEventListener("gestureend", handleGestureEnd);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("keydown", handleKeyDown);

      if (stage) {
        stage.removeEventListener("wheel", handleNativeWheel);
        stage.removeEventListener("gesturestart", handleGestureStart);
        stage.removeEventListener("gesturechange", handleGestureChange);
        stage.removeEventListener("gestureend", handleGestureEnd);
      }
    };

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (editingAnnotationId) {
          setEditingAnnotationId(null);
        } else if (activeTool !== "select") {
          setActiveTool("select");
        } else {
          setContextMenu(null);
          setSelectedAnnotationIds([]);
        }
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      if (!isReadOnly && (event.key === "Delete" || event.key === "Backspace") && selectedAnnotationIds.length > 0) {
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
      }
    }
  }, [activeTool, clientToWorld, editingAnnotationId, isReadOnly, markDirty, selectedAnnotationIds, zoomAtClientPoint, zoomBy]);

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    if (!isEditableTarget(event.target)) {
      event.preventDefault();
      clearNativeSelection();
    }

    setContextMenu(null);

    const target = event.target;

    if (target instanceof HTMLElement && target.closest(".game-card, .annotation-object, .annotation-stylebar, .canvas-tool-rail")) {
      return;
    }

    setSelectedAnnotationIds([]);
    setEditingAnnotationId(null);

    if (!isReadOnly && activeTool !== "select") {
      const world = clientToWorld(event.clientX, event.clientY);
      const nextAnnotation = createAnnotation(activeTool, world.x, world.y);

      setAnnotations((currentAnnotations) => [...currentAnnotations, nextAnnotation]);
      setSelectedAnnotationIds([nextAnnotation.id]);
      markDirty();

      if (nextAnnotation.kind === "text" || nextAnnotation.kind === "sticky" || nextAnnotation.kind === "section") {
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

    dragRef.current = {
      type: "pan",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: viewportRef.current.x,
      startY: viewportRef.current.y
    };
    setIsPanning(true);
  }

  function startItemDrag(event: PointerEvent<HTMLElement>, item: BoardItem) {
    if (isReadOnly) {
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
    if (isReadOnly) {
      return;
    }

    setItems((currentItems) => currentItems.map((item) => (item.id === itemId ? updater(item) : item)));
    markDirty();
  }

  function removeItem(itemId: string) {
    if (isReadOnly) {
      return;
    }

    setItems((currentItems) => currentItems.filter((item) => item.id !== itemId));
    setContextMenu(null);
    markDirty();
  }

  function updateAnnotations(annotationIds: string[], updater: (annotation: BoardAnnotation) => BoardAnnotation) {
    if (isReadOnly || annotationIds.length === 0) {
      return;
    }

    const selectedIds = new Set(annotationIds);
    setAnnotations((currentAnnotations) =>
      currentAnnotations.map((annotation) => (selectedIds.has(annotation.id) ? updater(annotation) : annotation))
    );
    markDirty();
  }

  function removeSelectedAnnotations() {
    if (isReadOnly || selectedAnnotationIds.length === 0) {
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

  function startAnnotationDrag(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) {
    if (isReadOnly || event.button !== 0 || isEditableTarget(event.target)) {
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
    if (isReadOnly || event.button !== 0) {
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

  function startLineEndpointDrag(event: PointerEvent<HTMLElement>, annotation: BoardAnnotation, endpoint: "start" | "end") {
    if (isReadOnly || event.button !== 0) {
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

    if (isReadOnly) {
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

  function addGameToBoard(game: GameSnapshot) {
    const rect = stageRef.current?.getBoundingClientRect();
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
    const world = clientToWorld(centerX, centerY);

    const nextItem: BoardItem = {
      id: createId(),
      bggId: game.bggId,
      x: world.x - CARD_WIDTH / 2,
      y: world.y - 120,
      scale: 1,
      note: "",
      status: "拥有",
      coverMode: "native",
      gameSnapshot: game
    };

    setItems((currentItems) => [...currentItems, nextItem]);
    markDirty();
    setIsAddOpen(false);
  }

  function handleTitleChange(value: string) {
    if (isReadOnly) {
      return;
    }

    setTitle(value.slice(0, 20));
    markDirty();
  }

  async function shareBoard() {
    if (!shareId) {
      return;
    }

    const url = `${window.location.origin}/s/${shareId}`;

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

    await navigator.clipboard.writeText(url);
    setShareCopied(true);
    window.setTimeout(() => setShareCopied(false), 1600);
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
  const backgroundAnnotations = annotations.filter((annotation) => annotation.kind === "section" || annotation.kind === "rectangle");
  const foregroundAnnotations = annotations.filter((annotation) => annotation.kind !== "section" && annotation.kind !== "rectangle");
  const stylebarPosition = getStylebarPosition(selectedAnnotations, viewport, stageRef.current);

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
    <main className="board-shell">
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
              readOnly={isReadOnly}
              value={title}
              onChange={(event) => handleTitleChange(event.target.value)}
            />
            <span>{isReadOnly ? t.publicShare : shareId ? `${t.shareLink} /s/${shareId}` : ""}</span>
          </div>
        </div>

        <div className="toolbar-actions">
          <LanguageSelect label={t.language} locale={locale} onChange={handleLocaleChange} />
          <button className="icon-button" type="button" onClick={() => zoomBy(0.9)} title={t.zoomOut}>
            <ZoomOut size={18} />
          </button>
          <span className="zoom-pill">{Math.round(viewport.scale * 100)}%</span>
          <button className="icon-button" type="button" onClick={() => zoomBy(1.1)} title={t.zoomIn}>
            <ZoomIn size={18} />
          </button>
          {!isReadOnly && shareId ? (
            <button className="button secondary" type="button" onClick={shareBoard}>
              <Share2 size={18} />
              {t.shareBoard}
            </button>
          ) : null}
          {shareCopied ? <span className="copy-hint toolbar-copy-hint">{t.shareCopied}</span> : null}
        </div>
      </header>

      {!isReadOnly ? (
        <>
          <CanvasToolRail activeTool={activeTool} onAddGame={() => setIsAddOpen(true)} onSelectTool={setActiveTool} t={t} />
          {selectedAnnotations.length > 0 ? (
            <AnnotationStyleBar
              onDelete={removeSelectedAnnotations}
              onStyleChange={setSelectedAnnotationStyle}
              position={stylebarPosition}
              selectedAnnotations={selectedAnnotations}
              t={t}
            />
          ) : null}
        </>
      ) : null}

      <section
        ref={stageRef}
        className={`canvas-stage${isPanning ? " is-panning" : ""}${activeTool !== "select" && !isReadOnly ? " is-tool-active" : ""}`}
        onPointerDown={handleStagePointerDown}
      >
        <div className="canvas-grid" />
        <div
          className="canvas-layer"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`
          }}
        >
          {backgroundAnnotations.map((annotation) => (
            <AnnotationObject
              annotation={annotation}
              editingId={editingAnnotationId}
              key={annotation.id}
              onDoubleClick={setEditingAnnotationId}
              onLineEndpointDrag={startLineEndpointDrag}
              onPointerDown={startAnnotationDrag}
              onResizeStart={startAnnotationResize}
              onTextChange={(annotationId, text) =>
                updateAnnotations([annotationId], (currentAnnotation) => ({
                  ...currentAnnotation,
                  text,
                  updatedAt: new Date().toISOString()
                }))
              }
              readOnly={isReadOnly}
              selected={selectedAnnotationIds.includes(annotation.id)}
              t={t}
            />
          ))}
          {items.map((item) => (
            <GameCard
              item={item}
              key={item.id}
              locale={locale}
              onContextMenu={openItemContextMenu}
              onDragStart={startItemDrag}
              onRemove={removeItem}
              onUpdate={updateItem}
              readOnly={isReadOnly}
              t={t}
            />
          ))}
          {foregroundAnnotations.map((annotation) => (
            <AnnotationObject
              annotation={annotation}
              editingId={editingAnnotationId}
              key={annotation.id}
              onDoubleClick={setEditingAnnotationId}
              onLineEndpointDrag={startLineEndpointDrag}
              onPointerDown={startAnnotationDrag}
              onResizeStart={startAnnotationResize}
              onTextChange={(annotationId, text) =>
                updateAnnotations([annotationId], (currentAnnotation) => ({
                  ...currentAnnotation,
                  text,
                  updatedAt: new Date().toISOString()
                }))
              }
              readOnly={isReadOnly}
              selected={selectedAnnotationIds.includes(annotation.id)}
              t={t}
            />
          ))}
          {snapGuides.map((guide) => (
            <SnapGuideLine guide={guide} key={`${guide.orientation}-${guide.position}-${guide.start}-${guide.end}`} scale={viewport.scale} />
          ))}
        </div>

        {items.length === 0 && !isReadOnly ? (
          <button className="empty-canvas-cta" type="button" onClick={() => setIsAddOpen(true)}>
            <Plus size={20} />
            {t.emptyBoard}
          </button>
        ) : null}
      </section>

      <footer className="board-footer">
        <div className="board-save-status">
          <span>{isReadOnly ? t.publicShare : saveState === "saving" ? t.saving : saveState === "error" ? t.saveFailed : isDirty ? t.unsaved : t.synced}</span>
          {saveState === "error" && !isReadOnly ? (
            <button className="footer-retry" type="button" onClick={() => void persistBoard()}>
              {t.retrySave}
            </button>
          ) : null}
        </div>
        <BggAttribution />
      </footer>

      {contextMenu && contextMenuItem && !isReadOnly ? (
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

      {isAddOpen && !isReadOnly ? <SearchDialog locale={locale} onClose={() => setIsAddOpen(false)} onSelect={addGameToBoard} t={t} /> : null}
    </main>
  );
}

function CanvasToolRail({
  activeTool,
  onAddGame,
  onSelectTool,
  t
}: {
  activeTool: CanvasTool;
  onAddGame: () => void;
  onSelectTool: (tool: CanvasTool) => void;
  t: UiCopy;
}) {
  const tools: Array<{ id: CanvasTool; label: string }> = [
    { id: "select", label: t.selectTool },
    { id: "text", label: t.textTool },
    { id: "sticky", label: t.stickyTool },
    { id: "section", label: t.sectionTool },
    { id: "rectangle", label: t.rectangleTool },
    { id: "line", label: t.lineTool },
    { id: "arrow", label: t.arrowTool }
  ];

  return (
    <aside className="canvas-tool-rail" aria-label={t.boardTools}>
      {tools.map((tool) => (
        <button
          aria-label={tool.label}
          className={`tool-button${activeTool === tool.id ? " is-active" : ""}`}
          key={tool.id}
          type="button"
          title={tool.label}
          onClick={() => onSelectTool(tool.id)}
        >
          {getToolIcon(tool.id)}
        </button>
      ))}
      <div className="tool-rail-separator" />
      <button aria-label={t.addGame} className="tool-button" type="button" title={t.addGame} onClick={onAddGame}>
        <Plus size={18} />
      </button>
    </aside>
  );
}

function AnnotationStyleBar({
  onDelete,
  onStyleChange,
  position,
  selectedAnnotations,
  t
}: {
  onDelete: () => void;
  onStyleChange: (patch: Partial<BoardAnnotationStyle>) => void;
  position: CSSProperties | undefined;
  selectedAnnotations: BoardAnnotation[];
  t: UiCopy;
}) {
  const activeStyle = selectedAnnotations[0]?.style ?? getDefaultAnnotationStyle("text");
  const showFillControl = selectedAnnotations.some(canAnnotationUseFill);

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

function AnnotationObject({
  annotation,
  editingId,
  onDoubleClick,
  onLineEndpointDrag,
  onPointerDown,
  onResizeStart,
  onTextChange,
  readOnly,
  selected,
  t
}: {
  annotation: BoardAnnotation;
  editingId: string | null;
  onDoubleClick: (annotationId: string | null) => void;
  onLineEndpointDrag: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation, endpoint: "start" | "end") => void;
  onPointerDown: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>, annotation: BoardAnnotation) => void;
  onTextChange: (annotationId: string, text: string) => void;
  readOnly: boolean;
  selected: boolean;
  t: UiCopy;
}) {
  const isEditing = editingId === annotation.id && !readOnly;
  const styleVars = getAnnotationCssVars(annotation.style);

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

function GameCard({
  item,
  locale,
  onContextMenu,
  onDragStart,
  onRemove,
  onUpdate,
  readOnly,
  t
}: {
  item: BoardItem;
  locale: Locale;
  onContextMenu: (event: MouseEvent<HTMLElement>, item: BoardItem) => void;
  onDragStart: (event: PointerEvent<HTMLElement>, item: BoardItem) => void;
  onRemove: (itemId: string) => void;
  onUpdate: (itemId: string, updater: (item: BoardItem) => BoardItem) => void;
  readOnly: boolean;
  t: UiCopy;
}) {
  const game = item.gameSnapshot;
  const displayName = getGameDisplayName(game, locale);
  const coverUrl = game.localImage || game.image || game.localThumbnail || game.thumbnail;
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

  return (
    <article
      className="game-card"
      onContextMenu={(event) => onContextMenu(event, item)}
      onPointerDown={(event) => onDragStart(event, item)}
      style={{
        left: item.x,
        top: item.y,
        transform: `scale(${item.scale})`
      }}
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
            src={withBasePath(coverUrl)}
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
        <span className="status-badge">{t.statusLabels[item.status]}</span>
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

function SearchDialog({
  locale,
  onClose,
  onSelect,
  t
}: {
  locale: Locale;
  onClose: () => void;
  onSelect: (game: GameSnapshot) => void;
  t: UiCopy;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<BggSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [addingId, setAddingId] = useState("");

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setSearchError("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError("");

      try {
        const response = await fetch(
          withBasePath(`/api/bgg/search?q=${encodeURIComponent(query.trim())}&locale=${encodeURIComponent(locale)}`),
          {
          signal: controller.signal
          }
        );
        const payload = (await response.json()) as { results?: BggSearchResult[]; error?: string };

        if (!response.ok) {
          throw new Error(payload.error ?? t.searchFailed);
        }

        setResults(payload.results ?? []);
      } catch (error) {
        if (!controller.signal.aborted) {
          setSearchError(error instanceof Error ? error.message : t.searchFailed);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 420);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [locale, query, t.searchFailed]);

  async function selectResult(result: BggSearchResult) {
    setAddingId(result.bggId);
    setSearchError("");

    try {
      const response = await fetch(withBasePath(`/api/bgg/things/${result.bggId}?locale=${encodeURIComponent(locale)}`));
      const payload = (await response.json()) as { game?: GameSnapshot; error?: string };

      if (!response.ok || !payload.game) {
        throw new Error(payload.error ?? t.detailFailed);
      }

      onSelect(payload.game);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : t.detailFailed);
    } finally {
      setAddingId("");
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

        <label className="search-field">
          <Search size={18} />
          <input
            autoFocus
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {isSearching ? <Loader2 className="spin" size={18} /> : null}
        </label>

        {searchError ? <p className="error-text">{searchError}</p> : null}

        <div className="search-results">
          {results.map((result) => {
            const resultName = result.displayName || result.name;
            const canonicalName = result.canonicalName && result.canonicalName !== resultName ? result.canonicalName : "";
            const resultMeta = [result.yearPublished, result.thingType === "boardgameexpansion" ? t.expansion : ""]
              .filter(Boolean)
              .join(" · ");

            return (
              <button className="result-row" key={result.bggId} type="button" onClick={() => selectResult(result)}>
                <span>
                  <strong>{resultName}</strong>
                  {resultMeta ? <em>{resultMeta}</em> : null}
                  {result.matchedAlias ? <small>{t.aliasPrefix}: {result.matchedAlias}</small> : null}
                  {canonicalName ? <small>{t.originalName}: {canonicalName}</small> : null}
                </span>
                {addingId === result.bggId ? <Loader2 className="spin" size={18} /> : <Plus size={18} />}
              </button>
            );
          })}

          {query.trim().length >= 2 && !isSearching && !searchError && results.length === 0 ? (
            <div className="result-empty">{t.noResults}</div>
          ) : null}
        </div>

        <BggAttribution className="dialog-attribution" />
      </section>
    </div>
  );
}
