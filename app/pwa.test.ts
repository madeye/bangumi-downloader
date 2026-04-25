import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layoutSrc = readFileSync(
  fileURLToPath(new URL("./layout.tsx", import.meta.url)),
  "utf8"
);
const registerSrc = readFileSync(
  fileURLToPath(new URL("./pwa-register.tsx", import.meta.url)),
  "utf8"
);
const manifestSrc = readFileSync(
  fileURLToPath(new URL("../public/manifest.webmanifest", import.meta.url)),
  "utf8"
);
const swSrc = readFileSync(
  fileURLToPath(new URL("../public/sw.js", import.meta.url)),
  "utf8"
);

describe("PWA metadata", () => {
  it("links the web app manifest from the root layout", () => {
    expect(layoutSrc).toMatch(/manifest:\s*"\/manifest\.webmanifest"/);
    expect(layoutSrc).toMatch(/themeColor:\s*"#0f766e"/);
  });

  it("declares installable standalone manifest fields", () => {
    const manifest = JSON.parse(manifestSrc) as {
      start_url?: string;
      scope?: string;
      display?: string;
      icons?: Array<{ src?: string; purpose?: string }>;
    };

    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons?.some((icon) => icon.purpose === "maskable")).toBe(true);
    expect(manifest.icons?.some((icon) => icon.src === "/icons/icon-192.png")).toBe(true);
  });
});

describe("service worker", () => {
  it("registers the service worker only as browser progressive enhancement", () => {
    expect(registerSrc).toMatch(/serviceWorker/);
    expect(registerSrc).toMatch(/register\("\/sw\.js"\)/);
    expect(registerSrc).toMatch(/process\.env\.NODE_ENV !== "production"/);
  });

  it("keeps API responses out of the offline cache", () => {
    expect(swSrc).toMatch(/pathname\.startsWith\("\/api\/"\)/);
    expect(swSrc).toMatch(/caches\.match\("\/"\)/);
  });
});
