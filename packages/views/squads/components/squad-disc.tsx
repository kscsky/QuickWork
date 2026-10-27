"use client";

import type { CSSProperties } from "react";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";

import { squadAccent, squadInitial } from "./squads-console-model";

export function SquadDisc({
  id,
  name,
  avatarUrl,
  className = "qw-sq-stack-disc",
}: {
  id: string;
  name: string;
  avatarUrl: string | null;
  className?: string;
}) {
  const classes = className ?? "qw-sq-stack-disc";
  const url = resolvePublicFileUrl(avatarUrl);
  if (url) {
    return <img className={classes} src={url} alt="" />;
  }
  return (
    <span
      className={classes}
      style={{ "--ac": squadAccent(id) } as CSSProperties}
      aria-hidden="true"
    >
      {squadInitial(name)}
    </span>
  );
}
