"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  X,
} from "lucide-react";
import { api } from "@quickwork/core/api";
import type { Attachment } from "@quickwork/core/types";
import { Button } from "@quickwork/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@quickwork/ui/components/ui/dialog";
import { copyText } from "@quickwork/ui/lib/clipboard";
import { cn } from "@quickwork/ui/lib/utils";

import { ReadonlyContent } from "../../../editor";
import { useAttachmentInlineMediaURL } from "../../../editor/attachment";
import { useDownloadAttachment } from "../../../editor/use-download-attachment";
import { useT } from "../../../i18n";

function isImage(attachment: Attachment): boolean {
  return attachment.content_type.startsWith("image/");
}

function isTextPreviewable(attachment: Attachment): boolean {
  return (
    attachment.content_type.startsWith("text/") ||
    /\.(md|markdown|txt)$/i.test(attachment.filename)
  );
}

function captionFor(attachment: Attachment): string {
  return attachment.filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Native <img> loads cannot carry the desktop Bearer token, and the renderer
 * runs at file://. Resolve through the shared attachment media policy so
 * site-relative /uploads paths become absolute (and auth-gated API URLs fall
 * back to an authenticated blob).
 */
function DeliveryImage({
  attachment,
  onLoad,
}: {
  attachment: Attachment;
  onLoad?: (img: HTMLImageElement) => void;
}) {
  const src = useAttachmentInlineMediaURL(attachment);
  return (
    <img
      src={src}
      alt={captionFor(attachment)}
      loading="lazy"
      onLoad={onLoad ? (event) => onLoad(event.currentTarget) : undefined}
    />
  );
}

function ImageCard({
  attachment,
  onOpen,
}: {
  attachment: Attachment;
  onOpen: () => void;
}) {
  const [dims, setDims] = useState<string>(() => {
    const sub = attachment.content_type.split("/")[1];
    return sub ? sub.toUpperCase() : "";
  });
  return (
    <button
      type="button"
      className="qw-solo-shot"
      onClick={onOpen}
      aria-label={captionFor(attachment)}
    >
      <span className="qw-solo-shot-im">
        <DeliveryImage
          attachment={attachment}
          onLoad={(img) => setDims(`${img.naturalWidth} × ${img.naturalHeight}`)}
        />
        <span className="qw-solo-shot-zoom" aria-hidden="true">
          <Eye className="size-3.5" />
        </span>
      </span>
      <span className="qw-solo-shot-cap">
        <span className="t">{captionFor(attachment)}</span>
        <span className="s">{dims}</span>
      </span>
    </button>
  );
}

interface SoloDeliverySectionProps {
  attachments: Attachment[];
  /** `running` = a run is still in flight; `review` = waiting for a human. */
  state: "running" | "review" | "done";
  /** The accept control, rendered in the lead. Omitted when already done. */
  action?: ReactNode;
  /** The refresh detail page supplies its own section head and lead. */
  showChrome?: boolean;
}

/**
 * Delivery-first section for a solo task: the artifacts are the page's
 * primary content. Images page through a lightbox; markdown/text files get a
 * rendered preview; every file keeps a real download URL.
 */
export function SoloDeliverySection({
  attachments,
  state,
  action,
  showChrome = true,
}: SoloDeliverySectionProps) {
  const { t } = useT("issues");
  const download = useDownloadAttachment();

  // Description uploads belong to the brief, not to the delivery. Deliveries
  // land on comments (the CLI uploads there); fall back to issue-level
  // attachments when a task only has those.
  const delivered = useMemo(() => {
    const fromComments = attachments.filter((a) => a.comment_id);
    return fromComments.length > 0 ? fromComments : attachments;
  }, [attachments]);
  const images = useMemo(() => delivered.filter(isImage), [delivered]);
  const files = useMemo(() => delivered.filter((a) => !isImage(a)), [delivered]);

  const [lightbox, setLightbox] = useState<number | null>(null);
  const [previewFile, setPreviewFile] = useState<Attachment | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState(false);

  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightbox(null);
      if (event.key === "ArrowLeft") {
        setLightbox((index) => (index === null ? null : (index + images.length - 1) % images.length));
      }
      if (event.key === "ArrowRight") {
        setLightbox((index) => (index === null ? null : (index + 1) % images.length));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, images.length]);

  useEffect(() => {
    if (!previewFile) return;
    let cancelled = false;
    setPreviewText(null);
    setPreviewError(false);
    void api
      .getAttachmentTextContent(previewFile.id)
      .then((result) => {
        if (!cancelled) setPreviewText(result.text);
      })
      .catch(() => {
        if (!cancelled) setPreviewError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [previewFile]);

  if (delivered.length === 0) return null;

  const leadDone = state === "done";
  const leadRunning = state === "running";
  const current = lightbox === null ? null : images[lightbox];

  return (
    <section className="qw-solo-delivery" id="solo-delivery">
      {showChrome ? (
      <>
      <div className={cn("qw-solo-delivery-lead", leadDone && "is-done")}>
        <span
          className={cn(
            "qw-solo-runstate",
            leadDone ? "done" : leadRunning ? "run" : "done",
          )}
        >
          <i className="dot" />
          {leadDone
            ? t(($) => $.detail.delivery_done)
            : leadRunning
              ? t(($) => $.detail.delivery_running)
              : t(($) => $.detail.delivery_waiting)}
        </span>
        <span className="lead-note">
          {leadDone
            ? t(($) => $.detail.delivery_done_note)
            : leadRunning
              ? t(($) => $.detail.delivery_running_note)
              : t(($) => $.detail.delivery_waiting_note)}
        </span>
        <span className="qw-solo-spacer" />
        {action}
      </div>

      <div className="qw-solo-section-head">
        <h2 className="qw-solo-section-title">
          {t(($) => $.detail.delivery_section)}
        </h2>
        <span className="qw-solo-section-count">
          {t(($) => $.detail.delivery_images, { count: images.length })}
          {" · "}
          {t(($) => $.detail.delivery_files, { count: files.length })}
        </span>
        <span className="qw-solo-spacer" />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => delivered.forEach((item) => void download(item.id))}
        >
          <Download />
          {t(($) => $.detail.delivery_download_all)}
        </Button>
      </div>
      </>
      ) : null}

      {images.length > 0 ? (
        <div className="qw-solo-gallery">
          {images.map((attachment, index) => (
            <ImageCard
              key={attachment.id}
              attachment={attachment}
              onOpen={() => setLightbox(index)}
            />
          ))}
        </div>
      ) : null}

      {files.length > 0 ? (
        <div className="qw-solo-packs">
          {files.map((attachment) => {
            const ext = attachment.filename.split(".").pop()?.toUpperCase() || "FILE";
            const previewable = isTextPreviewable(attachment);
            return (
              <div className="qw-solo-pack" key={attachment.id}>
                <span className="ic">{ext.slice(0, 4)}</span>
                <div className="pmain">
                  <div className="nm">
                    <span className="fname">{attachment.filename}</span>
                    <span className="sz">{sizeLabel(attachment.size_bytes)}</span>
                  </div>
                  <div className="sub">
                    {previewable
                      ? t(($) => $.detail.delivery_text_file)
                      : attachment.content_type || t(($) => $.detail.delivery_file)}
                  </div>
                </div>
                <div className="actions">
                  {previewable ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewFile(attachment)}
                    >
                      <FileText />
                      {t(($) => $.detail.delivery_preview)}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(($) => $.detail.delivery_download)}
                    onClick={() => void download(attachment.id)}
                  >
                    <Download />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {current ? createPortal(
        <div
          className="qw-solo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={captionFor(current)}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightbox(null);
          }}
        >
          <button
            type="button"
            className="qw-solo-lightbox-close"
            aria-label={t(($) => $.detail.delivery_close)}
            onClick={() => setLightbox(null)}
          >
            <X className="size-[17px]" />
          </button>
          {images.length > 1 ? (
            <button
              type="button"
              className="qw-solo-lightbox-nav prev"
              aria-label={t(($) => $.detail.delivery_previous)}
              onClick={() => setLightbox((index) => (
                index === null ? null : (index + images.length - 1) % images.length
              ))}
            >
              <ChevronLeft className="size-[18px]" />
            </button>
          ) : null}
          <DeliveryImage attachment={current} />
          {images.length > 1 ? (
            <button
              type="button"
              className="qw-solo-lightbox-nav next"
              aria-label={t(($) => $.detail.delivery_next)}
              onClick={() => setLightbox((index) => (
                index === null ? null : (index + 1) % images.length
              ))}
            >
              <ChevronRight className="size-[18px]" />
            </button>
          ) : null}
          <div className="qw-solo-lightbox-bar">
            <span className="cnt">{lightbox! + 1} / {images.length}</span>
            <span className="cap">{captionFor(current)}</span>
          </div>
        </div>,
        document.body,
      ) : null}

      <Dialog
        open={previewFile !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewFile(null);
        }}
      >
        <DialogContent
          className="qw-solo-md-dialog"
          showCloseButton={false}
          aria-describedby={undefined}
        >
          <DialogTitle className="sr-only">
            {previewFile ? previewFile.filename : t(($) => $.detail.delivery_preview)}
          </DialogTitle>
          <div className="qw-solo-md-head">
            <span className="t">{t(($) => $.detail.delivery_preview)}</span>
            <span className="s">{previewFile?.filename}</span>
            <span className="qw-solo-spacer" />
            {previewText ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void copyText(previewText);
                }}
              >
                <Copy />
                {t(($) => $.detail.delivery_copy)}
              </Button>
            ) : null}
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={t(($) => $.detail.delivery_close)}
              onClick={() => setPreviewFile(null)}
            >
              <X />
            </Button>
          </div>
          <div className="qw-solo-md-body">
            {previewError ? (
              <p className="qw-solo-md-loading">
                {t(($) => $.detail.delivery_preview_failed)}
              </p>
            ) : previewText === null ? (
              <p className="qw-solo-md-loading">
                <Loader2 className="mx-auto mb-2 size-4 animate-spin" />
                {t(($) => $.detail.delivery_preview_loading)}
              </p>
            ) : (
              <ReadonlyContent content={previewText} />
            )}
          </div>
          <div className="qw-solo-md-foot">
            <span className="text-caption text-muted-foreground">
              {previewFile ? sizeLabel(previewFile.size_bytes) : ""}
            </span>
            <span className="qw-solo-spacer" />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPreviewFile(null)}
            >
              {t(($) => $.detail.delivery_close)}
            </Button>
            {previewFile ? (
              <Button
                type="button"
                size="sm"
                onClick={() => void download(previewFile.id)}
              >
                <Download />
                {t(($) => $.detail.delivery_download)}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
