"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InboxItem, RelayActivityEvent } from "@quickwork/core/types";
import { activityListOptions } from "@quickwork/core/activity/queries";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { deduplicateInboxItems, inboxListOptions } from "@quickwork/core/inbox/queries";

import { AppLink } from "../../navigation";
import { useLocale, useT } from "../../i18n";

type ActivityFilter = "all" | "pass" | "return" | "admin";

const ACTION_DOT: Record<string, string> = {
  relay_approved: "pass",
  relay_returned: "return",
  relay_reassigned: "reassign",
  relay_skipped: "skip",
};

function dayStamp(date: Date): number {
  return date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
}

function todoKind(item: InboxItem): "review" | "parked" {
  const state = (item.details as Record<string, unknown> | null)?.state;
  return state === "parked" ? "parked" : "review";
}

function todoLeg(item: InboxItem): number {
  const position = Number((item.details as Record<string, unknown> | null)?.position);
  return Number.isFinite(position) ? position + 1 : 0;
}

/**
 * The workspace activity page: only the decisions that change where the relay
 * goes — approve, return, reassign, skip. Runs, comments and parking stay on
 * the task. Pending relay turns sit in a band at the top, which is what the
 * sidebar entry that used to be "notifications" now leads to.
 */
export function ActivityPage() {
  const { t } = useT("activity");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const { getMemberName } = useActorName();
  const [filter, setFilter] = useState<ActivityFilter>("all");

  const { data: events = [], isPending } = useQuery(activityListOptions(wsId));
  const { data: inboxItems = [] } = useQuery(inboxListOptions(wsId));

  const unreadInbox = useMemo(
    () => deduplicateInboxItems(inboxItems).filter((item) => !item.read && !item.archived),
    [inboxItems],
  );
  const todos = useMemo(
    () => unreadInbox.filter((item) => item.type === "relay_turn").slice(0, 2),
    [unreadInbox],
  );
  // Everything else that is waiting (mentions, comments, status changes) is
  // not dropped just because the log only keeps relay decisions: it collapses
  // into one quiet row that leads back to the full notifications page.
  const otherUnread = useMemo(
    () => unreadInbox.filter((item) => item.type !== "relay_turn").length,
    [unreadInbox],
  );

  const counts = useMemo(() => {
    const next = { pass: 0, return: 0, admin: 0, adminWeek: 0 };
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const event of events) {
      if (event.action === "relay_approved") next.pass += 1;
      else if (event.action === "relay_returned") next.return += 1;
      else if (
        event.action === "relay_reassigned" ||
        event.action === "relay_skipped"
      ) {
        next.admin += 1;
      }
      if (event.admin && new Date(event.created_at).getTime() >= weekAgo) {
        next.adminWeek += 1;
      }
    }
    return next;
  }, [events]);

  const visible = useMemo(
    () =>
      events.filter((event) => {
        if (filter === "all") return true;
        if (filter === "pass") return event.action === "relay_approved";
        if (filter === "return") return event.action === "relay_returned";
        return (
          event.action === "relay_reassigned" || event.action === "relay_skipped"
        );
      }),
    [events, filter],
  );

  const groups = useMemo(() => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const todayStamp = dayStamp(today);
    const yesterdayStamp = dayStamp(yesterday);
    const dateFormat = new Intl.DateTimeFormat(locale, {
      month: "long",
      day: "numeric",
    });
    const groupsOut: { key: number; label: string; events: RelayActivityEvent[] }[] =
      [];
    for (const event of visible) {
      const date = new Date(event.created_at);
      const stamp = dayStamp(date);
      const label =
        stamp === todayStamp
          ? t(($) => $.today, { date: dateFormat.format(date) })
          : stamp === yesterdayStamp
            ? t(($) => $.yesterday, { date: dateFormat.format(date) })
            : dateFormat.format(date);
      const last = groupsOut[groupsOut.length - 1];
      if (last && last.key === stamp) last.events.push(event);
      else groupsOut.push({ key: stamp, label, events: [event] });
    }
    return groupsOut;
  }, [visible, locale, t]);

  const timeFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    [locale],
  );

  const describe = (event: RelayActivityEvent) => {
    const leg = event.leg;
    switch (event.action) {
      case "relay_approved":
        return <span className="act-verb">{t(($) => $.verb_approved, { leg })}</span>;
      case "relay_returned":
        return (
          <span className="act-verb">{t(($) => $.verb_returned, { leg })}</span>
        );
      case "relay_reassigned":
        return (
          <span className="act-verb">
            {t(($) => $.verb_reassigned, {
              leg,
              name: event.to_user_id ? getMemberName(event.to_user_id) : "—",
            })}
          </span>
        );
      case "relay_skipped":
        return <span className="act-verb">{t(($) => $.verb_skipped, { leg })}</span>;
      default:
        return <span className="act-verb">{event.action}</span>;
    }
  };

  return (
    <div className="act-main">
      <div className="act-wrap">
        <header className="act-head">
          <p className="act-kicker">{t(($) => $.kicker)}</p>
          <h1 className="act-title">
            {t(($) => $.title)}
            <span className="act-sub">{t(($) => $.sub)}</span>
          </h1>
        </header>

        {todos.length > 0 || otherUnread > 0 ? (
          <section className="act-pending">
            {todos.length > 0 ? (
              <div className="act-todo" aria-label={t(($) => $.todo_label, { count: todos.length })}>
                <span className="act-todo-label">
                  {t(($) => $.todo_label, { count: todos.length })}
                </span>
                {todos.map((item) => {
                  const kind = todoKind(item);
                  const hint =
                    kind === "parked"
                      ? t(($) => $.todo_hint_parked, { leg: todoLeg(item) })
                      : t(($) => $.todo_hint_review, { leg: todoLeg(item) });
                  return (
                    <AppLink
                      key={item.id}
                      className="act-todo-item"
                      href={item.issue_id ? paths.issueDetail(item.issue_id) : paths.tasks()}
                    >
                      <b>{kind === "parked" ? t(($) => $.todo_parked) : t(($) => $.todo_review)}</b>
                      <small>
                        {item.title} · {hint}
                      </small>
                      <em>
                        {kind === "parked"
                          ? t(($) => $.todo_open_parked)
                          : t(($) => $.todo_open_review)}
                      </em>
                    </AppLink>
                  );
                })}
              </div>
            ) : null}
            {otherUnread > 0 ? (
              <AppLink className="act-more" href={paths.inbox()}>
                {t(($) => $.more_notifications, { count: otherUnread })}
              </AppLink>
            ) : null}
          </section>
        ) : null}

        <div className="act-filters">
          <button
            type="button"
            className={filter === "all" ? "act-filter on" : "act-filter"}
            onClick={() => setFilter("all")}
          >
            {t(($) => $.filter_all)}
          </button>
          <button
            type="button"
            className={filter === "pass" ? "act-filter on" : "act-filter"}
            onClick={() => setFilter("pass")}
          >
            {t(($) => $.filter_pass)} <em>{counts.pass}</em>
          </button>
          <button
            type="button"
            className={filter === "return" ? "act-filter on" : "act-filter"}
            onClick={() => setFilter("return")}
          >
            {t(($) => $.filter_return)} <em>{counts.return}</em>
          </button>
          <button
            type="button"
            className={filter === "admin" ? "act-filter on" : "act-filter"}
            onClick={() => setFilter("admin")}
          >
            {t(($) => $.filter_admin)} <em>{counts.admin}</em>
          </button>
          <span className="act-week">
            {t(($) => $.week_note, { count: counts.adminWeek })}
          </span>
        </div>

        {isPending ? (
          <p className="act-empty">…</p>
        ) : groups.length === 0 ? (
          <p className="act-empty">{t(($) => $.empty)}</p>
        ) : (
          groups.map((group) => (
            <div key={group.key}>
              <div className="act-day">
                <span>{group.label}</span>
                <em>{group.events.length}</em>
              </div>
              {group.events.map((event) => (
                <div key={event.id} className="act-row">
                  <span className="act-time">
                    {timeFormat.format(new Date(event.created_at))}
                  </span>
                  <span className={`act-dot ${ACTION_DOT[event.action] ?? ""}`} />
                  <div className="act-line">
                    <p>
                      <b>{getMemberName(event.actor_id)}</b> {describe(event)}
                      <AppLink
                        className="act-task"
                        href={paths.issueDetail(event.issue_id)}
                      >
                        {event.identifier}
                      </AppLink>
                      {event.admin ? (
                        <span className="act-admin">{t(($) => $.admin)}</span>
                      ) : null}
                      {event.id === events[0]?.id &&
                      Date.now() - new Date(event.created_at).getTime() < 60_000 ? (
                        <span className="act-live">
                          <i />
                          {t(($) => $.just_now)}
                        </span>
                      ) : null}
                    </p>
                    {event.reason ? <p className="act-reason">{event.reason}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          ))
        )}

        <p className="act-note">{t(($) => $.note)}</p>
      </div>
    </div>
  );
}
