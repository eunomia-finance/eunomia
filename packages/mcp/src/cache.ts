// Known payees outlive the RPC's event window (~7 days on testnet). Every cached address
// is still verified live before it is reported, so a stale entry costs one simulation,
// never a wrong answer. Storage is injectable so tools can be tested without a disk.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface KnownPayeeCache {
  load(treasuryId: string): string[];
  save(treasuryId: string, payees: string[]): void;
}

export function memoryCache(): KnownPayeeCache {
  const m = new Map<string, string[]>();
  return {
    load: (id) => [...(m.get(id) ?? [])],
    save: (id, p) => void m.set(id, [...p]),
  };
}

export function fileCache(dir: string): KnownPayeeCache {
  const file = (id: string) => join(dir, `${id}.payees.json`);
  return {
    load(id) {
      try {
        if (!existsSync(file(id))) return [];
        const parsed: unknown = JSON.parse(readFileSync(file(id), "utf8"));
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
      } catch {
        return [];
      }
    },
    save(id, payees) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file(id), JSON.stringify(payees, null, 2));
    },
  };
}
