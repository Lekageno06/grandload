import type { ScanFilterState, ScanItem } from './types';

export function filterScanItems(items: readonly ScanItem[], filters: ScanFilterState): ScanItem[] {
  let filtered = [...items];

  if (filters.type !== 'all') {
    filtered = filtered.filter((item) => item.type === filters.type);
  }

  if (filters.extension.trim().length > 0) {
    const desiredExtension = filters.extension.trim().toLowerCase();
    filtered = filtered.filter((item) => item.ext.toLowerCase() === desiredExtension);
  }

  const normalizedText = filters.text.trim().toLowerCase();
  if (normalizedText.length > 0) {
    filtered = filtered.filter((item) => {
      return (
        item.label.toLowerCase().includes(normalizedText) ||
        item.url.toLowerCase().includes(normalizedText) ||
        item.source.toLowerCase().includes(normalizedText)
      );
    });
  }

  return filtered;
}

export function getTypeCounts(items: readonly ScanItem[]): Record<string, number> {
  const counts: Record<string, number> = {
    image: 0,
    video: 0,
    audio: 0,
    document: 0,
    archive: 0,
    link: 0,
    other: 0,
  };

  for (const item of items) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }

  return counts;
}
