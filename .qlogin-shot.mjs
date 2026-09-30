import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.QW_BASE ?? "http://localhost:3010";
const OUT = process.env.QW_OUT ?? "D:/tmp/qw-shots";
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: "msedge" });

for (const [name, width, height] of [
  ["login-desktop", 1512, 950],
  ["login-wide", 1920, 1080],
  ["login-mobile", 430, 900],
]) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", (e.stack ?? e.message).split("\n")[0].slice(0, 200)));
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(11000);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`ok   ${name}  ${width}x${height}`);
  await ctx.close();
}

// Step 2 of the flow: the verification-code surface.
const ctx = await browser.newContext({ viewport: { width: 1512, height: 950 } });
const page = await ctx.newPage();
await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(9000);
await page.fill('input[type="email"]', "dev@quickwork.local").catch(() => {});
await page.press('input[type="email"]', "Enter").catch(() => {});
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/login-step2-code.png` });
console.log("ok   login-step2-code");
await ctx.close();

await browser.close();
console.log("DONE");
