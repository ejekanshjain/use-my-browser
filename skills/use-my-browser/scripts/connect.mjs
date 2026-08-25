import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const TIMEOUT = Number(process.env.UMB_TIMEOUT || 15000);

export function shotDir() {
  const dir = path.join(os.tmpdir(), "use-my-browser");
  mkdirSync(dir, { recursive: true });
  process.env.SHOT_DIR = dir;
  return dir;
}

export async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No browser context found");
  }

  const pages = context.pages();
  const page = pages.at(-1) ?? (await context.newPage());

  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  shotDir();
  return { browser, context, page, timeout: TIMEOUT };
}
