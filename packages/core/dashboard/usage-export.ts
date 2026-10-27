import type { UsageLogRow, UsageLogSortKey } from "../types";
import { api } from "../api";

export interface UsageLogExportParams {
  days: number;
  projectId: string | null;
  tz: string;
  status?: string;
  provider?: string;
  model?: string;
  agentId?: string;
  q?: string;
  sort?: UsageLogSortKey;
  dir?: "asc" | "desc";
}

export interface UsageLogExportResult {
  rows: UsageLogRow[];
  total: number;
  /** True when the caller's row cap stopped the walk before the server's end. */
  truncated: boolean;
}

const EXPORT_PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 20_000;

/**
 * Walk every page of the filtered log for CSV export.
 *
 * The table pages on the server, so exporting only the rows currently on
 * screen would silently drop the rest. This re-reads the same filters page by
 * page (500 at a time) until the server reports the end. The cap is explicit:
 * `truncated` is returned to the caller instead of pretending the file is
 * complete.
 */
export async function fetchAllUsageLogs(
  params: UsageLogExportParams,
  maxRows = EXPORT_MAX_ROWS,
): Promise<UsageLogExportResult> {
  const rows: UsageLogRow[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const result = await api.getUsageLogs({
      days: params.days,
      project_id: params.projectId ?? undefined,
      tz: params.tz,
      status: params.status,
      provider: params.provider,
      model: params.model,
      agent_id: params.agentId,
      q: params.q,
      page,
      page_size: EXPORT_PAGE_SIZE,
      sort: params.sort,
      dir: params.dir,
    });
    total = result.total;
    rows.push(...result.rows);
    if (result.rows.length === 0 || rows.length >= total) {
      return { rows, total, truncated: false };
    }
    if (rows.length >= maxRows) {
      return { rows: rows.slice(0, maxRows), total, truncated: true };
    }
    page += 1;
  }
}
