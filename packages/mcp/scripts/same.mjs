// Are two files byte-for-byte the same? The vendored copies in this repo (contract bindings,
// the exception codec) are kept honest by this check.
//
//   node scripts/same.mjs <source> <copy>           exit 1 when they differ
//   node scripts/same.mjs --write <source> <copy>   overwrite the copy with the source
//
// It replaces `cmp` and `cp` in the package scripts. npm runs scripts under cmd.exe on
// Windows, where neither exists — so `npm publish` died in prepublishOnly with "'cmp' is not
// recognized" on the one machine that publishes. CI keeps calling `cmp` directly; it runs on
// Linux and needs no help.
import { copyFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const write = args[0] === "--write";
const [source, copy] = write ? args.slice(1) : args;

if (!source || !copy) {
  console.error("usage: node same.mjs [--write] <source> <copy>");
  process.exit(2);
}

if (write) {
  copyFileSync(source, copy);
  console.log(`${copy} <- ${source}`);
} else if (!readFileSync(source).equals(readFileSync(copy))) {
  console.error(`${copy} has drifted from ${source}. Re-sync it, then run this again.`);
  process.exit(1);
}
