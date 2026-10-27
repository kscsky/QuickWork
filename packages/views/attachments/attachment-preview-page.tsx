"use client";

/**
 * Full-page attachment viewer.
 *
 * HTML attachments render through the same scroll-preserving sandboxed iframe
 * as the inline preview. Images load through the authenticated download proxy
 * (an object URL), so split-origin web and the desktop file:// renderer both
 * get the bytes without relying on storage CORS. Other textual files render
 * read-only; PDFs fall back to the browser's viewer; everything else offers
 * the original download.
 *
 * The route is workspace-scoped (`/{slug}/attachments/{id}/preview`) for
 * tenancy isolation; the API proxy is already auth-checked.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  FileText,
  X,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@quickwork/core/types";
import { api } from "@quickwork/core/api";
import { useWorkspaceId } from "@quickwork/core/hooks";
import { useWorkspacePaths } from "@quickwork/core/paths";
import { issueDetailOptions } from "@quickwork/core/issues/queries";
import { useActorName } from "@quickwork/core/workspace/hooks";
import { resolvePublicFileUrl } from "@quickwork/core/workspace/avatar-url";
import { ActorAvatar as ActorAvatarBase } from "@quickwork/ui/components/common/actor-avatar";
import { copyText } from "@quickwork/ui/lib/clipboard";
import { useNavigation } from "../navigation";
import { useLocale, useT } from "../i18n";
import { openExternal } from "../platform";
import { useAttachmentHtmlText } from "../editor/hooks/use-attachment-html-text";
import { useHtmlPreviewScrollRestore } from "./use-html-preview-scroll-restore";

interface AttachmentPreviewPageProps {
  attachmentId: string;
  /** Optional display name. Falls back to the server metadata filename. */
  filename?: string;
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileTypeLabel(attachment: Attachment | undefined): string {
  if (!attachment) return "FILE";
  const subtype = attachment.content_type.split("/")[1]?.split(";")[0]?.trim();
  if (subtype) return subtype.replace(/[^a-z0-9]/gi, "").toUpperCase().slice(0, 5);
  const ext = attachment.filename.split(".").pop();
  return ext ? ext.toUpperCase().slice(0, 5) : "FILE";
}

export function AttachmentPreviewPage({
  attachmentId,
  filename,
}: AttachmentPreviewPageProps) {
  const { t } = useT("editor");
  const locale = useLocale();
  const wsId = useWorkspaceId();
  const paths = useWorkspacePaths();
  const navigation = useNavigation();
  const { getActorName, getActorAvatarUrl } = useActorName();

  const metadataQuery = useQuery({
    queryKey: ["attachment", attachmentId],
    queryFn: () => api.getAttachment(attachmentId),
    staleTime: 60_000,
  });
  const attachment = metadataQuery.data;
  const contentType = attachment?.content_type ?? "";
  const isImage = contentType.startsWith("image/");
  const isHtml = contentType === "text/html" || contentType === "application/xhtml+xml";
  const isText =
    !isHtml &&
    (contentType.startsWith("text/") ||
      contentType === "application/json" ||
      contentType === "application/xml");
  const isPdf = contentType === "application/pdf";

  const issueId = attachment?.issue_id ?? null;
  const { data: issue = null } = useQuery({
    ...issueDetailOptions(wsId, issueId ?? ""),
    enabled: !!issueId,
  });

  const textQuery = useAttachmentHtmlText(isHtml || isText ? attachmentId : null);
  const text = textQuery.data?.text;

  const binaryQuery = useQuery({
    queryKey: ["attachment-blob", attachmentId],
    queryFn: () => api.getAttachmentBlob(attachmentId),
    enabled: isImage || isPdf,
    retry: false,
    staleTime: 5 * 60_000,
  });
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!binaryQuery.data) {
      setObjectUrl(null);
      return;
    }
    const url = URL.createObjectURL(binaryQuery.data);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [binaryQuery.data]);

  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(
    null,
  );
  const { contentKey, buildSrcDoc, iframeRef, onLoad } =
    useHtmlPreviewScrollRestore(text);

  const displayName = filename || attachment?.filename || t(($) => $.attachment.console.untitled);
  useEffect(() => {
    document.title = displayName;
  }, [displayName]);

  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    [locale],
  );
  const uploadedAt = attachment?.created_at
    ? dateFormatter.format(new Date(attachment.created_at))
    : "—";

  const downloadUrl =
    attachment?.attachment_download_url ?? attachment?.download_url ?? null;

  const handleDownload = () => {
    if (!downloadUrl) {
      toast.error(t(($) => $.attachment.download_failed));
      return;
    }
    openExternal(downloadUrl);
  };

  const handleCopyLink = async () => {
    const ok = await copyText(
      typeof window === "undefined" ? "" : window.location.href,
    );
    if (ok) toast.success(t(($) => $.attachment.console.copy_link_success));
    else toast.error(t(($) => $.attachment.console.copy_link_failed));
  };

  const handleOpenTask = () => {
    if (issueId) navigation.push(paths.issueDetail(issueId));
    else navigation.back();
  };

  const loading = metadataQuery.isLoading;
  const error = !loading && (!!metadataQuery.error || !attachment);

  return (
    <div className="qw-apv-page">
      <section className="qw-apv-shell" aria-label={displayName}>
        <header className="qw-apv-bar">
          <button type="button" className="qw-apv-back" onClick={handleOpenTask}>
            <ArrowLeft aria-hidden="true" />
            {issueId
              ? t(($) => $.attachment.console.back)
              : t(($) => $.attachment.close)}
          </button>
          <span className="qw-apv-crumb">
            <b>{issue?.identifier ?? t(($) => $.attachment.console.file_crumb)}</b>
            <span className="slash">/</span>
            <span>{t(($) => $.attachment.console.crumb)}</span>
            <span className="slash">/</span>
            <span>{t(($) => $.attachment.console.stage_index)}</span>
          </span>
          <div className="qw-apv-bar-actions">
            <button
              type="button"
              className="qw-apv-act primary"
              onClick={handleDownload}
              disabled={!downloadUrl}
            >
              <Download aria-hidden="true" />
              {t(($) => $.attachment.console.download)}
            </button>
            <button type="button" className="qw-apv-act" onClick={() => void handleCopyLink()}>
              <Copy aria-hidden="true" />
              {t(($) => $.attachment.console.copy_link)}
            </button>
            {issueId ? (
              <button type="button" className="qw-apv-act" onClick={handleOpenTask}>
                <ExternalLink aria-hidden="true" />
                {t(($) => $.attachment.console.open_task)}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            className="qw-apv-close"
            onClick={() => navigation.back()}
            aria-label={t(($) => $.attachment.console.close)}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="qw-apv-body">
          <div className="qw-apv-stage">
            <div className="qw-apv-stagehead">
              <span>{t(($) => $.attachment.console.stage_head)}</span>
              <span className="rule" />
              <span>
                {t(($) => $.attachment.console.stage_screen)}{" "}
                <b>{t(($) => $.attachment.console.stage_index)}</b>
              </span>
              <span className="ro">
                {t(($) => $.attachment.console.stage_original)}
              </span>
            </div>

            <div className="qw-apv-mat">
              <div className="qw-apv-frame">
                {loading || (isHtml && textQuery.isLoading) || (isImage && binaryQuery.isLoading) ? (
                  <div className="qw-apv-state">
                    {t(($) => $.attachment.preview_loading)}
                  </div>
                ) : error || (isHtml && textQuery.error) || (isPdf && binaryQuery.error) || (isImage && binaryQuery.error) ? (
                  <div className="qw-apv-state" data-testid="attachment-preview-page-error">
                    {t(($) => $.attachment.preview_failed)}
                  </div>
                ) : isImage && objectUrl ? (
                  <img
                    className="qw-apv-image"
                    src={objectUrl}
                    alt={displayName}
                    onLoad={(event) =>
                      setDimensions({
                        w: event.currentTarget.naturalWidth,
                        h: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                ) : isHtml ? (
                  <iframe
                    key={contentKey}
                    ref={iframeRef}
                    onLoad={onLoad}
                    srcDoc={buildSrcDoc(text as string)}
                    sandbox="allow-scripts"
                    title={displayName}
                    className="qw-apv-iframe"
                  />
                ) : isText ? (
                  <pre className="qw-apv-text">{text ?? ""}</pre>
                ) : isPdf && objectUrl ? (
                  <iframe
                    src={objectUrl}
                    title={displayName}
                    className="qw-apv-iframe"
                  />
                ) : (
                  <div className="qw-apv-state">
                    <FileText aria-hidden="true" className="size-6" />
                    {t(($) => $.attachment.preview_unsupported)}
                    <button type="button" onClick={handleDownload} disabled={!downloadUrl}>
                      {t(($) => $.attachment.console.download)}
                    </button>
                  </div>
                )}
              </div>
            </div>

            <footer className="qw-apv-stagefoot">
              <span className="qw-apv-pos">
                {t(($) => $.attachment.console.stage_index)}
              </span>
              <span className="qw-apv-caption">{displayName}</span>
              <span className="qw-apv-fit">
                {t(($) => $.attachment.console.stage_fit)}
              </span>
              <span className="qw-apv-dims">
                {dimensions ? `${dimensions.w} × ${dimensions.h}` : "—"}
              </span>
            </footer>
          </div>

          <aside className="qw-apv-rail" aria-label={t(($) => $.attachment.console.crumb)}>
            <div className="qw-apv-rail-inner">
              <div className="qw-apv-filehead">
                <span className="qw-apv-filetype">{fileTypeLabel(attachment)}</span>
                <div className="qw-apv-filemain">
                  <div className="qw-apv-kicker">
                    {t(($) => $.attachment.console.file_kicker)}
                    <span className="qw-apv-readonly">
                      {t(($) => $.attachment.console.read_only)}
                    </span>
                  </div>
                  <h2 className="qw-apv-name">{displayName}</h2>
                </div>
              </div>

              <div className="qw-apv-facts">
                <div className="qw-apv-fact">
                  <span className="k">{t(($) => $.attachment.console.fact_size)}</span>
                  <span className="v">{formatBytes(attachment?.size_bytes)}</span>
                </div>
                <div className="qw-apv-fact">
                  <span className="k">{t(($) => $.attachment.console.fact_type)}</span>
                  <span className="v">{contentType || "—"}</span>
                </div>
                <div className="qw-apv-fact">
                  <span className="k">
                    {t(($) => $.attachment.console.fact_uploaded)}
                  </span>
                  <span className="v">
                    {attachment ? (
                      <span className="qw-apv-owner">
                        <span className="av">
                          <ActorAvatarBase
                            name={getActorName(
                              attachment.uploader_type,
                              attachment.uploader_id,
                            )}
                            initials={getActorName(
                              attachment.uploader_type,
                              attachment.uploader_id,
                            )
                              .slice(0, 2)
                              .toUpperCase()}
                            avatarUrl={resolvePublicFileUrl(
                              getActorAvatarUrl(
                                attachment.uploader_type,
                                attachment.uploader_id,
                              ),
                            )}
                            isAgent={attachment.uploader_type === "agent"}
                            size="sm"
                          />
                        </span>
                        <span>
                          <span>
                            {getActorName(
                              attachment.uploader_type,
                              attachment.uploader_id,
                            )}
                          </span>
                          <span className="sub">
                            {attachment.uploader_type === "agent"
                              ? t(($) => $.attachment.console.uploader_agent)
                              : t(($) => $.attachment.console.uploader_member)}
                          </span>
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </span>
                </div>
                <div className="qw-apv-fact">
                  <span className="k">{t(($) => $.attachment.console.fact_date)}</span>
                  <span className="v">{uploadedAt}</span>
                </div>
              </div>

              {issue ? (
                <div className="qw-apv-taskcard">
                  <div className="qw-apv-kicker">
                    {t(($) => $.attachment.console.task_kicker)}
                  </div>
                  <button type="button" className="qw-apv-task" onClick={handleOpenTask}>
                    <span className="qw-apv-task-code">{issue.identifier}</span>
                    <span className="qw-apv-task-title">{issue.title}</span>
                    <ExternalLink aria-hidden="true" />
                  </button>
                </div>
              ) : null}

              <p className="qw-apv-note">
                <Zap aria-hidden="true" />
                {t(($) => $.attachment.console.note)}
              </p>

              <div className="qw-apv-archive">
                <div className="qw-apv-kicker">
                  {t(($) => $.attachment.console.archive_kicker)}
                </div>
                <div className="qw-apv-archive-row">
                  <span>{t(($) => $.attachment.console.archive_access)}</span>
                  <span>{t(($) => $.attachment.console.archive_access_value)}</span>
                </div>
                <div className="qw-apv-archive-row">
                  <span>{t(($) => $.attachment.console.archive_id)}</span>
                  <span>{attachment?.id.slice(0, 8).toUpperCase() ?? "—"}</span>
                </div>
              </div>

              <div className="qw-apv-railfoot">
                <span>
                  {t(($) => $.attachment.console.archive_state)}
                </span>
                <span className="seal">
                  <i aria-hidden="true" />
                  {t(($) => $.attachment.console.read_only)}
                </span>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
