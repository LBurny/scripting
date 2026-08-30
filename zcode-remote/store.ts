// Shared storage helpers for the ZCode Remote script.
// The connection URL is persisted in this script's private domain,
// which is accessible from both index.tsx and widget.tsx.

const KEY_URL = "connection_url"

/** The initial connection URL. Leave empty — paste your own ZCode remote
 *  link (from the ZCode desktop app) in the in-app settings page. */
export const DEFAULT_URL = ""

export function getConnectionURL(): string {
  return Storage.get<string>(KEY_URL) ?? DEFAULT_URL
}

export function setConnectionURL(url: string): void {
  Storage.set(KEY_URL, url)
}

/** Extract a query parameter from the URL without relying on the URL class. */
function getQueryParam(url: string, key: string): string | null {
  const m = url.match(new RegExp(`[?&]${key}=([^&]*)`))
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

/** The machine name carried by the connection URL (e.g. DESKTOP-LIB10A3). */
export function getDeviceName(url: string): string {
  return getQueryParam(url, "name") ?? "ZCode Remote"
}

/** The desktop app version carried by the URL (e.g. 3.8.1). */
export function getAppVersion(url: string): string {
  return getQueryParam(url, "app_version") ?? ""
}

/** The host of the connection URL, for display purposes. */
export function getHost(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)/)
  return m ? m[1] : url
}

export function isValidURL(url: string): boolean {
  return /^https?:\/\/.+/.test(url.trim())
}
