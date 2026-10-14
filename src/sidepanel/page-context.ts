import { listAdapters } from '../core/registry';
import type { PageContext } from '../core/types';

/** Réconcilie un contexte ancien du Service Worker avec le registre du build chargé par le panneau. */
export function reconcilePageContext(context: PageContext, adapters = listAdapters()): PageContext {
  let url: URL;
  try {
    url = new URL(context.url);
  } catch {
    return context;
  }

  const adapter = adapters.find((candidate) => {
    try {
      return candidate.matches(url);
    } catch {
      return false;
    }
  });
  if (!adapter || (context.adapterId !== 'generic' && context.kind !== 'other')) return context;

  return {
    ...context,
    adapterId: adapter.id,
    kind: adapter.classify(url),
  };
}
