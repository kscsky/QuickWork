import { chromium } from "playwright-core";

const BASE = "http://localhost:3010";
const EMAIL = "dev@quickwork.local";

const browser = await chromium.launch({ channel: "msedge" });

// ------------------------------------------------- reduced motion + mobile --
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForTimeout(900);
  console.log("mobile reduced-motion probe", JSON.stringify(await page.evaluate(() => {
    const q = (s, p) => {
      const el = document.querySelector(s);
      if (!el) return "MISSING";
      const cs = getComputedStyle(el, p);
      return { anim: cs.animationName, transition: cs.transitionProperty, display: cs.display };
    };
    return {
      marker: q(".login-form-marker"),
      ambient: q(".login-form-ambient"),
      field: q(".login-field"),
      busyAfter: q(".login-cta-busy"),
      docScrollW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    };
  })));
  await page.screenshot({ path: ".q-shot-8-mobile.png" });
  console.log("mobile pageerrors", errs);
  await ctx.close();
}

// ---------------------------------------- narrow desktop + full flow again --
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle", timeout: 120000 });
  await page.fill("#login-email", EMAIL);
  await page.click("button:has-text('继续')");
  await page.waitForSelector("text=查看你的邮箱", { timeout: 20000 });

  await page.evaluate(() => {
    window.cd = [];
    window.cd_t = setInterval(() => {
      const el = document.querySelector('main span[aria-hidden="true"] > span');
      if (el) window.cd.push(getComputedStyle(el).transform);
    }, 25);
  });
  await page.waitForTimeout(3500);
  console.log("cooldown drain transforms", JSON.stringify(await page.evaluate(() => {
    clearInterval(window.cd_t);
    const a = window.cd.filter(Boolean);
    return { n: a.length, distinct: new Set(a).size, first: a[0], last: a.at(-1) };
  })));
  await page.waitForTimeout(300);
  await page.screenshot({ path: ".q-shot-9-code-v2.png" });

  // reduced-motion off, but confirm the OTP still works with a wrong code path:
  // exercise the error state
  await page.keyboard.type("000000");
  await page.waitForTimeout(1500);
  console.log("error text", await page.textContent('[role="alert"]').catch(() => "NO ALERT"));
  await page.screenshot({ path: ".q-shot-10-error.png" });
  console.log("otp invalid classes", await page.getAttribute(".login-otp", "class"));

  // then the right code
  await page.keyboard.type("888888");
  await page.waitForFunction(() => !window.location.pathname.startsWith("/login"), null, { timeout: 30000 });
  console.log("final URL", page.url());
  console.log("pageerrors", errs);
  await ctx.close();
}

// ------------------------------------------------------ desktop input size --
{
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login?cli_callback=${encodeURIComponent("http://localhost:9876/callback")}&cli_state=abc`, {
    waitUntil: "networkidle",
    timeout: 120000,
  });
  await page.waitForTimeout(2200);
  await page.screenshot({ path: ".q-shot-11-cli-1024.png" });
  console.log("1024 cli heading", await page.textContent("main h2").catch(() => "none"));
  await ctx.close();
}

await browser.close();
