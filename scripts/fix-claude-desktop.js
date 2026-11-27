// Repairs a Claude Desktop config on Windows and adds the Eunomia MCP server to it: for a
// machine where `eunomia-mcp init --client claude-desktop` ran while Claude Desktop was open
// (it rewrote its config on exit and dropped the entry) or where the entry was pasted by hand
// in the wrong place. Close Claude Desktop first. Each file it changes is kept as *.onceki.
const fs = require("fs"), path = require("path"), os = require("os");
const home = os.homedir();
const APPDATA = process.env.APPDATA || path.join(home, "AppData", "Roaming");
const LOCAL = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
const credDir = path.join(process.env.EUNOMIA_HOME || path.join(home, ".eunomia"), "pubnet");
const creds = fs.existsSync(credDir) ? fs.readdirSync(credDir).filter((f) => /^C[A-Z2-7]{55}\.json$/.test(f)) : [];
if (creds.length === 0) { console.log("HATA: ajan anahtari bulunamadi (" + credDir + ")"); process.exit(1); }
creds.sort((a, b) => fs.statSync(path.join(credDir, b)).mtimeMs - fs.statSync(path.join(credDir, a)).mtimeMs);
const treasury = creds[0].replace(".json", "");
const entry = { command: "cmd", args: ["/c", "npx", "-y", "eunomia-mcp@0.3.4"], env: { EUNOMIA_TREASURY: treasury, EUNOMIA_NETWORK: "pubnet" } };

// Every claude_desktop_config.json under the user's AppData: the classic folder, a packaged
// install's own copy of Roaming, and wherever else a build keeps it. Looked for, not assumed —
// the first version of this script assumed two folders and the file Claude read was a third.
const files = [];
const seen = new Set();
const SKIP = /^(Cache|Code Cache|GPUCache|node_modules|Temp|Microsoft|Google|Mozilla|npm-cache|pnpm|Programs)$/i;
function walk(dir, depth) {
  if (depth > 7) return;
  let list;
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of list) {
    const p = path.join(dir, e.name);
    if (e.isFile() && e.name === "claude_desktop_config.json") {
      const real = (() => { try { return fs.realpathSync(p); } catch { return p; } })();
      if (!seen.has(real.toLowerCase())) { seen.add(real.toLowerCase()); files.push(p); }
    } else if (e.isDirectory() && !SKIP.test(e.name)) walk(p, depth + 1);
  }
}
walk(APPDATA, 0);
walk(LOCAL, 0);
walk(path.join(home, ".claude"), 0);
console.log("Bulunan ayar dosyasi: " + files.length);

// Elle yapistirilan "mcpServers" blogunu metinden cikarir (tirnak icindeki parantezleri saymaz).
function stripPasted(text) {
  const k = text.indexOf('"mcpServers"');
  if (k < 0) return text;
  let i = text.indexOf("{", k);
  if (i < 0) return text;
  let depth = 0, inStr = false, esc = false, end = -1;
  for (; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return text;
  let after = end + 1;
  while (after < text.length && /\s/.test(text[after])) after++;
  if (text[after] === ",") after++;
  return text.slice(0, k) + text.slice(after);
}
const parse = (t) => { try { const o = JSON.parse(t.replace(/^﻿/, "")); return o && typeof o === "object" && !Array.isArray(o) ? o : null; } catch { return null; } };

let done = 0;
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const raw = fs.readFileSync(f, "utf8");
  let obj = parse(raw), how = "saglamdi";
  if (!obj) { obj = parse(stripPasted(raw)); how = "onarildi"; }
  if (!obj && fs.existsSync(f + ".bak")) { obj = parse(stripPasted(fs.readFileSync(f + ".bak", "utf8"))); how = "yedekten alindi"; }
  if (!obj) { console.log("ATLANDI (okunamadi): " + f); continue; }
  fs.writeFileSync(f + ".onceki", raw);
  obj.mcpServers = Object.assign({}, obj.mcpServers && typeof obj.mcpServers === "object" ? obj.mcpServers : {}, { eunomia: entry });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
  console.log("TAMAM (" + how + "): " + f);
  done++;
}
console.log(done > 0 ? "\nBitti. Kasa: " + treasury + "\nSimdi Claude'u ac." : "\nHATA: hicbir ayar dosyasi duzeltilemedi.");
