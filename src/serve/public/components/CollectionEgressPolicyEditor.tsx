import { ShieldCheckIcon } from "lucide-react";

export type CollectionEgressPolicy = "local_only" | "lan" | "remote";

interface CollectionEgressPolicyEditorProps {
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onPolicyChange: (policy: CollectionEgressPolicy) => void;
  policy: CollectionEgressPolicy;
  relaxed: boolean;
  revision: number;
  source: "explicit" | "config_default";
}

export function CollectionEgressPolicyEditor({
  confirmed,
  onConfirmedChange,
  onPolicyChange,
  policy,
  relaxed,
  revision,
  source,
}: CollectionEgressPolicyEditorProps) {
  return (
    <section className="grid gap-x-5 gap-y-3 px-6 py-5 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <ShieldCheckIcon className="size-3.5 text-secondary/70" />
          <h3 className="font-medium text-[13px]">Data boundary</h3>
        </div>
        <p className="text-muted-foreground/50 text-xs leading-relaxed">
          Controls where source and derived content may travel.
        </p>
      </div>
      <div className="space-y-3">
        <label
          className="block font-mono text-[10px] text-muted-foreground/60 uppercase tracking-[0.1em]"
          htmlFor="collection-egress-policy"
        >
          Collection policy
        </label>
        <select
          className="h-9 w-full rounded-md border border-border/20 bg-muted/10 px-3 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary"
          id="collection-egress-policy"
          onChange={(event) =>
            onPolicyChange(event.target.value as CollectionEgressPolicy)
          }
          value={policy}
        >
          <option value="local_only">Local only</option>
          <option value="lan">Authenticated LAN</option>
          <option value="remote">Authenticated remote</option>
        </select>
        <p className="text-muted-foreground/45 text-xs">
          Source: <span className="font-mono">{source}</span> · revision{" "}
          <span className="font-mono">{revision}</span>
        </p>
        {relaxed ? (
          <div className="rounded-md border border-secondary/25 bg-secondary/6 p-3">
            <label className="flex cursor-pointer items-start gap-2.5 text-xs">
              <input
                checked={confirmed}
                className="mt-0.5 size-4 accent-[var(--secondary)]"
                onChange={(event) => onConfirmedChange(event.target.checked)}
                type="checkbox"
              />
              <span>
                I confirm this expands where collection content may travel. The
                confirmation applies only to revision {revision} and target{" "}
                {policy}.
              </span>
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}
