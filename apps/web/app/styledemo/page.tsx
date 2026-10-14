"use client";

// TEMPORARY style preview for the "name your workspace" step. Ten art
// directions over identical content so the choice can be made by looking at
// them. Delete once one is chosen.

const T = "给工作区起个名字。";
const D = "工作区是任务、智能体和项目所在的地方。之后可以邀请同事，或再开一个。";
const L1 = "工作区名称";
const L2 = "URL";
const L3 = "任务前缀";
const CTA = "创建工作区";

/** One field row, styled by the caller. Keeps the ten variants honest: they
 *  differ in form styling, not in what the form asks. */
function Field({
  label,
  hint,
  inputClass,
  style,
}: {
  label: string;
  hint?: string;
  inputClass?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px]">{label}</span>
      <div
        className={inputClass ?? "border px-3 py-2 text-[13px]"}
        style={style}
      >
        {hint}
      </div>
    </div>
  );
}

function Shell({
  label,
  note,
  children,
}: {
  label: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-900">
          {label}
        </p>
        <p className="text-[11px] text-neutral-500">{note}</p>
      </div>
      <div className="overflow-hidden rounded-md ring-1 ring-neutral-200">
        {children}
      </div>
    </section>
  );
}

/* 01 — Signal: the product's own dark canvas, one saturated colour. */
function V1() {
  return (
    <div className="px-10 py-8" style={{ background: "#0F1115", color: "#F2F4F8" }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: "#FFB020" }}>
        QuickWork
      </p>
      <h2 className="mt-4 text-[30px] font-semibold leading-tight tracking-[-0.03em]">{T}</h2>
      <p className="mt-2 max-w-[420px] text-[13px] leading-relaxed" style={{ color: "#98A2B3" }}>{D}</p>
      <div className="mt-6 grid max-w-[420px] grid-cols-2 gap-4">
        <Field label={L1} hint="Acme Inc" inputClass="rounded-md px-3 py-2 text-[13px]" style={{ background: "#1A1D24", border: "1px solid #2A2F3A", color: "#F2F4F8" }} />
        <Field label={L2} hint="localhost:3010/acme" inputClass="rounded-md px-3 py-2 text-[13px]" style={{ background: "#1A1D24", border: "1px solid #2A2F3A", color: "#6B7280" }} />
        <Field label={L3} hint="ACM" inputClass="rounded-md px-3 py-2 text-[13px]" style={{ background: "#1A1D24", border: "1px solid #2A2F3A", color: "#F2F4F8" }} />
      </div>
      <button className="mt-6 rounded-md px-5 py-2.5 text-[13px] font-semibold" style={{ background: "#FFB020", color: "#1A1206" }}>
        {CTA}
      </button>
    </div>
  );
}

/* 02 — Terminal: the form as a shell session. */
function V2() {
  return (
    <div className="px-10 py-8 font-mono" style={{ background: "#05070A", color: "#7CE38B" }}>
      <p className="text-[11px]" style={{ color: "#4B5563" }}>~/quickwork/init</p>
      <h2 className="mt-3 text-[26px] leading-tight" style={{ color: "#E5E7EB" }}>$ {T}</h2>
      <p className="mt-2 max-w-[440px] text-[12px] leading-relaxed" style={{ color: "#4B5563" }}># {D}</p>
      <div className="mt-6 flex max-w-[460px] flex-col gap-3 text-[13px]">
        <p><span style={{ color: "#4B5563" }}>name &gt;</span> Acme Inc<span className="ml-1 animate-pulse">▌</span></p>
        <p><span style={{ color: "#4B5563" }}>slug &gt;</span> acme</p>
        <p><span style={{ color: "#4B5563" }}>prefix &gt;</span> ACM</p>
      </div>
      <button className="mt-6 px-4 py-2 text-[13px]" style={{ border: "1px solid #7CE38B", color: "#7CE38B" }}>
        [ {CTA} ]
      </button>
    </div>
  );
}

/* 03 — Blueprint: a drawing of a workspace, on drafting paper. */
function V3() {
  return (
    <div
      className="px-10 py-8"
      style={{
        background: "#0A1B2E",
        backgroundImage:
          "linear-gradient(#7FD1FF14 1px, transparent 1px), linear-gradient(90deg, #7FD1FF14 1px, transparent 1px)",
        backgroundSize: "22px 22px",
        color: "#E8F4FF",
      }}
    >
      <div className="flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.28em]" style={{ color: "#7FD1FF" }}>
        <span>Workspace / 新建</span>
        <span>图 02</span>
      </div>
      <h2 className="mt-5 text-[28px] font-medium leading-tight tracking-[-0.02em]">{T}</h2>
      <p className="mt-2 max-w-[430px] text-[12px] leading-relaxed" style={{ color: "#8FB8D8" }}>{D}</p>
      <div className="mt-6 grid max-w-[440px] grid-cols-2 gap-4">
        <Field label={L1} hint="Acme Inc" inputClass="px-3 py-2 font-mono text-[12px]" style={{ border: "1px dashed #7FD1FF66", color: "#E8F4FF" }} />
        <Field label={L2} hint="localhost:3010/acme" inputClass="px-3 py-2 font-mono text-[12px]" style={{ border: "1px dashed #7FD1FF66", color: "#8FB8D8" }} />
        <Field label={L3} hint="ACM" inputClass="px-3 py-2 font-mono text-[12px]" style={{ border: "1px dashed #7FD1FF66", color: "#E8F4FF" }} />
      </div>
      <button className="mt-6 px-5 py-2 text-[13px] font-medium" style={{ background: "#7FD1FF", color: "#0A1B2E" }}>
        {CTA}
      </button>
    </div>
  );
}

/* 04 — Letterpress: ink on paper, display type as the layout. */
function V4() {
  return (
    <div className="px-10 py-8" style={{ background: "#F4EFE6", color: "#14110C" }}>
      <div className="flex items-baseline justify-between border-b pb-2 font-mono text-[10px] uppercase tracking-[0.3em]" style={{ borderColor: "#14110C33" }}>
        <span>QuickWork</span>
        <span>No. 01</span>
      </div>
      <h2 className="mt-6 text-[38px] font-black leading-[0.95] tracking-[-0.045em]">{T}</h2>
      <p className="mt-3 max-w-[440px] text-[12px] leading-relaxed" style={{ color: "#4A4238" }}>{D}</p>
      <div className="mt-6 grid max-w-[460px] grid-cols-2 gap-x-6 gap-y-4">
        <Field label={L1} hint="Acme Inc" inputClass="border-b-2 px-0 py-1.5 text-[14px]" style={{ borderColor: "#14110C" }} />
        <Field label={L2} hint="acme" inputClass="border-b px-0 py-1.5 text-[14px]" style={{ borderColor: "#14110C55" }} />
        <Field label={L3} hint="ACM" inputClass="border-b px-0 py-1.5 text-[14px]" style={{ borderColor: "#14110C55" }} />
      </div>
      <button className="mt-7 px-6 py-2.5 text-[13px] font-bold uppercase tracking-[0.14em]" style={{ background: "#14110C", color: "#F4EFE6" }}>
        {CTA}
      </button>
    </div>
  );
}

/* 05 — Swiss: strict grid, one red dot, nothing rounded. */
function V5() {
  return (
    <div className="px-10 py-8" style={{ background: "#FFFFFF", color: "#111111" }}>
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-1 pt-1">
          <span className="block size-2.5" style={{ background: "#E4002B" }} />
        </div>
        <div className="col-span-11">
          <h2 className="text-[26px] font-bold leading-[1.1] tracking-[-0.02em]">{T}</h2>
          <p className="mt-2 max-w-[430px] text-[12px] leading-[1.7] text-neutral-600">{D}</p>
        </div>
        <div className="col-span-1 pt-3 font-mono text-[10px] text-neutral-400">01</div>
        <div className="col-span-5 border-t-2 pt-3" style={{ borderColor: "#111" }}>
          <Field label={L1} hint="Acme Inc" inputClass="border-b px-0 py-2 text-[13px]" style={{ borderColor: "#CCC" }} />
        </div>
        <div className="col-span-1 pt-3 font-mono text-[10px] text-neutral-400">02</div>
        <div className="col-span-5 border-t-2 pt-3" style={{ borderColor: "#111" }}>
          <Field label={L2} hint="localhost:3010/acme" inputClass="border-b px-0 py-2 text-[13px]" style={{ borderColor: "#CCC" }} />
        </div>
        <div className="col-span-1 pt-3 font-mono text-[10px] text-neutral-400">03</div>
        <div className="col-span-5 border-t-2 pt-3" style={{ borderColor: "#111" }}>
          <Field label={L3} hint="ACM" inputClass="border-b px-0 py-2 text-[13px]" style={{ borderColor: "#CCC" }} />
        </div>
        <div className="col-span-6 flex items-end">
          <button className="px-6 py-2.5 text-[12px] font-bold uppercase tracking-[0.1em]" style={{ background: "#E4002B", color: "#FFF" }}>
            {CTA}
          </button>
        </div>
      </div>
    </div>
  );
}

/* 06 — Wireframe: the skeleton, deliberately undressed. */
function V6() {
  return (
    <div className="px-10 py-8" style={{ background: "#FAFAFA", color: "#222" }}>
      <div className="max-w-[460px] border-2 border-dashed p-6" style={{ borderColor: "#BBB" }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400">[ title ]</p>
        <h2 className="mt-2 text-[24px] font-medium leading-tight">{T}</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{D}</p>
        <div className="mt-5 flex flex-col gap-3">
          {[L1, L2, L3].map((l, i) => (
            <div key={l} className="flex items-center gap-3">
              <span className="w-[68px] shrink-0 font-mono text-[10px] uppercase text-neutral-400">{l}</span>
              <span className="flex-1 border border-dashed px-3 py-2 text-[12px] text-neutral-400" style={{ borderColor: "#CFCFCF" }}>
                {["Acme Inc", "localhost:3010/acme", "ACM"][i]}
              </span>
            </div>
          ))}
        </div>
        <button className="mt-5 w-full border-2 border-dashed py-2.5 text-[12px] font-medium" style={{ borderColor: "#888" }}>
          {CTA}
        </button>
        <p className="mt-3 font-mono text-[10px] text-neutral-400">[ primary action ]</p>
      </div>
    </div>
  );
}

/* 07 — Material: soft raised surfaces, the friendly default. */
function V7() {
  return (
    <div className="px-10 py-8" style={{ background: "#F5F6F8", color: "#1F2430" }}>
      <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.01em]">{T}</h2>
      <p className="mt-2 max-w-[430px] text-[13px] leading-relaxed" style={{ color: "#6B7280" }}>{D}</p>
      <div className="mt-6 flex max-w-[440px] flex-col gap-4 rounded-2xl bg-white p-5" style={{ boxShadow: "0 1px 2px rgba(16,24,40,.06), 0 8px 24px rgba(16,24,40,.06)" }}>
        {[L1, L2, L3].map((l, i) => (
          <Field
            key={l}
            label={l}
            hint={["Acme Inc", "localhost:3010/acme", "ACM"][i]}
            inputClass="rounded-xl px-3.5 py-2.5 text-[13px]"
            style={{ background: "#F7F8FA", border: "1px solid #E4E7EC" }}
          />
        ))}
        <button className="mt-1 rounded-xl py-3 text-[13px] font-semibold text-white" style={{ background: "#4F46E5", boxShadow: "0 1px 2px rgba(16,24,40,.1)" }}>
          {CTA}
        </button>
      </div>
    </div>
  );
}

/* 08 — Editorial: a magazine spread, fields as footnotes. */
function V8() {
  return (
    <div className="px-10 py-8" style={{ background: "#FBF9F4", color: "#1A1A1A" }}>
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">第一步 · 命名</p>
      <h2 className="mt-3 text-[40px] font-normal leading-[1.05] tracking-[-0.02em]" style={{ fontFamily: "Georgia, serif" }}>
        {T}
      </h2>
      <div className="mt-5 border-t pt-4" style={{ borderColor: "#1A1A1A22" }}>
        <p className="max-w-[540px] text-[13px] leading-[1.8] text-neutral-700">{D}</p>
      </div>
      <div className="mt-7 grid max-w-[560px] grid-cols-2 gap-x-10 gap-y-6">
        {[L1, L2, L3].map((l, i) => (
          <div key={l} className="flex flex-col gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-neutral-500">{l}</span>
            <span className="border-b pb-1.5 text-[15px]" style={{ borderColor: "#1A1A1A", color: i === 1 ? "#8A8580" : "#1A1A1A" }}>
              {["Acme Inc", "localhost:3010/acme", "ACM"][i]}
            </span>
          </div>
        ))}
      </div>
      <button className="mt-8 border px-6 py-3 text-[12px] uppercase tracking-[0.2em]" style={{ borderColor: "#1A1A1A" }}>
        {CTA} →
      </button>
    </div>
  );
}

/* 09 — Industrial: recessed fields on a metal panel. */
function V9() {
  return (
    <div
      className="px-10 py-8"
      style={{
        background: "linear-gradient(#2A2E33, #1E2226)",
        color: "#D6DBE0",
      }}
    >
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: "#8A9AA8" }}>
        <span className="size-1.5 rounded-full" style={{ background: "#F59E0B" }} />
        workspace / configure
      </div>
      <h2 className="mt-4 text-[26px] font-semibold uppercase leading-tight tracking-[0.01em]">{T}</h2>
      <p className="mt-2 max-w-[430px] text-[12px] leading-relaxed" style={{ color: "#8A9AA8" }}>{D}</p>
      <div className="mt-6 flex max-w-[460px] flex-col gap-3">
        {[L1, L2, L3].map((l, i) => (
          <div key={l} className="flex items-center gap-4">
            <span className="w-[92px] shrink-0 text-right font-mono text-[10px] uppercase tracking-[0.14em]" style={{ color: "#8A9AA8" }}>
              {l}
            </span>
            <span
              className="flex-1 rounded px-3 py-2 font-mono text-[12px]"
              style={{
                background: "#16191C",
                boxShadow: "inset 0 2px 4px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.05)",
                color: i === 1 ? "#6B7681" : "#D6DBE0",
              }}
            >
              {["Acme Inc", "localhost:3010/acme", "ACM"][i]}
            </span>
          </div>
        ))}
      </div>
      <button
        className="mt-6 rounded px-7 py-3 text-[12px] font-bold uppercase tracking-[0.16em]"
        style={{ background: "#F59E0B", color: "#1A1206", boxShadow: "0 2px 0 #8A5A08" }}
      >
        {CTA}
      </button>
    </div>
  );
}

/* 10 — Glass: frosted panels over a deep gradient. */
function V10() {
  return (
    <div
      className="relative px-10 py-8"
      style={{ background: "radial-gradient(120% 120% at 12% 0%, #1B2A6B 0%, #0B0F1E 55%, #07080F 100%)", color: "#EEF1F8" }}
    >
      <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]">{T}</h2>
      <p className="mt-2 max-w-[430px] text-[13px] leading-relaxed" style={{ color: "#A7B0C6" }}>{D}</p>
      <div
        className="mt-6 flex max-w-[440px] flex-col gap-4 rounded-2xl p-5"
        style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", backdropFilter: "blur(12px)" }}
      >
        {[L1, L2, L3].map((l, i) => (
          <Field
            key={l}
            label={l}
            hint={["Acme Inc", "localhost:3010/acme", "ACM"][i]}
            inputClass="rounded-xl px-3.5 py-2.5 text-[13px]"
            style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.14)", color: i === 1 ? "#A7B0C6" : "#EEF1F8" }}
          />
        ))}
        <button
          className="mt-1 rounded-xl py-3 text-[13px] font-semibold"
          style={{ background: "linear-gradient(90deg, #6D8BFF, #A56BFF)", color: "#0B0F1E", boxShadow: "0 6px 24px rgba(109,139,255,.35)" }}
        >
          {CTA}
        </button>
      </div>
    </div>
  );
}

const VARIANTS: Array<[string, string, () => React.ReactElement]> = [
  ["01 · 信号 Signal", "暗底 + 单一琥珀色（产品已有）", V1],
  ["02 · 终端 Terminal", "黑底等宽，表单当命令行", V2],
  ["03 · 蓝图 Blueprint", "深蓝图纸 + 青色虚线标注", V3],
  ["04 · 印刷 Letterpress", "暖纸 + 油墨黑 + 超重标题", V4],
  ["05 · 瑞士 Swiss", "白底严格网格 + 一抹红 + 无圆角", V5],
  ["06 · 线框 Wireframe", "虚线骨架，故意不装饰", V6],
  ["07 · Material", "柔和圆角 + 浅阴影，最熟悉的默认", V7],
  ["08 · 杂志 Editorial", "衬线大标 + 细分隔线 + 脚注式标签", V8],
  ["09 · 工业 Industrial", "金属面板 + 内凹字段 + 厚实质感", V9],
  ["10 · 玻璃 Glass", "深色渐变 + 毛玻璃 + 发光描边", V10],
];

export default function StyleDemoPage() {
  // The root layout pins <body> to h-full overflow-hidden — the product owns
  // its own scroll containers — so a page that just renders a tall column has
  // to bring one. Without this the ten variants overflow invisibly.
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto flex max-w-[900px] flex-col gap-8 p-8">
        {VARIANTS.map(([label, note, Comp]) => (
          <Shell key={label} label={label} note={note}>
            <Comp />
          </Shell>
        ))}
      </div>
    </div>
  );
}
