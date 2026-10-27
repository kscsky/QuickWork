import type { QuillOnboardingLanguage } from "@quickwork/core/onboarding";

export type QuillContentLang = QuillOnboardingLanguage;

interface LocalizedText {
  en: string;
  zh: string;
  ko: string;
  ja: string;
}

export interface QuillOnboardingDefinition {
  title: string;
  language: QuillContentLang;
}

/**
 * Quill's name, description, avatar, permissions, and system instructions are
 * NOT here — they are server constants delivered by `POST /api/agents/quill`.
 * Keeping them out of the client is what lets QuickWork update Quill's prompt by
 * deploying, and stops a client from minting an agent that claims Quill's
 * identity.
 *
 * The chat title stays client-side: it names a session this member is opening,
 * in the language they are currently using.
 */
const QUILL_CHAT_TITLE: LocalizedText = {
  en: "Getting started with Quill",
  zh: "和 Quill 开始",
  ko: "Quill와 시작하기",
  ja: "Quill と始める",
};

export function getQuillOnboarding(
  lang: QuillContentLang,
): QuillOnboardingDefinition {
  return {
    title: QUILL_CHAT_TITLE[lang],
    language: lang,
  };
}
