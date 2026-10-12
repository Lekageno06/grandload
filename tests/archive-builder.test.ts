import { unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ArchiveMeta, PageRef } from '../src/core/types';
import '../src/packagers';
import { createArchive } from '../src/offscreen/archive-builder';
import { buildChapterDownloadFilename } from '../src/background/orchestrator';

const metadata: ArchiveMeta = {
  series: 'Test',
  chapter: { number: 12, label: 'Chapitre 12', url: 'https://example.com/chapter-12/' },
  pageCount: 2,
  sourceUrl: 'https://example.com/chapter-12/',
};

const pages: PageRef[] = [
  { index: 2, url: 'https://cdn.example.com/2.webp', ext: 'webp' },
  { index: 1, url: 'https://cdn.example.com/1.webp', ext: 'webp' },
];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('archive builder', () => {
  it('builds a sanitized archive filename with three-digit integer chapters', () => {
    const decimalMeta: ArchiveMeta = {
      ...metadata,
      series: 'A & B <Saga>',
      chapter: { ...metadata.chapter, number: 129.5 },
    };
    expect(buildChapterDownloadFilename(decimalMeta, '.cbz')).toBe(
      'Grandload/A & B _Saga_/A & B _Saga_ - Chapitre 129.5.cbz',
    );
    expect(
      buildChapterDownloadFilename(
        {
          ...decimalMeta,
          chapter: { ...decimalMeta.chapter, number: 12 },
        },
        '.zip',
      ),
    ).toBe('Grandload/A & B _Saga_/A & B _Saga_ - Chapitre 012.zip');
  });

  it('fetches pages in reading order, names them and reports progress', async () => {
    const generatedBlobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (!(blob instanceof Blob)) {
        throw new Error('Blob attendu pour créer une URL objet.');
      }
      generatedBlobs.push(blob);
      return `blob:archive-${generatedBlobs.length}`;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (input: Parameters<typeof fetch>[0]) =>
          new Response(new Uint8Array([Number(String(input).split('/').at(-1)?.split('.')[0])]), {
            headers: { 'Content-Type': 'image/webp' },
          }),
      ),
    );
    const progress: Array<[string, number, number]> = [];

    const result = await createArchive({
      jobId: 'job-1',
      pages,
      packagerId: 'cbz',
      meta: metadata,
      onProgress: (jobId, done, total) => progress.push([jobId, done, total]),
    });

    expect(result.kind).toBe('archive');
    if (result.kind !== 'archive') {
      throw new Error('Un CBZ unique était attendu.');
    }
    expect(result.blobUrl).toBe('blob:archive-1');
    expect(progress).toHaveLength(2);
    expect(progress.every(([jobId, _done, total]) => jobId === 'job-1' && total === 2)).toBe(true);

    const [archiveBlob] = generatedBlobs;
    expect(archiveBlob).toBeDefined();
    if (!archiveBlob) {
      throw new Error('Blob CBZ absent.');
    }
    const contents = unzipSync(new Uint8Array(await archiveBlob.arrayBuffer()));
    expect(Object.keys(contents)).toEqual(['001.webp', '002.webp', 'ComicInfo.xml']);
    expect(Array.from(contents['001.webp'] ?? [])).toEqual([1]);
    expect(Array.from(contents['002.webp'] ?? [])).toEqual([2]);
  });

  it('returns one blob URL per image for folder output', async () => {
    const urls: string[] = [];
    const createdBlobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      if (blob instanceof Blob) {
        createdBlobs.push(blob);
      }
      const url = `blob:file-${urls.length + 1}`;
      urls.push(url);
      return url;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }),
      ),
    );

    const result = await createArchive({
      jobId: 'folder-job',
      pages: pages.slice(0, 1),
      packagerId: 'folder',
      meta: metadata,
    });

    expect(result.kind).toBe('files');
    if (result.kind !== 'files') {
      throw new Error('Une liste de fichiers était attendue.');
    }
    expect(result.files.map((file) => file.name)).toEqual(['001.webp']);
    expect(result.files[0]?.blobUrl).toBe('blob:file-1');
    expect(createdBlobs[0]?.type).toBe('image/webp');
  });

  it('creates no file blob when the user cancels during image acquisition', async () => {
    const controller = new AbortController();
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    const fetcher = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const build = createArchive({
      jobId: 'cancelled-job',
      pages: pages.slice(0, 1),
      packagerId: 'cbz',
      meta: metadata,
      signal: controller.signal,
      fetchOptions: { fetcher, sleep: async () => undefined },
    });

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    controller.abort();
    await expect(build).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it('creates no blob when an image fails after all retries', async () => {
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('forbidden', { status: 403 })),
    );

    await expect(
      createArchive({
        jobId: 'failed-job',
        pages: pages.slice(0, 1),
        packagerId: 'cbz',
        meta: metadata,
        fetchOptions: { sleep: async () => undefined },
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    expect(createObjectUrl).not.toHaveBeenCalled();
  });
});
