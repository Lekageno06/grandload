import { unzipSync } from 'fflate';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import type { ArchiveEntry, ArchiveMeta } from '../src/core/types';
import { createComicInfo } from '../src/packagers/comicinfo';
import { cbzPackager } from '../src/packagers/cbz';
import { folderPackager } from '../src/packagers/folder';
import { formatArchiveEntryName } from '../src/packagers/types';
import { zipPackager } from '../src/packagers/zip';

const metadata: ArchiveMeta = {
  series: 'A & B <Saga>',
  chapter: {
    number: 129.5,
    label: 'Titre "spécial" & suite',
    url: 'https://example.com/chapter?x=1&y=2',
  },
  pageCount: 2,
  sourceUrl: 'https://example.com/chapter?x=1&y=2',
};

const imageEntries: ArchiveEntry[] = [
  { name: '001.webp', data: new Uint8Array([1, 2, 3]) },
  { name: '002.webp', data: new Uint8Array([4, 5, 6]) },
];

function requireBlob(output: Blob | ArchiveEntry[]): Blob {
  if (!(output instanceof Blob)) {
    throw new Error('Le packager devait produire une archive Blob.');
  }
  return output;
}

describe('packagers', () => {
  it('names entries with max(3, digit count of total) padding', () => {
    expect(formatArchiveEntryName(1, 9, '.webp')).toBe('001.webp');
    expect(formatArchiveEntryName(1, 1000, 'jpg')).toBe('0001.jpg');
    expect(formatArchiveEntryName(12, 12000, '.PNG')).toBe('00012.png');
  });

  it('writes ZIP entries in STORE mode and keeps their names and bytes', async () => {
    const blob = requireBlob(await zipPackager.pack(imageEntries, metadata));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const files = unzipSync(bytes);

    expect(blob.type).toBe('application/zip');
    expect(bytes[8]).toBe(0);
    expect(bytes[9]).toBe(0);
    expect(Object.keys(files)).toEqual(['001.webp', '002.webp']);
    expect(Array.from(files['001.webp'] ?? [])).toEqual([1, 2, 3]);
  });

  it('adds valid ComicInfo XML with escaped metadata to CBZ', async () => {
    const blob = requireBlob(await cbzPackager.pack(imageEntries, metadata));
    expect(blob.type).toBe('application/octet-stream');
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const xmlBytes = files['ComicInfo.xml'];
    expect(xmlBytes).toBeDefined();

    const xml = new TextDecoder().decode(xmlBytes);
    const parser = new JSDOM().window.DOMParser;
    const document = new parser().parseFromString(xml, 'application/xml');

    expect(document.querySelector('parsererror')).toBeNull();
    expect(document.querySelector('ComicInfo Series')?.textContent).toBe('A & B <Saga>');
    expect(document.querySelector('ComicInfo Number')?.textContent).toBe('129.5');
    expect(document.querySelector('ComicInfo Title')?.textContent).toBe('Titre "spécial" & suite');
    expect(document.querySelector('ComicInfo PageCount')?.textContent).toBe('2');
    expect(document.querySelector('ComicInfo Web')?.textContent).toBe(metadata.sourceUrl);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;Saga&gt;');
    expect(xml).toContain('&quot;spécial&quot;');
  });

  it('uses application/zip for standard ZIP and octet-stream for CBZ', async () => {
    const zipBlob = requireBlob(await zipPackager.pack(imageEntries, metadata));
    const cbzBlob = requireBlob(await cbzPackager.pack(imageEntries, metadata));

    expect(zipBlob.type).toBe('application/zip');
    expect(cbzBlob.type).toBe('application/octet-stream');
    expect(zipPackager.extension).toBe('.zip');
    expect(cbzPackager.extension).toBe('.cbz');
  });

  it('returns separate page files for folder output', async () => {
    const output = await folderPackager.pack(imageEntries, metadata);
    expect(Array.isArray(output)).toBe(true);
    expect((output as ArchiveEntry[]).map((entry) => entry.name)).toEqual(['001.webp', '002.webp']);
  });

  it('escapes all XML special characters in ComicInfo values', () => {
    const xml = createComicInfo({
      ...metadata,
      series: `A & B <C> "D" 'E'`,
    });
    expect(xml).toContain('A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;');
  });
});
