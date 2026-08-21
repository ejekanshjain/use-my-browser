#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const CDP_PORT = 9222;
const SKIP_PROFILES = new Set(["System Profile", "Guest Profile"]);

const BROWSERS = [
  {
    id: "chrome",
    name: "Google Chrome",
    linux: {
      commands: ["google-chrome", "google-chrome-stable", "google-chrome-beta"],
      userData: [".config", "google-chrome"],
    },
    darwin: {
      apps: ["Google Chrome.app"],
      binary: ["Contents", "MacOS", "Google Chrome"],
      userData: ["Library", "Application Support", "Google", "Chrome"],
    },
    win32: {
      exe: ["Google", "Chrome", "Application", "chrome.exe"],
      userData: ["Google", "Chrome", "User Data"],
    },
  },
  {
    id: "chromium",
    name: "Chromium",
    linux: {
      commands: ["chromium", "chromium-browser"],
      userData: [".config", "chromium"],
    },
    darwin: {
      apps: ["Chromium.app"],
      binary: ["Contents", "MacOS", "Chromium"],
      userData: ["Library", "Application Support", "Chromium"],
    },
    win32: {
      exe: ["Chromium", "Application", "chrome.exe"],
      userData: ["Chromium", "User Data"],
    },
  },
  {
    id: "brave",
    name: "Brave",
    linux: {
      commands: ["brave-browser", "brave-browser-stable", "brave"],
      userData: [".config", "BraveSoftware", "Brave-Browser"],
    },
    darwin: {
      apps: ["Brave Browser.app"],
      binary: ["Contents", "MacOS", "Brave Browser"],
      userData: [
        "Library",
        "Application Support",
        "BraveSoftware",
        "Brave-Browser",
      ],
    },
    win32: {
      exe: ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
      userData: ["BraveSoftware", "Brave-Browser", "User Data"],
    },
  },
];

function which(command) {
  try {
    const finder = process.platform === "win32" ? "where" : "which";
    return execFileSync(finder, [command], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .split(/\r?\n/)[0];
  } catch {
    return null;
  }
}

function macosAppRoots() {
  return ["/Applications", path.join(os.homedir(), "Applications")];
}

function resolveExecutable(browser) {
  if (process.platform === "darwin") {
    for (const root of macosAppRoots()) {
      for (const app of browser.darwin.apps) {
        const candidate = path.join(root, app, ...browser.darwin.binary);
        if (existsSync(candidate)) return candidate;
      }
    }
    return null;
  }

  if (process.platform === "win32") {
    const roots = [
      process.env.LOCALAPPDATA,
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
    ].filter(Boolean);
    for (const root of roots) {
      const candidate = path.join(root, ...browser.win32.exe);
      if (existsSync(candidate)) return candidate;
    }
    return which(browser.win32.exe.at(-1));
  }

  for (const command of browser.linux.commands) {
    const found = which(command);
    if (found) return found;
  }
  return null;
}

function linuxConfigHome() {
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
}

function resolveUserDataDir(browser, executable) {
  if (
    process.platform === "linux" &&
    executable &&
    executable.includes("/snap/")
  ) {
    const snapDir = path.join(
      os.homedir(),
      "snap",
      browser.id,
      "common",
      browser.id === "chrome" ? "google-chrome" : browser.id,
    );
    if (existsSync(snapDir)) return snapDir;
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), ...browser.darwin.userData);
  }

  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, ...browser.win32.userData);
  }

  const segments = browser.linux.userData;
  if (segments[0] === ".config") {
    return path.join(linuxConfigHome(), ...segments.slice(1));
  }
  return path.join(os.homedir(), ...segments);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function listProfiles(userDataDir) {
  const names = new Map();
  const localState = readJson(path.join(userDataDir, "Local State"));
  const cache = localState?.profile?.info_cache ?? {};
  for (const [directory, info] of Object.entries(cache)) {
    if (SKIP_PROFILES.has(directory)) continue;
    names.set(
      directory,
      info.name || info.gaia_name || info.user_name || directory,
    );
  }

  if (existsSync(userDataDir)) {
    for (const entry of readdirSync(userDataDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || SKIP_PROFILES.has(entry.name)) continue;
      const preferences = path.join(userDataDir, entry.name, "Preferences");
      if (!existsSync(preferences)) continue;
      if (!names.has(entry.name)) names.set(entry.name, entry.name);
    }
  }

  if (names.size === 0) names.set("Default", "Default");

  return [...names.entries()].map(([directory, name]) => ({ directory, name }));
}

function isRunning(userDataDir) {
  return (
    existsSync(path.join(userDataDir, "SingletonLock")) ||
    existsSync(path.join(userDataDir, "lockfile"))
  );
}

function cdpStatus(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/json/version", timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          try {
            resolve({ available: true, port, info: JSON.parse(body) });
          } catch {
            resolve({ available: false, port });
          }
        });
      },
    );
    req.on("error", () => resolve({ available: false, port }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ available: false, port });
    });
  });
}

const cdp = await cdpStatus(CDP_PORT);
const browsers = [];

for (const browser of BROWSERS) {
  const executable = resolveExecutable(browser);
  if (!executable) continue;

  const userDataDir = resolveUserDataDir(browser, executable);
  const profiles = listProfiles(userDataDir);
  const running = isRunning(userDataDir);

  browsers.push({
    id: browser.id,
    name: browser.name,
    executable,
    userDataDir,
    running,
    profiles,
  });
}

console.log(
  JSON.stringify(
    {
      platform: process.platform,
      cdp,
      browsers,
    },
    null,
    2,
  ),
);
