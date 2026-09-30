import { chromium } from "playwright-core";

const URL = "http://localhost:3010/login";
const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(URL, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(800);

const probe = async (label, selector) => {
  const out = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      fontSize: cs.fontSize,
      height: Math.round(r.height),
      width: Math.round(r.width),
      bg: cs.backgroundColor,
      border: cs.borderColor,
      boxShadow: cs.boxShadow,
      borderRadius: cs.borderRadius,
      color: cs.color,
    };
  }, selector);
  console.log(label, JSON.stringify(out));
};

const btn = await page.$(".login-cta");
await probe("panel     ", "main > div");
await probe("rail      ", "main ol");
await probe("field     ", ".login-field");
await probe("input     ", ".login-field input");
await probe("cta       ", ".login-cta");
await probe("cta(cli)  ", ".login-cta");
await probe("h2        ", "main h2");
await probe("desc      ", "main form + p, main p");

// focus state of the field: sample the accent bar + halo before/after blur
if (btn) await page.click("main h2");
await page.waitForTimeout(400);
const restBar = await page.evaluate(() => {
  const el = document.querySelector(".login-field");
  const cs = getComputedStyle(el);
  const bar = getComputedStyle(el, "::before");
  return { border: cs.borderColor, shadow: cs.boxShadow.slice(0, 60), barScale: bar.scale, barOpacity: bar.opacity, barLeft: bar.left };
});
console.log("field@rest", JSON.stringify(restBar));

await page.focus("#login-email");
await page.waitForTimeout(400);
const focusBar = await page.evaluate(() => {
  const el = document.querySelector(".login-field");
  const cs = getComputedStyle(el);
  const bar = getComputedStyle(el, "::before");
  return { border: cs.borderColor, shadow: cs.boxShadow.slice(0, 60), barScale: bar.scale, barOpacity: bar.opacity };
});
console.log("field@focus", JSON.stringify(focusBar));

// marker travel: sample left over the transition
await page.fill("#login-email", "dev@quickwork.local");
await page.waitForTimeout(200);
await page.screenshot({ path: ".qlogin-email-filled.png" });

// CTA hover
await page.hover(".login-cta");
await page.waitForTimeout(300);
const hover = await page.evaluate(() => {
  const el = document.querySelector(".login-cta");
  const cs = getComputedStyle(el);
  return { transform: cs.transform, shadow: cs.boxShadow.slice(0, 50) };
});
console.log("cta@hover", JSON.stringify(hover));

console.log("markerLabel", await page.evaluate(() => {
  const m = document.querySelector(".login-form-marker");
  return m ? getComputedStyle(m).left : null;
}));

await browser.close();
