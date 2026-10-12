declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { contentType?: string; url?: string });
    readonly window: {
      readonly document: Document;
      readonly DOMParser: typeof DOMParser;
    };
  }
}
