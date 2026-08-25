---
name: use-my-browser
description: >
  Connect to the user's installed Chromium browser (Chrome, Chromium, or Brave)
  over CDP with Playwright and drive the real signed-in profile. Use when the
  user says "use my browser", "use my chrome", "use my brave", "open in my
  browser", "drive my browser", "connect to my browser", wants screenshots or
  clicks in their actual system browser, or runs /use-my-browser. Prefer this
  over headless browsers, in-app browsers, and page-fetch tools when they ask
  to use their own browser. Batch known multi-step flows into one script so
  the live browser stays fast.
---

# Use my browser

Drive the user's real Chrome, Chromium, or Brave profile through Chrome DevTools Protocol. Playwright attaches with `connectOverCDP`. The launched browser process must stay running; killing it closes the window.

`SKILL_DIR` is the directory that contains this file.

The expensive part is not Playwright. It is an LLM turn per action: write a tiny script, reconnect CDP, click once, screenshot, think, repeat. Fast agents collapse a known flow into **one** process.

## Speed

Pick a mode, then run it. T3 Code's preview browser is fast when the agent uses `preview_evaluate` for a known page, `preview_wait_for` after a change, and `preview_snapshot` only to discover controls. Do the same here.

**Known page, JS can do it** (native inputs, extract a table, click in-DOM controls): one `eval.mjs`. One expression, mutate + return.

**Known flow that needs Playwright events** (login, wizard, file upload, React fills): one `batch.mjs` or one `run.mjs`. Do not inspect between those steps. After a click that changes the page, `wait` (locator + text + url together), not another inspect.

**Unknown page**: `inspect.mjs` once. Then eval or batch the rest. Do not pair inspect with a screenshot every time.

Stop doing these:

- One click, fill, or screenshot per `run.mjs` invocation
- Screenshot or full DOM dump after every action
- `goto` when the tab is already on that URL
- `waitForTimeout` / sleep loops
- Re-detecting browsers after CDP is live

Confirm with the cheapest signal that answers the next question: `page.url()`, a locator `innerText()`, `waitForURL`, or one `eval`. Screenshot once at the end if the user needs to see the page, or if the check is visual.

Keep fills sequential in that one script so focus does not race. Parallelize independent reads with `Promise.all`. Arm `waitForURL` (or a locator wait) before the click that navigates. Keep order when a step depends on the previous one (click opens a modal, then fill the modal). After a submit, wait for a URL, text, or locator — not a screenshot.

Default action timeout is 15s (`UMB_TIMEOUT` to override). `goto` uses `domcontentloaded` unless you need `load`.

## Session rules

- Setup once per session. After CDP is live, skip detection and launch.
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

Reuse the last open tab. Call `context.newPage()` only when there are no pages or the user wants a new tab.

### Inspect

```bash
node "$SKILL_DIR/scripts/inspect.mjs"
```

Returns `url`, `title`, visible interactive controls, and an aria snapshot. Use this instead of a screenshot when you need to discover controls.

### Batch known steps

```bash
node "$SKILL_DIR/scripts/batch.mjs" /tmp/use-my-browser/actions.json
# or
node "$SKILL_DIR/scripts/batch.mjs" --stdin
```

JSON array. Each step has `op` plus a target. Prefer Playwright locator strings: `role=button[name='Send']`, `text=Continue`, `role=textbox[name='Email']`. You can also pass `role`+`name`, `label`, `placeholder`, `text`, `testId`, or `selector`.

```json
[
  {"op": "goto", "url": "https://example.com/login"},
  {"op": "fill", "locator": "role=textbox[name='Email']", "text": "user@example.com"},
  {"op": "fill", "locator": "role=textbox[name='Password']", "text": "secret"},
  {"op": "click", "locator": "role=button[name='Sign in']"},
  {"op": "wait", "url": "**/dashboard", "text": "Dashboard"},
  {"op": "eval", "js": "({ href: location.href, heading: document.querySelector('h1')?.innerText })"}
]
```

Ops: `goto`, `reload`, `newPage`, `click`, `fill`, `type`, `press`, `scroll`, `check`, `uncheck`, `hover`, `select`, `wait`, `eval`, `screenshot`.

`goto` skips when the tab is already on that URL (`force: true` to reload). `wait` ANDs every condition you pass (`url`, `urlIncludes`, `text`, `load`, `fn`, locator). `type` can omit a target (types into focus) or set `clear: true`. `scroll` takes `deltaX` / `deltaY`. `select` takes `value` or `values`.

### Eval

```bash
node "$SKILL_DIR/scripts/eval.mjs" 'document.title'
node "$SKILL_DIR/scripts/eval.mjs" --stdin
```

Runs in the page. Return one serializable value. Wrap object literals: `(() => ({ href: location.href, items: [...] }))()`. When the flow is known, put the whole mutation + read in that one expression:

```js
(() => {
  const set = (selector, value) => {
    const el = document.querySelector(selector);
    if (!el) throw new Error(selector);
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  set("#email", "user@example.com");
  set("#password", "secret");
  document.querySelector("button[type=submit]")?.click();
  return { href: location.href };
})()
```

Use Playwright `fill` / `batch.mjs` instead when the inputs are React-controlled or need real pointer events.

### Task module (branching / Playwright-only APIs)

```bash
node "$SKILL_DIR/scripts/run.mjs" /tmp/use-my-browser/task.mjs
node "$SKILL_DIR/scripts/run.mjs" --stdin
```

```js
export default async function ({ page, context, browser }) {
  await page.goto("https://example.com/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill("user@example.com");
  await page.getByLabel("Password").fill("secret");
  await Promise.all([
    page.waitForURL("**/dashboard"),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  return {
    url: page.url(),
    heading: await page.getByRole("heading").first().innerText(),
  };
}
```

`run.mjs` attaches through `scripts/connect.mjs` (`http://127.0.0.1:9222`, last tab, 15s timeouts). Save screenshots under `$TMPDIR/use-my-browser` (`SHOT_DIR`). When the user should see one, embed it:

```md
![screenshot](/tmp/use-my-browser/page.png)
```

## Operating the page

Prefer locators (`getByRole`, `getByLabel`, `getByText`, `getByPlaceholder`, `getByTestId`) over raw CSS and over coordinates.

Typical Playwright: `goto`, `click`, `fill`, `press`, `hover`, `selectOption`, `innerText`, `evaluate`, `screenshot`, `waitForURL`, `waitForSelector`, `waitForLoadState`.

For a local app, reload after code changes when hot reload is not enough, then re-check with inspect or a cheap eval — not a new navigation.

If connect fails, re-run detect. If the browser died, launch again. If the user-data dir is locked, ask them to quit the browser first.
