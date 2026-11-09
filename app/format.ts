import type { PendingFormat } from "./types.js";

export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 200;

/** Inline formatting currently visible at the caret, ignoring the editor default. */
export interface InlineContext {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: string | null;
  fontSize: string | null;
  fontFamily: string | null;
  background: string | null;
}

export function clampFontSize(value: number): number {
  if (!Number.isFinite(value)) return 17;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(value)));
}

/** Small steps near the readable range, larger ones once the size is big. */
export function fontSizeStep(size: number): number {
  if (size < 24) return 1;
  if (size < 48) return 2;
  return 4;
}

export function nextFontSize(size: number, direction: 1 | -1): number {
  const safe = clampFontSize(size);
  return clampFontSize(safe + fontSizeStep(safe) * direction);
}

function normalizeFamily(value: string | null): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The carrier span only needs declarations that differ from the surrounding
 * text. Everything else inherits, which keeps exported Markdown clean.
 */
export function carrierStyle(pending: PendingFormat, base: InlineContext): string {
  const declarations: string[] = [];
  if (pending.bold !== undefined && pending.bold !== base.bold) {
    declarations.push(`font-weight: ${pending.bold ? 700 : 400}`);
  }
  if (pending.italic !== undefined && pending.italic !== base.italic) {
    declarations.push(`font-style: ${pending.italic ? "italic" : "normal"}`);
  }
  if (pending.underline !== undefined && pending.underline !== base.underline) {
    declarations.push(`text-decoration: ${pending.underline ? "underline" : "none"}`);
  }
  if (pending.color !== undefined && pending.color !== base.color) {
    declarations.push(`color: ${pending.color ?? "var(--editor-ink)"}`);
  }
  if (pending.fontSize !== undefined && pending.fontSize !== base.fontSize) {
    declarations.push(`font-size: ${pending.fontSize ?? "inherit"}`);
  }
  if (
    pending.fontFamily !== undefined &&
    normalizeFamily(pending.fontFamily) !== normalizeFamily(base.fontFamily)
  ) {
    declarations.push(`font-family: ${pending.fontFamily ?? "inherit"}`);
  }
  if (pending.background !== undefined && pending.background !== base.background) {
    declarations.push(`background-color: ${pending.background ?? "var(--editor-bg)"}`);
  }
  return declarations.join("; ");
}

export function hasPendingFormat(pending: PendingFormat): boolean {
  return Object.keys(pending).length > 0;
}

/**
 * Insert the zero-width carrier that gives the next typed character its
 * formatting. Returns null when the surrounding text already matches, in
 * which case typing inherits the right format on its own.
 */
export function insertCarrier(range: Range, style: string): HTMLElement | null {
  if (!style || !range.collapsed) return null;
  const doc = range.startContainer.ownerDocument ?? document;
  const span = doc.createElement("span");
  span.className = "caret-style";
  span.setAttribute("style", style);
  span.append(doc.createTextNode("\u200b"));
  range.insertNode(span);
  return span;
}

export function carrierHasText(span: HTMLElement): boolean {
  return (span.textContent ?? "").replace(/\u200b/g, "").length > 0;
}

/**
 * Drop the invisible marker after real text has been typed into the carrier.
 * Only the carrier is touched; the rest of the document is never rewritten.
 */
export function stripCarrierMarker(span: HTMLElement, selection: Selection | null): void {
  const anchor = selection?.anchorNode ?? null;
  const focus = selection?.focusNode ?? null;
  let anchorOffset = selection?.anchorOffset ?? 0;
  let focusOffset = selection?.focusOffset ?? 0;

  const walker = span.ownerDocument.createTreeWalker(span, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data.includes("\u200b")) continue;
    const markerCount = (length: number) =>
      (node.data.slice(0, length).match(/\u200b/g) ?? []).length;
    if (node === anchor) anchorOffset = Math.max(0, anchorOffset - markerCount(anchorOffset));
    if (node === focus) focusOffset = Math.max(0, focusOffset - markerCount(focusOffset));
    node.data = node.data.replace(/\u200b/g, "");
  }

  if (selection && anchor && focus && anchor.isConnected && focus.isConnected) {
    try {
      selection.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset);
    } catch {
      /* the browser may have replaced the selection while committing input */
    }
  }
}
