---
name: use-my-browser
description: >
  Connect to the user's installed Chromium browser (Chrome, Chromium, or Brave)
  over CDP with Playwright and drive the real signed-in profile. Use when the
  user says "use my browser", "use my chrome", "use my brave", "open in my
  browser", "drive my browser", "connect to my browser", wants screenshots or
  clicks in their actual system browser, or runs /use-my-browser. Prefer this
  over headless browsers, in-app browsers, and page-fetch tools when they ask
  to use their own browser.
---

# Use my browser

Drive the user's real Chrome, Chromium, or Brave profile through Chrome DevTools Protocol. Playwright attaches with `connectOverCDP`. The launched browser process must stay running; killing it closes the window.

`SKILL_DIR` is the directory that contains this file.

## Session rules

- Do this setup once per session. After CDP is live, skip detection and launch and go straight to task scripts.
- Remember the chosen browser and profile. Do not re-ask.
- Do not use headless browsers, in-app browsers, or fetch tools as a stand-in.
- Do not call `browser.close()` on the user's browser. Disconnecting Playwright is fine. Killing the launched process is not.

## 1. Detect installed browsers

```bash
node "$SKILL_DIR/scripts/detect-browsers.mjs"
```

If `browsers` is empty, tell the user no Chrome, Chromium, or Brave install was found and stop.

If `cdp.available` is true, the debugging browser is already up. Skip to [Connect](#4-connect-and-use).

## 2. Choose browser and profile

- One browser: use it.
- Several browsers: ask which one.
- One profile: use it.
- Several profiles: ask which one. Pass the profile `directory` (for example `Default` or `Profile 1`), not the display name.

## 3. Launch with remote debugging

If the chosen browser's `running` flag is true and CDP is not available, Chromium will refuse a second process on that user-data dir. Ask the user to quit that browser, wait, then launch.

Launch in the background and leave it running:

```bash
"<executable>" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="<userDataDir>" \
  --profile-directory="<profileDirectory>"
```

Quote the executable when the path has spaces, for example `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Wait until `http://127.0.0.1:9222/json/version` responds before connecting.

## 4. Connect and use

Install Playwright once if `$SKILL_DIR/node_modules/playwright-core` is missing:

```bash
npm install --prefix "$SKILL_DIR" playwright-core
```

Write a short task module and run it:

```bash
node "$SKILL_DIR/scripts/run.mjs" /tmp/use-my-browser/task.mjs
```

Task module shape:

```js
export default async function ({ page, context, browser }) {
  await page.goto("https://example.com");
  const text = await page.locator("h1").innerText();
  const shot = `${process.env.SHOT_DIR}/page.png`;
  await page.screenshot({ path: shot });
  return { text, shot };
}
```

`run.mjs` attaches through `scripts/connect.mjs`:

```js
import { chromium } from "playwright-core";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const context = browser.contexts()[0];
if (!context) throw new Error("No browser context found");

const pages = context.pages();
const page = pages.at(-1) ?? (await context.newPage());
page.setDefaultTimeout(60000);
page.setDefaultNavigationTimeout(60000);
```

Reuse the last open tab. Call `context.newPage()` only when there are no pages or the user wants a new tab.

## Operating the page

Work like a Playwright script against the live tab.

- Prefer locators (`getByRole`, `getByText`, `locator`) over raw CSS and over coordinates.
- After click, type, or navigation, confirm with the cheapest check that answers the next question: a locator read, `innerText()`, or one screenshot. Do not dump the full DOM and a screenshot together by default.
- If the tab is already on the target URL, do not `goto` it again. That reloads and can wipe in-progress input.
- Save screenshots under `$TMPDIR/use-my-browser` (the runner sets `SHOT_DIR`). When the user should see a screenshot, embed it:

```md
![screenshot](/tmp/use-my-browser/page.png)
```

- Typical actions: `page.goto`, `click()`, `fill()`, `press()`, `hover()`, `selectOption()`, `innerText()`, `content()`, `evaluate()`, `screenshot()`, `waitForURL`, `waitForSelector`.
- For a local app, reload after code changes when hot reload is not enough, then re-check the page.

If connect fails, re-run detect. If the browser died, launch again. If the user-data dir is locked, ask them to quit the browser first.
