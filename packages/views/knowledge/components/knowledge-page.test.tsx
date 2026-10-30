/**
 * The knowledge page is the squad's memory surface: it lists distilled
 * entries, marks drafts, and runs a semantic (or keyword) search. These are
 * the behaviours an operator relies on when checking what the relay learned,
 * so they are asserted here rather than re-derived through helpers.
 */
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { NavigationProvider, type NavigationAdapter } from "../../navigation";
import { renderWithI18n } from "../../test/i18n";
import { KnowledgePage } from "./knowledge-page";

const { LIST, SEARCH } = vi.hoisted(() => {
  const now = new Date().toISOString();
  const base = {
    workspace_id: "ws-1",
    squad_id: null,
    tags: ["接力"],
    created_by: "u-1",
    published_by: null,
    published_at: null,
    usage_count: 0,
    created_at: now,
    updated_at: now,
    source_leg: 0,
    source_kind: "handoff",
    source_issue_id: "i-1",
    embedding_profile_id: "p-1",
    embedding_model: "text-embedding-v4",
    embedding_dims: 1024,
  };
  return {
    LIST: {
      entries: [
        {
          ...base,
          id: "k-1",
          kind: "summary",
          title: "发布「秋日的第一支精华」内容包",
          body: "三篇笔记与九张图的总结。",
          status: "published",
          embedding_chunks: 6,
        },
        {
          ...base,
          id: "k-2",
          kind: "faq",
          title: "「拆解与定方案」这一棒怎么做的？",
          body: "把内容包拆成 3 篇笔记与 9 张图；标题不超过 20 字。",
          status: "draft",
          embedding_profile_id: null,
          embedding_model: "",
          embedding_dims: null,
        },
      ],
      stats: { "summary:published": 1, "faq:published": 0, "faq:draft": 1 },
      embedding: {
        enabled: true,
        profile_id: "p-1",
        provider: "bailian",
        model: "text-embedding-v4",
        dims: 1024,
      },
      profiles: [
        {
          id: "p-1",
          provider: "bailian",
          base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
          model: "text-embedding-v4",
          dims: 1024,
          key_hint: "9f2c",
          status: "verified",
          last_error: "",
          is_active: true,
          created_at: now,
          updated_at: now,
        },
      ],
      corpora: [
        {
          profile_id: "p-1",
          provider: "bailian",
          model: "text-embedding-v4",
          dims: 1024,
          entries: 1,
          active: true,
        },
      ],
      unindexed: 1,
    },
    SEARCH: {
      mode: "keyword",
      profile: {
        id: "p-1",
        provider: "bailian",
        model: "text-embedding-v4",
        dims: 1024,
      },
      hits: [
        {
          entry: {
            ...base,
            id: "k-3",
            kind: "faq",
            title: "配图色调规范",
            body: "暖棕 + 米白 + 琥珀，3:4。",
            status: "published",
            embedding_chunks: 4,
            matched_chunk_index: 2,
            matched_chunk_text: "命中片段：暖棕 + 米白 + 琥珀；3:4 / 1080×1440。",
            matched_heading: "配图规范",
          },
          score: 0.42,
        },
      ],
    },
  };
});

vi.mock("@quickwork/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@quickwork/core/paths", () => ({
  useWorkspacePaths: () => ({
    issueDetail: (id: string) => `/acme/issues/${id}`,
  }),
}));
vi.mock("@quickwork/core/permissions", () => ({
  useCurrentMember: () => ({ role: "admin" }),
}));
vi.mock("@quickwork/core/knowledge/queries", () => ({
  knowledgeListOptions: (wsId: string, dims?: unknown) => ({
    queryKey: ["knowledge", wsId, "list", dims],
    queryFn: () => Promise.resolve(LIST),
  }),
  knowledgeSearchOptions: (wsId: string, query: string, _limit?: number, profileId?: string) => ({
    queryKey: ["knowledge", wsId, "search", profileId, query],
    queryFn: () => Promise.resolve(SEARCH),
    enabled: query.trim().length > 0,
  }),
  knowledgeProfilesOptions: (wsId: string) => ({
    queryKey: ["knowledge", wsId, "profiles"],
    queryFn: () => Promise.resolve(LIST.profiles),
  }),
  embeddingProvidersOptions: (wsId: string) => ({
    queryKey: ["knowledge", wsId, "providers"],
    queryFn: () => Promise.resolve([]),
    enabled: false,
  }),
}));
vi.mock("@quickwork/core/knowledge/mutations", () => ({
  usePublishKnowledgeEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useArchiveKnowledgeEntry: () => ({ mutate: vi.fn(), isPending: false }),
  useReindexKnowledge: () => ({ mutate: vi.fn(), isPending: false }),
  useMatchEmbeddingModels: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEmbeddingProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useActivateEmbeddingProfile: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEmbeddingProfile: () => ({ mutate: vi.fn(), isPending: false }),
}));

const adapter: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/knowledge",
  searchParams: new URLSearchParams(),
  hash: "",
  getShareableUrl: (path: string) => `https://quickwork.test${path}`,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return renderWithI18n(
    <QueryClientProvider client={queryClient}>
      <NavigationProvider value={adapter}>
        <KnowledgePage />
      </NavigationProvider>
    </QueryClientProvider>,
  );
}

describe("KnowledgePage", () => {
  it("lists distilled entries with status and the embedding mode", async () => {
    renderPage();

    expect(
      await screen.findByText("发布「秋日的第一支精华」内容包"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("「拆解与定方案」这一棒怎么做的？"),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
    // The draft publishes through the admin action next to it.
    expect(screen.getByRole("button", { name: "Publish" })).toBeInTheDocument();
    // Every entry is stamped with its corpus; the draft is unindexed.
    expect(screen.getAllByText("1024 dims").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unindexed").length).toBeGreaterThan(0);
    expect(screen.getByText("text-embedding-v4")).toBeInTheDocument();
    expect(screen.getAllByText("Parent-child · 6 chunks").length).toBeGreaterThan(0);
  });

  it("runs a keyword search when no embedding provider is configured", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("发布「秋日的第一支精华」内容包");

    const input = screen.getByRole("textbox", { name: /Ask:/ });
    await user.type(input, "配图 色调");
    await user.keyboard("{Enter}");

    expect(await screen.findByText("配图色调规范")).toBeInTheDocument();
    expect(
      screen.getByText("命中片段：暖棕 + 米白 + 琥珀；3:4 / 1080×1440。"),
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Matched chunk/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Keyword search · no embeddings configured/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("发布「秋日的第一支精华」内容包"),
    ).not.toBeInTheDocument();
  });
});
