"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@quickwork/core/api";
import { useAuthStore } from "@quickwork/core/auth";
import {
  workspaceKeys,
  workspaceListOptions,
} from "@quickwork/core/workspace/queries";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@quickwork/core/paths";
import { AppLink, useNavigation } from "../navigation";
import { useLogout } from "../auth";
import { DragStrip } from "../platform";
import { useLocale, useT } from "../i18n";
import { ArrowLeft, ArrowRight, Check, LogOut, Zap } from "lucide-react";

export interface InvitePageProps {
  invitationId: string;
  /**
   * Optional "go back" handler. Caller passes it only when there's a
   * sensible destination (user has at least one workspace, or arrived
   * from an in-app flow). Omitted on first-invite/zero-workspace paths
   * where Back would have nowhere to go — Log out is then the only exit.
   */
  onBack?: () => void;
}

/**
 * Full-page shell for the "accept invitation" transition. Shared between
 * web (Next.js route `/invite/[id]`) and desktop (window-overlay).
 */
export function InvitePage({ invitationId, onBack }: InvitePageProps) {
  const { t } = useT("invite");
  const locale = useLocale();
  const { push } = useNavigation();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<"accepted" | "declined" | null>(null);

  const { data: invitation, isLoading, error: fetchError } = useQuery({
    queryKey: ["invitation", invitationId],
    queryFn: () => api.getInvitation(invitationId),
  });

  const { data: wsList = [] } = useQuery(workspaceListOptions());
  const hasOnboarded = useHasOnboarded();
  const fallbackDest = resolvePostAuthDestination(wsList, hasOnboarded);

  const handleAccept = async () => {
    setAccepting(true);
    setError(null);
    try {
      await api.acceptInvitation(invitationId);
      await api.markOnboardingComplete({
        completion_path: "invite_accept",
        workspace_id: invitation?.workspace_id,
      });
      await useAuthStore.getState().refreshMe();
      setDone("accepted");
      const nextList = await qc.fetchQuery({
        ...workspaceListOptions(),
        staleTime: 0,
      });
      const joined = nextList.find((w) => w.id === invitation?.workspace_id);
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
      const dest = joined
        ? paths.workspace(joined.slug).tasks()
        : fallbackDest;
      setTimeout(() => push(dest), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.errors.accept_failed));
    } finally {
      setAccepting(false);
    }
  };

  const handleDecline = async () => {
    setDeclining(true);
    setError(null);
    try {
      await api.declineInvitation(invitationId);
      setDone("declined");
      qc.invalidateQueries({ queryKey: workspaceKeys.myInvitations() });
    } catch (e) {
      setError(e instanceof Error ? e.message : t(($) => $.errors.decline_failed));
    } finally {
      setDeclining(false);
    }
  };

  const dateFormatter = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const formatDate = (value?: string | null) => {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : dateFormatter.format(date);
  };

  if (isLoading) {
    return (
      <InviteFrame onBack={onBack}>
        <InviteStatusPaper
          title={t(($) => $.loading.title)}
          description={t(($) => $.loading.description)}
        />
      </InviteFrame>
    );
  }

  if (fetchError || !invitation) {
    return (
      <InviteFrame onBack={onBack}>
        <InviteStatusPaper
          title={t(($) => $.not_found.title)}
          description={t(($) => $.not_found.description)}
          action={
            <AppLink href={fallbackDest} className="qw-inv-accept">
              {t(($) => $.not_found.go_to_dashboard)}
            </AppLink>
          }
        />
      </InviteFrame>
    );
  }

  if (done === "accepted") {
    return (
      <InviteFrame onBack={onBack}>
        <InviteStatusPaper
          icon={<Check aria-hidden="true" />}
          title={t(($) => $.accepted.title, {
            workspace_name: invitation.workspace_name,
          })}
          description={t(($) => $.accepted.redirecting)}
        />
      </InviteFrame>
    );
  }

  if (done === "declined") {
    return (
      <InviteFrame onBack={onBack}>
        <InviteStatusPaper
          title={t(($) => $.declined.title)}
          description={t(($) => $.declined.description)}
          action={
            <AppLink href={fallbackDest} className="qw-inv-accept">
              {t(($) => $.declined.go_to_dashboard)}
            </AppLink>
          }
        />
      </InviteFrame>
    );
  }

  const inviter = invitation.inviter_name || invitation.inviter_email || "—";
  const role =
    invitation.role === "admin" ? t(($) => $.roles.admin) : t(($) => $.roles.member);
  const workspaceName =
    invitation.workspace_name ?? t(($) => $.main.fallback_workspace_name);
  const badge = workspaceName.slice(0, 1).toUpperCase();
  const shortNo = invitation.id.slice(0, 8).toUpperCase();
  const isExpired = invitation.status !== "pending";
  const isAlreadyHandled =
    invitation.status === "accepted" || invitation.status === "declined";

  return (
    <InviteFrame onBack={onBack} no={shortNo}>
      <div className="qw-inv-copy">
        <div className="qw-inv-kicker">
          <i aria-hidden="true" />
          {t(($) => $.console.kicker)}
        </div>
        <h1>
          {t(($) => $.console.headline_prefix)} <span>{workspaceName}</span>
          <br />
          {t(($) => $.console.headline_suffix)}
        </h1>
        <p>
          <b>{inviter}</b> {t(($) => $.console.copy_as)} <b>{role}</b>.{" "}
          {t(($) => $.console.copy_rest)}
        </p>

        <div className="qw-inv-relay">
          <div className="qw-inv-relay-head">
            {t(($) => $.console.relay_label)}
            <b>{t(($) => $.console.relay_eng)}</b>
          </div>
          <ul className="qw-inv-legs">
            <li className="qw-inv-leg">
              <span className="qw-inv-leg-ava">
                {inviter.slice(0, 1).toUpperCase()}
              </span>
              <span className="qw-inv-leg-main">
                <span className="qw-inv-leg-k">
                  {t(($) => $.console.leg_prev_label)}
                </span>
                <span className="qw-inv-leg-sub">
                  {t(($) => $.console.leg_prev_sub)}
                </span>
              </span>
              <span className="qw-inv-leg-state done">
                {t(($) => $.console.state_done)}
              </span>
            </li>
            <li className="qw-inv-leg me">
              <span className="qw-inv-leg-ava">
                {t(($) => $.console.you_initial)}
              </span>
              <span className="qw-inv-leg-main">
                <span className="qw-inv-leg-k">
                  {t(($) => $.console.leg_you_label)}
                </span>
                <span className="qw-inv-leg-sub">
                  {t(($) => $.console.leg_you_sub)}
                </span>
              </span>
              <span className="qw-inv-leg-state next">
                {t(($) => $.console.state_now)}
              </span>
            </li>
            <li className="qw-inv-leg">
              <span className="qw-inv-leg-ava">{t(($) => $.console.agent_initial)}</span>
              <span className="qw-inv-leg-main">
                <span className="qw-inv-leg-k">
                  {t(($) => $.console.leg_next_label)}
                </span>
                <span className="qw-inv-leg-sub">
                  {t(($) => $.console.leg_next_sub)}
                </span>
              </span>
              <span className="qw-inv-leg-state later">
                {t(($) => $.console.state_wait)}
              </span>
            </li>
          </ul>
          <p className="qw-inv-relay-note">
            <i aria-hidden="true" />
            {t(($) => $.console.relay_note)}
          </p>
        </div>
      </div>

      <article className="qw-inv-paper">
        <div className="qw-inv-paper-head">
          <span className="qw-inv-paper-kicker">
            <i aria-hidden="true" />
            {t(($) => $.console.paper_kicker)}
          </span>
          <span className="qw-inv-paper-no">{t(($) => $.console.no_prefix)} {shortNo}</span>
        </div>

        <div className="qw-inv-ws">
          <span className="qw-inv-ws-badge">{badge}</span>
          <div className="qw-inv-ws-main">
            <h2>{workspaceName}</h2>
            <span>{t(($) => $.console.workspace_path)}</span>
          </div>
          <span className="qw-inv-ws-tag">{t(($) => $.console.workspace_tag)}</span>
        </div>

        <p className="qw-inv-lead">
          <b>{inviter}</b> {t(($) => $.console.lead_invite)} <b>{role}</b>
          {t(($) => $.console.lead_end, { workspace: workspaceName })}
        </p>

        <dl className="qw-inv-facts">
          <div>
            <dt>{t(($) => $.console.fact_inviter)}</dt>
            <dd>
              <span className="qw-inv-mini-ava">
                {inviter.slice(0, 1).toUpperCase()}
              </span>
              <b>{inviter}</b>
            </dd>
          </div>
          <div>
            <dt>{t(($) => $.console.fact_role)}</dt>
            <dd>
              <b>{role}</b>
              <span className="qw-inv-role-tag">{invitation.role}</span>
            </dd>
          </div>
          <div>
            <dt>{t(($) => $.console.fact_valid)}</dt>
            <dd>{formatDate(invitation.expires_at)}</dd>
          </div>
        </dl>

        <div className="qw-inv-paper-note">
          <Zap aria-hidden="true" />
          <p>{t(($) => $.console.paper_note)}</p>
        </div>

        <div className="qw-inv-reply">
          <span className="qw-inv-reply-tag">{t(($) => $.console.reply_tag)}</span>
          <div className="qw-inv-reply-head">
            <span>{t(($) => $.console.reply_as, { role })}</span>
            <span className="qw-inv-reply-valid">
              {t(($) => $.console.reply_valid, {
                date: formatDate(invitation.expires_at),
              })}
            </span>
          </div>

          {isAlreadyHandled ? (
            <p className="qw-inv-status-line">
              {invitation.status === "accepted"
                ? t(($) => $.main.already_handled_accepted)
                : t(($) => $.main.already_handled_declined)}
            </p>
          ) : isExpired ? (
            <p className="qw-inv-status-line">{t(($) => $.main.expired)}</p>
          ) : (
            <div className="qw-inv-actions">
              <button
                type="button"
                className="qw-inv-accept"
                onClick={handleAccept}
                disabled={accepting || declining}
              >
                {accepting ? t(($) => $.main.joining) : t(($) => $.main.accept)}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="qw-inv-decline"
                onClick={handleDecline}
                disabled={accepting || declining}
              >
                {declining ? t(($) => $.main.declining) : t(($) => $.main.decline)}
              </button>
            </div>
          )}

          {error ? (
            <p className="qw-inv-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="qw-inv-paper-foot">
          <span>{t(($) => $.console.other_account_hint)}</span>
          <LogoutLink />
          <span className="qw-inv-paper-seal" aria-hidden="true">
            {t(($) => $.console.brand_initial)}
          </span>
        </footer>
      </article>
    </InviteFrame>
  );
}

function LogoutLink() {
  const { t } = useT("invite");
  const logout = useLogout();
  return (
    <button type="button" className="qw-inv-other" onClick={logout}>
      {t(($) => $.header.log_out)}
    </button>
  );
}

function InviteFrame({
  onBack,
  no,
  children,
}: {
  onBack?: () => void;
  no?: string;
  children: ReactNode;
}) {
  const { t } = useT("invite");
  const logout = useLogout();
  return (
    <div className="qw-inv-screen">
      <DragStrip />
      <div className="qw-inv-top">
        <span className="qw-inv-mark">{t(($) => $.console.brand_initial)}</span>
        <span className="qw-inv-word">{t(($) => $.console.wordmark)}</span>
        <span className="qw-inv-top-note">{t(($) => $.console.top_note)}</span>
        {onBack ? (
          <button type="button" className="qw-inv-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            {t(($) => $.header.back)}
          </button>
        ) : null}
        {no ? (
          <span className="qw-inv-top-no">
            {t(($) => $.console.no_prefix)} {no}
          </span>
        ) : null}
        <button type="button" className="qw-inv-top-logout" onClick={logout}>
          <LogOut aria-hidden="true" />
          {t(($) => $.header.log_out)}
        </button>
      </div>
      <div className="qw-inv-center">{children}</div>
      <footer className="qw-inv-foot">
        <span>{t(($) => $.console.footer_left)}</span>
        <span>{t(($) => $.console.footer_right)}</span>
      </footer>
    </div>
  );
}

function InviteStatusPaper({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  const { t } = useT("invite");
  return (
    <article className="qw-inv-paper qw-inv-paper-status">
      <span className="qw-inv-status-mark">
        {icon ?? t(($) => $.console.brand_initial)}
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action ? <div className="qw-inv-status-action">{action}</div> : null}
    </article>
  );
}
