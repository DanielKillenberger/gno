import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { StrictMode, type ReactNode } from "react";

import { usePdfDocument } from "../../../../src/serve/public/hooks/use-pdf-document";
import {
  PDF_WHOLE_FILE_MAX_BYTES,
  type GnoDocumentLoadingTask,
  type GnoGetDocumentParams,
  type PdfFallbackReason,
  type PdfTransportHint,
} from "../../../../src/serve/public/lib/pdf";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type FakeDoc = {
  numPages: number;
};

type FakeTask = {
  url: string;
  transport: PdfTransportHint | undefined;
  gnoDocId: string;
  destroyed: boolean;
  deferred: Deferred<FakeDoc>;
  promise: Promise<FakeDoc>;
  destroy: ReturnType<typeof mock>;
};

const getDocumentCalls: FakeTask[] = [];
let docIdCounter = 0;
const destroyEvents: string[] = [];

// ── HEAD probe double ───────────────────────────────────────────────────────
type HeadResult = { status: number; contentLength?: string } | Error;
const DEFAULT_HEAD: HeadResult = { status: 200, contentLength: "1024" };
let headResult: HeadResult = DEFAULT_HEAD;
/** When set, the probe response waits on this gate (unmount-during-probe). */
let headGate: Deferred<void> | null = null;
const headCalls: { url: string; method: string | undefined }[] = [];

const fakeFetch = mock(
  async (url: string, init?: RequestInit): Promise<Response> => {
    headCalls.push({ url, method: init?.method });
    if (headGate) {
      await headGate.promise;
    }
    const result = headResult;
    if (result instanceof Error) {
      throw result;
    }
    const headers = new Headers();
    if (result.contentLength !== undefined) {
      headers.set("content-length", result.contentLength);
    }
    return new Response(null, { status: result.status, headers });
  }
);

/** The load starts only after the HEAD probe settles. */
async function loadStarted(count = 1): Promise<void> {
  await waitFor(() =>
    expect(getDocumentCalls.length).toBeGreaterThanOrEqual(count)
  );
}

const classifyPdfError = mock((err: unknown): PdfFallbackReason => {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("password")) return "password";
  if (msg.includes("network")) return "network";
  if (msg.includes("worker") || msg.includes("bootstrap")) return "bootstrap";
  return "corrupt";
});

const metrics = {
  mintDocId: () => {
    docIdCounter += 1;
    return `d${docIdCounter}`;
  },
  recordDocumentDestroy: mock((args: { docId: string }) => {
    destroyEvents.push(args.docId);
  }),
  reset: mock(() => undefined),
  snapshot: mock(() => ({
    events: destroyEvents.map((docId, i) => ({
      seq: i + 1,
      kind: "documentDestroy" as const,
      docId,
    })),
    capacity: 2000,
    dropped: 0,
    seqHigh: destroyEvents.length,
    t0Epoch: 0,
  })),
};

function fakeGetDocument(params: GnoGetDocumentParams): GnoDocumentLoadingTask {
  const d = deferred<FakeDoc>();
  const gnoDocId = metrics.mintDocId();
  const task: FakeTask = {
    url: params.url,
    transport: params.transport,
    gnoDocId,
    destroyed: false,
    deferred: d,
    promise: d.promise,
    destroy: mock(async () => {
      task.destroyed = true;
    }),
  };
  getDocumentCalls.push(task);
  return task as unknown as GnoDocumentLoadingTask;
}

function makeDoc(numPages: number): FakeDoc {
  return { numPages };
}

function undestroyedTasks(): FakeTask[] {
  return getDocumentCalls.filter((t) => !t.destroyed);
}

function StrictWrapper({ children }: { children: ReactNode }) {
  return <StrictMode>{children}</StrictMode>;
}

const deps = {
  getDocument: fakeGetDocument,
  classifyPdfError:
    classifyPdfError as typeof import("../../../../src/serve/public/lib/pdf").classifyPdfError,
  getPdfMetrics: () => metrics as never,
  fetch: fakeFetch,
};

describe("use-pdf-document", () => {
  beforeEach(() => {
    getDocumentCalls.length = 0;
    destroyEvents.length = 0;
    docIdCounter = 0;
    headResult = DEFAULT_HEAD;
    headGate = null;
    headCalls.length = 0;
    fakeFetch.mockClear();
    classifyPdfError.mockClear();
    metrics.recordDocumentDestroy.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  test("StrictMode: two getDocument permitted; first destroyed; never two undestroyed", async () => {
    const { result, unmount } = renderHook(
      () => usePdfDocument("/api/doc-asset?path=a.pdf", deps),
      { wrapper: StrictWrapper }
    );

    await loadStarted();

    expect(getDocumentCalls.length).toBeGreaterThanOrEqual(1);

    if (getDocumentCalls.length === 1) {
      const first = getDocumentCalls[0]!;
      unmount();
      expect(first.destroyed).toBe(true);
      // never loaded → no documentDestroy
      expect(destroyEvents.length).toBe(0);

      const secondHook = renderHook(() =>
        usePdfDocument("/api/doc-asset?path=a.pdf", deps)
      );
      await loadStarted(2);
      const second = getDocumentCalls[1]!;
      expect(undestroyedTasks().length).toBe(1);

      await act(async () => {
        second.deferred.resolve(makeDoc(3));
      });
      await waitFor(() => {
        expect(secondHook.result.current.status).toBe("ready");
      });

      await act(async () => {
        first.deferred.resolve(makeDoc(99));
      });
      expect(secondHook.result.current.numPages).toBe(3);
      secondHook.unmount();
      expect(destroyEvents).toEqual([second.gnoDocId]);
      return;
    }

    const first = getDocumentCalls[0]!;
    const last = getDocumentCalls.at(-1)!;
    expect(first.destroyed).toBe(true);
    expect(last.destroyed).toBe(false);
    expect(undestroyedTasks().length).toBe(1);

    await act(async () => {
      last.deferred.resolve(makeDoc(3));
    });
    await waitFor(() => expect(result.current.numPages).toBe(3));

    await act(async () => {
      first.deferred.resolve(makeDoc(99));
    });
    expect(result.current.numPages).toBe(3);
    unmount();
    expect(destroyEvents).toEqual([last.gnoDocId]);
  });

  test("success unmount: task destroy once and documentDestroy once", async () => {
    const { result, unmount } = renderHook(() =>
      usePdfDocument("/ok.pdf", deps)
    );
    await loadStarted();
    const task = getDocumentCalls[0]!;
    const pdf = makeDoc(2);
    await act(async () => {
      task.deferred.resolve(pdf);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    unmount();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(destroyEvents).toEqual([task.gnoDocId]);
    expect(metrics.recordDocumentDestroy).toHaveBeenCalledTimes(1);
  });

  test("rejection: task.destroy on cleanup, documentDestroy zero times", async () => {
    const { result, unmount } = renderHook(() =>
      usePdfDocument("/err.pdf", deps)
    );
    await loadStarted();
    const task = getDocumentCalls[0]!;
    await act(async () => {
      task.deferred.reject(new Error("invalid pdf"));
    });
    await waitFor(() => expect(result.current.status).toBe("error"));
    unmount();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(destroyEvents.length).toBe(0);
    expect(metrics.recordDocumentDestroy).not.toHaveBeenCalled();
  });

  test("URL-change: old last resolve does not overwrite; destroy counts exact", async () => {
    const { result, rerender, unmount } = renderHook(
      ({ url }: { url: string }) => usePdfDocument(url, deps),
      { initialProps: { url: "/a.pdf" } }
    );
    await loadStarted();
    const first = getDocumentCalls[0]!;
    rerender({ url: "/b.pdf" });
    await loadStarted(2);
    const second = getDocumentCalls.at(-1)!;
    expect(first.destroyed).toBe(true);
    // first never loaded → no documentDestroy for first
    expect(destroyEvents).not.toContain(first.gnoDocId);

    const pdfB = makeDoc(2);
    await act(async () => {
      second.deferred.resolve(pdfB);
    });
    await waitFor(() => expect(result.current.numPages).toBe(2));

    const orphanA = makeDoc(7);
    await act(async () => {
      first.deferred.resolve(orphanA);
    });
    // stale resolution does not overwrite viewer state or emit a metric
    expect(result.current.numPages).toBe(2);
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(destroyEvents).not.toContain(first.gnoDocId);

    unmount();
    expect(destroyEvents).toEqual([second.gnoDocId]);
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });

  test("retry race: superseded reject LAST cannot overwrite; destroy exact", async () => {
    const { result, unmount } = renderHook(() =>
      usePdfDocument("/c.pdf", deps)
    );
    await loadStarted();
    const first = getDocumentCalls[0]!;
    act(() => {
      result.current.retry();
    });
    await loadStarted(2);
    const second = getDocumentCalls.at(-1)!;
    expect(first.destroyed).toBe(true);

    const pdf = makeDoc(5);
    await act(async () => {
      second.deferred.resolve(pdf);
    });
    await waitFor(() => expect(result.current.numPages).toBe(5));

    await act(async () => {
      first.deferred.reject(new Error("late fail"));
    });
    expect(result.current.status).toBe("ready");
    expect(result.current.numPages).toBe(5);
    unmount();
    expect(destroyEvents).toEqual([second.gnoDocId]);
  });

  test("stale late resolution after unmount: task remains singly destroyed, no documentDestroy", async () => {
    const { unmount } = renderHook(() => usePdfDocument("/late.pdf", deps));
    await loadStarted();
    const task = getDocumentCalls[0]!;
    unmount();
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(destroyEvents.length).toBe(0);

    const orphan = makeDoc(1);
    await act(async () => {
      task.deferred.resolve(orphan);
    });
    expect(task.destroy).toHaveBeenCalledTimes(1);
    expect(destroyEvents.length).toBe(0);
  });

  test("classifyPdfError discrimination for all four reasons", async () => {
    const cases = [
      ["password needed", "password"],
      ["network failure", "network"],
      ["worker bootstrap fail", "bootstrap"],
      ["invalid pdf", "corrupt"],
    ] as const;

    for (const [msg, reason] of cases) {
      const { result, unmount } = renderHook(() =>
        usePdfDocument(`/err-${reason}.pdf`, deps)
      );
      await loadStarted(getDocumentCalls.length + 1);
      const task = getDocumentCalls.at(-1)!;
      await act(async () => {
        task.deferred.reject(new Error(msg));
      });
      await waitFor(() => expect(result.current.status).toBe("error"));
      expect(result.current.error).toBe(reason);
      unmount();
    }
    expect(destroyEvents.length).toBe(0);
  });

  test("per-load opaque distinct docId including same URL", async () => {
    const firstHook = renderHook(() => usePdfDocument("/same.pdf", deps));
    await loadStarted();
    const id1 = getDocumentCalls[0]!.gnoDocId;
    await act(async () => {
      getDocumentCalls[0]!.deferred.resolve(makeDoc(1));
    });
    await waitFor(() => expect(firstHook.result.current.docId).toBe(id1));
    firstHook.unmount();

    const secondHook = renderHook(() => usePdfDocument("/same.pdf", deps));
    await loadStarted(2);
    const id2 = getDocumentCalls.at(-1)!.gnoDocId;
    expect(id2).not.toBe(id1);
    await act(async () => {
      getDocumentCalls.at(-1)!.deferred.resolve(makeDoc(1));
    });
    await waitFor(() => expect(secondHook.result.current.docId).toBe(id2));
    secondHook.unmount();
    expect(destroyEvents).toEqual([id1, id2]);
  });

  test("repeated cleanup is idempotent (no double documentDestroy)", async () => {
    const { result, unmount } = renderHook(() =>
      usePdfDocument("/once.pdf", deps)
    );
    await loadStarted();
    const task = getDocumentCalls[0]!;
    const pdf = makeDoc(1);
    await act(async () => {
      task.deferred.resolve(pdf);
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    unmount();
    unmount();
    expect(destroyEvents).toEqual([task.gnoDocId]);
    expect(task.destroy).toHaveBeenCalledTimes(1);
  });

  // ── Transport tier by size (fn-136 R1) ────────────────────────────────────

  test("HEAD probe once per load: whole-file under the bound, ranged at or above it", async () => {
    const cases: { contentLength: string; expected: PdfTransportHint }[] = [
      { contentLength: "1024", expected: "whole-file" },
      {
        contentLength: String(PDF_WHOLE_FILE_MAX_BYTES - 1),
        expected: "whole-file",
      },
      { contentLength: String(PDF_WHOLE_FILE_MAX_BYTES), expected: "ranged" },
      {
        contentLength: String(PDF_WHOLE_FILE_MAX_BYTES * 4),
        expected: "ranged",
      },
    ];
    for (const { contentLength, expected } of cases) {
      headCalls.length = 0;
      headResult = { status: 200, contentLength };
      const url = `/api/doc-asset?path=size-${contentLength}.pdf`;
      const { result, unmount } = renderHook(() => usePdfDocument(url, deps));
      await loadStarted(getDocumentCalls.length + 1);
      const task = getDocumentCalls.at(-1)!;
      expect(task.transport).toBe(expected);
      expect(task.url).toBe(url);
      // Exactly one same-origin HEAD against the asset URL per document load.
      expect(headCalls).toEqual([{ url, method: "HEAD" }]);
      await act(async () => {
        task.deferred.resolve(makeDoc(1));
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(headCalls.length).toBe(1);
      unmount();
    }
  });

  test("HEAD failure, non-2xx, or missing/invalid Content-Length falls back to ranged without a document error", async () => {
    const cases: { name: string; head: HeadResult }[] = [
      { name: "network", head: new Error("network down") },
      { name: "500", head: { status: 500, contentLength: "1024" } },
      { name: "404", head: { status: 404 } },
      { name: "no-length", head: { status: 200 } },
      { name: "bad-length", head: { status: 200, contentLength: "abc" } },
    ];
    for (const { name, head } of cases) {
      headResult = head;
      const { result, unmount } = renderHook(() =>
        usePdfDocument(`/api/doc-asset?path=${name}.pdf`, deps)
      );
      await loadStarted(getDocumentCalls.length + 1);
      const task = getDocumentCalls.at(-1)!;
      expect(task.transport).toBe("ranged");
      // The probe outcome never surfaces as a viewer error.
      expect(result.current.status).toBe("loading");
      expect(result.current.error).toBeNull();
      await act(async () => {
        task.deferred.resolve(makeDoc(2));
      });
      await waitFor(() => expect(result.current.status).toBe("ready"));
      expect(result.current.error).toBeNull();
      expect(classifyPdfError).not.toHaveBeenCalled();
      unmount();
    }
  });

  test("unmount during the HEAD probe never creates a loading task", async () => {
    headGate = deferred<void>();
    const { unmount } = renderHook(() =>
      usePdfDocument("/api/doc-asset?path=probe.pdf", deps)
    );
    expect(headCalls.length).toBe(1);
    unmount();
    await act(async () => {
      headGate!.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getDocumentCalls.length).toBe(0);
    expect(destroyEvents.length).toBe(0);
    expect(metrics.recordDocumentDestroy).not.toHaveBeenCalled();
  });
});
