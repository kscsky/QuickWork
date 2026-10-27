// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@quickwork/core/types";
import { I18nProvider } from "@quickwork/core/i18n/react";
import enCommon from "../../locales/en/common.json";
import enSkills from "../../locales/en/skills.json";
import { NavigationProvider, type NavigationAdapter } from "../../navigation";

const TEST_RESOURCES = { en: { common: enCommon, skills: enSkills } };

const skillRef = vi.hoisted(() => ({ current: null as unknown }));
const agentsRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const membersRef = vi.hoisted(() => ({ current: [] as unknown[] }));
const canEditRef = vi.hoisted(() => ({ current: true }));

vi.mock("@quickwork/core/hooks", () => ({ useWorkspaceId: () => "ws-1" }));
vi.mock("@quickwork/core/workspace/queries", () => ({
  skillDetailOptions: (wsId: string, id: string) => ({
    queryKey: ["skill", wsId, id],
    queryFn: () => Promise.resolve(skillRef.current),
  }),
  agentListOptions: (wsId: string) => ({
    queryKey: ["agents", wsId],
    queryFn: () => Promise.resolve(agentsRef.current),
  }),
  memberListOptions: (wsId: string) => ({
    queryKey: ["members", wsId],
    queryFn: () => Promise.resolve(membersRef.current),
  }),
  selectSkillAssignments: () => new Map(),
  workspaceKeys: {
    skills: (wsId: string) => ["skills", wsId],
    agents: (wsId: string) => ["agents", wsId],
  },
}));
vi.mock("@quickwork/core/runtimes", () => ({
  runtimeListOptions: (wsId: string) => ({
    queryKey: ["runtimes", wsId],
    queryFn: () => Promise.resolve([]),
  }),
  runtimeDisplayLabel: (r: { name?: string }) => r.name ?? "runtime",
}));
vi.mock("@quickwork/core/agents", () => ({
  useWorkspacePresenceMap: () => ({ byAgent: new Map() }),
}));
vi.mock("@quickwork/core/auth", () => {
  const state = () => ({ user: { id: "user-1" } });
  return {
    useAuthStore: Object.assign(
      (selector?: (s: ReturnType<typeof state>) => unknown) =>
        selector ? selector(state()) : state(),
      { getState: state },
    ),
  };
});
vi.mock("@quickwork/core/paths", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@quickwork/core/paths")>()),
  useWorkspacePaths: () => ({ skills: () => "/acme/skills" }),
}));
vi.mock("@quickwork/core/permissions", () => ({
  useSkillPermissions: () => ({ canEdit: { allowed: true, reason: null } }),
}));
vi.mock("@quickwork/core/api", () => ({
  api: { updateSkill: vi.fn(), deleteSkill: vi.fn() },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../hooks/use-can-edit-skill", () => ({
  useCanEditSkill: () => canEditRef.current,
}));
vi.mock("./skill-list-actions", () => ({ AddToAgentDialog: () => null }));
vi.mock("@quickwork/ui/components/common/capability-banner", () => ({
  CapabilityBanner: () => <div data-testid="capability-banner" />,
}));
vi.mock("../../common/actor-avatar", () => ({
  ActorAvatar: () => <div />,
}));

import { SkillDetailPage } from "./skill-detail-page";

const LONG_DESCRIPTION =
  "Animation for product interfaces — when to animate and when not to. " +
  "Triggers on: animation, easing, cubic-bezier, spring, keyframes.";

const baseSkill: Skill = {
  id: "skill-1",
  workspace_id: "ws-1",
  name: "aiforui-animations",
  description: LONG_DESCRIPTION,
  config: {},
  created_by: "user-1",
  created_at: "2026-07-28T18:11:37Z",
  updated_at: "2026-07-28T18:14:40Z",
  content:
    "---\nname: aiforui-animations\n---\n\n# Interface Animations\n\n## Working notes\n- keep evidence\n",
  files: [
    { id: "f-1", path: "patterns.md", content: "# Patterns\n" } as Skill["files"][number],
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const replace = vi.fn();
  const navigation: NavigationAdapter = {
    push: vi.fn(),
    replace,
    back: vi.fn(),
    pathname: "/acme/skills/skill-1",
    searchParams: new URLSearchParams(),
    hash: "",
    getShareableUrl: (path) => path,
  };
  render(
    <I18nProvider locale="en" resources={TEST_RESOURCES}>
      <NavigationProvider value={navigation}>
        <QueryClientProvider client={queryClient}>
          <SkillDetailPage skillId="skill-1" />
        </QueryClientProvider>
      </NavigationProvider>
    </I18nProvider>,
  );
  return { replace, queryClient };
}

/** Publishes a new server version of the skill, as a `skill:updated` event would. */
async function remoteUpdate(queryClient: QueryClient, next: Partial<Skill>) {
  skillRef.current = {
    ...(skillRef.current as Skill),
    updated_at: "2026-07-29T10:00:00Z",
    ...next,
  };
  await queryClient.invalidateQueries({ queryKey: ["skill", "ws-1", "skill-1"] });
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  skillRef.current = baseSkill;
  agentsRef.current = [];
  membersRef.current = [{ user_id: "user-1", role: "member" }];
  canEditRef.current = true;
});

describe("SkillDetailPage document", () => {
  it("renders the file rail and the SKILL.md body", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "SKILL.md" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "patterns.md" })).toBeTruthy();
    expect(screen.getByText("Working notes")).toBeTruthy();
    expect(screen.getByText("keep evidence")).toBeTruthy();
    // Frontmatter and the leading H1 belong to the header, not the body.
    expect(screen.queryByText(/name: aiforui-animations/)).toBeNull();
    expect(screen.queryByText("Interface Animations")).toBeNull();
  });

  it("switches the document when a supporting file is selected", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "patterns.md" }));

    expect(screen.getByRole("heading", { name: "patterns.md" })).toBeTruthy();
    expect(screen.getByText("Supporting file for aiforui-animations")).toBeTruthy();
    expect(screen.getByText("Patterns")).toBeTruthy();
  });
});

describe("SkillDetailPage editing", () => {
  it("toggles between the rendered document and the raw editor", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));

    const editor = screen.getByRole("textbox", {
      name: /SKILL\.md/,
    }) as HTMLTextAreaElement;
    expect(editor.value).toBe(baseSkill.content);
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.queryByRole("textbox", { name: /SKILL\.md/ })).toBeNull();
    expect(screen.getByText("Working notes")).toBeTruthy();
  });

  it("offers read-only viewers a plain-text view, not an edit", async () => {
    canEditRef.current = false;
    renderPage();

    expect(await screen.findByRole("button", { name: "Plain text" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByTestId("capability-banner")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Plain text" }));
    const editor = screen.getByRole("textbox", {
      name: /SKILL\.md/,
    }) as HTMLTextAreaElement;
    expect(editor.readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /Save changes/ })).toBeNull();
  });

  it("counts a supporting-file edit as one changed file", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "patterns.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: /patterns\.md/ }), {
      target: { value: "edited content" },
    });

    expect(screen.getByText("Changed: 1 file")).toBeTruthy();
  });

  it("renames a supporting file from the document bar", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "patterns.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    const field = screen.getByLabelText("File path");
    fireEvent.change(field, { target: { value: "notes/patterns.md" } });
    const renameButtons = screen.getAllByRole("button", { name: "Rename" });
    fireEvent.click(renameButtons[renameButtons.length - 1]!);

    expect(screen.getByRole("button", { name: "notes/patterns.md" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "patterns.md" })).toBeNull();
  });
});

describe("SkillDetailPage save state", () => {
  it("appears in the top bar once the draft is dirty", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.queryByRole("button", { name: /Save changes/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "changed" },
    });

    expect(screen.getByText("Changed: Description")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Save changes/ }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("lists every dirty part reusing the field labels", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "renamed-skill" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "changed" },
    });

    expect(screen.getByText("Changed: Name · Description")).toBeTruthy();
  });

  it("saves the draft through the API", async () => {
    const { api } = await import("@quickwork/core/api");
    const updated = {
      ...baseSkill,
      description: "changed",
      updated_at: new Date().toISOString(),
    };
    vi.mocked(api.updateSkill).mockResolvedValue(updated);

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "changed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save changes/ }));

    expect(api.updateSkill).toHaveBeenCalledWith(
      "skill-1",
      expect.objectContaining({ description: "changed" }),
    );
    expect(await screen.findByText("Saved · just now")).toBeTruthy();
  });
});

/**
 * MUL-5645. Dirty state is measured against the seeded baseline, not against
 * the latest server skill. The two failures that rule prevents:
 *
 * 1. A description carrying trailing whitespace — what `description: |`
 *    frontmatter yields, so every imported skill — used to compare unequal to
 *    itself because only one side of the check was trimmed. The page opened
 *    permanently dirty and Discard reseeded the same value, so it never cleared.
 * 2. A remote update read as a local edit, because the check compared the draft
 *    against the NEW server skill. Any agent edit froze the editor on stale
 *    text behind a conflict banner, whatever the description looked like.
 */
describe("SkillDetailPage draft baseline (MUL-5645)", () => {
  const CONFLICT_BANNER = "Someone else updated this skill";

  it("opens clean when the description carries a trailing newline", async () => {
    skillRef.current = { ...baseSkill, description: `${LONG_DESCRIPTION}\n` };
    renderPage();

    await screen.findByRole("button", { name: "Edit" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.queryByText(/^Changed:/)).toBeNull();
  });

  it("stays clean after Discard on a trailing-newline description", async () => {
    skillRef.current = { ...baseSkill, description: `${LONG_DESCRIPTION}\n` };
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Description");
    fireEvent.change(field, { target: { value: "typo" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.queryByText(/^Changed:/)).toBeNull();
    expect(
      (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    ).toBe(LONG_DESCRIPTION);
  });

  it("pulls a remote edit in silently while the draft is untouched", async () => {
    const { queryClient } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await remoteUpdate(queryClient, { description: "Rewritten by the agent" });

    expect(await screen.findByDisplayValue("Rewritten by the agent")).toBeTruthy();
    expect(screen.queryByText(CONFLICT_BANNER)).toBeNull();
    expect(screen.queryByText(/^Changed:/)).toBeNull();
  });

  it("pulls a remote SKILL.md edit in silently too", async () => {
    const { queryClient } = renderPage();

    await screen.findByText("Working notes");
    await remoteUpdate(queryClient, {
      content: `${baseSkill.content}\n## Added remotely\n`,
    });

    expect(await screen.findByText("Added remotely")).toBeTruthy();
    expect(screen.queryByText(CONFLICT_BANNER)).toBeNull();
    expect(screen.queryByText(/^Changed:/)).toBeNull();
  });

  it("keeps local edits behind a conflict banner", async () => {
    const { queryClient } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Description");
    fireEvent.change(field, { target: { value: "my unsaved edit" } });

    await remoteUpdate(queryClient, { description: "Rewritten by the agent" });

    expect(await screen.findByText(CONFLICT_BANNER)).toBeTruthy();
    expect(
      (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    ).toBe("my unsaved edit");
  });

  it("releases the conflict once the user reverts their own edits", async () => {
    const { queryClient } = renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const field = screen.getByLabelText("Description");
    fireEvent.change(field, { target: { value: "typo" } });

    await remoteUpdate(queryClient, { description: "Rewritten by the agent" });
    expect(await screen.findByText(CONFLICT_BANNER)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: LONG_DESCRIPTION },
    });

    await vi.waitFor(() => {
      expect(screen.queryByText(CONFLICT_BANNER)).toBeNull();
    });
    expect(
      (screen.getByLabelText("Description") as HTMLTextAreaElement).value,
    ).toBe("Rewritten by the agent");
  });
});

describe("SkillDetailPage origin link", () => {
  const SOURCE_URL = "https://github.com/anthropics/skills/tree/main/animations";

  it("links the imported origin to its source", async () => {
    skillRef.current = {
      ...baseSkill,
      config: { origin: { type: "github", source_url: SOURCE_URL } },
    };
    renderPage();
    const link = (await screen.findByRole("link", {
      name: "Imported · GitHub",
    })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(SOURCE_URL);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("keeps manual origins as plain text", async () => {
    renderPage();
    expect((await screen.findAllByText("Created manually")).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: "Created manually" }),
    ).toBeNull();
  });

  it("degrades a refused source_url to plain text, keeping the label", async () => {
    skillRef.current = {
      ...baseSkill,
      config: {
        origin: { type: "github", source_url: "https://evil.example/skills" },
      },
    };
    renderPage();
    expect((await screen.findAllByText("Imported · GitHub")).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("link", { name: "Imported · GitHub" }),
    ).toBeNull();
  });
});
