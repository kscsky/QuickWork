import { chromium } from "playwright-core";

const BASE = "http://localhost:3010";
const EMAIL = "dev@quickwork.local";
const CODE = "888888";

const browser = await chromium.launch({ channel: "msedge" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

const start = (selector, prop, opts = {}) =>
  page.evaluate(
    ({ selector, prop, key, pseudo }) => {
      window[key] = [];
      const tick = () => {
        const el = document.querySelector(selector);
        if (el) window[key].push(getComputedStyle(el, pseudo || undefined)[prop]);
      };
      window[key + "_t"] = setInterval(tick, 25);
      tick();
    },
    { selector, prop, key: opts.key ?? "s", pseudo: opts.pseudo },
  );
const stop = (key = "s") =>
  page.evaluate((k) => {
    clearInterval(window[k + "_t"]);
    return window[k];
  }, key);

const distinct = (arr) => {
  const clean = arr.filter((v) => v != null);
  return { n: clean.length, distinct: new Set(clean).size, first: clean[0], last: clean.at(-1) };
};

const delay = (url, ms) =>
  page.route(url, async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });

// ---------------------------------------------------------------- step 1 ---
await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
await page.waitForTimeout(900);
console.log("URL", page.url());
await page.screenshot({ path: ".q-shot-1-email.png" });

// field focus transition: bar + halo, sampled across the transition
await page.click("main h2"); // blur
await page.waitForTimeout(500);
await start(".login-field", "boxShadow", { key: "fld" });
await start(".login-field", "scale", { key: "bar", pseudo: "::before" });
await page.focus("#login-email");
await page.waitForTimeout(600);
const fld = distinct(await stop("fld"));
const bar = distinct(await stop("bar"));
console.log("field focus halo samples", JSON.stringify(fld));
console.log("field accent-bar scale samples", JSON.stringify(bar));
console.log("fld", fld);

// email field validity readout
await page.fill("#login-email", EMAIL);
await page.waitForTimeout(300);
await page.screenshot({ path: ".q-shot-2-typed.png" });

// CTA hover
await page.hover(".login-cta");
await page.waitForTimeout(300);
console.log(
  "cta hover transform",
  await page.evaluate(() => getComputedStyle(document.querySelector(".login-cta")).transform),
);
await page.mouse.move(10, 10);

// marker pulse at rest (idle rail is not a still image)
await start(".login-form-marker", "boxShadow", { key: "mk" });
await page.waitForTimeout(1400);
console.log("marker pulse (idle)", JSON.stringify(distinct(await stop("mk"))));

// ambient wash
await start(".login-form-ambient", "translate", { key: "amb" });
await page.waitForTimeout(4000);
console.log("ambient translate drift", JSON.stringify(distinct(await stop("amb"))));

// ------------------------------------------------- busy CTA + step change ---
await delay("**/auth/send-code", 2200);
await start(".login-cta", "height", { key: "bh" });
await start("main", "backgroundColor", { key: "mc" });
await stop("bh");
await stop("mc");

await page.click("button:has-text('继续')");
await page.waitForTimeout(120);
await page.evaluate(() => {
  window.busy = [];
  window.busy_t = setInterval(() => {
    const el = document.querySelector(".login-cta-busy");
    if (el) window.busy.push(getComputedStyle(el, "::after").transform);
  }, 25);
});
await page.screenshot({ path: ".q-shot-3-busy.png" });
await page.waitForTimeout(900);
console.log("busy sweep transform", JSON.stringify(distinct(await page.evaluate(() => {
  clearInterval(window.busy_t);
  return window.busy;
}))));

await start(".login-form-marker", "left", { key: "mkl" });
await page.waitForSelector("text=查看你的邮箱", { timeout: 20000 });
await page.waitForTimeout(900);
console.log("marker travel on step change", JSON.stringify(distinct(await stop("mkl"))));
console.log("marker final left", await page.evaluate(() => getComputedStyle(document.querySelector(".login-form-marker")).left));

// ---------------------------------------------------------------- step 2 ---
await page.waitForTimeout(600);
await page.screenshot({ path: ".q-shot-4-code.png" });

// resend cooldown draining rule
await start("main .bg-brand", "scaleX", { key: "cd" });
await page.waitForTimeout(3200);
console.log("resend cooldown bar scaleX", JSON.stringify(distinct(await stop("cd"))));

// OTP active cell treatment
await page.waitForTimeout(200);
console.log(
  "otp group / cell widths",
  await page.evaluate(() => {
    const g = document.querySelector(".login-otp");
    const c = document.querySelector(".login-otp-cell");
    const cs = getComputedStyle(c);
    return { cells: g.children.length, w: Math.round(c.getBoundingClientRect().width), h: Math.round(c.getBoundingClientRect().height), radius: cs.borderRadius, font: cs.fontFamily.split(",")[0], fontSize: cs.fontSize };
  }),
);

// --------------------------------------------- completion + verify + e2e ---
await delay("**/auth/verify-code", 2600);
await start(".login-otp", "boxShadow", { key: "otp" });
await start(".login-otp", "transform", { key: "swp", pseudo: "::after" });
await page.keyboard.type(CODE);
await page.waitForTimeout(700);
await page.screenshot({ path: ".q-shot-5-otp-complete.png" });
console.log("otp complete ring", JSON.stringify(distinct(await stop("otp"))));
console.log("otp complete sweep scaleX", JSON.stringify(distinct(await stop("swp"))));

await page.waitForFunction(() => !window.location.pathname.startsWith("/login"), null, { timeout: 30000 });
await page.waitForTimeout(2500);
console.log("after login URL", page.url());
await page.screenshot({ path: ".q-shot-6-after-login.png" });

// ---------------------------------------------------------------- step 3 ---
await page.goto(`${BASE}/login?cli_callback=${encodeURIComponent("http://localhost:9876/callback")}&cli_state=abc`, {
  waitUntil: "networkidle",
  timeout: 120000,
});
await page.waitForTimeout(2500);
console.log("cli step URL", page.url());
console.log("cli step heading", await page.evaluate(() => document.querySelector("main h2")?.textContent));
await page.screenshot({ path: ".q-shot-7-cli.png" });

console.log("pageerrors", errors);
await browser.close();
