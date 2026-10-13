import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';

import { genericAdapter } from '../src/adapters/generic';
import { getChapterNumberFromUrl, mangasOriginesAdapter } from '../src/adapters/mangas-origines';
import { autoScrollUntilStable } from '../src/content/scroll-loader';
import { formatChapterSource } from '../src/modules/chapter-download';
import { processPageExclusions } from '../src/modules/chapter-download/exclusions';

function readMangasOriginesFixture(
  name: 'series.html' | 'chapter.html' | 'chapter-the-boxer.html',
): string {
  const fixtureUrl = new URL(`./fixtures/mangas-origines/${name}`, import.meta.url);
  return readFileSync(fileURLToPath(fixtureUrl), 'utf8');
}

describe('mangas-origines adapter', () => {
  it('affiche la source sous forme d’hôte et chemin tronqué', () => {
    expect(formatChapterSource('https://mangas-origines.fr/oeuvre/the-boxer/chapitre-119/')).toBe(
      'mangas-origines.fr/oeuvre/the-boxer/chapitre-119/',
    );
    expect(formatChapterSource('https://example.test/a'.repeat(20), 20)).toMatch(/…$/u);
  });

  it('délègue la collecte au content reader et ne possède aucun collecteur DOM parallèle', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/chapter-download/index.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain("sendContentRequest<PageRef[]>(tabId, 'READ_CHAPTER_PAGES'");
    expect(source).not.toContain('executeScript');
    expect(source).not.toMatch(/querySelectorAll[^\n]*['"]img/iu);
  });
  it('classifies series and chapter URLs including a decimal route', () => {
    const seriesUrl = new URL('https://mangas-origines.fr/oeuvre/one-piece/');
    const chapterUrl = new URL('https://mangas-origines.fr/oeuvre/one-piece/chapitre-129-5/');

    expect(mangasOriginesAdapter.matches(seriesUrl)).toBe(true);
    expect(mangasOriginesAdapter.classify(seriesUrl)).toBe('series');
    expect(mangasOriginesAdapter.matches(chapterUrl)).toBe(true);
    expect(mangasOriginesAdapter.classify(chapterUrl)).toBe('chapter');
  });

  it('reads all 323 unique series chapters from the captured page', () => {
    const doc = new JSDOM(readMangasOriginesFixture('series.html'), {
      url: 'https://mangas-origines.fr/oeuvre/overgeared/',
    }).window.document;
    const chapters = mangasOriginesAdapter.readSeries(doc).chapters;

    expect(doc.querySelectorAll('.ori-chl-row').length).toBe(323);
    expect(chapters).toHaveLength(323);
    expect(new Set(chapters.map((chapter) => chapter.url)).size).toBe(323);
    expect(chapters[0]?.number).toBe(0);
    expect(chapters[0]?.label).toBe('Chapitre 0');
    expect(chapters.at(-1)?.number).toBe(322);
    expect(chapters.at(-1)?.label).toBe('Chapitre 322');
    expect(chapters.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: 323 }, (_value, index) => index),
    );
  });

  it('parses a decimal chapter number between integer chapters', () => {
    const decimalChapter = getChapterNumberFromUrl(
      'https://mangas-origines.fr/oeuvre/overgeared/chapitre-129-5/',
    );

    expect(decimalChapter).toBe(129.5);
    expect(129 < decimalChapter! && decimalChapter! < 130).toBe(true);
  });

  it('builds chapter metadata from the work title and URL, never the link text', () => {
    const doc = new JSDOM(readMangasOriginesFixture('chapter.html'), {
      url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-320/',
    }).window.document;
    expect(
      mangasOriginesAdapter.readChapterMeta(
        doc,
        'https://mangas-origines.fr/oeuvre/overgeared/chapitre-129-5/',
      ),
    ).toEqual({
      series: 'Overgeared',
      number: 129.5,
      label: 'Chapitre 129.5',
    });
  });

  it('sorts a synthetic 129.5 row derived from the fixture between 129 and 130', () => {
    const doc = new JSDOM(readMangasOriginesFixture('series.html'), {
      url: 'https://mangas-origines.fr/oeuvre/overgeared/',
    }).window.document;
    const sourceRow = doc.querySelector<HTMLElement>('.ori-chl-row[data-num="129"]');
    expect(sourceRow).not.toBeNull();
    if (!sourceRow) {
      throw new Error('La ligne du chapitre 129 est absente de la fixture.');
    }
    const decimalRow = sourceRow.cloneNode(true) as HTMLElement;

    for (const anchor of Array.from(decimalRow.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      anchor.href = anchor.href.replace('/chapitre-129/', '/chapitre-129-5/');
    }
    const longLabel = decimalRow.querySelector<HTMLElement>('.ori-chl-nom-long');
    const shortLabel = decimalRow.querySelector<HTMLElement>('.ori-chl-nom-court');
    if (longLabel) {
      longLabel.textContent = 'Chapitre 129.5';
    }
    if (shortLabel) {
      shortLabel.textContent = 'Ch.129.5';
    }
    doc.querySelector('.ori-chl-liste')?.appendChild(decimalRow);

    const chapters = mangasOriginesAdapter.readSeries(doc).chapters;
    const chapter129Index = chapters.findIndex((chapter) => chapter.number === 129);

    expect(
      chapters.slice(chapter129Index, chapter129Index + 3).map((chapter) => chapter.number),
    ).toEqual([129, 129.5, 130]);
  });

  it('reads chapter images from the captured reader in DOM order', () => {
    const doc = new JSDOM(readMangasOriginesFixture('chapter.html'), {
      url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-320/',
    }).window.document;
    const selector = '.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img';
    const pages = mangasOriginesAdapter.readChapterPages(doc);
    const fixtureImages = Array.from(doc.querySelectorAll(selector));

    expect(fixtureImages).toHaveLength(50);
    expect(pages).toHaveLength(fixtureImages.length);
    expect(pages[0]?.index).toBe(1);
    expect(new URL(pages[0]?.url ?? '').pathname).toMatch(/page_0001\.webp$/u);
    expect(pages.map((page) => page.index)).toEqual(
      Array.from({ length: fixtureImages.length }, (_value, index) => index + 1),
    );
    expect(pages.map((page) => new URL(page.url).pathname.split('/').pop())).toEqual(
      Array.from(
        { length: fixtureImages.length },
        (_value, index) => `page_${String(index + 1).padStart(4, '0')}.webp`,
      ),
    );
  });

  it('reads exactly the reader pages and excludes the header logo', () => {
    const doc = new JSDOM(readMangasOriginesFixture('chapter-the-boxer.html'), {
      url: 'https://mangas-origines.fr/oeuvre/the-boxer/chapitre-119/',
    }).window.document;

    const pages = mangasOriginesAdapter.readChapterPages(doc);

    expect(pages).toHaveLength(16);
    expect(pages.some((page) => page.url.includes('logos_oritest2-2.png'))).toBe(false);
    expect(pages.map((page) => new URL(page.url).pathname.split('/').pop())).toEqual(
      Array.from(
        { length: 16 },
        (_value, index) => `img_${String(index + 1).padStart(4, '0')}_TheBoxer.webp`,
      ),
    );
  });

  it('keeps the same 16 pages when pre-exclusion is disabled', () => {
    const doc = new JSDOM(readMangasOriginesFixture('chapter-the-boxer.html'), {
      url: 'https://mangas-origines.fr/oeuvre/the-boxer/chapitre-119/',
    }).window.document;
    const pages = mangasOriginesAdapter.readChapterPages(doc);
    const processed = processPageExclusions(pages, mangasOriginesAdapter, false);

    expect(processed).toHaveLength(16);
    expect(processed.every((page) => !page.excluded)).toBe(true);
    expect(processed.some((page) => page.url.includes('logos_oritest2-2.png'))).toBe(false);
  });

  it('signale une structure adaptateur invalide quand aucune planche n’est trouvée', () => {
    const doc = new JSDOM(
      '<main class="ori-lec-scene"><div class="reading-content"></div></main>',
      { url: 'https://mangas-origines.fr/oeuvre/the-boxer/chapitre-119/' },
    ).window.document;

    expect(() => mangasOriginesAdapter.readChapterPages(doc)).toThrowError(
      'Structure de chapitre mangas-origines non reconnue',
    );
  });

  it('falls back to chapter images outside the precise reader structure', () => {
    const doc = new JSDOM(readMangasOriginesFixture('chapter.html'), {
      url: 'https://mangas-origines.fr/oeuvre/overgeared/chapitre-320/',
    }).window.document;
    const fixtureImage = doc.querySelector<HTMLImageElement>(
      '.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img',
    );
    expect(fixtureImage).not.toBeNull();
    if (!fixtureImage) {
      throw new Error('La fixture ne contient pas de planche du lecteur.');
    }

    const fallbackImage = fixtureImage.cloneNode(true) as HTMLImageElement;
    doc
      .querySelectorAll('.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img')
      .forEach((image) => image.classList.remove('wp-manga-chapter-img'));
    fallbackImage.className = 'wp-manga-chapter-img';
    doc.body.appendChild(fallbackImage);

    expect(
      doc.querySelectorAll('.ori-lec-scene .reading-content .page-break img.wp-manga-chapter-img'),
    ).toHaveLength(0);
    expect(mangasOriginesAdapter.readChapterPages(doc).map((page) => page.url)).toEqual([
      'https://mangas-origines.fr/wp-content/uploads/WP-manga/data/manga_649ef26fcfb6a/4fac69e6c27c9846289067da2f02cbf9/page_0001.webp',
    ]);
  });
});

describe('generic adapter', () => {
  it('finds the dominant container of large images and ignores header/footer content', () => {
    const doc = new JSDOM(`
      <html>
        <body>
          <header><img src="https://example.com/logo.png" width="400" /></header>
          <main>
            <div class="reader">
              <img src="https://example.com/1.jpg" width="900" />
              <img src="https://example.com/2.jpg" width="1000" />
            </div>
          </main>
          <footer><img src="https://example.com/footer.png" width="300" /></footer>
        </body>
      </html>
    `).window.document;

    expect(genericAdapter.readChapterPages(doc).map((page) => page.url)).toEqual([
      'https://example.com/1.jpg',
      'https://example.com/2.jpg',
    ]);
  });
});

describe('scroll loader', () => {
  it('stops once the count of discovered pages stabilizes', async () => {
    const pageCounts = [2, 3, 3, 3];
    let currentIndex = 0;

    const document = {
      body: { scrollHeight: 1500 },
      documentElement: { scrollHeight: 1500 },
    } as unknown as Document;

    const windowLike = {
      scrollY: 0,
      scrollTo: vi.fn(({ top }: { top: number }) => {
        windowLike.scrollY = top;
      }),
    } as unknown as Window & typeof globalThis;

    const result = await autoScrollUntilStable({
      document,
      windowRef: windowLike,
      pageCountProvider: () => pageCounts[currentIndex++] ?? 3,
      scrollStep: 600,
      maxScrolls: 10,
      stabilizationWindow: 2,
    });

    expect(result).toBe(3);
    expect(windowLike.scrollTo).toHaveBeenCalled();
  });
});
