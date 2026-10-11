export type GrandloadErrorCode =
  | 'ADAPTER_STRUCTURE'
  | 'PERMISSION_DENIED'
  | 'FETCH_FAILED'
  | 'INVALID_URL'
  | 'REGISTRY_NOT_FOUND'
  | 'STORAGE_READ_FAILED'
  | 'STORAGE_WRITE_FAILED'
  | 'RUNTIME_UNAVAILABLE'
  | 'UNKNOWN';

export class GrandloadError extends Error {
  readonly code: GrandloadErrorCode;

  constructor(code: GrandloadErrorCode, message: string) {
    super(message);
    this.name = 'GrandloadError';
    this.code = code;
  }
}

export function toGrandloadError(error: unknown, fallbackCode: GrandloadErrorCode = 'UNKNOWN'): GrandloadError {
  if (error instanceof GrandloadError) {
    return error;
  }

  if (error instanceof Error) {
    return new GrandloadError(fallbackCode, error.message);
  }

  if (typeof error === 'string' && error.length > 0) {
    return new GrandloadError(fallbackCode, error);
  }

  return new GrandloadError(fallbackCode, 'Une erreur inconnue est survenue.');
}
