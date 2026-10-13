import { describe, expect, it } from 'vitest';
import { mangasOriginesAdapter } from '../src/adapters/mangas-origines';
import type { PageRef } from '../src/core/types';
import type { ExclusionMemory } from '../src/core/storage';
import {
  evaluateAutoExclusion,
  evaluateMemorizedExclusion,
  processPageExclusions,
} from '../src/modules/chapter-download/exclusions';
import { getChapterSelectionCounts, getExclusionBadgeText } from '../src/modules/chapter-download';

describe('Exclusions (RG-106 & RG-107)', () => {
  describe('Pré-exclusions automatiques (RG-106)', () => {
    it('pré-exclut une image dont la largeur est < 200 px', () => {
      const page: PageRef = {
        index: 1,
        url: 'https://mangas-origines.fr/page_001.webp',
        ext: 'webp',
        width: 150,
        height: 1000,
      };

      const result = evaluateAutoExclusion(page, undefined, mangasOriginesAdapter);
      expect(result.excluded).toBe(true);
      expect(result.reason).toContain('200 px');
    });

    it('ne pré-exclut pas une image large (> 200 px)', () => {
      const page: PageRef = {
        index: 1,
        url: 'https://mangas-origines.fr/page_001.webp',
        ext: 'webp',
        width: 800,
        height: 1200,
      };

      const result = evaluateAutoExclusion(page, undefined, mangasOriginesAdapter);
      expect(result.excluded).toBe(false);
    });

    it('pré-exclut un doublon consécutif exact', () => {
      const prev: PageRef = {
        index: 1,
        url: 'https://mangas-origines.fr/page_001.webp',
        ext: 'webp',
      };
      const curr: PageRef = {
        index: 2,
        url: 'https://mangas-origines.fr/page_001.webp',
        ext: 'webp',
      };

      const result = evaluateAutoExclusion(curr, prev, mangasOriginesAdapter);
      expect(result.excluded).toBe(true);
      expect(result.reason).toContain('Doublon');
    });

    it("pré-exclut une bannière ou un motif d'URL fourni par l'adaptateur (logo, banner, discord)", () => {
      const bannerPage: PageRef = {
        index: 5,
        url: 'https://mangas-origines.fr/uploads/banner_fin.webp',
        ext: 'webp',
        width: 800,
      };

      const result = evaluateAutoExclusion(bannerPage, undefined, mangasOriginesAdapter);
      expect(result.excluded).toBe(true);
      expect(result.reason).toContain('bannière');
    });
  });

  describe('Exclusions mémorisées (RG-107)', () => {
    it('suggère la dernière planche sans l’exclure automatiquement si lastPage est mémorisé', () => {
      const memory: ExclusionMemory = {
        lastPage: true,
        urlPatterns: [],
      };
      const lastPage: PageRef = {
        index: 10,
        url: 'https://mangas-origines.fr/page_010.webp',
        ext: 'webp',
      };

      const result = evaluateMemorizedExclusion(lastPage, 9, 10, memory);
      expect(result.excluded).toBe(false);
      expect(result.isSuggestedExclusion).toBe(true);
      expect(result.reason).toContain('dernière planche');
    });

    it("n'exclut pas les autres planches avec lastPage mémorisé", () => {
      const memory: ExclusionMemory = {
        lastPage: true,
        urlPatterns: [],
      };
      const middlePage: PageRef = {
        index: 5,
        url: 'https://mangas-origines.fr/page_005.webp',
        ext: 'webp',
      };

      const result = evaluateMemorizedExclusion(middlePage, 4, 10, memory);
      expect(result.excluded).toBe(false);
    });

    it("suggère un motif d'URL mémorisé sans appliquer l'exclusion", () => {
      const memory: ExclusionMemory = {
        lastPage: false,
        urlPatterns: ['discord_join'],
      };
      const page: PageRef = {
        index: 3,
        url: 'https://mangas-origines.fr/images/discord_join_v2.png',
        ext: 'png',
      };

      const result = evaluateMemorizedExclusion(page, 2, 10, memory);
      expect(result.excluded).toBe(false);
      expect(result.isSuggestedExclusion).toBe(true);
      expect(result.reason).toContain('discord_join');
    });
  });

  describe('Traitement complet processPageExclusions', () => {
    it('applique les pré-exclusions si activées et les ignore si désactivées', () => {
      const pages: PageRef[] = [
        { index: 1, url: 'https://mangas-origines.fr/p1.webp', ext: 'webp', width: 800 },
        { index: 2, url: 'https://mangas-origines.fr/banner.webp', ext: 'webp', width: 800 },
        { index: 3, url: 'https://mangas-origines.fr/p3.webp', ext: 'webp', width: 150 },
      ];

      const enabled = processPageExclusions(pages, mangasOriginesAdapter, true);
      expect(enabled[0]?.excluded).toBe(false);
      expect(enabled[1]?.excluded).toBe(true);
      expect(enabled[1]?.isAutoExcluded).toBe(true);
      expect(enabled[2]?.excluded).toBe(true);
      expect(enabled[2]?.isAutoExcluded).toBe(true);

      const disabled = processPageExclusions(pages, mangasOriginesAdapter, false);
      expect(disabled[0]?.excluded).toBe(false);
      expect(disabled[1]?.excluded).toBe(false);
      expect(disabled[2]?.excluded).toBe(false);
    });

    it('conserve un badge et une raison lisibles pour une planche pré-exclue', () => {
      const [excluded] = processPageExclusions(
        [{ index: 1, url: 'https://mangas-origines.fr/logo.webp', ext: 'webp', width: 800 }],
        mangasOriginesAdapter,
        true,
      );

      expect(excluded?.excluded).toBe(true);
      expect(
        getExclusionBadgeText({
          selected: false,
          excludeReason: excluded?.reason,
        }),
      ).toContain('bannière/promo');
    });

    it('retourne la dernière planche mémorisée comme suggestion incluse', () => {
      const pages: PageRef[] = [
        { index: 1, url: 'https://mangas-origines.fr/p1.webp', ext: 'webp' },
        { index: 2, url: 'https://mangas-origines.fr/p2.webp', ext: 'webp' },
      ];
      const memory: ExclusionMemory = { lastPage: true, urlPatterns: [] };

      const result = processPageExclusions(pages, mangasOriginesAdapter, false, memory);
      expect(result[0]?.excluded).toBe(false);
      expect(result[1]?.excluded).toBe(false);
      expect(result[1]?.isSuggestedExclusion).toBe(true);
      expect(result[1]?.reason).toContain('dernière planche');
    });
  });

  it('keeps memorized exclusions included as visible suggestions and counts them as included', () => {
    const page = { index: 10, url: 'https://example.test/page_010.jpg', ext: 'jpg' };
    const [suggestion] = processPageExclusions([page], undefined, false, {
      lastPage: true,
      urlPatterns: [],
    });
    expect(suggestion?.excluded).toBe(false);
    expect(suggestion?.isSuggestedExclusion).toBe(true);

    const displayItem = {
      selected: true,
      excludeReason: suggestion?.reason,
      isSuggestedExclusion: suggestion?.isSuggestedExclusion,
    };
    expect(getExclusionBadgeText(displayItem)).toContain('dernière planche');
    expect(getChapterSelectionCounts([{ selected: true }, { selected: false }])).toEqual({
      included: 1,
      excluded: 1,
    });
  });
});
