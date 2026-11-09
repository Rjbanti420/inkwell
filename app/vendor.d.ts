declare module "../vendor/marked.esm.js" {
  export const marked: {
    parse(src: string, options?: Record<string, unknown>): string;
    use(options: Record<string, unknown>): void;
  };
}

declare module "../vendor/purify.es.mjs" {
  interface SanitizeConfig {
    ALLOWED_TAGS?: string[];
    ALLOWED_ATTR?: string[];
    ALLOW_DATA_ATTR?: boolean;
  }
  const DOMPurify: {
    sanitize(html: string, config?: SanitizeConfig): string;
  };
  export default DOMPurify;
}
