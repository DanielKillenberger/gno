import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  PdfToolbar,
  ZOOM_STOPS,
} from "../../../../../src/serve/public/components/pdf/PdfToolbar";
import { MAX_ZOOM, MIN_ZOOM } from "../../../../../src/serve/public/lib/pdf";

describe("PdfToolbar", () => {
  afterEach(() => {
    cleanup();
  });

  function setup(overrides: Partial<Parameters<typeof PdfToolbar>[0]> = {}) {
    const onPageChange = mock(() => undefined);
    const onZoomIn = mock(() => undefined);
    const onZoomOut = mock(() => undefined);
    const onZoomTo = mock((_level: number) => undefined);
    const onFitMode = mock(() => undefined);
    const props = {
      page: 3,
      numPages: 10,
      zoom: 1,
      fitMode: "width" as const,
      disabled: false,
      downloadUrl: "/api/doc-asset?uri=x&path=doc.pdf",
      onPageChange,
      onZoomIn,
      onZoomOut,
      onZoomTo,
      onFitMode,
      ...overrides,
    };
    const view = render(<PdfToolbar {...props} />);
    return {
      ...props,
      onPageChange,
      onZoomIn,
      onZoomOut,
      onZoomTo,
      onFitMode,
      view,
    };
  }

  test("prev/next call onPageChange and disable at boundaries", () => {
    const { onPageChange, view } = setup({ page: 1, numPages: 5 });
    expect(
      (screen.getByTestId("pdf-toolbar-prev") as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByTestId("pdf-toolbar-next"));
    expect(onPageChange).toHaveBeenCalledWith(2);

    view.rerender(
      <PdfToolbar
        page={5}
        numPages={5}
        zoom={1}
        fitMode="custom"
        downloadUrl="/dl"
        onPageChange={onPageChange}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        onZoomTo={() => undefined}
        onFitMode={() => undefined}
      />
    );
    expect(
      (screen.getByTestId("pdf-toolbar-next") as HTMLButtonElement).disabled
    ).toBe(true);
    fireEvent.click(screen.getByTestId("pdf-toolbar-prev"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  test("page input: digits clamp 0→1 and >N→N on Enter/blur; empty/non-numeric revert", () => {
    const { onPageChange } = setup({ page: 3, numPages: 10 });
    const input = screen.getByTestId(
      "pdf-toolbar-page-input"
    ) as HTMLInputElement;

    // Invalid non-numeric — revert, no callback
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe("3");

    // Empty — revert
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe("3");

    // Digits-only 0 clamps to 1 on Enter
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).toHaveBeenCalledWith(1);

    onPageChange.mockClear();
    // >N clamps to N on Enter
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).toHaveBeenCalledWith(10);

    onPageChange.mockClear();
    // 0 via blur clamps to 1
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.blur(input);
    expect(onPageChange).toHaveBeenCalledWith(1);

    onPageChange.mockClear();
    // >N via blur clamps to N
    fireEvent.change(input, { target: { value: "50" } });
    fireEvent.blur(input);
    expect(onPageChange).toHaveBeenCalledWith(10);

    onPageChange.mockClear();
    // Valid page
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPageChange).toHaveBeenCalledWith(7);

    // Escape reverts without commit
    onPageChange.mockClear();
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onPageChange).not.toHaveBeenCalled();
    expect(input.value).toBe("3");
  });

  test("page indicator is aria-live with tabular n/N", () => {
    setup({ page: 12, numPages: 240 });
    const indicator = screen.getByTestId("pdf-toolbar-page-indicator");
    expect(indicator.getAttribute("aria-live")).toBe("polite");
    expect(indicator.textContent?.replace(/\s+/g, " ").trim()).toMatch(
      /12\s*\/\s*240/
    );
    expect(indicator.className).toContain("tabular-nums");
  });

  test("zoom in/out and fit modes; custom leaves both unpressed", () => {
    const { onZoomIn, onZoomOut, onFitMode, view } = setup({
      fitMode: "width",
      zoom: 1.2,
    });

    fireEvent.click(screen.getByTestId("pdf-toolbar-zoom-in"));
    expect(onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("pdf-toolbar-zoom-out"));
    expect(onZoomOut).toHaveBeenCalled();
    // Reason for change: the percentage readout button became the zoom-level
    // combobox, so the live percentage is asserted on its trigger. onZoomReset
    // remains wired and is covered by the PdfViewer keyboard-shortcut tests.
    expect(screen.getByTestId("pdf-toolbar-zoom-level").textContent).toContain(
      "120%"
    );

    expect(
      screen.getByTestId("pdf-toolbar-fit-width").getAttribute("aria-pressed")
    ).toBe("true");
    expect(
      screen.getByTestId("pdf-toolbar-fit-page").getAttribute("aria-pressed")
    ).toBe("false");
    fireEvent.click(screen.getByTestId("pdf-toolbar-fit-page"));
    expect(onFitMode).toHaveBeenCalledWith("page");

    view.rerender(
      <PdfToolbar
        page={1}
        numPages={5}
        zoom={1}
        fitMode="custom"
        downloadUrl="/dl"
        onPageChange={() => undefined}
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        onZoomTo={() => undefined}
        onFitMode={() => undefined}
      />
    );
    expect(
      screen.getByTestId("pdf-toolbar-fit-width").getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen.getByTestId("pdf-toolbar-fit-page").getAttribute("aria-pressed")
    ).toBe("false");
  });

  test("zoom-level combobox: stops within bounds, current level selected, accessible name", () => {
    setup({ zoom: 2, fitMode: "custom" });
    const trigger = screen.getByTestId("pdf-toolbar-zoom-level");
    expect(trigger.textContent).toContain("200%");
    expect(trigger.getAttribute("aria-label")).toContain("Zoom level");
    // Every stop lies inside the viewer's existing bounds — no new zoom math.
    for (const level of ZOOM_STOPS) {
      expect(level).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(level).toBeLessThanOrEqual(MAX_ZOOM);
    }
    expect(ZOOM_STOPS).toContain(1);
    expect(ZOOM_STOPS).toContain(2);
  });

  test("zoom-level combobox disables with controlsDisabled and keeps steppers independent", () => {
    setup({ disabled: true });
    const trigger = screen.getByTestId(
      "pdf-toolbar-zoom-level"
    ) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-in") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-out") as HTMLButtonElement).disabled
    ).toBe(true);
  });

  test("zoom-level combobox opens and selecting a level calls onZoomTo with that value", async () => {
    const { onZoomTo } = setup({ zoom: 1, fitMode: "custom" });
    const trigger = screen.getByTestId("pdf-toolbar-zoom-level");
    // Radix opens on pointerdown+click; keyboard Enter also opens.
    fireEvent.keyDown(trigger, { key: "Enter" });
    const option = await screen.findByTestId("pdf-toolbar-zoom-option-200");
    expect(option.getAttribute("aria-label")).toContain("200 percent");
    fireEvent.click(option);
    expect(onZoomTo).toHaveBeenCalledWith(2);
  });

  test("zoom-level combobox marks 100% as the default level", async () => {
    setup({ zoom: 1, fitMode: "custom" });
    fireEvent.keyDown(screen.getByTestId("pdf-toolbar-zoom-level"), {
      key: "Enter",
    });
    const option = await screen.findByTestId("pdf-toolbar-zoom-option-100");
    expect(option.getAttribute("aria-label")).toContain("default level");
  });

  test("zoom-out disabled at MIN_ZOOM; zoom-in disabled at MAX_ZOOM", () => {
    const { onZoomOut, onZoomIn, view } = setup({ zoom: MIN_ZOOM });
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-out") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-in") as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(screen.getByTestId("pdf-toolbar-zoom-out"));
    expect(onZoomOut).not.toHaveBeenCalled();

    view.rerender(
      <PdfToolbar
        page={1}
        numPages={5}
        zoom={MAX_ZOOM}
        fitMode="custom"
        downloadUrl="/dl"
        onPageChange={() => undefined}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomTo={() => undefined}
        onFitMode={() => undefined}
      />
    );
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-in") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-out") as HTMLButtonElement).disabled
    ).toBe(false);
    fireEvent.click(screen.getByTestId("pdf-toolbar-zoom-in"));
    expect(onZoomIn).not.toHaveBeenCalled();
  });

  test("responsive structure: flex-wrap, mobile break, fit labels, page input", () => {
    setup();
    const toolbar = screen.getByTestId("pdf-toolbar");
    expect(toolbar.className.split(/\s+/)).toContain("flex-wrap");

    const mobileBreak = screen.getByTestId("pdf-toolbar-mobile-break");
    expect(mobileBreak.className.split(/\s+/)).toContain("basis-full");
    expect(mobileBreak.className.split(/\s+/)).toContain("lg:hidden");
    expect(mobileBreak.className.split(/\s+/)).toContain("w-full");

    // Source order: nav → zoom → break → fit → download
    const children = Array.from(toolbar.children);
    const navIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === "pdf-toolbar-group-nav"
    );
    const zoomIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === "pdf-toolbar-group-zoom"
    );
    const breakIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === "pdf-toolbar-mobile-break"
    );
    const fitIdx = children.findIndex(
      (el) => (el as HTMLElement).dataset.testid === "pdf-toolbar-fit-group"
    );
    const dlIdx = children.findIndex(
      (el) =>
        (el as HTMLElement).dataset.testid === "pdf-toolbar-group-download"
    );
    expect(navIdx).toBeGreaterThanOrEqual(0);
    expect(zoomIdx).toBeGreaterThan(navIdx);
    expect(breakIdx).toBeGreaterThan(zoomIdx);
    expect(fitIdx).toBeGreaterThan(breakIdx);
    expect(dlIdx).toBeGreaterThan(fitIdx);

    const input = screen.getByTestId("pdf-toolbar-page-input");
    expect(input.className.split(/\s+/)).toContain("hidden");
    expect(input.className.split(/\s+/)).toContain("lg:inline-flex");
    // Indicator remains visible at all breakpoints
    expect(screen.getByTestId("pdf-toolbar-page-indicator")).toBeTruthy();

    const fitWidthLabel = screen.getByTestId("pdf-toolbar-fit-width-label");
    expect(fitWidthLabel.className.split(/\s+/)).toContain("hidden");
    expect(fitWidthLabel.className.split(/\s+/)).toContain("lg:inline");
    expect(fitWidthLabel.textContent).toBe("Fit width");

    const fitPageLabel = screen.getByTestId("pdf-toolbar-fit-page-label");
    expect(fitPageLabel.className.split(/\s+/)).toContain("hidden");
    expect(fitPageLabel.className.split(/\s+/)).toContain("lg:inline");
    expect(fitPageLabel.textContent).toBe("Fit page");
  });

  test("no Pages/Text view toggle; download is real anchor", () => {
    setup({ downloadUrl: "/download.pdf" });
    expect(screen.queryByText("Pages")).toBeNull();
    expect(screen.queryByText("Text")).toBeNull();
    expect(
      document.querySelector('[data-testid="pdf-view-toggle"]')
    ).toBeNull();
    const dl = screen.getByTestId("pdf-toolbar-download");
    const anchor = dl.matches("a") ? dl : dl.querySelector("a");
    expect(anchor).toBeTruthy();
    expect((anchor as HTMLAnchorElement).getAttribute("href")).toBe(
      "/download.pdf"
    );
    expect((anchor as HTMLAnchorElement).hasAttribute("download")).toBe(true);
  });

  test("disabled empty document disables controls; download stays actionable", () => {
    setup({ disabled: true, numPages: 0, page: 0 });
    expect(
      (screen.getByTestId("pdf-toolbar-prev") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-next") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-zoom-in") as HTMLButtonElement).disabled
    ).toBe(true);
    expect(
      (screen.getByTestId("pdf-toolbar-fit-width") as HTMLButtonElement)
        .disabled
    ).toBe(true);
    const dl = screen.getByTestId("pdf-toolbar-download");
    const anchor = dl.matches("a") ? dl : dl.querySelector("a");
    expect(anchor).toBeTruthy();
    expect((anchor as HTMLAnchorElement).hasAttribute("download")).toBe(true);
  });

  test("icon buttons expose aria-labels", () => {
    setup();
    expect(screen.getByLabelText("Previous page")).toBeTruthy();
    expect(screen.getByLabelText("Next page")).toBeTruthy();
    expect(screen.getByLabelText("Zoom in")).toBeTruthy();
    expect(screen.getByLabelText("Zoom out")).toBeTruthy();
    expect(screen.getByLabelText("Download original")).toBeTruthy();
  });
});
