import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileCache, memoryCache } from "./cache.js";

test("memory cache round-trips per treasury and copies on save", () => {
  const c = memoryCache();
  assert.deepEqual(c.load("C1"), []);
  const arr = ["GA"];
  c.save("C1", arr);
  arr.push("GB"); // caller mutation must not leak into the cache
  assert.deepEqual(c.load("C1"), ["GA"]);
  assert.deepEqual(c.load("C2"), []);
});

test("file cache persists to <dir>/<treasury>.payees.json and survives a reload", () => {
  const dir = mkdtempSync(join(tmpdir(), "eunomia-cache-"));
  fileCache(dir).save("C1", ["GA", "GB"]);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, "C1.payees.json"), "utf8")), ["GA", "GB"]);
  assert.deepEqual(fileCache(dir).load("C1"), ["GA", "GB"]);
  assert.deepEqual(fileCache(dir).load("missing"), []);
});

test("file cache treats a corrupt file as empty instead of crashing the tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "eunomia-cache-"));
  writeFileSync(join(dir, "C1.payees.json"), "{not json");
  assert.deepEqual(fileCache(dir).load("C1"), []);
});

test("file cache creates a missing directory on save", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "eunomia-cache-")), "nested", "deeper");
  fileCache(dir).save("C1", ["GA"]);
  assert.deepEqual(fileCache(dir).load("C1"), ["GA"]);
});
