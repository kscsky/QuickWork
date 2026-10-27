import { describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ScrollRestorationAdapter } from "../platform";
import { ScrollRestorationProvider } from "../platform";
import { AttachmentPreviewPage } from "./attachment-preview-page";
import { hashString } from "../editor/utils/hash-string";
import { buildScrollBridge } from "../editor/utils/iframe-scroll-bridge";

const htmlText = "<html><body><h1>Report</h1></body></html>";

const attachment = {
  id: "att-1",
  workspace_id: "ws-1",
  issue_id: null,
  comment_id: null,
  chat_session_id: null,
  chat_message_id: null,
  uploader_type: "member",
  uploader_id: "user-1",
  filename: "report.html",
  url: "/files/report.html",
  download_url: "/api/attachments/att-1/download",
  markdown_url: "/api/attachments/att-1/download",
  content_type: "text/html",
  size_bytes: 1024,
  created_at: "2026-10-20T10:00:00Z",
};

vi.mock("@quickwork/core/api", () => ({
  api: {
    getBaseUrl: () => "",
    getAttachment: () => Promise.resolve(attachment),
    getAttachmentBlob: () => Promise.resolve(new Blob()),
  },
}));

vi.mock("../editor/hooks/use-attachment-html-text", () => ({
  useAttachmentHtmlText: () => ({
    data: { text: htmlText, originalContentType: "text/html" },
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@quickwork/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));

vi.mock("@quickwork/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@quickwork/core/paths")>()),
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/ws-1/issues/${id}`,
  }),
}));

vi.mock("@quickwork/core/issues/queries", () => ({
  issueDetailOptions: (_wsId: string, id: string) => ({
    queryKey: ["issue", id],
    queryFn: () => Promise.resolve(null),
  }),
}));

vi.mock("@quickwork/core/workspace/hooks", () => ({
  useActorName: () => ({
    getActorName: () => "Tester",
    getActorAvatarUrl: () => null,
  }),
}));

vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: vi.fn(), back: vi.fn() }),
}));

const attachmentLabels = {
  preview_loading: "Loading preview…",
  preview_failed: "Couldn't load preview",
  preview_unsupported: "This file type can't be previewed.",
  download_failed: "Couldn't fetch a download link.",
  close: "Close",
  console: {
    back: "Back to task",
    crumb: "Attachment preview",
    file_crumb: "Attachment",
    download: "Download",
    copy_link: "Copy link",
    open_task: "Open task",
    close: "Close preview",
    stage_head: "PREVIEW / READ ONLY",
    stage_screen: "SCREEN",
    stage_index: "01 / 01",
    stage_original: "Original",
    stage_fit: "Fit to window · 100%",
    file_kicker: "FILE / ATTACHMENT",
    read_only: "Read-only",
    fact_size: "SIZE",
    fact_type: "TYPE",
    fact_uploaded: "UPLOADED",
    fact_date: "DATE",
    uploader_agent: "Agent",
    uploader_member: "Member",
    task_kicker: "TASK",
    note: "Stored with this task.",
    archive_kicker: "ARCHIVE",
    archive_access: "Access",
    archive_access_value: "Workspace members",
    archive_id: "Attachment ID",
    archive_state: "Read-only archive",
    copy_link_success: "Link copied",
    copy_link_failed: "Couldn't copy the link",
    untitled: "Attachment",
  },
};

vi.mock("../i18n", () => ({
  useT: () => ({
    t: (fn: (d: Record<string, unknown>) => string) =>
      fn({ attachment: attachmentLabels }),
  }),
  useLocale: () => "en",
}));

function renderPage(adapter: ScrollRestorationAdapter) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ScrollRestorationProvider adapter={adapter}>
        <AttachmentPreviewPage attachmentId="att-1" />
      </ScrollRestorationProvider>
    </QueryClientProvider>,
  );
}

describe("AttachmentPreviewPage", () => {
  it("injects the scroll bridge under the desktop adapter and keys the iframe on contentKey", async () => {
    const adapter: ScrollRestorationAdapter = {
      get: () => undefined,
      registerExternalSource: vi.fn(),
    };
    const { container } = renderPage(adapter);
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    const iframe = container.querySelector("iframe")!;
    expect(iframe).toBeTruthy();
    expect(iframe.getAttribute("srcdoc")).toContain(
      buildScrollBridge(hashString(htmlText)),
    );
    expect(adapter.registerExternalSource).toHaveBeenCalledWith(
      "html-iframe",
      expect.objectContaining({ capture: expect.any(Function) }),
    );
  });

  it("does NOT inject the bridge or register a source on web (adapter without registerExternalSource)", async () => {
    const webAdapter: ScrollRestorationAdapter = { get: () => undefined };
    const { container } = renderPage(webAdapter);
    await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
    const iframe = container.querySelector("iframe")!;
    expect(iframe.getAttribute("srcdoc")).not.toContain("__quickwork");
    expect(iframe.getAttribute("srcdoc")).not.toContain(buildScrollBridge("x"));
    expect(iframe.getAttribute("srcdoc")).toContain("scrollIntoView");
  });
});
