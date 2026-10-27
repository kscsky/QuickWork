/**
 * URL policy for attachment media rendered through native resource loads
 * (`<img>`, `<video>`, `<iframe>`).
 *
 * The attachment metadata response carries three URL fields with different
 * lifetimes and auth requirements. A bare `/api/attachments/<id>/download`
 * URL requires the caller's Bearer token, which a native resource fetch
 * cannot send on the desktop renderer. Prefer a signed or public storage URL,
 * and only fall back to the API-shaped URL when nothing better exists — the
 * caller's re-sign/blob path handles that case.
 */

import { api } from "@quickwork/core/api";
import type { Attachment } from "@quickwork/core/types";

/**
 * Prefix a site-relative path with the configured API base. Web with the
 * default empty base keeps the relative path and resolves it against the page
 * origin; split-origin clients (desktop, mobile webview) need the absolute
 * form.
 */
export function absolutizeMediaURL(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  if (/^blob:/i.test(rawUrl) || /^data:/i.test(rawUrl)) return rawUrl;
  if (!rawUrl.startsWith("/")) return rawUrl;
  // The api singleton is a Proxy that returns `undefined` for any property
  // access before `setApiInstance()` runs (boot ordering, SSR). Optional
  // chaining lets us cope with that without throwing — pre-init renders
  // simply keep the site-relative path.
  const baseUrl = (api.getBaseUrl?.() ?? "").replace(/\/+$/, "");
  if (!baseUrl) return rawUrl;
  return `${baseUrl}${rawUrl}`;
}

function isSiteRelativeLocalUploadURL(rawURL: string): boolean {
  if (!rawURL || !rawURL.startsWith("/")) return false;
  const path = rawURL.split(/[?#]/, 1)[0] ?? "";
  return path === "/uploads" || path.startsWith("/uploads/");
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function hasExpiringSignatureQuery(q: URLSearchParams): boolean {
  for (const key of [
    "Signature",
    "X-Amz-Signature",
    "Key-Pair-Id",
    "Expires",
    "X-Amz-Expires",
  ]) {
    if (q.has(key)) return true;
  }
  return false;
}

function storageURLMatchesCdnDomain(rawURL: string, cdnDomain: string): boolean {
  const expected = normalizeHost(cdnDomain);
  if (!rawURL || !expected) return false;
  try {
    const u = new URL(rawURL);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    if (normalizeHost(u.hostname) !== expected) return false;
    return !hasExpiringSignatureQuery(u.searchParams);
  } catch {
    return false;
  }
}

/**
 * Pick the URL most likely to load inside a native resource fetch.
 *
 * 1. Signed absolute `download_url` — fast and loadable for its TTL.
 * 2. Public CDN `record.url` — skipped when the deployment signs that host.
 * 3. Site-relative `/uploads/...` — direct static object on local storage.
 * 4. `markdown_url` — durable, server-policy-aligned URL.
 * 5. `record.url` — legacy fallback.
 */
export function pickInlineMediaURL(
  record: Attachment,
  fallback: string,
  cdnDomain: string,
  cdnSigned: boolean,
): string {
  const dl = record.download_url ?? "";
  if (
    /^https?:\/\//i.test(dl) &&
    /[?&](Signature|X-Amz-Signature|Key-Pair-Id|Expires|X-Amz-Expires)=/i.test(dl)
  ) {
    return dl;
  }
  if (!cdnSigned && storageURLMatchesCdnDomain(record.url, cdnDomain)) {
    return record.url;
  }
  if (isSiteRelativeLocalUploadURL(record.url)) return record.url;
  if (record.markdown_url) return record.markdown_url;
  if (record.url) return record.url;
  return fallback;
}
