import { registerPackager } from '../core/registry';
import { cbzPackager } from './cbz';
import { folderPackager } from './folder';
import { zipPackager } from './zip';

registerPackager(cbzPackager);
registerPackager(zipPackager);
registerPackager(folderPackager);

export { cbzPackager, folderPackager, zipPackager };
