import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const layoutSrc = readFileSync(
  fileURLToPath(new URL("./layout.tsx", import.meta.url)),
  "utf8"
);
const cssSrc = readFileSync(
  fileURLToPath(new URL("./globals.css", import.meta.url)),
  "utf8"
);

function mobileBlock(): string {
  const match = cssSrc.match(/@media \(max-width: 640px\) \{([\s\S]*?)\n\}\s*(?:\/\*|\.progress-bar|$)/);
  if (!match) throw new Error("mobile @media block not found");
  return match[1];
}

describe("viewport export", () => {
  it("declares device-width and initial-scale for mobile", () => {
    expect(layoutSrc).toMatch(/export const viewport\s*:\s*Viewport/);
    expect(layoutSrc).toMatch(/width:\s*"device-width"/);
    expect(layoutSrc).toMatch(/initialScale:\s*1/);
  });

  it("opts into viewport-fit cover for notched devices", () => {
    expect(layoutSrc).toMatch(/viewportFit:\s*"cover"/);
  });
});

describe("mobile CSS (max-width: 640px)", () => {
  it("prevents iOS zoom on search input with 16px font", () => {
    expect(cssSrc).toMatch(/\.search-row input[\s\S]*?font-size:\s*16px/);
  });

  it("pins the batch action bar to the bottom on small screens", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.batch-bar\s*\{[\s\S]*?position:\s*sticky/);
    expect(block).toMatch(/\.batch-bar\s*\{[\s\S]*?bottom:\s*env\(safe-area-inset-bottom/);
  });

  it("gives primary controls a finger-sized tap target", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.search-row button\s*\{[\s\S]*?min-height:\s*48px/);
    expect(block).toMatch(/\.batch-bar button\s*\{[\s\S]*?min-height:\s*40px/);
    expect(block).toMatch(/\.row-actions a\s*\{[\s\S]*?min-height:\s*40px/);
  });

  it("lets row actions span full width so they don't crowd the title", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.row-actions\s*\{[\s\S]*?width:\s*100%/);
    expect(block).toMatch(/\.row-actions a\s*\{[\s\S]*?flex:\s*1/);
  });

  it("shrinks the hero heading so it fits a phone viewport", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.hero-copy h1\s*\{[\s\S]*?font-size:\s*clamp\(1\.6rem/);
  });

  it("stacks the search input and button vertically", () => {
    const block = mobileBlock();
    expect(block).toMatch(/\.search-row\s*\{[\s\S]*?flex-direction:\s*column/);
  });

  it("respects iOS safe-area insets around the page shell", () => {
    const block = mobileBlock();
    expect(block).toMatch(/env\(safe-area-inset-left/);
    expect(block).toMatch(/env\(safe-area-inset-right/);
    expect(block).toMatch(/env\(safe-area-inset-bottom/);
  });
});
