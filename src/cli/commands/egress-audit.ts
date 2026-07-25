/** Local, content-free egress audit management commands. */

import { EgressAuditService } from "../../core/egress-audit";
import { CliError } from "../errors";
import { initStore } from "./shared";

interface AuditOptions {
  configPath?: string;
  indexName?: string;
}

const run = async (
  options: AuditOptions,
  operation: (service: EgressAuditService) => Promise<unknown>
): Promise<void> => {
  const initialized = await initStore({
    configPath: options.configPath,
    indexName: options.indexName,
    syncConfig: false,
    allowEmptyCollections: true,
  });
  if (!initialized.ok) throw new CliError("RUNTIME", initialized.error);
  try {
    const result = await operation(new EgressAuditService(initialized.store));
    if (
      typeof result === "object" &&
      result !== null &&
      "ok" in result &&
      !(result as { ok: boolean }).ok
    ) {
      const failure = result as {
        ok: false;
        error: { code: string; message: string };
      };
      throw new CliError("RUNTIME", failure.error.message, {
        details: { auditCode: failure.error.code },
      });
    }
    const value =
      typeof result === "object" && result !== null && "value" in result
        ? (result as { value: unknown }).value
        : result;
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } finally {
    await initialized.store.close();
  }
};

export const egressAuditList = (
  input: { limit?: number; cursor?: string },
  options: AuditOptions = {}
): Promise<void> => run(options, (service) => service.list(input));

export const egressAuditShow = (
  auditId: string,
  options: AuditOptions = {}
): Promise<void> => run(options, (service) => service.show(auditId));

export const egressAuditStatus = (options: AuditOptions = {}): Promise<void> =>
  run(options, (service) => service.status());

export const egressAuditDelete = (
  auditId: string,
  options: AuditOptions = {}
): Promise<void> => run(options, (service) => service.delete(auditId));

export const egressAuditPurge = (options: AuditOptions = {}): Promise<void> =>
  run(options, (service) => service.purge());
