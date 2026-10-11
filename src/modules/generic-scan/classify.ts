import { getFileExtension } from '../../shared/url-utils';
import type { ResourceType, ScanSource } from './types';

const imageExtensions = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg', 'bmp', 'ico']);
const videoExtensions = new Set(['mp4', 'webm', 'mkv', 'mov', 'avi', 'm3u8', 'mpd']);
const audioExtensions = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const documentExtensions = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
]);
const archiveExtensions = new Set(['zip', 'rar', '7z', 'tar', 'gz']);

export function classifyResource(url: string, source: ScanSource | string = 'other'): ResourceType {
  const ext = getFileExtension(url);

  if (ext) {
    if (imageExtensions.has(ext)) {
      return 'image';
    }
    if (videoExtensions.has(ext)) {
      return 'video';
    }
    if (audioExtensions.has(ext)) {
      return 'audio';
    }
    if (documentExtensions.has(ext)) {
      return 'document';
    }
    if (archiveExtensions.has(ext)) {
      return 'archive';
    }
  }

  const normalizedSource = source.toLowerCase();

  if (normalizedSource === 'a' || normalizedSource === 'link' || normalizedSource === 'iframe') {
    return 'link';
  }

  if (normalizedSource === 'img' || normalizedSource === 'picture' || normalizedSource === 'meta') {
    return 'image';
  }

  if (normalizedSource === 'video' || normalizedSource === 'source') {
    return 'video';
  }

  if (normalizedSource === 'audio') {
    return 'audio';
  }

  return 'other';
}
