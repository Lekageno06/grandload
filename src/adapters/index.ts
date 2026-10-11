import { registerAdapter } from '../core/registry';
import { genericAdapter } from './generic';
import { mangasOriginesAdapter } from './mangas-origines';

registerAdapter(genericAdapter);
registerAdapter(mangasOriginesAdapter);

export { genericAdapter, mangasOriginesAdapter };
