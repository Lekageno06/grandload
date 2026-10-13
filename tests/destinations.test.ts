import { describe, expect, it, vi } from 'vitest';

import {
  destinationTemplateValues,
  expandDestinationTemplate,
  validateDestinationTemplate,
} from '../src/destinations/template';
import { getDestination, registerDestination } from '../src/destinations/registry';
import { writeBlobToDirectory, type DirectoryHandleLike, type FileHandleLike, type WritableFileLike } from '../src/destinations/custom-folder';

describe('destinations', () => {
  it('développe les jetons dans des segments nettoyés', () => {
    expect(
      expandDestinationTemplate(
        'Grandload/{serie}/{chapitre}/{domaine}',
        destinationTemplateValues({
          series: 'The Boxer',
          chapter: 'Chapitre 119',
          sourceUrl: 'https://example.test/chapitre-119/',
          date: new Date('2026-01-02T00:00:00Z'),
        }),
      ),
    ).toBe('Grandload/The Boxer/Chapitre 119/example.test');
  });

  it('refuse les chemins absolus, traversées et caractères interdits', () => {
    expect(validateDestinationTemplate('../outside').valid).toBe(false);
    expect(validateDestinationTemplate('C:\\Downloads').valid).toBe(false);
    expect(validateDestinationTemplate('Manga|Test').valid).toBe(false);
    expect(expandDestinationTemplate('', {})).toBe('');
  });

  it('enregistre et retrouve un writer par identifiant', () => {
    const writer = { id: 'test', writeArchive: async () => undefined };
    expect(registerDestination(writer)).toBe(writer);
    expect(getDestination('test')).toBe(writer);
  });

  it('écrit dans des sous-dossiers, ajoute un suffixe et ne conserve pas une écriture interrompue', async () => {
    const files = new Map<string, Blob>();
    const directories = new Map<string, FakeDirectory>();
    class FakeDirectory implements DirectoryHandleLike {
      name: string;
      constructor(name: string) { this.name = name; directories.set(name, this); }
      async getDirectoryHandle(name: string): Promise<DirectoryHandleLike> {
        return directories.get(`${this.name}/${name}`) ?? new FakeDirectory(`${this.name}/${name}`);
      }
      async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
        const key = `${this.name}/${name}`;
        if (options?.create === false && !files.has(key)) throw new Error('NotFound');
        return {
          createWritable: async (): Promise<WritableFileLike> => ({
            write: async (blob) => { files.set(key, blob); },
            close: async () => undefined,
            abort: async () => { files.delete(key); },
          }),
        };
      }
      async removeEntry(name: string): Promise<void> { files.delete(`${this.name}/${name}`); }
    }
    const root = new FakeDirectory('root');
    files.set('root/Manga/archive.cbz', new Blob(['existing']));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['archive']))));

    await expect(writeBlobToDirectory(root, 'blob:archive', 'Manga/archive.cbz')).resolves.toBe('archive (1).cbz');
    expect(files.has('root/Manga/archive (1).cbz')).toBe(true);
  });
});
