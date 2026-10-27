"use client";

/**
 * Multi-attachment artifact panel for comments and chat messages.
 *
 * Rendered by AttachmentList when a standalone comment carries two or more
 * attachments. Images become a thumbnail gallery backed by the shared image
 * sequence viewer; every other previewable kind stays a document row that
 * opens the same AttachmentPreviewModal the single-file card uses.
 *
 * Single attachments keep the existing inline figure / file-card rendering —
 * this panel is the "a run produced several files" shape, not a replacement
 * for one-off attachments.
 */

import { useMemo, useState } from "react";
import { Download, Eye, Maximize2 } from "lucide-react";
import { toast } from "sonner";
import type { Attachment } from "@quickwork/core/types";
import { isImageAttachment } from "@quickwork/core/attachments/image-sequence";
import { Button } from "@quickwork/ui/components/ui/button";
import { cn } from "@quickwork/ui/lib/utils";
import { useT } from "../../i18n";
import {
  ImageSequenceProvider,
  useImageSequencePreview,
} from "../../editor/image-sequence-context";
import { useAttachmentPreview } from "../../editor/attachment-preview-modal";
import { useAttachmentInlineMediaURL } from "../../editor/attachment";
import { useDownloadAttachment } from "../../editor/use-download-attachment";
import { getPreviewKind } from "../../editor/utils/preview";

type ArtifactFilter = "all" | "image" | "doc";

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function baseName(filename: string): string {
  return filename.split(/[\\/]/).pop() ?? filename;
}

function fileTitle(filename: string): string {
  const base = baseName(filename);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

function extensionOf(filename: string): string {
  const base = baseName(filename);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toUpperCase() : "";
}

function typeBadge(filename: string): string {
  const ext = extensionOf(filename);
  if (!ext) return "FILE";
  return ext === "MARKDOWN" ? "MD" : ext.slice(0, 4);
}

function docMeta(attachment: Attachment): string {
  const size = formatBytes(attachment.size_bytes);
  const type = extensionOf(attachment.filename);
  return [size, type].filter(Boolean).join(" · ");
}

export function ArtifactPanel({
  attachments,
  className,
}: {
  attachments: Attachment[];
  className?: string;
}) {
  const { t } = useT("issues");
  const [filter, setFilter] = useState<ArtifactFilter>("all");
  const preview = useAttachmentPreview();
  const download = useDownloadAttachment();

  const images = useMemo(
    () =>
      attachments.filter((a) =>
        isImageAttachment(a.content_type, a.filename),
      ),
    [attachments],
  );
  const docs = useMemo(
    () =>
      attachments.filter(
        (a) => !isImageAttachment(a.content_type, a.filename),
      ),
    [attachments],
  );

  const imageItems = useMemo(
    () =>
      images.map((attachment) => ({
        key: attachment.id,
        url:
          attachment.download_url ||
          attachment.markdown_url ||
          attachment.url,
        filename: attachment.filename,
        attachment,
      })),
    [images],
  );

  const total = attachments.length;
  const countLabel = t(($) => $.comment.artifacts.count, {
    total,
    images: images.length,
    docs: docs.length,
  });

  const tabs: { id: ArtifactFilter; label: string; disabled: boolean }[] = [
    {
      id: "all",
      label: t(($) => $.comment.artifacts.all, { total }),
      disabled: false,
    },
    {
      id: "image",
      label: t(($) => $.comment.artifacts.images, { count: images.length }),
      disabled: images.length === 0,
    },
    {
      id: "doc",
      label: t(($) => $.comment.artifacts.docs, { count: docs.length }),
      disabled: docs.length === 0,
    },
  ];

  const openDoc = (attachment: Attachment) => {
    if (!preview.tryOpen({ kind: "full", attachment })) {
      void download(attachment.id);
    }
  };

  const downloadAll = () => {
    toast.success(
      t(($) => $.comment.artifacts.download_all_toast, { count: total }),
    );
    // Browsers throttle a burst of programmatic downloads; spacing them keeps
    // the first file from swallowing the rest.
    attachments.forEach((attachment, index) => {
      window.setTimeout(() => {
        void download(attachment.id);
      }, index * 150);
    });
  };

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border bg-card",
        className,
      )}
      aria-label={t(($) => $.comment.artifacts.title)}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="shrink-0 text-body font-medium">
            {t(($) => $.comment.artifacts.title)}
          </span>
          <span className="truncate font-mono text-caption font-normal text-muted-foreground">
            {countLabel}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <div
            role="tablist"
            aria-label={t(($) => $.comment.artifacts.title)}
            className="inline-flex rounded-md border border-border bg-muted/50 p-0.5"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={filter === tab.id}
                disabled={tab.disabled}
                onClick={() => setFilter(tab.id)}
                className={cn(
                  "h-6 rounded px-2 text-caption transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
                  filter === tab.id
                    ? "bg-background font-medium text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="gap-1"
            onClick={downloadAll}
          >
            <Download className="h-3 w-3" />
            {t(($) => $.comment.artifacts.download_all)}
          </Button>
        </div>
      </header>

      {images.length > 0 && filter !== "doc" && (
        <ImageSequenceProvider items={imageItems}>
          <div className="grid grid-cols-2 gap-3 p-3 sm:grid-cols-3">
            {images.map((attachment, index) => (
              <GalleryTile
                key={attachment.id}
                attachment={attachment}
                index={index}
                onFallback={(item) =>
                  preview.open({ kind: "full", attachment: item })
                }
              />
            ))}
          </div>
        </ImageSequenceProvider>
      )}

      {docs.length > 0 && filter !== "image" && (
        <div
          className={cn(
            "px-3 pb-2",
            images.length > 0 && filter !== "doc" && "border-t border-border",
          )}
        >
          <div className="px-0.5 pb-1 pt-2 text-micro font-semibold uppercase tracking-wider text-muted-foreground">
            {t(($) => $.comment.artifacts.docs_label)}
          </div>
          {docs.map((attachment) => (
            <DocRow
              key={attachment.id}
              attachment={attachment}
              onPreview={() => openDoc(attachment)}
              onDownload={() => void download(attachment.id)}
            />
          ))}
        </div>
      )}

      {preview.modal}
    </section>
  );
}

function GalleryTile({
  attachment,
  index,
  onFallback,
}: {
  attachment: Attachment;
  index: number;
  onFallback: (attachment: Attachment) => void;
}) {
  const { t } = useT("issues");
  const sequence = useImageSequencePreview();
  const src = useAttachmentInlineMediaURL(attachment);
  const title = fileTitle(attachment.filename);
  const coverLabel = t(($) => $.comment.artifacts.cover, { index: index + 1 });
  const size = formatBytes(attachment.size_bytes);

  return (
    <figure className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <button
        type="button"
        className="group relative block aspect-[4/5] w-full overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={`${coverLabel}: ${title}`}
        onClick={() => {
          if (!sequence.openAt(attachment.id)) onFallback(attachment);
        }}
      >
        <img
          src={src}
          alt={title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
        <span className="absolute left-2 top-2 inline-flex h-5 items-center rounded-full bg-black/60 px-2 text-micro text-white backdrop-blur-sm">
          {coverLabel}
        </span>
        <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-md bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100">
          <Maximize2 className="h-3 w-3" />
        </span>
      </button>
      <figcaption className="flex items-center gap-2 px-2.5 py-2">
        <span className="min-w-0 flex-1 truncate text-caption font-medium text-foreground">
          {title}
        </span>
        {size && (
          <span className="shrink-0 font-mono text-micro text-muted-foreground">
            {size}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

function DocRow({
  attachment,
  onPreview,
  onDownload,
}: {
  attachment: Attachment;
  onPreview: () => void;
  onDownload: () => void;
}) {
  const { t } = useT("issues");
  const kind = getPreviewKind(attachment.content_type, attachment.filename);
  const badge = typeBadge(attachment.filename);
  const isJson = extensionOf(attachment.filename) === "JSON";

  return (
    <div className="flex items-center gap-2.5 border-t border-border px-0.5 py-2 first:border-t-0">
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-md border font-mono text-[10px] font-bold",
          isJson
            ? "border-warning/25 bg-warning/10 text-warning"
            : "border-primary/15 bg-primary/5 text-primary",
        )}
      >
        {badge}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-caption text-foreground">
          {attachment.filename}
        </p>
        <p className="truncate text-micro text-muted-foreground">
          {docMeta(attachment)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {kind && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="gap-1"
            onClick={onPreview}
          >
            <Eye className="h-3 w-3" />
            {t(($) => $.comment.artifacts.preview)}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(($) => $.comment.artifacts.download)}
          onClick={onDownload}
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
