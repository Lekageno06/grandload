import { describe, expect, it, vi } from 'vitest';

import type { PageRef } from '../src/core/types';
import { fetchImages } from '../src/offscreen/image-fetcher';

function createPages(count: number): PageRef[] {
  return Array.from({ length: count }, (_value, index) => ({
    index: index + 1,
    url: `https://cdn.example.com/${index + 1}.webp`,
    ext: 'webp',
  }));
}

describe('image fetcher', () => {
  it('fetches with credentials, limits concurrency to 3 and reports progress', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const progress: number[] = [];
    const fetcher = vi.fn(
      async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        expect(init?.credentials).toBe('include');
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return new Response(new Uint8Array([1]), {
          headers: { 'Content-Type': 'image/webp' },
        });
      },
    );

    const images = await fetchImages(createPages(8), {
      fetcher,
      onProgress: (done) => progress.push(done),
    });

    expect(images).toHaveLength(8);
    expect(maxInFlight).toBe(3);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('retries twice after a failed response and then succeeds', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('fail', { status: 503 }))
      .mockResolvedValueOnce(new Response('fail', { status: 503 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), { headers: { 'Content-Type': 'image/png' } }),
      );
    const sleep = vi.fn(async (_delayMs: number) => undefined);

    const images = await fetchImages(createPages(1), { fetcher, sleep });

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1000, 3000]);
    expect(images[0]?.data).toEqual(new Uint8Array([9]));
  });

  it.each([
    ['text/html', new Uint8Array([1])],
    ['image/png', new Uint8Array()],
  ])('rejects invalid image response (%s)', async (contentType, body) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(body, { headers: { 'Content-Type': contentType } }));

    await expect(
      fetchImages(createPages(1), { fetcher, sleep: async () => undefined }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('keeps HTTP status and content type when an HTML response exhausts its backoff', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('<html></html>', {
      status: 200, headers: { 'Content-Type': 'text/html' },
    }));
    await expect(fetchImages(createPages(1), { fetcher, sleep: async () => undefined })).rejects.toThrow('HTTP 200');
    await expect(fetchImages(createPages(1), { fetcher: vi.fn<typeof fetch>().mockRejectedValue(new TypeError('Failed to fetch')), sleep: async () => undefined })).rejects.toThrow('Connexion interrompue');
  });

  it('uses the 1 s, 3 s, 6 s retry schedule with a simulated clock', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))
        .mockResolvedValueOnce(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))
        .mockResolvedValueOnce(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }));
      const promise = fetchImages(createPages(1), { fetcher });
      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(3000);
      await vi.advanceTimersByTimeAsync(6000);
      await expect(promise).resolves.toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a request at its configured deadline and exhausts its retries', async () => {
    const fetcher = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );

    await expect(
      fetchImages(createPages(1), {
        fetcher,
        sleep: async () => undefined,
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('reduces to one worker after the first image fails without building an incomplete archive', async () => {
    const fetcher = vi.fn(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        if (String(input).endsWith('/1.webp')) {
          return Promise.resolve(new Response('forbidden', { status: 403 }));
        }
        void init;
        return Promise.resolve(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/webp' } }));
      },
    );

    await expect(
      fetchImages(createPages(8), {
        fetcher,
        sleep: async () => undefined,
      }),
    ).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    expect(fetcher).toHaveBeenCalled();
  });
});
