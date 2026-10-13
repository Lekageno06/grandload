import { createWpMangaAdapter } from '../wp-manga';

export const hentaiOriginesAdapter = createWpMangaAdapter({
  id: 'hentai-origines',
  hosts: ['hentai-origines.com'],
  baseUrl: 'https://hentai-origines.com',
  pathPrefix: '/manga',
  seriesSelector: '.ori-chl-row',
  readerSelector: 'main.ori-lec-scene .reading-content img.wp-manga-chapter-img',
  titleSuffix: /\s*-\s*Hentai\s+Origines\s*$/iu,
});
