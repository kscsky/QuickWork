import { chromium } from "playwright-core";

const URL = process.env.QLOGIN_URL ?? "http://localhost:3010/login";
const OUT = process.env.QLOGIN_OUT ?? ".qlogin-before.png";
const WIDTH = Number(process.env.QLOGIN_W ?? 1440);

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: WIDTH, height: 900 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: OUT });
console.log("shot ->", OUT);
if (errors.length) console.log("console errors:\n" + errors.join("\n"));
await browser.close();
