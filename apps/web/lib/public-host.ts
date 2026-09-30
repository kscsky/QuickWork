const OFFICIAL_MARKETING_HOSTS = new Set(["quickwork.ai", "www.quickwork.ai"]);

export function isOfficialMarketingHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return OFFICIAL_MARKETING_HOSTS.has(normalized);
}
