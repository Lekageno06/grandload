import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getVirtualWindow, ImageGallery } from '../src/ui/components/gallery';

describe('ImageGallery', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('virtualise une galerie de 2 000 vignettes', () => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const windowLike = dom.window as unknown as {
      document: Document;
      Node: typeof Node;
      HTMLElement: typeof HTMLElement;
    };
    vi.stubGlobal('document', windowLike.document);
    vi.stubGlobal('Node', windowLike.Node);
    vi.stubGlobal('HTMLElement', windowLike.HTMLElement);
    vi.stubGlobal('IntersectionObserver', undefined);

    const items = Array.from({ length: 2000 }, (_, index) => ({
      id: String(index),
      url: `https://example.test/${index}.jpg`,
      label: `Image ${index}`,
      ext: 'jpg',
    }));
    const gallery = new ImageGallery(items);

    expect(gallery.element.dataset.virtualized).toBe('true');
    expect(gallery.element.querySelectorAll('.ui-gallery-card')).toHaveLength(120);
    expect(getVirtualWindow(2000, 600)).toEqual({ start: 600, end: 720 });
  });
});
