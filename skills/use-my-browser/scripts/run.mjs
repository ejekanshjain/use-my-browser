#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { connect } from "./connect.mjs";

const taskFile = process.argv[2];
if (!taskFile) {
  console.error("usage: node scripts/run.mjs <task.mjs>");
  process.exit(1);
}

const shotDir = path.join(os.tmpdir(), "use-my-browser");
mkdirSync(shotDir, { recursive: true });
process.env.SHOT_DIR = shotDir;

const { browser, context, page } = await connect();
const mod = await import(pathToFileURL(path.resolve(taskFile)).href);
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
