import { registerAdapter } from '../core/registry';
import { genericAdapter } from './generic';
import { mangasOriginesAdapter } from './mangas-origines';

declare const __GRANDLOAD_PRIVATE__: boolean;

registerAdapter(genericAdapter);
registerAdapter(mangasOriginesAdapter);
if (typeof __GRANDLOAD_PRIVATE__ !== 'undefined' && __GRANDLOAD_PRIVATE__) {
  void import('./private').then(({ hentaiOriginesAdapter, hentaiScantradAdapter }) => {
    registerAdapter(hentaiOriginesAdapter);
    registerAdapter(hentaiScantradAdapter);
  });
}

export { genericAdapter, mangasOriginesAdapter };
