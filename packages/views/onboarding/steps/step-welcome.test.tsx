import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "../../test/i18n";
import { StepWelcome } from "./step-welcome";

// The waybill is the welcome screen's proof: a task leaves this zone, an agent
// in the target zone executes it in a sandbox, and a receipt closes the loop.
// Its short mono labels are exactly the kind of string that is tempting to
// inline — a hardcoded literal would pass key-parity and show English to every
// locale. These assertions run against the real bundles.
describe("StepWelcome waybill", () => {
  it("renders the waybill in English", () => {
    renderWithI18n(<StepWelcome onNext={vi.fn()} />);

    expect(screen.getByText("WAYBILL")).toBeInTheDocument();
    expect(screen.getByText("QW-0001")).toBeInTheDocument();
    expect(screen.getByText("ORIGIN")).toBeInTheDocument();
    expect(screen.getByText("TARGET")).toBeInTheDocument();
    expect(screen.getByText("Accepted")).toBeInTheDocument();
    expect(screen.getByText("Dispatched")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.getByText("Receipt")).toBeInTheDocument();
  });

  it("localizes them rather than rendering hardcoded English", () => {
    renderWithI18n(<StepWelcome onNext={vi.fn()} />, { locale: "zh-Hans" });

    expect(screen.getByText("运单 / WAYBILL")).toBeInTheDocument();
    expect(screen.getByText("本区 / ORIGIN")).toBeInTheDocument();
    expect(screen.getByText("目标区 / TARGET")).toBeInTheDocument();
    expect(screen.getByText("已受理")).toBeInTheDocument();
    expect(screen.getByText("已派发")).toBeInTheDocument();
    expect(screen.getByText("执行中")).toBeInTheDocument();
    expect(screen.getByText("已回执")).toBeInTheDocument();
    expect(screen.getByText("沙箱")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });
});
