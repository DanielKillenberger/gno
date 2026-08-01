import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minus,
  Plus,
  StretchHorizontal,
} from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import type { FitMode } from "../../hooks/use-pdf-pages";

import { MAX_ZOOM, MIN_ZOOM } from "../../lib/pdf";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type PdfToolbarProps = {
  page: number;
  numPages: number;
  /** Logical zoom (1 = 100%). */
  zoom: number;
  fitMode: FitMode;
  /** When true, all interactive controls are disabled (empty / zero-page). */
  disabled?: boolean;
  downloadUrl: string;
  onPageChange: (page: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Commit an exact zoom level (1 = 100%) from the zoom-level combobox. */
  onZoomTo: (level: number) => void;
  onFitMode: (mode: "width" | "page") => void;
};

/**
 * Fixed zoom stops, all inside the viewer's existing MIN_ZOOM (0.25) /
 * MAX_ZOOM (4) bounds — no new zoom math and no new bounds. 100% is the
 * default level and is marked as such in its accessible name.
 */
export const ZOOM_STOPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

function zoomStopLabel(level: number): string {
  return `${Math.round(level * 100)}%`;
}

function clampPage(raw: number, numPages: number): number {
  if (!Number.isFinite(raw) || numPages < 1) {
    return 1;
  }
  return Math.min(numPages, Math.max(1, Math.trunc(raw)));
}

/**
 * Digits-only finite values (including 0) are numeric and clamp to 1..N.
 * Empty / non-numeric → null (caller reverts, no callback).
 */
function parsePageDraft(draft: string, numPages: number): number | null {
  const trimmed = draft.trim();
  if (!trimmed || !/^\d+$/u.test(trimmed)) {
    return null;
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n)) {
    return null;
  }
  return clampPage(n, numPages);
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
  testId,
  pressed,
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
  testId?: string;
  pressed?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          aria-pressed={pressed}
          className="cursor-pointer focus-visible:ring-primary/50"
          data-testid={testId}
          disabled={disabled}
          onClick={onClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Scholarly Dusk instrument-rail toolbar. Pure/controlled — no pdfjs imports.
 * DocView owns the Pages/Text view toggle; this rail never renders it.
 */
export function PdfToolbar({
  page,
  numPages,
  zoom,
  fitMode,
  disabled = false,
  downloadUrl,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFitMode,
}: PdfToolbarProps) {
  const liveId = useId();
  const [draft, setDraft] = useState(String(page));

  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  const atStart = page <= 1 || numPages < 1;
  const atEnd = page >= numPages || numPages < 1;
  const controlsDisabled = disabled || numPages < 1;
  const zoomPercent = Math.round(zoom * 100);
  const atMinZoom = zoom <= MIN_ZOOM;
  const atMaxZoom = zoom >= MAX_ZOOM;

  const commitDraft = () => {
    if (controlsDisabled) {
      setDraft(String(page));
      return;
    }
    const parsed = parsePageDraft(draft, numPages);
    if (parsed === null) {
      setDraft(String(page));
      return;
    }
    setDraft(String(parsed));
    if (parsed !== page) {
      onPageChange(parsed);
    }
  };

  return (
    <div
      className="gno-pdf-toolbar sticky top-0 z-10 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-t-lg border-border/40 border-b bg-background/85 px-3 py-2 backdrop-blur-[20px]"
      data-testid="pdf-toolbar"
      role="toolbar"
      aria-label="PDF toolbar"
    >
      {/* Group A — page navigation */}
      <div
        className="flex items-center gap-1"
        data-testid="pdf-toolbar-group-nav"
      >
        <IconButton
          disabled={controlsDisabled || atStart}
          label="Previous page"
          onClick={() => onPageChange(clampPage(page - 1, numPages))}
          testId="pdf-toolbar-prev"
        >
          <ChevronLeft />
        </IconButton>

        <Input
          aria-label="Page number"
          className="hidden h-8 w-12 px-1 text-center font-mono text-xs tabular-nums lg:inline-flex"
          data-testid="pdf-toolbar-page-input"
          disabled={controlsDisabled}
          inputMode="numeric"
          onBlur={commitDraft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitDraft();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraft(String(page));
              (e.target as HTMLInputElement).blur();
            }
          }}
          value={draft}
        />

        <span
          aria-atomic="true"
          aria-live="polite"
          className="min-w-[3.5rem] px-1 text-center font-mono text-muted-foreground text-xs tabular-nums"
          data-testid="pdf-toolbar-page-indicator"
          id={liveId}
        >
          <span className="text-primary">{Math.max(0, page)}</span>
          <span className="text-muted-foreground/70">
            {" "}
            / {Math.max(0, numPages)}
          </span>
        </span>

        <IconButton
          disabled={controlsDisabled || atEnd}
          label="Next page"
          onClick={() => onPageChange(clampPage(page + 1, numPages))}
          testId="pdf-toolbar-next"
        >
          <ChevronRight />
        </IconButton>
      </div>

      {/* Group B — zoom */}
      <div
        className="flex items-center gap-1"
        data-testid="pdf-toolbar-group-zoom"
      >
        <IconButton
          disabled={controlsDisabled || atMinZoom}
          label="Zoom out"
          onClick={onZoomOut}
          testId="pdf-toolbar-zoom-out"
        >
          <Minus />
        </IconButton>

        {/*
          Zoom-level combobox. Deliberately inherits the previous readout's
          exact type treatment (font-mono text-xs tabular-nums) and h-8 sizing,
          with the primitive's border/shadow suppressed, so the toolbar's
          resting rhythm is unchanged next to the ghost stepper buttons — the
          control reads as the same numeral it always was, now operable.
        */}
        <Select
          disabled={controlsDisabled}
          onValueChange={(v) => onZoomTo(Number(v))}
          // Always controlled: a zoom that is not a fixed stop simply has no
          // matching item, and the trigger keeps showing the live percentage.
          value={String(zoom)}
        >
          <SelectTrigger
            aria-label={`Zoom level, ${zoomPercent} percent`}
            className="h-8 min-w-[4.25rem] cursor-pointer gap-1 border-transparent bg-transparent px-2 font-mono text-xs tabular-nums shadow-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-primary/50 dark:bg-transparent dark:hover:bg-accent"
            data-testid="pdf-toolbar-zoom-level"
            size="sm"
          >
            <SelectValue placeholder={`${zoomPercent}%`}>
              {zoomPercent}%
            </SelectValue>
          </SelectTrigger>
          <SelectContent
            className="min-w-[6rem]"
            data-testid="pdf-toolbar-zoom-level-list"
          >
            {ZOOM_STOPS.map((level) => (
              <SelectItem
                aria-label={
                  level === 1
                    ? "100 percent, default level"
                    : `${Math.round(level * 100)} percent`
                }
                className="cursor-pointer font-mono text-xs tabular-nums"
                data-testid={`pdf-toolbar-zoom-option-${Math.round(level * 100)}`}
                key={level}
                value={String(level)}
              >
                {zoomStopLabel(level)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <IconButton
          disabled={controlsDisabled || atMaxZoom}
          label="Zoom in"
          onClick={onZoomIn}
          testId="pdf-toolbar-zoom-in"
        >
          <Plus />
        </IconButton>
      </div>

      {/*
        Structural <lg two-row split: A+B on row 1, C+D on row 2.
        Desktop (lg+) hides the break so all groups share one row.
        Source order A→B→break→C→D preserved.
      */}
      <span
        aria-hidden
        className="h-0 w-full basis-full lg:hidden"
        data-testid="pdf-toolbar-mobile-break"
      />

      {/* Group C — fit modes */}
      <div
        className="flex items-center gap-0.5 rounded-md border border-border/40 p-0.5"
        data-testid="pdf-toolbar-fit-group"
        role="group"
        aria-label="Fit mode"
      >
        <Button
          aria-label="Fit width"
          aria-pressed={fitMode === "width"}
          className="h-7 cursor-pointer gap-1 px-2 text-xs focus-visible:ring-primary/50 data-[pressed=true]:bg-primary/15 data-[pressed=true]:text-primary"
          data-pressed={fitMode === "width" ? "true" : "false"}
          data-testid="pdf-toolbar-fit-width"
          disabled={controlsDisabled}
          onClick={() => onFitMode("width")}
          size="sm"
          type="button"
          variant="ghost"
        >
          <StretchHorizontal className="size-3.5" />
          <span
            className="hidden lg:inline"
            data-testid="pdf-toolbar-fit-width-label"
          >
            Fit width
          </span>
        </Button>
        <Button
          aria-label="Fit page"
          aria-pressed={fitMode === "page"}
          className="h-7 cursor-pointer gap-1 px-2 text-xs focus-visible:ring-primary/50 data-[pressed=true]:bg-primary/15 data-[pressed=true]:text-primary"
          data-pressed={fitMode === "page" ? "true" : "false"}
          data-testid="pdf-toolbar-fit-page"
          disabled={controlsDisabled}
          onClick={() => onFitMode("page")}
          size="sm"
          type="button"
          variant="ghost"
        >
          <Maximize2 className="size-3.5" />
          <span
            className="hidden lg:inline"
            data-testid="pdf-toolbar-fit-page-label"
          >
            Fit page
          </span>
        </Button>
      </div>

      <span className="flex-1" data-testid="pdf-toolbar-spacer" />

      {/* Group D — download */}
      <div data-testid="pdf-toolbar-group-download">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              asChild
              className="cursor-pointer focus-visible:ring-primary/50"
              data-testid="pdf-toolbar-download"
              size="icon-sm"
              variant="ghost"
            >
              <a
                aria-label="Download original"
                download
                href={downloadUrl || undefined}
              >
                <Download />
              </a>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Download original</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
