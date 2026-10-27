"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@quickwork/ui/lib/utils";

interface SoloIssueViewProps {
  /** The scroll container the page lives in — drives the sticky summary. */
  scrollContainerEl: HTMLDivElement | null;
  sticky: ReactNode;
  header: ReactNode;
  propsStrip: ReactNode;
  /** Delivery is null when the task has no artifacts; context then leads. */
  delivery: ReactNode | null;
  brief: ReactNode;
  clarification: ReactNode;
  execution: ReactNode;
  subIssues: ReactNode | null;
  discussion: ReactNode;
  composer: ReactNode;
}

/**
 * S3 delivery-first layout for a plain (non-relay) issue.
 *
 * Delivery above the brief is the point: an image/document task should show
 * its result before the instructions. The requirement clarification sits
 * beside the brief — never in a rail. This component only owns reading order
 * and the scroll summary; all content and handlers stay in IssueDetail.
 */
export function SoloIssueView({
  scrollContainerEl,
  sticky,
  header,
  propsStrip,
  delivery,
  brief,
  clarification,
  execution,
  subIssues,
  discussion,
  composer,
}: SoloIssueViewProps) {
  const headerRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    if (!scrollContainerEl) return;
    const update = () => {
      const threshold = headerRef.current?.offsetHeight ?? 150;
      setStuck(scrollContainerEl.scrollTop > Math.max(24, threshold - 4));
    };
    scrollContainerEl.addEventListener("scroll", update, { passive: true });
    update();
    return () => scrollContainerEl.removeEventListener("scroll", update);
  }, [scrollContainerEl]);

  return (
    <div className="qw-solo-page">
      <div className={cn("qw-solo-sticky", stuck && "is-stuck")}>
        <div className="qw-solo-sticky-inner">{sticky}</div>
      </div>

      <div className="qw-solo-header" ref={headerRef}>
        {header}
      </div>

      {propsStrip}

      {delivery}

      <div className="qw-solo-context">
        <div className="qw-solo-context-main">{brief}</div>
        <div className="qw-solo-context-side">{clarification}</div>
      </div>

      {execution}
      {subIssues}

      <div className="qw-solo-discussion">{discussion}</div>
      {composer}
    </div>
  );
}
