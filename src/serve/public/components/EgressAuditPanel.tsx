import {
  ChevronRightIcon,
  Loader2Icon,
  ReceiptTextIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "../hooks/use-api";
import { Button } from "./ui/button";

interface AuditReceipt {
  action: string;
  auditId: string;
  byteSize: number;
  contentClass: string;
  createdAtMs: number;
  decision: "allow" | "deny";
  destinationZone: string;
  effectivePolicy: string;
  reasonCode: string;
}

interface AuditPage {
  nextCursor: string | null;
  receipts: AuditReceipt[];
}

interface AuditStatus {
  bytes: number;
  receipts: number;
  retention: {
    maxAgeDays: number;
    maxBytes: number;
    maxReceipts: number;
  };
}

interface CleanupResult {
  auditId?: string;
  checkpointedFrames: number;
  deleted: number;
  physicalCleanup: string;
  remainingWalFrames: number;
}

export function EgressAuditPanel() {
  const [receipts, setReceipts] = useState<AuditReceipt[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<AuditStatus | null>(null);
  const [selected, setSelected] = useState<AuditReceipt | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [purgeConfirmed, setPurgeConfirmed] = useState(false);
  const [cleanup, setCleanup] = useState<CleanupResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const response = await apiFetch<AuditStatus>("/api/egress/audits/status");
    if (response.data) setStatus(response.data);
    else if (response.error) setError(response.error);
  }, []);

  const loadPage = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError(null);
    const suffix = cursor
      ? `?limit=10&cursor=${encodeURIComponent(cursor)}`
      : "?limit=10";
    const response = await apiFetch<AuditPage>(`/api/egress/audits${suffix}`);
    setLoading(false);
    if (response.error || !response.data) {
      setError(response.error ?? "Audit list failed");
      return;
    }
    const page = response.data;
    setReceipts((current) =>
      cursor ? [...current, ...page.receipts] : page.receipts
    );
    setNextCursor(page.nextCursor);
  }, []);

  useEffect(() => {
    void Promise.all([loadPage(), loadStatus()]);
  }, [loadPage, loadStatus]);

  const show = async (auditId: string) => {
    setError(null);
    const response = await apiFetch<{ receipt: AuditReceipt }>(
      `/api/egress/audits/${encodeURIComponent(auditId)}`
    );
    if (response.data) setSelected(response.data.receipt);
    else setError(response.error ?? "Audit receipt unavailable");
  };

  const remove = async (auditId: string) => {
    setError(null);
    const response = await apiFetch<CleanupResult>(
      `/api/egress/audits/${encodeURIComponent(auditId)}`,
      { method: "DELETE" }
    );
    setPendingDelete(null);
    if (response.error || !response.data) {
      setError(response.error ?? "Audit deletion failed");
      return;
    }
    setCleanup(response.data);
    setSelected((current) => (current?.auditId === auditId ? null : current));
    setReceipts((current) =>
      current.filter((receipt) => receipt.auditId !== auditId)
    );
    await loadStatus();
  };

  const purge = async () => {
    setError(null);
    const response = await apiFetch<CleanupResult>("/api/egress/audits", {
      method: "DELETE",
    });
    setPurgeConfirmed(false);
    if (response.error || !response.data) {
      setError(response.error ?? "Audit purge failed");
      return;
    }
    setCleanup(response.data);
    setReceipts([]);
    setNextCursor(null);
    setSelected(null);
    await loadStatus();
  };

  return (
    <section
      aria-labelledby="egress-audit-title"
      className="space-y-3 border-border/15 border-t px-6 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            className="flex items-center gap-2 font-medium text-[13px]"
            id="egress-audit-title"
          >
            <ReceiptTextIcon className="size-3.5 text-secondary/70" />
            Local audit receipts
          </h3>
          <p className="mt-1 text-muted-foreground/50 text-xs">
            Content-free decisions; newest first; retained locally.
          </p>
        </div>
        <p className="font-mono text-[10px] text-muted-foreground/50">
          {status
            ? `${status.receipts} receipts · ${status.bytes} bytes`
            : "loading status"}
        </p>
      </div>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div className="max-h-44 overflow-y-auto rounded-md border border-border/20">
        {receipts.length === 0 && !loading ? (
          <p className="p-3 text-muted-foreground/50 text-xs">
            No audit receipts yet.
          </p>
        ) : null}
        {receipts.map((receipt) => (
          <div
            className="flex items-center gap-2 border-border/15 border-b px-3 py-2 last:border-0"
            key={receipt.auditId}
          >
            <button
              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
              onClick={() => void show(receipt.auditId)}
              type="button"
            >
              <span className="block truncate font-mono text-[10px]">
                {receipt.decision} · {receipt.reasonCode}
              </span>
              <span className="block text-[10px] text-muted-foreground/45">
                {receipt.action} / {receipt.destinationZone} /{" "}
                {receipt.contentClass}
              </span>
            </button>
            {pendingDelete === receipt.auditId ? (
              <div className="flex gap-1">
                <Button
                  onClick={() => void remove(receipt.auditId)}
                  size="sm"
                  type="button"
                  variant="destructive"
                >
                  Confirm
                </Button>
                <Button
                  onClick={() => setPendingDelete(null)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                aria-label="Delete audit receipt"
                onClick={() => setPendingDelete(receipt.auditId)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <Trash2Icon className="size-3" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {nextCursor ? (
        <Button
          disabled={loading}
          onClick={() => void loadPage(nextCursor)}
          size="sm"
          type="button"
          variant="outline"
        >
          {loading ? <Loader2Icon className="size-3 animate-spin" /> : null}
          Load older
          <ChevronRightIcon className="size-3" />
        </Button>
      ) : null}

      {selected ? (
        <output className="block rounded-md border border-border/20 bg-muted/10 p-3 font-mono text-[10px]">
          <span className="block">{selected.auditId}</span>
          <span className="block text-muted-foreground/60">
            {selected.effectivePolicy} · {selected.reasonCode} ·{" "}
            {selected.byteSize} bytes
          </span>
        </output>
      ) : null}

      {cleanup ? (
        <output
          aria-live="polite"
          className="block text-[10px] text-muted-foreground/60"
        >
          Deleted {cleanup.deleted}; cleanup {cleanup.physicalCleanup};
          checkpointed {cleanup.checkpointedFrames}; WAL remaining{" "}
          {cleanup.remainingWalFrames}.
        </output>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 border-border/15 border-t pt-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            checked={purgeConfirmed}
            onChange={(event) => setPurgeConfirmed(event.target.checked)}
            type="checkbox"
          />
          Confirm purge of all local audit receipts
        </label>
        <Button
          className="ml-auto"
          disabled={!purgeConfirmed}
          onClick={() => void purge()}
          size="sm"
          type="button"
          variant="destructive"
        >
          Purge audits
        </Button>
      </div>
    </section>
  );
}
