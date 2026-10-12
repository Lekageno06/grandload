import { registerModule } from '../core/registry';
import chapterDownloadModule from './chapter-download';
import genericScanModule from './generic-scan';
import preferencesModule from './preferences';
import seriesDownloadModule from './series-download';

registerModule(genericScanModule);
registerModule(chapterDownloadModule);
registerModule(seriesDownloadModule);
registerModule(preferencesModule);

export { genericScanModule, chapterDownloadModule, seriesDownloadModule, preferencesModule };
