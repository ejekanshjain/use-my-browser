# use-my-browser

Agent skill that connects Grok, Claude Code, Codex, Cursor, and other SKILL.md-compatible agents to **your real Chrome, Chromium, or Brave profile** over Chrome DevTools Protocol.

The agent launches the browser with remote debugging, attaches with Playwright (`connectOverCDP`), and then clicks, types, inspects, reads text, and takes screenshots in the live window. Your signed-in sessions stay intact. Known multi-step flows run in one batched script so the agent is not doing one click per turn. Driver scripts print a result, disconnect from CDP, and exit; only the launched browser stays running.

## Install

```bash
npx skills add ejekanshjain/use-my-browser -g
```

That copies `skills/use-my-browser` into the agent skills directory (`~/.agents/skills`, `~/.claude/skills`, or similar).

### Grok

```bash
git clone https://github.com/ejekanshjain/use-my-browser.git
cp -R use-my-browser/skills/use-my-browser ~/.grok/skills/use-my-browser
```

Or point Grok at this repo with `[skills].paths` in `~/.grok/config.toml`.

### Manual copy

```bash
cp -R skills/use-my-browser ~/.agents/skills/use-my-browser
# or ~/.claude/skills/use-my-browser
# or ~/.grok/skills/use-my-browser
```

## Usage

Say **use my browser**, **use my chrome**, **use my brave**, or run `/use-my-browser`.

The skill will:

1. Detect installed Chromium browsers and their profiles.
2. Ask which browser if more than one is installed.
3. Ask which profile if more than one exists.
4. Launch that browser with `--remote-debugging-port=9222` against the real user-data dir, and leave the process running.
5. Attach Playwright and drive the current tab.

Killing the launched process closes the browser window.

## Requirements

- Node.js
- Google Chrome, Chromium, or Brave
- `playwright-core` (the skill installs it into the skill directory on first use)

No Playwright browser download is needed. It talks to the browser you already have.

## How it works

```text
skills/use-my-browser/
  SKILL.md                 # agent instructions
  scripts/detect-browsers.mjs
  scripts/wait-cdp.mjs     # poll until 127.0.0.1:9222 answers
  scripts/connect.mjs      # chromium.connectOverCDP('http://127.0.0.1:9222')
  scripts/inspect.mjs      # cheap page inventory (url, controls, aria)
  scripts/eval.mjs         # run JavaScript in the live tab
  scripts/batch.mjs        # many actions in one CDP session
  scripts/run.mjs          # Playwright task module against the live tab
```

Detect finds executables and profiles on Linux, macOS, and Windows. Launch looks like this:

```bash
"/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/Library/Application Support/BraveSoftware/Brave-Browser" \
  --profile-directory="Profile 1"
```

If that browser is already open without debugging, Chromium will refuse a second process on the same profile. Quit it first, then launch with the flags above.

After launch, wait with `node scripts/wait-cdp.mjs` instead of a shell sleep loop. Playwright's CDP client keeps Node alive until it disconnects, so every driver script disconnects and `process.exit`s after printing — otherwise the agent waits on a finished task.

When the steps are already known, run them together:

```json
[
  {"op": "goto", "url": "https://example.com/login"},
  {"op": "clickIf", "role": "button", "name": "Accept all"},
  {"op": "fill", "label": "Email", "text": "user@example.com"},
  {"op": "fill", "label": "Password", "text": "secret"},
  {"op": "click", "role": "button", "name": "Sign in"},
  {"op": "wait", "url": "**/dashboard"}
]
```

```bash
node scripts/batch.mjs /tmp/use-my-browser/actions.json
node scripts/inspect.mjs
node scripts/eval.mjs 'document.title'
```

Task modules are for branching or Playwright-only APIs:

```js
export default async function ({ page }) {
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  const text = await page.locator('h1').innerText()
  return { text, url: page.url() }
}
```

```bash
node scripts/run.mjs /tmp/use-my-browser/task.mjs
```

## Security

Remote debugging is bound to `127.0.0.1:9222`. Anything on your machine that can reach that port can control the browser, including cookies and logged-in sessions.

Do not expose port 9222. Do not pass `--remote-debugging-address=0.0.0.0`.

## License

MIT
