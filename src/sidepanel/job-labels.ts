export function formatJobLabel(params: Record<string, unknown>): string {
  const chapter = params.chapter;
  const meta = params.meta;
  const series = typeof params.seriesTitle === 'string'
    ? params.seriesTitle
    : typeof meta === 'object' && meta !== null && 'series' in meta && typeof meta.series === 'string' ? meta.series : '';
  const chapterLabel = typeof chapter === 'object' && chapter !== null && 'label' in chapter && typeof chapter.label === 'string'
    ? chapter.label
    : typeof meta === 'object' && meta !== null && 'chapter' in meta && typeof meta.chapter === 'object' && meta.chapter !== null && 'label' in meta.chapter && typeof meta.chapter.label === 'string' ? meta.chapter.label : '';
  return series && chapterLabel ? `${series} · ${chapterLabel}` : 'Téléchargement Grandload';
}
