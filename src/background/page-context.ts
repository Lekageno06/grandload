import { getAdapter, listAdapters } from '../core/registry';
import type { AdapterResolutionDiagnostics, PageContext } from '../core/types';

export async function resolvePageContext(
  tabId: number,
  url: string,
  registryReady: Promise<unknown> = Promise.resolve(),
): Promise<PageContext> {
  await registryReady;
  const diagnostics: AdapterResolutionDiagnostics = {
    registryReady: true,
    registered: listAdapters().map((adapter) => adapter.id),
    matches: [],
    selected: null,
  };
  let parsedUrl: URL | undefined;
  try { parsedUrl = new URL(url); } catch { parsedUrl = undefined; }
  const adapter = parsedUrl ? getAdapter(parsedUrl, diagnostics) : undefined;
  let kind: PageContext['kind'] = 'other';
  if (parsedUrl && adapter) {
    try {
      kind = adapter.classify(parsedUrl);
    } catch {
      kind = 'other';
    }
  }
  console.info('[Grandload][SW] PAGE_CONTEXT', {
    url: parsedUrl ? `${parsedUrl.origin}${parsedUrl.pathname}` : 'invalide',
    registered: diagnostics.registered,
    matches: diagnostics.matches,
    selected: diagnostics.selected,
    registryReady: diagnostics.registryReady,
  });
  return {
    url,
    kind,
    adapterId: adapter?.id ?? 'generic',
    tabId,
    serviceWorkerDiagnostics: diagnostics,
  };
}
