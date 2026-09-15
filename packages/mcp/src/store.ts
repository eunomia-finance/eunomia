// Exception requests this agent filed, so `pay` can close the one it just satisfied and
// `check_exception` can name requests without a chain scan. The chain (the agent account's
// data entries) stays the source of truth; this is a bookmark list.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ExceptionRecord {
  /** `<treasury8>.<ts36>` — the data-entry name without the `eunomia.x.` prefix */
  id: string;
  to: string;
  /** stroops, decimal string */
  amount: string;
  taskId: string;
  reasonCodes: number[];
  /** unix seconds */
  requestedAt: number;
  txHash: string;
}

export interface ExceptionStore {
  load(treasuryId: string): ExceptionRecord[];
  save(treasuryId: string, records: ExceptionRecord[]): void;
}

export function memoryExceptionStore(): ExceptionStore {
  const m = new Map<string, ExceptionRecord[]>();
  return {
    load: (id) => [...(m.get(id) ?? [])],
    save: (id, r) => void m.set(id, [...r]),
  };
}

export function fileExceptionStore(dir: string): ExceptionStore {
  const file = (id: string) => join(dir, `${id}.exceptions.json`);
  return {
    load(id) {
      try {
        if (!existsSync(file(id))) return [];
        const parsed: unknown = JSON.parse(readFileSync(file(id), "utf8"));
        return Array.isArray(parsed)
          ? (parsed as ExceptionRecord[]).filter((r) => r && typeof r.id === "string")
          : [];
      } catch {
        return [];
      }
    },
    save(id, records) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(id), JSON.stringify(records, null, 2));
    },
  };
}
