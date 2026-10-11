export type ResourceType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'link' | 'other';
export type ScanSource =
  'a' | 'img' | 'picture' | 'video' | 'audio' | 'source' | 'link' | 'meta' | 'iframe' | 'style';

export interface ScanItem {
  id: string;
  url: string;
  type: ResourceType;
  ext: string;
  label: string;
  source: ScanSource;
}

export interface ScanFilterState {
  type: ResourceType | 'all';
  extension: string;
  text: string;
}
