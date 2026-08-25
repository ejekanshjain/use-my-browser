#!/usr/bin/env node
import { withSession } from "./connect.mjs";

const INTERACTIVE =
  'a[href], button, input, textarea, select, summary, [role="button"], [role="link"], [role="textbox"], [role="checkbox"], [role="radio"], [role="combobox"], [role="menuitem"], [role="tab"], [role="switch"]';

await withSession(async ({ page }) => {
  const [aria, interactive] = await Promise.all([
    page
      .locator("body")
      .ariaSnapshot({ timeout: 5000 })
      .catch(() => null),
    page.evaluate((selector) => {
      const visible = (el) => {
        const style = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          box.width > 0 &&
          box.height > 0
        );
      };

      return [...document.querySelectorAll(selector)]
        .filter(visible)
        .slice(0, 100)
        .map((el) => {
          const name = (
            el.getAttribute("aria-label") ||
            el.getAttribute("placeholder") ||
            el.getAttribute("name") ||
            el.innerText ||
            ""
          )
            .trim()
            .slice(0, 80);
          return {
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") || undefined,
            type: el.getAttribute("type") || undefined,
            name: name || undefined,
            testId: el.getAttribute("data-testid") || undefined,
            href: el.href || undefined,
          };
        });
    }, INTERACTIVE),
  ]);

  const snapshot = {
    url: page.url(),
    title: await page.title(),
    interactive,
  };

  if (aria) {
    snapshot.aria =
      aria.length > 20000 ? `${aria.slice(0, 20000)}\n…truncated` : aria;
  }

  return snapshot;
});
