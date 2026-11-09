/** Inline formatting that applies to the text typed at a collapsed caret. */
export interface PendingFormat {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** null means the theme default. */
  color?: string | null;
  /** Pixel value such as "48px"; null means inherit. */
  fontSize?: string | null;
  /** CSS font stack; null means inherit. */
  fontFamily?: string | null;
  /** Highlight color; null means no highlight. */
  background?: string | null;
}

export interface Tab {
  id: string;
  title: string;
  fileName: string | null;
  filePath: string | null;
  dirty: boolean;
  folderId: string | null;
  editor: HTMLElement;
  wrap: HTMLElement;
  lastRange: Range | null;
  pending: PendingFormat;
}

export interface StoredTab {
  id: string;
  title: string;
  fileName: string | null;
  filePath: string | null;
  dirty: boolean;
  html: string;
  /** Document-wide inline styles (font size/family/color) outside the HTML. */
  style?: string;
  folderId?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  expanded: boolean;
}

export interface SessionFile {
  version: 1;
  activeId: string;
  tabs: StoredTab[];
  folders?: Folder[];
}

export type ThemeMode = "system" | "light" | "dark";

export interface Settings {
  volume: number;
  muted: boolean;
  theme: ThemeMode;
  sidebar: boolean;
  highlightColor: string;
  pageWidth: "narrow" | "normal" | "wide";
}

export const BLOCK_TAGS = new Set([
  "ADDRESS",
  "ARTICLE",
  "ASIDE",
  "BLOCKQUOTE",
  "DIV",
  "FIGCAPTION",
  "FIGURE",
  "FOOTER",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "HEADER",
  "HR",
  "LI",
  "MAIN",
  "NAV",
  "OL",
  "P",
  "PRE",
  "SECTION",
  "UL",
]);
