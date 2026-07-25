import { Loader2Icon, ScanSearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  allowedCollections: string[];
  mode: "complete" | "denied" | "partial";
  decision: {
    allowed: boolean;
    reason: string;
  };
  disclosure: null | {
    code: "EGRESS_PARTIAL_RESULT";
    omittedCount: number;
    omittedCollections: string[];
  };
  omittedCollections: Array<{ collection: string; reason: string }>;
  remediation: null | { message: string };
}

interface CollectionEgressCheckPanelProps {
  availableCollections: readonly string[];
  collection: string;
  effectivePolicy: "lan" | "local_only" | "remote";
  source: "config_default" | "explicit";
}

const selectClass =
  "h-8 rounded-md border border-border/20 bg-muted/10 px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary";

export function CollectionEgressCheckPanel({
  availableCollections,
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
  const [collectionSearch, setCollectionSearch] = useState("");
  const [selectedCollections, setSelectedCollections] = useState<string[]>([
    collection,
  ]);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckResult | null>(null);
  const collectionOptions = useMemo(
    () =>
      [...new Set([collection, ...availableCollections])].sort((left, right) =>
        left.localeCompare(right)
      ),
    [availableCollections, collection]
  );
  const visibleCollections = useMemo(() => {
    const query = collectionSearch.trim().toLowerCase();
    return query
      ? collectionOptions.filter((name) => name.toLowerCase().includes(query))
      : collectionOptions;
  }, [collectionOptions, collectionSearch]);
  const partialAvailable = selectedCollections.length > 1;

  useEffect(() => {
    setSelectedCollections([collection]);
    setCollectionSearch("");
    setPartialResults("deny");
    setResult(null);
    setError(null);
  }, [collection]);

  useEffect(() => {
    if (!partialAvailable && partialResults === "explicit") {
      setPartialResults("deny");
    }
  }, [partialAvailable, partialResults]);

  const toggleCollection = (name: string, checked: boolean): void => {
    setSelectedCollections((current) => {
      if (checked) {
        return current.includes(name) || current.length >= 64
          ? current
          : [...current, name];
      }
      return current.length === 1
        ? current
        : current.filter((candidate) => candidate !== name);
    });
    setResult(null);
  };

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
        collections: selectedCollections,
        contentClass,
        destinationZone,
        partialResults:
          selectedCollections.length > 1 ? partialResults : "deny",
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
            disabled={checking}
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
            disabled={checking}
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
            disabled={checking}
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

      <fieldset className="space-y-2 rounded-md border border-border/20 bg-muted/5 p-3">
        <legend className="px-1 font-mono text-[10px] text-muted-foreground/60 uppercase">
          Collection scope
        </legend>
        <label
          className="block space-y-1 text-[10px] text-muted-foreground/60 uppercase"
          htmlFor="egress-collection-search"
        >
          Search collections
          <input
            className={`${selectClass} block w-full normal-case`}
            id="egress-collection-search"
            disabled={checking}
            onChange={(event) => setCollectionSearch(event.target.value)}
            placeholder="Filter existing collections"
            type="search"
            value={collectionSearch}
          />
        </label>
        <div
          aria-label="Collections included in the check"
          className="grid max-h-28 gap-1 overflow-y-auto sm:grid-cols-2"
          role="group"
        >
          {visibleCollections.map((name) => {
            const checked = selectedCollections.includes(name);
            return (
              <label
                className="flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/20"
                key={name}
              >
                <input
                  checked={checked}
                  disabled={
                    checking || (checked && selectedCollections.length === 1)
                  }
                  onChange={(event) =>
                    toggleCollection(name, event.target.checked)
                  }
                  type="checkbox"
                />
                <span className="truncate font-mono" title={name}>
                  {name}
                </span>
                {name === collection ? (
                  <span className="ml-auto text-[9px] text-muted-foreground/45 uppercase">
                    current
                  </span>
                ) : null}
              </label>
            );
          })}
          {visibleCollections.length === 0 ? (
            <p className="text-muted-foreground/50 text-xs">
              No matching collections.
            </p>
          ) : null}
        </div>
        <p className="text-[10px] text-muted-foreground/50">
          {selectedCollections.length} selected · maximum 64
        </p>
      </fieldset>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2">
          <input
            checked={authenticated}
            disabled={checking}
            onChange={(event) => setAuthenticated(event.target.checked)}
            type="checkbox"
          />
          Authenticated
        </label>
        <label className="flex items-center gap-2">
          <input
            checked={authorized}
            disabled={checking}
            onChange={(event) => setAuthorized(event.target.checked)}
            type="checkbox"
          />
          Operation authorized
        </label>
        <label className="flex items-center gap-2">
          Partial mode
          <select
            className={selectClass}
            disabled={checking || !partialAvailable}
            onChange={(event) =>
              setPartialResults(event.target.value as "deny" | "explicit")
            }
            value={partialResults}
          >
            <option value="deny">deny</option>
            <option value="explicit">explicit</option>
          </select>
        </label>
        {!partialAvailable ? (
          <span className="text-[10px] text-muted-foreground/50">
            Explicit partial results require at least two collections.
          </span>
        ) : null}
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
            {result.mode} · {result.decision.reason}
          </p>
          <p className="mt-1 text-muted-foreground/60">
            Omitted: {result.disclosure?.omittedCount ?? 0}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div>
              <p className="font-mono text-[10px] text-muted-foreground/50 uppercase">
                Allowed collections
              </p>
              {result.allowedCollections.length > 0 ? (
                <ul className="mt-1 space-y-0.5 font-mono">
                  {result.allowedCollections.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground/50">None</p>
              )}
            </div>
            <div>
              <p className="font-mono text-[10px] text-muted-foreground/50 uppercase">
                Omitted collections
              </p>
              {result.omittedCollections.length > 0 ? (
                <ul className="mt-1 space-y-0.5 font-mono">
                  {result.omittedCollections.map((item) => (
                    <li key={item.collection}>
                      {item.collection} · {item.reason}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-muted-foreground/50">None</p>
              )}
            </div>
          </div>
          {result.disclosure ? (
            <p className="mt-2 font-mono text-[10px] text-muted-foreground/60">
              {result.disclosure.code}:{" "}
              {result.disclosure.omittedCollections.join(", ")}
            </p>
          ) : null}
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
