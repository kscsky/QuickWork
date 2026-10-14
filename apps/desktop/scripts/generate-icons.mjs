#!/usr/bin/env node
// Regenerates every launcher icon from one source-of-truth SVG below:
// the Windows .ico, the macOS .icns, the Linux hicolor set, the window
// icon in resources/, and the web favicon/PWA icons. Run it whenever the
// brand mark changes; nothing else in the repo may hand-edit those files.
//
//   node scripts/generate-icons.mjs
//
// The mark is this product's own unit — a machine seat with its status lamp,
// in the blueprint palette (navy ink #1f344c = --primary, brand blue
// #1c63b0 = --brand, in-flight amber #c96a00 = --inflight; the same hexes
// resolve from tokens.css). Rendering goes through the Playwright browser
// already installed for e2e, at each target size directly so every icon is
// native-resolution rather than a downscale of one bitmap.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");

const INK = "#1f344c";
const BRAND = "#1c63b0";
const LAMP = "#c96a00";

/** The mark: navy tile, machine-hue band, the white seat, its lamp. */
function markSvg({ rounded = true, bleed = false } = {}) {
  const radius = rounded ? 22 : 0;
  // Maskable/favicon variants need the seat inside the safe zone: scale it
  // toward the centre instead of touching the tile edges.
  const seat = bleed
    ? { x: 26, y: 32, w: 48, h: 41, r: 6 }
    : { x: 24, y: 32, w: 52, h: 44, r: 7 };
  // The lamp half-overlaps the seat's corner (like the avatar presence dot).
  // Sizing it to 24/100 is what keeps it legible at 16 px — the whole point
  // of the mark is "a seat with its status lamp", so the lamp must survive
  // the taskbar size.
  const lampCx = seat.x + seat.w - (bleed ? 11 : 12);
  const lampCy = seat.y + seat.h + (bleed ? 3 : 4);
  const lampSize = bleed ? 22 : 24;
  const ringSize = lampSize + 6;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <defs>
    <linearGradient id="band" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${BRAND}"/>
      <stop offset="0.62" stop-color="${BRAND}" stop-opacity="0.25"/>
      <stop offset="1" stop-color="${BRAND}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="tile"><rect width="100" height="100" rx="${radius}"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="100" height="100" fill="${INK}"/>
    <rect width="100" height="9" fill="url(#band)"/>
    <rect x="${seat.x}" y="${seat.y}" width="${seat.w}" height="${seat.h}" rx="${seat.r}" fill="#ffffff"/>
    <rect x="${lampCx - ringSize / 2}" y="${lampCy - ringSize / 2}" width="${ringSize}" height="${ringSize}" rx="${ringSize / 3}" fill="${INK}"/>
    <rect x="${lampCx - lampSize / 2}" y="${lampCy - lampSize / 2}" width="${lampSize}" height="${lampSize}" rx="${lampSize / 4}" fill="${LAMP}"/>
  </g>
</svg>`;
}

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

async function renderPngs(browser, svg, sizes) {
  const page = await browser.newPage();
  const out = new Map();
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">` +
        `<div style="width:${size}px;height:${size}px">` +
        svg.replace("<svg ", `<svg width="${size}" height="${size}" `) +
        `</div></body></html>`,
    );
    out.set(size, await page.screenshot({ omitBackground: true }));
  }
  await page.close();
  return out;
}

/** ICO container: PNG-compressed entries are accepted by Windows Vista+. */
function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(entries.length * 16);
  let offset = 6 + dir.length;
  const payloads = [];
  entries.forEach(([size, png], i) => {
    const at = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, at);
    dir.writeUInt8(size >= 256 ? 0 : size, at + 1);
    dir.writeUInt8(0, at + 2);
    dir.writeUInt8(0, at + 3);
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(png.length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += png.length;
    payloads.push(png);
  });
  return Buffer.concat([header, dir, ...payloads]);
}

/**
 * ICNS container. All entries are PNG payloads, which every macOS since
 * 10.7 reads; the `ic07..ic14` types just declare the pixel size.
 */
function buildIcns(entries) {
  const chunks = entries.map(([type, png]) => {
    const head = Buffer.alloc(8);
    head.write(type, 0, 4, "ascii");
    head.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

const browser = await chromium.launch({ channel: "msedge" });
const tile = markSvg();
const bleed = markSvg({ rounded: false, bleed: true });
const pngs = await renderPngs(browser, tile, PNG_SIZES);
const bleedPngs = await renderPngs(browser, bleed, [512]);
await browser.close();

// Windows: build/icon.ico (installer, .exe resources, taskbar)
writeFileSync(
  resolve(desktopRoot, "build/icon.ico"),
  buildIco(
    [16, 24, 32, 48, 64, 128, 256].map((s) => [s, pngs.get(s)]),
  ),
);

// macOS: build/icon.icns
writeFileSync(
  resolve(desktopRoot, "build/icon.icns"),
  buildIcns([
    ["ic11", pngs.get(32)],
    ["ic12", pngs.get(64)],
    ["ic07", pngs.get(128)],
    ["ic13", pngs.get(256)],
    ["ic08", pngs.get(256)],
    ["ic14", pngs.get(512)],
    ["ic09", pngs.get(512)],
    ["ic10", pngs.get(1024)],
  ]),
);

// electron-builder's mac/other conversions read build/icon.png
writeFileSync(resolve(desktopRoot, "build/icon.png"), pngs.get(1024));

// Linux hicolor set (pre-rendered — electron-builder's auto-generation
// silently shipped only the 1024 source once; see electron-builder.yml)
mkdirSync(resolve(desktopRoot, "build/icons"), { recursive: true });
for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
  writeFileSync(
    resolve(desktopRoot, `build/icons/${size}x${size}.png`),
    pngs.get(size),
  );
}

// Window icon (Linux BrowserWindow + fallback); see BUNDLED_ICON_PATH
writeFileSync(resolve(desktopRoot, "resources/icon.png"), pngs.get(512));

// Web: favicon + PWA icons share the SVG source and the rendered sizes
const webPublic = resolve(repoRoot, "apps/web/public");
writeFileSync(resolve(webPublic, "favicon.svg"), tile + "\n");
mkdirSync(resolve(webPublic, "icons"), { recursive: true });
writeFileSync(resolve(webPublic, "icons/icon.svg"), tile + "\n");
writeFileSync(resolve(webPublic, "icons/icon-192.png"), pngs.get(192));
writeFileSync(resolve(webPublic, "icons/icon-512.png"), pngs.get(512));
writeFileSync(
  resolve(webPublic, "icons/icon-maskable-512.png"),
  bleedPngs.get(512),
);
writeFileSync(
  resolve(webPublic, "icons/apple-touch-icon.png"),
  pngs.get(180),
);

console.log("[icons] wrote ico/icns/png sets from the inline mark");
