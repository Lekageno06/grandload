import { registerDestination } from './registry';

export const browserDestination = registerDestination({
  id: 'browser',
  writeArchive: async ({ blobUrl, filename, saveAs = false }) => {
    await new Promise<void>((resolve, reject) => {
      chrome.downloads.download({ url: blobUrl, filename, saveAs, conflictAction: 'uniquify' }, (id) => {
        const error = chrome.runtime.lastError;
        if (error || typeof id !== 'number') {
          reject(new Error(error?.message ?? 'Le téléchargement est impossible.'));
          return;
        }
        resolve();
      });
    });
  },
});
