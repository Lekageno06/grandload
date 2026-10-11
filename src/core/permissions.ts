export function getOriginPattern(url: string | URL): string {
  const target = typeof url === 'string' ? new URL(url) : new URL(url.toString());
  return `${target.protocol}//${target.hostname}/*`;
}

export async function hasHostAccess(url: string | URL): Promise<boolean> {
  const originPattern = getOriginPattern(url);

  if (typeof chrome === 'undefined' || !chrome.permissions || typeof chrome.permissions.contains !== 'function') {
    return true;
  }

  const granted = await chrome.permissions.contains({ origins: [originPattern] });
  return granted;
}

export async function requestHostAccess(url: string | URL): Promise<boolean> {
  const originPattern = getOriginPattern(url);

  if (typeof chrome === 'undefined' || !chrome.permissions || typeof chrome.permissions.request !== 'function') {
    return true;
  }

  const result = await chrome.permissions.request({ origins: [originPattern] });
  return result;
}
