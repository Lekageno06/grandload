export type DestinationMode = 'browser' | 'custom-folder' | 'ask-each-time';

export interface DestinationSettings {
  mode: DestinationMode;
  subfolderTemplate: string;
  customFolderName: string;
}

export interface DestinationWriteRequest {
  blobUrl: string;
  filename: string;
  saveAs?: boolean;
}

export interface DestinationWriter {
  id: string;
  writeArchive: (request: DestinationWriteRequest) => Promise<void>;
}
