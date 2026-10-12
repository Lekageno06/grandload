import type { SiteAdapter } from '../../adapters/types';
import type { ExclusionMemory } from '../../core/storage';
import type { PageRef } from '../../core/types';

export interface ExclusionResult {
  excluded: boolean;
  reason?: string;
  isAutoExcluded?: boolean;
  isSuggestedExclusion?: boolean;
}

/**
 * Applique les pré-exclusions automatiques (RG-106) :
 * - Largeur < 200 px (si connue)
 * - URL correspondant aux motifs de l'adaptateur (logo, bannière, avatar...)
 * - Doublon exact consécutif
 */
export function evaluateAutoExclusion(
  page: PageRef,
  previousPage: PageRef | undefined,
  adapter?: SiteAdapter,
): { excluded: boolean; reason?: string } {
  // 1. Doublon exact consécutif
  if (previousPage && page.url === previousPage.url) {
    return {
      excluded: true,
      reason: 'Doublon consécutif exact',
    };
  }

  // 2. Largeur < 200 px
  if (page.width !== undefined && page.width > 0 && page.width < 200) {
    return {
      excluded: true,
      reason: 'Largeur inférieure à 200 px',
    };
  }

  // 3. Motifs de l'adaptateur ou fonction autoExclude
  if (adapter) {
    if (adapter.autoExclude) {
      const adapterReason = adapter.autoExclude(page);
      if (adapterReason) {
        return {
          excluded: true,
          reason: adapterReason,
        };
      }
    }

    if (adapter.excludePatterns) {
      for (const pattern of adapter.excludePatterns) {
        if (pattern.test(page.url)) {
          return {
            excluded: true,
            reason: `Motif d'URL (${pattern.source})`,
          };
        }
      }
    }
  }

  return { excluded: false };
}

/**
 * Applique les exclusions mémorisées par site (RG-107) :
 * - Dernière planche
 * - Motifs d'URL mémorisés (sous-chaînes)
 */
export function evaluateMemorizedExclusion(
  page: PageRef,
  index: number,
  totalPages: number,
  memory?: ExclusionMemory,
): { excluded: boolean; reason?: string } {
  if (!memory) {
    return { excluded: false };
  }

  // Dernière planche mémorisée
  if (memory.lastPage && totalPages > 1 && index === totalPages - 1) {
    return {
      excluded: true,
      reason: 'Exclusion mémorisée : dernière planche',
    };
  }

  // Motifs d'URL mémorisés
  if (memory.urlPatterns && memory.urlPatterns.length > 0) {
    for (const pattern of memory.urlPatterns) {
      if (pattern && page.url.toLowerCase().includes(pattern.toLowerCase())) {
        return {
          excluded: true,
          reason: `Exclusion mémorisée : motif "${pattern}"`,
        };
      }
    }
  }

  return { excluded: false };
}

/**
 * Calcule l'état d'exclusion combiné pour une liste complète de planches.
 */
export function processPageExclusions(
  pages: PageRef[],
  adapter?: SiteAdapter,
  autoExcludeEnabled = true,
  memory?: ExclusionMemory,
): Array<PageRef & ExclusionResult> {
  return pages.map((page, index) => {
    const previous = index > 0 ? pages[index - 1] : undefined;

    // 1. Exclusions mémorisées (priorité RG-107)
    const memResult = evaluateMemorizedExclusion(page, index, pages.length, memory);
    if (memResult.excluded) {
      const item: PageRef & ExclusionResult = {
        ...page,
        excluded: true,
        isSuggestedExclusion: true,
      };
      if (memResult.reason !== undefined) {
        item.reason = memResult.reason;
      }
      return item;
    }

    // 2. Pré-exclusions automatiques (RG-106) si activées
    if (autoExcludeEnabled) {
      const autoResult = evaluateAutoExclusion(page, previous, adapter);
      if (autoResult.excluded) {
        const item: PageRef & ExclusionResult = {
          ...page,
          excluded: true,
          isAutoExcluded: true,
        };
        if (autoResult.reason !== undefined) {
          item.reason = autoResult.reason;
        }
        return item;
      }
    }

    return {
      ...page,
      excluded: false,
    };
  });
}
