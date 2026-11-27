import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { claudeCodeAddArgs, configPath, mergeServer, PINNED_PACKAGE, runClaude, serverEntry, storeConfigPaths } from "./clientConfig.js";
import { VERSION } from "./version.js";

const ENV = { EUNOMIA_TREASURY: "CTREASURY", EUNOMIA_NETWORK: "pubnet" };

test("the config is merged: other servers and settings survive", () => {
  const existing = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x", args: [] } } });
  const out = JSON.parse(mergeServer(existing, serverEntry(ENV, "linux")));
  assert.equal(out.theme, "dark");
  assert.deepEqual(out.mcpServers.other, { command: "x", args: [] });
  assert.deepEqual(out.mcpServers.eunomia, { command: "npx", args: ["-y", PINNED_PACKAGE], env: ENV });
});

test("a client starts this exact release, never whatever is newest (fifth review, F6)", () => {
  assert.match(PINNED_PACKAGE, /^eunomia-mcp@\d+\.\d+\.\d+$/);
  for (const platform of ["linux", "darwin", "win32"] as const) {
    const { args } = serverEntry(ENV, platform);
    assert.equal(args.at(-1), PINNED_PACKAGE, platform);
    assert.ok(!args.includes("eunomia-mcp"), platform);
  }
});

test("the version in code is the version being published", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
  assert.equal(VERSION, pkg.version);
});

test("a missing or empty config starts fresh", () => {
  assert.deepEqual(Object.keys(JSON.parse(mergeServer(null, serverEntry(ENV, "linux"))).mcpServers), ["eunomia"]);
  assert.deepEqual(Object.keys(JSON.parse(mergeServer("  ", serverEntry(ENV, "linux"))).mcpServers), ["eunomia"]);
});

test("a config that is not a JSON object is never overwritten", () => {
  assert.throws(() => mergeServer("[1,2]", serverEntry(ENV, "linux")), /not a JSON object/);
  assert.throws(() => mergeServer("{ broken", serverEntry(ENV, "linux")));
});

test("on Windows the desktop clients start npx through cmd", () => {
  assert.deepEqual(serverEntry(ENV, "win32").args, ["/c", "npx", "-y", PINNED_PACKAGE]);
  assert.equal(serverEntry(ENV, "win32").command, "cmd");
});

test("each client's config lives where the client reads it", () => {
  assert.match(configPath("claude-desktop", "win32", { APPDATA: "C:/Users/u/AppData/Roaming" }, "C:/Users/u"), /Roaming[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("claude-desktop", "darwin", {}, "/Users/u"), /Library[\\/]Application Support[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("claude-desktop", "linux", {}, "/home/u"), /\.config[\\/]Claude[\\/]claude_desktop_config\.json$/);
  assert.match(configPath("cursor", "linux", {}, "/home/u"), /\.cursor[\\/]mcp\.json$/);
});

test("the agent's secret never goes into a client config", () => {
  const entry = serverEntry(ENV, "linux");
  assert.ok(!JSON.stringify(entry).includes("SECRET"));
});

test("Claude Code starts the server the way the other clients do — through cmd on Windows", () => {
  assert.deepEqual(claudeCodeAddArgs(ENV, "linux").slice(-4), ["--", "npx", "-y", PINNED_PACKAGE]);
  assert.deepEqual(claudeCodeAddArgs(ENV, "win32").slice(-6), ["--", "cmd", "/c", "npx", "-y", PINNED_PACKAGE]);
  assert.deepEqual(claudeCodeAddArgs(ENV, "linux").slice(0, 9), ["mcp", "add", "--scope", "user", "eunomia", "-e", "EUNOMIA_TREASURY=CTREASURY", "-e", "EUNOMIA_NETWORK=pubnet"]);
});

test("runClaude: the native binary first; a Windows .cmd shim through cmd.exe, never with shell characters", () => {
  const calls: string[][] = [];
  const shim = ((file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file === "claude") throw Object.assign(new Error("spawn"), { code: "ENOENT" });
    return Buffer.from("");
  }) as unknown as typeof import("node:child_process").execFileSync;
  runClaude(["mcp", "list"], "win32", shim);
  assert.deepEqual(calls[1], ["cmd.exe", "/d", "/s", "/c", "claude", "mcp", "list"]);
  assert.throws(() => runClaude(["-e", "X=a&calc"], "win32", shim), /reinterpret/);
  assert.throws(() => runClaude(["mcp", "list"], "linux", shim), /spawn/);
});

test("a packaged Claude Desktop on Windows gets the config in its own Roaming copy too", () => {
  const env = { LOCALAPPDATA: "C:/Users/u/AppData/Local" };
  const list = () => ["Claude_pzs8sxrjxfjjc", "Microsoft.WindowsStore_8wekyb3d8bbwe", "AnthropicPBC.Claude_abc123", "ClaudeNotes"];
  const got = storeConfigPaths("win32", env, "C:/Users/u", list).map((p) => p.split("\\").join("/"));
  assert.deepEqual(got, [
    "C:/Users/u/AppData/Local/Packages/Claude_pzs8sxrjxfjjc/LocalCache/Roaming/Claude/claude_desktop_config.json",
    "C:/Users/u/AppData/Local/Packages/AnthropicPBC.Claude_abc123/LocalCache/Roaming/Claude/claude_desktop_config.json",
  ]);
  assert.deepEqual(storeConfigPaths("darwin", env, "/Users/u", list), []);
  assert.deepEqual(storeConfigPaths("win32", env, "C:/Users/u", () => []), []);
});
