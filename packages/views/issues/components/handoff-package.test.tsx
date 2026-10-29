// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IssueChainStep } from "@quickwork/core/types";

import { renderWithI18n } from "../../test/i18n";
import type { HandoffDraft } from "./relay-leg-rail";

vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: ({ actorId }: { actorId: string }) => (
    <span data-testid="actor-avatar">{actorId}</span>
  ),
}));
vi.mock("../../editor", () => ({
  useAttachmentPreview: () => ({ tryOpen: () => false, modal: null }),
  useDownloadAttachment: () => () => undefined,
}));

import { HandoffPackageCard, PreviousHandoffCard } from "./handoff-package";

afterEach(cleanup);

const handoff = {
  summary: "已拆成四块，方案草案已交。",
  files: [],
  acceptance: [
    {
      label: "口径",
      requirement: "中国大陆 · 近 3–5 年",
      delivered: "口径说明 §1",
      state: "pass",
    },
    {
      label: "来源",
      requirement: "每个结论可复核",
      delivered: "3 条待补",
      state: "warn",
    },
  ],
  open_questions: ["下沉市场样本只有 2 条"],
  next_brief: ["补齐 6 条来源", "逐条校验 URL"],
};

const step: IssueChainStep = {
  id: "step-1",
  position: 0,
  holder_user_id: "u1",
  agent_id: "a1",
  title: "拆解与定方案",
  state: "reviewing",
  plan: "按清单补齐来源",
  handoff,
};

const nextStep: IssueChainStep = {
  id: "step-2",
  position: 1,
  holder_user_id: "u2",
  agent_id: "a2",
  title: "成稿",
  state: "pending",
};

const draft: HandoffDraft = {
  candidates: [],
  picked: new Set<string>(),
  onToggle: vi.fn(),
  summary: handoff.summary,
  onSummaryChange: vi.fn(),
  acceptance: handoff.acceptance,
  onAcceptanceChange: vi.fn(),
  openQuestions: handoff.open_questions.join("\n"),
  onOpenQuestionsChange: vi.fn(),
  nextBrief: handoff.next_brief.join("\n"),
  onNextBriefChange: vi.fn(),
};

function nameOf(userId: string): string {
  return userId === "u1" ? "2032936974" : "12345678";
}

function ReviewCard({
  onApprove = vi.fn(),
  onReturn = vi.fn(),
  outputRunning = false,
  summary = handoff.summary,
}: {
  onApprove?: () => void;
  onReturn?: (reason: string) => void;
  outputRunning?: boolean;
  summary?: string;
}) {
  const [returnOpen, setReturnOpen] = useState(false);
  return (
    <HandoffPackageCard
      step={step}
      nextStep={nextStep}
      identifier="KSCS-8"
      seq={1}
      timeLabel="2 天前"
      agentName="2032936974 的智能体"
      nameOf={nameOf}
      draft={{ ...draft, summary }}
      canApprove
      approvePending={false}
      returnPending={false}
      outputRunning={outputRunning}
      onApprove={onApprove}
      onReturn={onReturn}
      returnOpen={returnOpen}
      onReturnOpenChange={setReturnOpen}
    />
  );
}

describe("HandoffPackageCard", () => {
  it("renders the package's acceptance ledger, open questions and next brief", () => {
    renderWithI18n(<ReviewCard />);

    expect(screen.getByText(/HANDOFF PACKAGE/)).toBeInTheDocument();
    expect(screen.getByText("IN REVIEW")).toBeInTheDocument();
    expect(screen.getByDisplayValue("已拆成四块，方案草案已交。")).toBeInTheDocument();
    expect(screen.getByDisplayValue("中国大陆 · 近 3–5 年")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3 条待补")).toBeInTheDocument();
    expect(screen.getByDisplayValue(/下沉市场样本只有 2 条/)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/补齐 6 条来源/)).toBeInTheDocument();
    expect(screen.getAllByText(/1 \/ 2/).length).toBeGreaterThan(0);
  });

  it("returns the leg with the selected reason and the written detail", () => {
    const onReturn = vi.fn();
    renderWithI18n(<ReviewCard onReturn={onReturn} />);

    fireEvent.click(screen.getByRole("button", { name: "Return for revision" }));
    expect(screen.getByText("Return to 2032936974")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Missing evidence" }));
    fireEvent.change(
      screen.getByPlaceholderText(/What needs to change/),
      { target: { value: "补到 6 条可复核来源" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Return leg" }));

    expect(onReturn).toHaveBeenCalledWith(
      "Missing evidence · 补到 6 条可复核来源",
    );
  });

  it("approves from the package footer", () => {
    const onApprove = vi.fn();
    renderWithI18n(<ReviewCard onApprove={onApprove} />);

    fireEvent.click(screen.getByRole("button", { name: "Approve & pass" }));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("locks approval while the leg's summary run is active", () => {
    renderWithI18n(<ReviewCard outputRunning />);

    expect(screen.getAllByText("Writing the handoff summary…").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Summarizing this leg…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Return for revision" }),
    ).toBeDisabled();
  });

  it("requires a summary before approving", () => {
    renderWithI18n(<ReviewCard summary="" />);

    expect(
      screen.getByText("Write a summary, or generate it, before approving."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Approve & pass" }),
    ).toBeDisabled();
  });

  it("is read-only once the leg is handed off", () => {
    renderWithI18n(
      <HandoffPackageCard
        step={{ ...step, state: "done" }}
        nextStep={nextStep}
        identifier="KSCS-8"
        seq={1}
        timeLabel="2 天前"
        nameOf={nameOf}
        canApprove={false}
        approvePending={false}
        returnPending={false}
        outputRunning={false}
        onApprove={vi.fn()}
        onReturn={vi.fn()}
        returnOpen={false}
        onReturnOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText("已拆成四块，方案草案已交。")).toBeInTheDocument();
    expect(screen.getByText("HANDED OFF")).toBeInTheDocument();
    expect(screen.getByText("Handed off to 12345678.")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Return for revision" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Approve & pass" }),
    ).toBeNull();
  });
});

describe("PreviousHandoffCard", () => {
  it("shows the handoff the next leg received, and opens the full package", () => {
    const onOpen = vi.fn();
    renderWithI18n(
      <PreviousHandoffCard
        step={{ ...step, state: "done" }}
        seq={1}
        nameOf={nameOf}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("From leg 1 / HANDED OVER")).toBeInTheDocument();
    expect(screen.getByText("已拆成四块，方案草案已交。")).toBeInTheDocument();
    expect(screen.getByText("Open questions carried in")).toBeInTheDocument();
    expect(screen.getByText("Handed to you")).toBeInTheDocument();
    expect(screen.getByText("补齐 6 条来源")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open full package/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
