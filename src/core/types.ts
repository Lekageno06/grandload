export type PageKind = 'chapter' | 'series' | 'other';
export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled';

export interface PageContext {
  url: string;
  kind: PageKind;
  adapterId: string;
  tabId: number;
}

export interface ModuleApi {
  setStatus?: (message: string) => void;
  setBusy?: (busy: boolean) => void;
}

export interface MessageRouter {
  send: <T extends string>(type: T, payload: Record<string, unknown>) => Promise<unknown>;
  on: <T extends string>(
    type: T,
    handler: (payload: Record<string, unknown>) => unknown | Promise<unknown>,
  ) => void;
}

export interface GrandloadModule {
  id: string;
  title: string;
  priority: number;
  canHandle: (ctx: PageContext) => boolean;
  mountPopup: (root: HTMLElement, ctx: PageContext, api: ModuleApi) => void;
  registerBackground?: (router: MessageRouter) => void;
  requiredPermissions?: readonly string[];
}

export interface SiteAdapter {
  id: string;
  matches: (url: URL) => boolean;
  classify: (url: URL) => PageKind;
  readSeries: (doc: Document) => SeriesInfo;
  readChapterPages: (doc: Document) => PageRef[];
  prepareChapter?: (doc: Document) => Promise<void>;
  acquisition: 'live-dom' | 'html-parse';
  autoExclude?: (page: PageRef) => string | null;
}

export interface Packager {
  id: string;
  extension: string;
  pack: (entries: ArchiveEntry[], meta: ArchiveMeta) => Promise<Blob | ArchiveEntry[]>;
}

export interface PackagerMetadata {
  id: string;
  extension: string;
}

export interface PageRef {
  index: number;
  url: string;
  ext: string;
  width?: number;
  height?: number;
}

export interface ChapterRef {
  number: number;
  label: string;
  url: string;
}

export interface SeriesInfo {
  title: string;
  chapters: ChapterRef[];
}

export interface ArchiveEntry {
  name: string;
  data: Uint8Array;
}

export interface ArchiveMeta {
  series: string;
  chapter: ChapterRef;
  pageCount: number;
  sourceUrl: string;
}

export type ArchiveBuildResult =
  | { kind: 'archive'; blobUrl: string; size: number }
  | { kind: 'files'; files: Array<{ name: string; blobUrl: string; size: number }> };

export interface Job {
  id: string;
  kind: 'chapter' | 'series' | 'links';
  state: JobState;
  params: Record<string, unknown>;
  children?: string[];
  progress: {
    done: number;
    total: number;
  };
  error?: {
    code: string;
    message: string;
  };
  warning?: {
    requested: string;
    actual: string;
  };
  createdAt: number;
}
