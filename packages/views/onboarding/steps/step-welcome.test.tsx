import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { StepWelcome } from "./step-welcome";

// The welcome illustration used to be five mock activity cards whose status
// labels came from `STATUS_CONFIG.label` — the server's English seed — while
// every other string on the screen went through `useT` (MUL-6850). A
// non-English member met the product on a line that read half in each language.
//
// The illustration is now the signal, and its labels are short product-y nouns
// — zone names, a state, a receipt — exactly the kind of string that is
// tempting to inline as a literal. The locale parity suite cannot catch that:
// it compares key sets, so a hardcoded "Running" in the markup passes it and
// shows English to everyone. These assert against the REAL locale bundles, so a
// regression fails here rather than in a screenshot.
describe("StepWelcome signal labels", () => {
  it("renders the signal's words in English", () => {
    renderWithI18n(<StepWelcome onNext={vi.fn()} />);

    // The zone repeats down the rail — the work leaves the origin zone, is
    // picked up in the target zone, and the receipt lands back in the origin —
    // which is the whole argument of the picture.
    expect(screen.getByText("Origin zone · 00:00")).toBeInTheDocument();
    expect(screen.getByText("Target zone · 00:07")).toBeInTheDocument();
    expect(screen.getByText("Origin zone · 00:09")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Dispatched")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Receipt returned")).toBeInTheDocument();
  });

  it("localizes them rather than rendering hardcoded English", () => {
    renderWithI18n(<StepWelcome onNext={vi.fn()} />, { locale: "zh-Hans" });

    // The zone repeats down the rail — the work leaves the origin zone, is
    // picked up in the target zone, and the receipt lands back in the origin —
    // which is the whole argument of the picture.
    expect(screen.getAllByText("本区 · 00:00").length).toBe(1);
    expect(screen.getByText("目标区 · 00:07")).toBeInTheDocument();
    expect(screen.getByText("已受理")).toBeInTheDocument();
    expect(screen.getByText("已派发")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("已回执")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });
});
