import { chromium } from "playwright-core";

const BASE = "http://localhost:3010";
const WRONG_FIRST = process.argv.includes("--wrong-first");

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const reqs = [];
page.on("request", (r) => {
  if (r.url().includes("/api/") || r.url().includes("/auth/")) reqs.push("REQ " + r.url().replace(BASE, ""));
});
page.on("response", (r) => {
  if (r.url().includes("/auth/") || r.url().includes("workspace")) reqs.push("RES " + r.status() + " " + r.url().replace(BASE, ""));
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE-ERR", m.text().slice(0, 300));
});
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 300)));

async function fillWhenLive(sel, value, gate) {
  for (let i = 0; i < 60; i++) {
    await page.fill(sel, value);
    if (await page.evaluate((s) => !document.querySelector(s)?.disabled, gate)) return;
    await page.waitForTimeout(500);
  }
  throw new Error("never hydrated");
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
await fillWhenLive("#login-email", "dev@quickwork.local", "button[type=submit]");
await page.click("button[type=submit]");
await page.waitForSelector("text=查看你的邮箱", { timeout: 30000 });
await page.waitForTimeout(400);

if (WRONG_FIRST) {
  await page.keyboard.type("000000");
  await page.waitForTimeout(2000);
  console.log("after wrong:", await page.evaluate(() => document.activeElement?.id));
}

await page.keyboard.type("888888");
await page.waitForTimeout(6000);
console.log("url", page.url());
console.log(reqs.join("\n"));
await browser.close();
