import { chromium } from "playwright-core";

const BASE = "http://localhost:3010";
const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e)));
page.on("response", async (r) => {
  if (r.url().includes("/auth/")) console.log(r.url().split("/auth/")[1], "->", r.status());
});

// Fill until React has hydrated and the controlled input keeps the value.
async function fillWhenLive(sel, value, labelSel) {
  for (let i = 0; i < 60; i++) {
    await page.fill(sel, value);
    const ok = await page.evaluate(
      (s) => !document.querySelector(s)?.disabled,
      labelSel,
    );
    if (ok) return;
    await page.waitForTimeout(500);
  }
  throw new Error("never hydrated");
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
await fillWhenLive("#login-email", "dev@quickwork.local", "button[type=submit]");
await page.click("button[type=submit]");
await page.waitForSelector("text=查看你的邮箱", { timeout: 30000 });
await page.waitForTimeout(500);

const state = () =>
  page.evaluate(() => ({
    active: document.activeElement?.id || document.activeElement?.tagName,
    otp: document.querySelector("#login-code")?.value,
    alert: document.querySelector('[role="alert"]')?.textContent,
  }));

console.log("before type ", JSON.stringify(await state()));
await page.keyboard.type("000000");
await page.waitForTimeout(2000);
console.log("after bad   ", JSON.stringify(await state()));

await page.keyboard.type("888888");
await page.waitForTimeout(4000);
console.log("after good  ", JSON.stringify(await state()), page.url());
await page.screenshot({ path: ".q-debug-after-good.png" });
await browser.close();
