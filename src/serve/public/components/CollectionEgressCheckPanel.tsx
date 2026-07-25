import { Loader2Icon, ScanSearchIcon } from "lucide-react";
import { useState } from "react";

import { apiFetch } from "../hooks/use-api";
import { Button } from "./ui/button";

type Action =
  | "clip_write"
  | "export"
  | "publish"
  | "remote_inference"
  | "retrieve"
  | "serve";
type Destination = "lan" | "local_process" | "loopback" | "remote";
type ContentClass =
  | "attachment"
  | "audit_log"
  | "capsule"
  | "embedding"
  | "metadata"
  | "retrieval_trace"
  | "snippet"
  | "source";

interface CheckResult {
  mode: "complete" | "denied" | "partial";
  decision: {
    allowed: boolean;
    reason: string;
  };
  disclosure: null | { omittedCount: number };
  omittedCollections: Array<{ collection: string; reason: string }>;
  remediation: null | { message: string };
}

interface CollectionEgressCheckPanelProps {
  collection: string;
  effectivePolicy: "lan" | "local_only" | "remote";
  source: "config_default" | "explicit";
}

const selectClass =
  "h-8 rounded-md border border-border/20 bg-muted/10 px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

export function CollectionEgressCheckPanel({
  collection,
  effectivePolicy,
  source,
}: CollectionEgressCheckPanelProps) {
  const [action, setAction] = useState<Action>("export");
  const [destinationZone, setDestinationZone] = useState<Destination>("remote");
  const [contentClass, setContentClass] =
    useState<ContentClass>("retrieval_trace");
  const [authenticated, setAuthenticated] = useState(true);
  const [authorized, setAuthorized] = useState(true);
  const [partialResults, setPartialResults] = useState<"deny" | "explicit">(
    "deny"
  );
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);

  const check = async () => {
    setChecking(true);
    setError(null);
    const response = await apiFetch<CheckResult>("/api/egress/check", {
      method: "POST",
      body: JSON.stringify({
        action,
        caller: {
          authenticated,
          operationAuthorized: authorized,
        },
        collections: [collection],
        contentClass,
        destinationZone,
        partialResults,
      }),
    });
    setChecking(false);
    if (response.error || !response.data) {
      setResult(null);
      setError(response.error ?? "Policy check failed");
      return;
    }
    setResult(response.data);
  };

  return (
    <section
      aria-labelledby="egress-check-title"
      className="space-y-3 border-border/15 border-t px-6 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            className="flex items-center gap-2 font-medium text-[13px]"
            id="egress-check-title"
          >
            <ScanSearchIcon className="size-3.5 text-secondary/70" />
            Check a boundary
          </h3>
          <p className="mt-1 text-muted-foreground/50 text-xs">
            Exact, content-free explanation before an action runs.
          </p>
        </div>
        <p className="text-right font-mono text-[10px] text-muted-foreground/50">
          {effectivePolicy} / {source}
        </p>
      </div>

      <div className="grid gap-2 md:grid-cols-3">
        <label className="space-y-1 text-[10px] text-muted-foreground/60 uppercase">
          Action
          <select
            className={`${selectClass} w-full`}
            onChange={(event) => setAction(event.target.value as Action)}
            value={action}
          >
            {[
              "retrieve",
              "serve",
              "publish",
              "remote_inference",
              "export",
              "clip_write",
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] text-muted-foreground/60 uppercase">
          Destination
          <select
            className={`${selectClass} w-full`}
            onChange={(event) =>
              setDestinationZone(event.target.value as Destination)
            }
            value={destinationZone}
          >
            {["local_process", "loopback", "lan", "remote"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[10px] text-muted-foreground/60 uppercase">
          Content class
          <select
            className={`${selectClass} w-full`}
            onChange={(event) =>
              setContentClass(event.target.value as ContentClass)
            }
            value={contentClass}
          >
            {[
              "source",
              "snippet",
              "metadata",
              "attachment",
              "embedding",
              "capsule",
              "audit_log",
              "retrieval_trace",
            ].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            checked={authenticated}
            onChange={(event) => setAuthenticated(event.target.checked)}
            type="checkbox"
          />
          Authenticated
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={authorized}
            onChange={(event) => setAuthorized(event.target.checked)}
            type="checkbox"
          />
          Operation authorized
        </label>
        <label className="flex items-center gap-2">
          Partial mode
          <select
            className={selectClass}
            onChange={(event) =>
              setPartialResults(event.target.value as "deny" | "explicit")
            }
            value={partialResults}
          >
            <option value="deny">deny</option>
            <option value="explicit">explicit</option>
          </select>
        </label>
        <Button
          className="ml-auto text-xs"
          disabled={checking}
          onClick={() => void check()}
          size="sm"
          type="button"
          variant="outline"
        >
          {checking ? <Loader2Icon className="size-3 animate-spin" /> : null}
          Explain
        </Button>
      </div>

      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {result ? (
        <output
          aria-live="polite"
          className="block rounded-md border border-border/20 bg-muted/10 p-3 text-xs"
        >
          <p className="font-mono">
            {result.decision.allowed ? "allowed" : "denied"} ·{" "}
            {result.decision.reason} · {result.mode}
          </p>
          <p className="mt-1 text-muted-foreground/60">
            Omitted: {result.disclosure?.omittedCount ?? 0}
          </p>
          {result.remediation ? (
            <p className="mt-1 text-muted-foreground/70">
              {result.remediation.message}
            </p>
          ) : null}
        </output>
      ) : null}
    </section>
  );
}
