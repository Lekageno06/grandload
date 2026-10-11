import type { ScanItem } from './types';

function escapeCsvValue(value: string): string {
  if (value.includes('"') || value.includes(',') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/gu, '""')}"`;
  }

  return value;
}

export function exportTxt(items: readonly ScanItem[]): string {
  return items.map((item) => item.url).join('\n');
}

export function exportJson(items: readonly ScanItem[]): string {
  return JSON.stringify(items, null, 2);
}

export function exportCsv(items: readonly ScanItem[]): string {
  const rows = ['url,type,ext,source,label'];

  for (const item of items) {
    const row = [
      escapeCsvValue(item.url),
      escapeCsvValue(item.type),
      escapeCsvValue(item.ext),
      escapeCsvValue(item.source),
      escapeCsvValue(item.label),
    ].join(',');

    rows.push(row);
  }

  return rows.join('\n');
}
