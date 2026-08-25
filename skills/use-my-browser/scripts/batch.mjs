#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { withSession } from "./connect.mjs";

function usage() {
  console.error(
    "usage: node scripts/batch.mjs <actions.json|--stdin>  (JSON array of steps)",
  );
  process.exit(1);
}

const arg = process.argv[2];
if (!arg) usage();

const raw =
  arg === "-" || arg === "--stdin"
    ? await readFile("/dev/stdin", "utf8")
    : await readFile(arg, "utf8");

let steps;
try {
  steps = JSON.parse(raw);
} catch (error) {
  throw new Error(`invalid JSON: ${error.message}`);
}

if (!Array.isArray(steps)) {
  throw new Error("batch input must be a JSON array of steps");
}

function urlsMatch(current, target) {
  try {
    const a = new URL(current);
    const b = new URL(target, current);
    return (
      a.origin === b.origin &&
      a.pathname.replace(/\/$/, "") === b.pathname.replace(/\/$/, "")
    );
  } catch {
    return current === target;
  }
}

function locator(page, step) {
  if (step.locator) return page.locator(step.locator);
  if (step.selector) return page.locator(step.selector);
  if (step.testId) return page.getByTestId(step.testId);
  if (step.label) return page.getByLabel(step.label, { exact: step.exact });
  if (step.placeholder) {
    return page.getByPlaceholder(step.placeholder, { exact: step.exact });
  }
  if (step.role) {
    return page.getByRole(step.role, { name: step.name, exact: step.exact });
  }
  if (step.text) return page.getByText(step.text, { exact: step.exact });
  return null;
}

function requireLocator(page, step) {
  const target = locator(page, step);
  if (!target) {
    throw new Error(
      "need locator, selector, testId, label, placeholder, role, or text",
    );
  }
  return target;
}

function timeoutOpt(step, fallback) {
  if (step.timeout != null) return { timeout: Number(step.timeout) };
  if (fallback != null) return { timeout: fallback };
  return undefined;
}

await withSession(async (session) => {
  let { page, context } = session;
  const shots = process.env.SHOT_DIR;
  const results = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step || typeof step !== "object" || !step.op) {
      throw new Error(`step ${i}: missing op`);
    }

    try {
      switch (step.op) {
        case "goto": {
          if (!step.url) throw new Error("url required");
          if (!step.force && urlsMatch(page.url(), step.url)) {
            results.push({ op: "goto", skipped: true, url: page.url() });
            break;
          }
          await page.goto(step.url, {
            waitUntil: step.waitUntil || "domcontentloaded",
            ...timeoutOpt(step),
          });
          results.push({ op: "goto", url: page.url() });
          break;
        }
        case "reload":
          await page.reload({
            waitUntil: step.waitUntil || "domcontentloaded",
            ...timeoutOpt(step),
          });
          break;
        case "newPage": {
          page = await context.newPage();
          session.page = page;
          if (step.url) {
            await page.goto(step.url, {
              waitUntil: step.waitUntil || "domcontentloaded",
              ...timeoutOpt(step),
            });
          }
          results.push({ op: "newPage", url: page.url() });
          break;
        }
        case "click":
          await requireLocator(page, step).click(timeoutOpt(step));
          break;
        case "clickIf": {
          const target = requireLocator(page, step);
          try {
            await target.first().click(timeoutOpt(step, 500));
            results.push({ op: "clickIf", clicked: true });
          } catch {
            results.push({ op: "clickIf", clicked: false });
          }
          break;
        }
        case "fill":
          await requireLocator(page, step).fill(
            String(step.text ?? ""),
            timeoutOpt(step),
          );
          break;
        case "type": {
          const text = String(step.text ?? "");
          const target = locator(page, step);
          if (target) {
            if (step.clear) await target.fill(text, timeoutOpt(step));
            else await target.pressSequentially(text, timeoutOpt(step));
          } else {
            await page.keyboard.type(text);
          }
          break;
        }
        case "press": {
          const key = step.key || "Enter";
          const target = locator(page, step);
          if (target) await target.press(key, timeoutOpt(step));
          else await page.keyboard.press(key);
          break;
        }
        case "scroll": {
          const deltaX = Number(step.deltaX || 0);
          const deltaY = Number(step.deltaY || 0);
          const target = locator(page, step);
          if (target) {
            if (step.intoView) {
              await target.first().scrollIntoViewIfNeeded(timeoutOpt(step));
            } else {
              await target.evaluate(
                (el, delta) => el.scrollBy(delta.x, delta.y),
                { x: deltaX, y: deltaY },
              );
            }
          } else if (step.intoView) {
            throw new Error("intoView needs a locator");
          } else {
            await page.mouse.wheel(deltaX, deltaY);
          }
          break;
        }
        case "check":
          await requireLocator(page, step).check(timeoutOpt(step));
          break;
        case "uncheck":
          await requireLocator(page, step).uncheck(timeoutOpt(step));
          break;
        case "hover":
          await requireLocator(page, step).hover(timeoutOpt(step));
          break;
        case "select": {
          const values = step.values ?? step.value;
          await requireLocator(page, step).selectOption(
            values,
            timeoutOpt(step),
          );
          break;
        }
        case "wait": {
          const opt = timeoutOpt(step);
          const waits = [];
          if (step.url) waits.push(page.waitForURL(step.url, opt));
          if (step.urlIncludes) {
            waits.push(
              page.waitForURL(
                (href) => String(href).includes(step.urlIncludes),
                opt,
              ),
            );
          }
          if (step.text) {
            waits.push(
              page.getByText(step.text, { exact: step.exact }).waitFor(opt),
            );
          }
          if (step.load) waits.push(page.waitForLoadState(step.load, opt));
          if (step.fn) waits.push(page.waitForFunction(step.fn, undefined, opt));
          const target = locator(page, step);
          if (target) waits.push(target.waitFor(opt));
          if (waits.length === 0) {
            throw new Error(
              "need url, urlIncludes, text, load, fn, or a locator",
            );
          }
          await Promise.all(waits);
          break;
        }
        case "eval": {
          if (!step.js) throw new Error("js required");
          const value = await page.evaluate(async (source) => eval(source), step.js);
          results.push({ op: "eval", value });
          break;
        }
        case "screenshot": {
          const name = step.name || `shot-${i}.png`;
          const file = path.join(shots, name);
          const target = locator(page, step);
          if (target && step.intoView !== false) {
            await target.first().scrollIntoViewIfNeeded().catch(() => {});
          }
          if (target && step.element) {
            await target.first().screenshot({ path: file });
          } else {
            await page.screenshot({
              path: file,
              fullPage: Boolean(step.fullPage),
            });
          }
          results.push({ op: "screenshot", path: file });
          break;
        }
        default:
          throw new Error(`unknown op "${step.op}"`);
      }
    } catch (error) {
      error.message = `step ${i} ${step.op}: ${error.message}`;
      throw error;
    }
  }

  return {
    url: page.url(),
    title: await page.title(),
    results,
  };
});
