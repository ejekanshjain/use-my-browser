import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const TIMEOUT = Number(process.env.UMB_TIMEOUT || 15000);
const DISCONNECT_MS = Number(process.env.UMB_DISCONNECT_MS || 800);
const EXIT_MS = Number(process.env.UMB_EXIT_MS || 2000);

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

function write(stream, text) {
  return new Promise((resolve) => {
    stream.write(text.endsWith("\n") ? text : `${text}\n`, () => resolve());
  });
}

/**
 * connectOverCDP keeps Node alive until the WebSocket drops.
 * browser.close() on a CDP connection disconnects; it does not quit Chrome.
 * process.exit is the guarantee the agent is not left waiting on a finished task.
 */
export async function disconnect(browser, exitCode = 0) {
  const failsafe = setTimeout(() => process.exit(exitCode), EXIT_MS);
  try {
    if (browser) {
      await Promise.race([
        browser.close(),
        new Promise((resolve) => setTimeout(resolve, DISCONNECT_MS)),
      ]);
    }
  } catch {
    // Exiting anyway.
  }
  clearTimeout(failsafe);
  process.exit(exitCode);
}

export async function withSession(fn) {
  let browser;
  let exitCode = 0;
  try {
    const session = await connect();
    browser = session.browser;
    const result = await fn(session);
    if (result !== undefined) {
      await write(
        process.stdout,
        typeof result === "string" ? result : JSON.stringify(result, null, 2),
      );
    }
  } catch (error) {
    exitCode = 1;
    await write(process.stderr, error?.stack || error?.message || String(error));
  } finally {
    await disconnect(browser, exitCode);
  }
}
