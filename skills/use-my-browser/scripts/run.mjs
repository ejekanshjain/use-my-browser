#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { connect } from "./connect.mjs";

const taskFile = process.argv[2];
if (!taskFile) {
  console.error("usage: node scripts/run.mjs <task.mjs|--stdin>");
  process.exit(1);
}

const href =
  taskFile === "-" || taskFile === "--stdin"
    ? `data:text/javascript;base64,${Buffer.from(await readFile("/dev/stdin", "utf8")).toString("base64")}`
    : pathToFileURL(resolve(taskFile)).href;

const { browser, context, page } = await connect();
const mod = await import(href);
const run = mod.default ?? mod.run;

if (typeof run !== "function") {
  throw new Error(
    "task module must export default async function ({ page, context, browser })",
  );
}

const result = await run({ page, context, browser });
if (result !== undefined) {
  console.log(
    typeof result === "string" ? result : JSON.stringify(result, null, 2),
  );
}
