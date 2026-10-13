import type { ChapterMeta, PageKind, PageRef, SeriesInfo } from '../core/types';

export interface SiteAdapter {
  id: string;
  matches: (url: URL) => boolean;
  classify: (url: URL) => PageKind;
  readSeries: (doc: Document) => SeriesInfo;
  readChapterPages: (doc: Document) => PageRef[];
  readChapterMeta: (doc: Document, url: string) => ChapterMeta;
  countChapterPageElements?: (doc: Document) => number;
  prepareChapter?: (doc: Document) => Promise<void>;
  acquisition: 'live-dom' | 'html-parse';
  autoExclude?: (page: PageRef) => string | null;
  /** Motifs d'URL à pré-exclure automatiquement (logo, bannière, avatar…). */
  excludePatterns?: readonly RegExp[];
}

export type { PageKind, PageRef, SeriesInfo };
