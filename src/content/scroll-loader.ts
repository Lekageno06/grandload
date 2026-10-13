export type ScrollLoaderOptions = {
  document: Document;
  windowRef?: Pick<Window, 'scrollTo' | 'scrollY'>;
  pageCountProvider?: () => number;
  scrollStep?: number;
  maxScrolls?: number;
  stabilizationWindow?: number;
  delayMs?: number;
};

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

export async function autoScrollUntilStable(options: ScrollLoaderOptions): Promise<number> {
  const documentRef = options.document;
  const windowRef = options.windowRef ?? documentRef.defaultView ?? undefined;
  const pageCountProvider = options.pageCountProvider ?? (() => 0);

  const scrollStep = options.scrollStep ?? 600;
  const maxScrolls = options.maxScrolls ?? 8;
  const stabilizationWindow = options.stabilizationWindow ?? 2;
  const delayMs = options.delayMs ?? 200;

  const history: number[] = [];

  for (let step = 0; step < maxScrolls; step += 1) {
    const count = pageCountProvider();
    history.push(count);

    if (history.length >= stabilizationWindow) {
      const lastValues = history.slice(-stabilizationWindow);
      if (lastValues.every((value) => value === lastValues[0])) {
        return count;
      }
    }

    if (!windowRef || typeof windowRef.scrollTo !== 'function') {
      break;
    }

    const maxHeight = Math.max(
      documentRef.body?.scrollHeight ?? 0,
      documentRef.documentElement?.scrollHeight ?? 0,
      windowRef.scrollY ?? 0,
    );
    const nextTop = Math.min((windowRef.scrollY ?? 0) + scrollStep, maxHeight);

    windowRef.scrollTo({ top: nextTop, behavior: 'auto' });
    await wait(delayMs);
  }

  return pageCountProvider();
}
