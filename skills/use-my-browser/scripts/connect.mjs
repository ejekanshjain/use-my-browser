import { chromium } from "playwright-core";

const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";

export async function connect() {
  const browser = await chromium.connectOverCDP(CDP_URL);
  const context = browser.contexts()[0];

  if (!context) {
    throw new Error("No browser context found");
  }

  const pages = context.pages();
  const page = pages.at(-1) ?? (await context.newPage());

  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(60000);

  return { browser, context, page };
}
