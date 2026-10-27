---
name: quickwork-relay-leg-output
description: "Use when your holder asks for this relay leg's output (产出) — write the leg's handoff document summarizing the leg's conversation and results, as one markdown comment."
user-invocable: false
allowed-tools: Bash(quickwork *)
---

# Relay Leg Output

A squad task runs as a relay (接力): an ordered set of legs, each held by one
person and run on the agent that person lends. When a leg is done, its holder
asks you for **the leg's output** — and this skill is how you write it.

The output is ONE markdown document that summarizes **this leg only**: what the
holder asked, what you and they discussed and decided, and what was actually
delivered. It is the leg's deliverable — the holder reviews it, and on approval
it travels with the handoff package to the next leg.

## What goes in the document

Write it so a reader who was NOT in this leg can act on it:

1. **The ask** — the goal this leg worked on, in one or two sentences
   (the holder's brief, if they wrote one, goes here in their own terms).
2. **What was discussed and decided** — the conversation's substance: options
   weighed, decisions made and why, corrections along the way. Decisions are
   the part future legs most need; keep the reasoning one line each.
3. **What was delivered** — concrete outputs: files produced (name them),
   branches/PRs, links, key findings with their numbers. Point at the actual
   artifact, do not restate its whole content.
4. **Open items / risks** — anything unresolved, assumed, or worth watching,
   each with what the next leg should do about it.
5. **For the next leg** — the one or two things they must know or do first.

Keep it tight: a good output reads in two minutes. Markdown headings and
bullet lists; no walls of text.

## Rules

- **Only this leg.** Summarize the conversation and runs that belong to this
  leg. Do not invent work that was not done, and do not paste content from
  other legs or the room as if it were this leg's output.
- **No questions.** This is a delivery, not a chat turn. If something is
  unresolved, record it under Open items — your holder reviews the document
  and decides.
- **One comment, markdown only.** Post the final document as a single comment
  on this issue: the comment body IS the document — no preamble like "here is
  the summary", no trailing commentary. The holder's client lifts the comment
  straight into the handoff.
- **Write in the holder's language.** The document follows the language the
  holder used in this leg's conversation.
