import type { ArchiveMeta } from './types';

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&apos;');
}

export function createComicInfo(meta: ArchiveMeta): string {
  const values = {
    series: meta.series,
    number: String(meta.chapter.number),
    title: meta.chapter.label,
    pageCount: String(meta.pageCount),
    web: meta.sourceUrl,
  };

  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<ComicInfo>',
    `  <Series>${escapeXml(values.series)}</Series>`,
    `  <Number>${escapeXml(values.number)}</Number>`,
    `  <Title>${escapeXml(values.title)}</Title>`,
    `  <PageCount>${escapeXml(values.pageCount)}</PageCount>`,
    `  <Web>${escapeXml(values.web)}</Web>`,
    '</ComicInfo>',
  ].join('\n');
}
