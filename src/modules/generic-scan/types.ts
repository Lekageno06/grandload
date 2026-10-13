export type ResourceType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'link' | 'other';
export type ScanSource =
  | 'a'
  | 'img'
  | 'picture'
  | 'video'
  | 'audio'
  | 'source'
  | 'link'
  | 'meta'
  | 'iframe'
  | 'style'
  | 'poster'
  | 'icon'
  | 'svg';
export type AssetProvenance = 'header' | 'footer' | 'navigation' | 'main' | 'content';

export interface ScanItem {
  id: string;
  url: string;
  type: ResourceType;
  ext: string;
  label: string;
  source: ScanSource;
  provenance?: AssetProvenance;
  width?: number;
  height?: number;
}

export interface ScanFilterState {
  type: ResourceType | 'all';
  extension: string;
  text: string;
}
