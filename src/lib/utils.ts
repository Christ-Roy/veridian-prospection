import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Build an href for a web domain, choosing http vs https based on the
 * `has_https` flag in `web_domains_all` when available.
 * Falls back to `http://` so that sites without HTTPS still open correctly
 * (sites with HTTPS will redirect automatically).
 */
export function webHref(
  domain: string,
  webDomainsAll?: Array<{ domain: string; has_https?: string | number | boolean | null }> | null,
): string {
  if (webDomainsAll && webDomainsAll.length > 0) {
    const entry = webDomainsAll.find((d) => d.domain === domain);
    if (entry) {
      const https = entry.has_https === true || entry.has_https === 1 || entry.has_https === "1" || entry.has_https === "true";
      return `${https ? "https" : "http"}://${domain}`;
    }
  }
  return `http://${domain}`;
}
