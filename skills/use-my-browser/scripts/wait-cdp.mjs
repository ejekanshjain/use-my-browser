#!/usr/bin/env node
const CDP_URL = process.env.CDP_URL || "http://127.0.0.1:9222";
const DEADLINE_MS = Number(process.env.UMB_WAIT_CDP || 15000);
const INTERVAL_MS = Number(process.env.UMB_WAIT_CDP_INTERVAL || 150);

const versionUrl = new URL("/json/version", CDP_URL).href;
const deadline = Date.now() + DEADLINE_MS;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

while (Date.now() < deadline) {
  try {
    const response = await fetch(versionUrl, { signal: AbortSignal.timeout(800) });
    if (response.ok) {
      const info = await response.json();
      console.log(JSON.stringify({ ready: true, ...info }));
      process.exit(0);
    }
  } catch {
    // Browser is still starting.
  }
  await sleep(INTERVAL_MS);
}

console.error(JSON.stringify({ ready: false, url: versionUrl, waitedMs: DEADLINE_MS }));
process.exit(1);
