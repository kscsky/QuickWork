"use client";

import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@quickwork/ui/components/ui/item";
import { useT } from "../../i18n";

/** Mirrors `quillAgentAvatarURL` in server/internal/handler/quill_agent.go.
 *  Placeholder until Quill has real artwork — these two must move together or
 *  onboarding shows one face and the created agent another. */
export const QUILL_PLACEHOLDER_EMOJI = "🪶";
import { StepHeading } from "./step-shell";

/**
 * The subject of step 3, stated as an object rather than a footnote.
 *
 * The step used to be titled after its dependency — "Pick an agent runtime" —
 * with Quill named only in the grey lede. That put the thing being created in
 * the small print and the technical prerequisite in the headline, so a member
 * reached a button saying "Start with Quill" without ever being told who that
 * is. Headline plus a card with a mark on it is what makes the introduction
 * survive not reading carefully.
 *
 * Quill does not exist yet at this point in the flow — she is created when the
 * member commits — so this cannot render her stored avatar. It reuses the mark
 * the Runtimes page already uses for "Start with Quill" instead, which keeps
 * the two entry points recognisably the same thing.
 */
export function QuillIntro() {
  const { t } = useT("onboarding");
  return (
    <div className="flex flex-col gap-5">
      <StepHeading title={t(($) => $.quill_intro.headline)} />
      <Item variant="outline">
        <ItemMedia>
          <span
            role="img"
            aria-label={t(($) => $.quill_intro.name)}
            className="flex size-9 shrink-0 select-none items-center justify-center rounded-full bg-muted text-title leading-none"
          >
            {QUILL_PLACEHOLDER_EMOJI}
          </span>
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            {t(($) => $.quill_intro.name)}
            <span className="text-muted-foreground">
              {" · "}
              {t(($) => $.quill_intro.role)}
            </span>
          </ItemTitle>
          <ItemDescription>{t(($) => $.quill_intro.blurb)}</ItemDescription>
        </ItemContent>
      </Item>
    </div>
  );
}
