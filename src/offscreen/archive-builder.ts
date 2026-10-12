import { getPackager } from '../core/registry';
import { GrandloadError } from '../core/errors';
import type { ArchiveBuildResult, ArchiveEntry, ArchiveMeta, PageRef } from '../core/types';
import { formatArchiveEntryName } from '../packagers/types';
import '../packagers';
import { fetchImages } from './image-fetcher';
import type { ImageFetchOptions } from './image-fetcher';

export type BuiltArchive = ArchiveBuildResult;

export type BuildArchiveRequest = {
  jobId: string;
  pages: PageRef[];
  packagerId: string;
  meta: ArchiveMeta;
  signal?: AbortSignal;
  onProgress?: (jobId: string, done: number, total: number) => void;
  fetchOptions?: Pick<ImageFetchOptions, 'fetcher' | 'sleep' | 'timeoutMs'>;
};

function mimeTypeForExtension(extension: string): string {
  const mimeByExtension: Record<string, string> = {
    avif: 'image/avif',
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  };
  return mimeByExtension[extension.toLowerCase()] ?? 'application/octet-stream';
}

function toBlobPart(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

export async function createArchive(request: BuildArchiveRequest): Promise<BuiltArchive> {
  if (request.pages.length === 0) {
    throw new GrandloadError('ADAPTER_STRUCTURE', 'Aucune planche sélectionnée.');
  }

  const packager = getPackager(request.packagerId);
  if (!packager) {
    throw new GrandloadError('REGISTRY_NOT_FOUND', `Packager inconnu : ${request.packagerId}`);
  }

  const pages = [...request.pages].sort((left, right) => left.index - right.index);
  const fetched = await fetchImages(pages, {
    ...request.fetchOptions,
    ...(request.signal ? { signal: request.signal } : {}),
    onProgress: (done, total) => request.onProgress?.(request.jobId, done, total),
  });
  const total = fetched.length;
  const entries: ArchiveEntry[] = fetched.map((image, index) => ({
    name: formatArchiveEntryName(index + 1, total, image.extension),
    data: image.data,
  }));
  const output = await packager.pack(entries, { ...request.meta, pageCount: total });

  if (output instanceof Blob) {
    const blobUrl = URL.createObjectURL(output);
    return { kind: 'archive', blobUrl, size: output.size };
  }

  const files = output.map((entry, index) => {
    const page = fetched[index];
    const extension = page?.extension ?? entry.name.split('.').at(-1) ?? 'img';
    const blob = new Blob([toBlobPart(entry.data)], { type: mimeTypeForExtension(extension) });
    return { name: entry.name, blobUrl: URL.createObjectURL(blob), size: blob.size };
  });
  return { kind: 'files', files };
}

export function revokeBlobUrls(urls: string[]): void {
  for (const url of urls) {
    if (url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}
