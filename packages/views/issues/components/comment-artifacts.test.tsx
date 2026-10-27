// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nProvider } from "@quickwork/core/i18n/react";
import type { Attachment } from "@quickwork/core/types";
import enCommon from "../../locales/en/common.json";
import enIssues from "../../locales/en/issues.json";

const previewTryOpen = vi.hoisted(() => vi.fn(() => true));
const previewOpen = vi.hoisted(() => vi.fn());
const sequenceOpenAt = vi.hoisted(() => vi.fn(() => true));
const downloadAttachment = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../editor/attachment-preview-modal", () => ({
  useAttachmentPreview: () => ({
    tryOpen: previewTryOpen,
    open: previewOpen,
    modal: null,
  }),
}));

vi.mock("../../editor/image-sequence-context", () => ({
  ImageSequenceProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useImageSequencePreview: () => ({ openAt: sequenceOpenAt }),
}));

vi.mock("../../editor/use-download-attachment", () => ({
  useDownloadAttachment: () => downloadAttachment,
}));

vi.mock("../../editor/attachment", () => ({
  useAttachmentInlineMediaURL: (attachment: Attachment) => attachment.url,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@quickwork/core/workspace/avatar-url", () => ({
  resolvePublicFileUrl: (value: string | null) => value,
}));

import { ArtifactPanel } from "./comment-artifacts";

const TEST_RESOURCES = { en: { common: enCommon, issues: enIssues } };

function attachment(overrides: Partial<Attachment>): Attachment {
  return {
    id: "a-1",
    workspace_id: "ws-1",
    issue_id: "i-1",
    comment_id: "c-1",
    chat_session_id: null,
    chat_message_id: null,
    uploader_type: "agent",
    uploader_id: "agent-1",
    filename: "file.png",
    url: "https://cdn.example/file.png",
    download_url: "https://cdn.example/file.png",
    markdown_url: "/api/attachments/a-1/download",
    content_type: "image/png",
    size_bytes: 1024,
    created_at: "2026-10-19T00:00:00Z",
    ...overrides,
  };
}

function renderPanel(attachments: Attachment[]) {
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <ArtifactPanel attachments={attachments} />
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ArtifactPanel", () => {
  it("groups images into a gallery and lists documents below it", () => {
    renderPanel([
      attachment({ id: "img-1", filename: "01-cover.jpg" }),
      attachment({ id: "img-2", filename: "02-cover.jpg" }),
      attachment({
        id: "doc-1",
        filename: "选品总结.md",
        content_type: "text/markdown",
        size_bytes: 9000,
        url: "https://cdn.example/report.md",
        download_url: "https://cdn.example/report.md",
      }),
    ]);

    expect(screen.getByText("Artifacts")).toBeTruthy();
    expect(
      screen.getByText("3 files · 2 images / 1 docs"),
    ).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.getByText("选品总结.md")).toBeTruthy();
  });

  it("filters the gallery and documents from the header tabs", () => {
    renderPanel([
      attachment({ id: "img-1", filename: "01-cover.jpg" }),
      attachment({ id: "img-2", filename: "02-cover.jpg" }),
      attachment({
        id: "doc-1",
        filename: "report.md",
        content_type: "text/markdown",
      }),
    ]);

    fireEvent.click(screen.getByRole("tab", { name: "Docs 1" }));
    expect(screen.queryAllByRole("img")).toHaveLength(0);
    expect(screen.getByText("report.md")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Images 2" }));
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(screen.queryByText("report.md")).toBeNull();
  });

  it("opens a document through the shared preview modal", () => {
    const doc = attachment({
      id: "doc-1",
      filename: "report.md",
      content_type: "text/markdown",
    });
    renderPanel([attachment({ id: "img-1" }), doc]);

    fireEvent.click(screen.getByRole("button", { name: /Preview/ }));
    expect(previewTryOpen).toHaveBeenCalledWith({
      kind: "full",
      attachment: doc,
    });
  });

  it("opens an image at its gallery position", () => {
    const image = attachment({ id: "img-1" });
    renderPanel([image, attachment({ id: "img-2" })]);

    fireEvent.click(
      screen.getByRole("button", { name: "Cover 1: file" }),
    );
    expect(sequenceOpenAt).toHaveBeenCalledWith("img-1");
  });
});
