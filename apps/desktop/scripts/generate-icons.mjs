#!/usr/bin/env node
// Regenerates every launcher icon from one source-of-truth SVG below:
// the Windows .ico, the macOS .icns, the Linux hicolor set, the window
// icon in resources/, and the web favicon/PWA icons. Run it whenever the
// brand mark changes; nothing else in the repo may hand-edit those files.
//
//   node scripts/generate-icons.mjs
//
// The mark is Retro Neko: a black cat with cat-eye green eyes, a red collar
// and the QuickWork star tag on a teal late-90s sunset. It is drawn here as
// SVG so every target size is rendered natively (not downscaled) through the
// Playwright browser already installed for e2e. The maskable variant is
// full-bleed and scales the cat into Android's safe zone.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const repoRoot = resolve(desktopRoot, "..", "..");

/** The mark: late-90s teal sunset, black cat, green eyes, red collar, star tag. */
function markSvg({ rounded = true, bleed = false } = {}) {
  const radius = rounded ? 112 : 0;
  // Maskable icons get a full-bleed background and the cat scaled into the
  // central safe zone so Android's launcher crop cannot clip its ears/star.
  const scale = bleed ? 0.82 : 1;
  const innerStroke = rounded
    ? `<rect x="3" y="3" width="506" height="506" rx="110" fill="none" stroke="#fff" stroke-opacity="0.12" stroke-width="2"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <clipPath id="tile"><rect width="512" height="512" rx="${radius}"/></clipPath>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0f9c93"/>
      <stop offset="0.6" stop-color="#0b6f78"/>
      <stop offset="1" stop-color="#123448"/>
    </linearGradient>
    <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd36b"/>
      <stop offset="0.5" stop-color="#ff8a5c"/>
      <stop offset="1" stop-color="#ff4d8d"/>
    </linearGradient>
    <linearGradient id="cat" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#20232e"/>
      <stop offset="1" stop-color="#0c0e15"/>
    </linearGradient>
    <clipPath id="sunclip"><circle cx="256" cy="250" r="150"/></clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <circle cx="256" cy="250" r="150" fill="url(#sun)"/>
    <g clip-path="url(#sunclip)" fill="#0b6f78">
      <rect x="90" y="220" width="332" height="10"/>
      <rect x="90" y="248" width="332" height="14"/>
      <rect x="90" y="282" width="332" height="18"/>
      <rect x="90" y="320" width="332" height="22"/>
      <rect x="90" y="362" width="332" height="26"/>
    </g>
    <circle cx="256" cy="250" r="150" fill="none" stroke="#ffd36b" stroke-width="6" opacity="0.65"/>

    <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
      <path d="M72 126 C120 84 184 74 226 94 C176 104 136 144 128 196 C104 184 84 158 72 126 Z" fill="#ffe9b8" opacity="0.85"/>
      <path d="M118 294 L142 138 L222 196 C244 186 268 186 290 196 L370 138 L394 294 C404 374 342 424 256 424 C170 424 108 374 118 294 Z" fill="url(#cat)" stroke="#05070c" stroke-width="10" stroke-linejoin="round"/>
      <path d="M142 138 L156 222 L204 194 Z" fill="#ff8a95"/>
      <path d="M370 138 L356 222 L308 194 Z" fill="#ff8a95"/>
      <path d="M150 258 C190 226 222 224 250 252 C220 284 182 284 150 258 Z" fill="#b9ff6b"/>
      <path d="M362 258 C322 226 290 224 262 252 C292 284 330 284 362 258 Z" fill="#b9ff6b"/>
      <path d="M176 258 C196 242 216 242 230 256 C214 270 192 270 176 258 Z" fill="#0c0e15"/>
      <path d="M336 258 C316 242 296 242 282 256 C298 270 320 270 336 258 Z" fill="#0c0e15"/>
      <circle cx="190" cy="248" r="7" fill="#fff"/>
      <circle cx="322" cy="248" r="7" fill="#fff"/>
      <path d="M246 300 L256 310 L266 300 Z" fill="#ff8a95"/>
      <path d="M256 310 L256 324" stroke="#ff8a95" stroke-width="4" stroke-linecap="round"/>
      <path d="M232 324 Q244 338 256 324 Q268 338 280 324" fill="none" stroke="#ff8a95" stroke-width="5" stroke-linecap="round"/>
      <g stroke="#d8d2c4" stroke-width="5" stroke-linecap="round" opacity="0.8">
        <path d="M112 300 L58 286"/><path d="M110 320 L54 326"/>
        <path d="M400 300 L454 286"/><path d="M402 320 L458 326"/>
      </g>
      <path d="M150 384 C198 406 314 406 362 384 L374 420 C316 448 196 448 138 420 Z" fill="#e23b4a" stroke="#05070c" stroke-width="8"/>
      <g transform="translate(256 424) scale(0.3)">
        <path d="M0 -100 L22 -36 L90 -90 L36 -22 L100 0 L36 22 L90 90 L22 36 L0 100 L-22 36 L-90 90 L-36 22 L-100 0 L-36 -22 L-90 -90 L-22 -36 Z" fill="#ffd36b" stroke="#05070c" stroke-width="14"/>
      </g>
    </g>

    <g stroke="#ffffff" stroke-opacity="0.05" stroke-width="2">
      <path d="M0 40 H512"/><path d="M0 72 H512"/><path d="M0 104 H512"/>
      <path d="M0 440 H512"/><path d="M0 472 H512"/>
    </g>
    <rect x="0" y="0" width="512" height="18" fill="#06222b" opacity="0.45"/>
    <rect x="0" y="494" width="512" height="18" fill="#06222b" opacity="0.45"/>
  </g>
  ${innerStroke}
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
