import { registerModule } from '../core/registry';
import chapterDownloadModule from './chapter-download';
import genericScanModule from './generic-scan';

registerModule(genericScanModule);
registerModule(chapterDownloadModule);

export { genericScanModule, chapterDownloadModule };
