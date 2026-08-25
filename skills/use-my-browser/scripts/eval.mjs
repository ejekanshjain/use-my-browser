#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { withSession } from "./connect.mjs";

const args = process.argv.slice(2);
const fromStdin = args[0] === "-" || args[0] === "--stdin";
const code = fromStdin
  ? await readFile("/dev/stdin", "utf8")
  : args.join(" ").trim();

if (!code) {
  console.error("usage: node scripts/eval.mjs <js|--stdin>");
  process.exit(1);
}

await withSession(async ({ page }) => {
  return await page.evaluate(async (source) => eval(source), code);
});
