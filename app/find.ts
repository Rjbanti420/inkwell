import { $ } from "./dom.js";

interface Segment {
  node: Text;
  start: number;
  end: number;
  block: Element | null;
}

const MATCH_LIMIT = 5000;
const BLOCK_SELECTOR = "p,div,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,th";

/**
 * Find & replace over the active editor. Matches are painted with the CSS
 * Custom Highlight API, so searching never mutates the document (and cannot
 * pollute exports or undo history).
 */
export class FindController {
  private bar = $<HTMLElement>("#findbar");
  private queryInput = $<HTMLInputElement>("#find-query");
  private replaceInput = $<HTMLInputElement>("#find-replace");
  private count = $<HTMLElement>("#find-count");
  private caseButton = $<HTMLButtonElement>("#find-case");
  private replaceRow = $<HTMLElement>("#replace-row");
  private replaceToggle = $<HTMLButtonElement>("#find-replace-toggle");

  private ranges: Range[] = [];
  private index = -1;
  private caseSensitive = false;
  open = false;

  constructor(
    private readonly getEditor: () => HTMLElement | null,
    private readonly onEdited: () => void,
    private readonly focusEditor?: () => void,
  ) {
    $("#find-next").addEventListener("click", () => this.step(1));
    $("#find-prev").addEventListener("click", () => this.step(-1));
    $("#find-close").addEventListener("click", () => this.close());
    this.caseButton.addEventListener("click", () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
      this.search();
    });

    this.queryInput.addEventListener("input", () => this.search());
    this.queryInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.step(event.shiftKey ? -1 : 1);
      }
    });

    this.replaceInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.replaceCurrent();
      }
    });

    $("#replace-one").addEventListener("click", () => this.replaceCurrent());
    $("#replace-all").addEventListener("click", () => this.replaceAll());

    this.replaceToggle.addEventListener("click", () => {
      this.showReplace(this.replaceRow.hidden);
    });

    this.bar.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.close();
        return;
      }
      if (event.key === "Tab") {
        if (event.target === this.queryInput) {
          event.preventDefault();
          this.showReplace(true);
          this.replaceInput.focus();
        } else if (event.target === this.replaceInput && event.shiftKey) {
          event.preventDefault();
          this.queryInput.focus();
        }
      }
    });
  }

  openBar(showReplace: boolean): void {
    this.bar.hidden = false;
    this.open = true;
    this.showReplace(showReplace);
    this.queryInput.focus();
    this.queryInput.select();
    this.search();
  }

  close(): void {
    this.bar.hidden = true;
    this.open = false;
    this.clearHighlights();
    if (this.focusEditor) this.focusEditor();
    else this.getEditor()?.focus();
  }

  /** Called when the document or the active tab changes. */
  refresh(): void {
    if (!this.open) return;
    this.search();
  }

  private showReplace(show: boolean): void {
    this.replaceRow.hidden = !show;
    this.replaceToggle.setAttribute("aria-pressed", String(show));
    if (show) {
      this.replaceInput.focus();
      this.replaceInput.select();
    } else {
      this.queryInput.focus();
    }
  }

  private search(): void {
    const editor = this.getEditor();
    this.clearHighlights();
    this.ranges = [];
    this.index = -1;

    const query = this.queryInput.value;
    if (!editor || !query) {
      this.updateCount();
      return;
    }

    const { text, segments } = buildIndex(editor);
    const pattern = new RegExp(
      query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      this.caseSensitive ? "gu" : "giu",
    );

    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined) continue;
      const snippet = match[0];
      // A newline here is an artificial paragraph boundary, not real text.
      if (!snippet || snippet.includes("\n")) continue;
      const start = locate(segments, match.index);
      const end = locate(segments, match.index + snippet.length);
      if (!start || !end) continue;
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      this.ranges.push(range);
      if (this.ranges.length >= MATCH_LIMIT) break;
    }

    if (this.ranges.length) {
      this.index = 0;
      this.paint();
    }
    this.updateCount();
  }

  private step(delta: number): void {
    if (!this.ranges.length) {
      this.search();
      if (!this.ranges.length) return;
    }
    this.index = (this.index + delta + this.ranges.length) % this.ranges.length;
    this.paint();
    this.revealCurrent();
    this.updateCount();
  }

  /** Scroll the current match into view without touching focus or selection. */
  private revealCurrent(): void {
    const range = this.ranges[this.index];
    if (!range) return;
    const editor = this.getEditor();
    const scroller = editor?.closest<HTMLElement>(".tab-page");
    if (!editor || !scroller) return;
    const rect = range.getBoundingClientRect();
    const box = scroller.getBoundingClientRect();
    if (!rect.height && !rect.width) return;
    if (rect.top < box.top + 36 || rect.bottom > box.bottom - 36) {
      scroller.scrollTop += rect.top - box.top - box.height / 2 + rect.height / 2;
    }
  }

  private replaceCurrent(): void {
    const range = this.ranges[this.index];
    if (!range) return;
    const previous = this.index;
    const replacement = this.replaceInput.value;
    range.deleteContents();
    range.insertNode(document.createTextNode(replacement));
    this.onEdited();
    this.search();
    if (this.ranges.length) {
      this.index = Math.min(previous, this.ranges.length - 1);
      this.paint();
      this.revealCurrent();
    }
    this.updateCount();
  }

  private replaceAll(): void {
    if (!this.ranges.length) return;
    const replacement = this.replaceInput.value;
    for (let i = this.ranges.length - 1; i >= 0; i -= 1) {
      const range = this.ranges[i];
      range.deleteContents();
      range.insertNode(document.createTextNode(replacement));
    }
    this.onEdited();
    this.search();
    this.updateCount();
  }

  private updateCount(): void {
    if (!this.queryInput.value) {
      this.count.textContent = "0 / 0";
      return;
    }
    if (!this.ranges.length) {
      this.count.textContent = "No matches";
      return;
    }
    this.count.textContent = `${this.index + 1} / ${this.ranges.length}`;
  }

  private paint(): void {
    const highlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!highlightCtor || !registry) return;
    if (!this.ranges.length) {
      this.clearHighlights();
      return;
    }
    registry.set("find-match", new highlightCtor(...this.ranges));
    const current = this.ranges[this.index];
    if (current) registry.set("find-current", new highlightCtor(current));
  }

  private clearHighlights(): void {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    if (!registry) return;
    registry.delete("find-match");
    registry.delete("find-current");
  }
}

function buildIndex(root: HTMLElement): { text: string; segments: Segment[] } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const segments: Segment[] = [];
  let text = "";
  let previousBlock: Element | null = null;

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const textNode = node as Text;
    if (!textNode.data) continue;
    const block = textNode.parentElement?.closest(BLOCK_SELECTOR) ?? null;
    if (previousBlock && block && block !== previousBlock) text += "\n";
    const start = text.length;
    text += textNode.data;
    segments.push({ node: textNode, start, end: text.length, block });
    previousBlock = block;
  }

  return { text, segments };
}

function locate(segments: Segment[], offset: number): { node: Text; offset: number } | null {
  for (const segment of segments) {
    if (offset >= segment.start && offset <= segment.end) {
      return { node: segment.node, offset: offset - segment.start };
    }
  }
  return null;
}
