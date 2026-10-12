import { consumeRequestedDownloadName } from '../core/storage';

export type FilenameSuggestion = (suggestion?: chrome.downloads.FilenameSuggestion) => void;

export async function suggestRequestedDownloadName(
  item: Pick<chrome.downloads.DownloadItem, 'byExtensionId' | 'url'>,
  suggest: FilenameSuggestion,
  consumeName: (url: string) => Promise<string | undefined> = consumeRequestedDownloadName,
): Promise<void> {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest();
    return;
  }

  try {
    const filename = await consumeName(item.url);
    if (filename) {
      suggest({ filename, conflictAction: 'uniquify' });
    } else {
      suggest();
    }
  } catch {
    suggest();
  }
}
