export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(scope: string): Logger {
  const format = (level: LogLevel, message: string, meta?: Record<string, unknown>): void => {
    const payload: Record<string, unknown> = { scope, ...meta };

    if (level === 'info') {
      console.info(message, payload);
      return;
    }

    if (level === 'warn') {
      console.warn(message, payload);
      return;
    }

    console.error(message, payload);
  };

  return {
    info: (message: string, meta?: Record<string, unknown>) => format('info', message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => format('warn', message, meta),
    error: (message: string, meta?: Record<string, unknown>) => format('error', message, meta),
  };
}

export const logger = createLogger('grandload');

export default logger;
