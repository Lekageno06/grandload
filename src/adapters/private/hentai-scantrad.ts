import { createWpMangaAdapter } from '../wp-manga';

export const hentaiScantradAdapter = createWpMangaAdapter({
  id: 'hentai-scantrad',
  hosts: ['hentai-scantrad.org'],
  baseUrl: 'https://hentai-scantrad.org',
  pathPrefix: '/manga',
  seriesSelector: 'li.wp-manga-chapter',
  readerSelector: 'div.read-container .reading-content div.page-break.no-gaps img.wp-manga-chapter-img',
  titleSuffix: /\s*-\s*Hentai\s+Scantrad\s*$/iu,
  extraOrigins: () => ['https://*.hentai-scantrad.org/*'],
});
