// Markdown <-> rich text conversion.
//
// Import: marked parses Markdown to HTML, DOMPurify strips anything that could
// execute, then a normalization pass keeps only the inline styles this editor
// understands. Export: a small DOM walker writes CommonMark plus the few GFM
// features used by the editor (highlight, underline, inline styles).
/* @ts-ignore -- vendored ESM file, declared in vendor.d.ts */
import { marked } from "../vendor/marked.esm.js";
/* @ts-ignore -- vendored ESM file, declared in vendor.d.ts */
import DOMPurify from "../vendor/purify.es.mjs";
import { BLOCK_TAGS } from "./types.js";

const highlightExtension = {
  name: "highlight",
  level: "inline" as const,
  start(src: string) {
    return src.indexOf("==");
  },
  tokenizer(this: any, src: string) {
    const match = /^==([^=\n]+)==/.exec(src);
    if (!match) return undefined;
    return {
      type: "highlight",
      raw: match[0],
      tokens: this.lexer.inlineTokens(match[1]),
    };
  },
  renderer(this: any, token: any) {
    return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
  },
};

// breaks: true keeps single line breaks visible; blank lines are restored
// explicitly below instead of being collapsed between blocks.
marked.use({ gfm: true, breaks: true, extensions: [highlightExtension] });

const ALLOWED_TAGS = [
  "p", "div", "br",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "strong", "b", "em", "i", "u", "s", "del", "mark", "span",
  "a", "ul", "ol", "li", "blockquote", "pre", "code", "hr", "img",
];
const ALLOWED_ATTR = ["style", "href", "src", "alt", "title"];

/** Sanitize arbitrary HTML (imported file or clipboard) for the editor. */
export function sanitizeHtml(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  normalizeContent(template.content);
  return template.innerHTML;
}

/**
 * The editor writes two spaces per nested list level, which CommonMark accepts
 * under bullet items but not under `1. ` items (their content starts at column
 * three). Widen only the indentation needed for parsing; export stays at two.
 */
function normalizeListNesting(markdown: string): string {
  const lines = markdown.split("\n");
  const stack: Array<{ indent: number; content: number }> = [];
  let fence: string | null = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence) continue;

    const match = /^(\s*)([-+*]|\d+[.)])(\s+)(.*)$/.exec(line);
    if (!match) {
      if (/^\s*$/.test(line)) continue;
      if (!/^\s/.test(line)) stack.length = 0;
      continue;
    }

    const indent = match[1].length;
    const marker = match[2];
    const gap = match[3].length;
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1];
    let adjusted = indent;
    if (parent && indent > parent.indent && indent < parent.content) {
      adjusted = parent.content;
      lines[index] = " ".repeat(adjusted - indent) + line;
    }

    const content = adjusted + marker.length + gap;
    if (parent && adjusted === parent.indent) parent.content = Math.max(parent.content, content);
    else stack.push({ indent: adjusted, content });
  }
  return lines.join("\n");
}

/**
 * Parse Markdown into sanitized, editor-ready HTML. Marked's space tokens (and
 * the extra newlines it leaves on some block tokens) are turned into explicit
 * empty paragraphs, so consecutive blank lines survive a save/reopen.
 */
export function markdownToHtml(markdown: string): string {
  const tokens = marked.lexer(normalizeListNesting(markdown)) as any[];
  const futureContent = new Array<boolean>(tokens.length);
  let seenFuture = false;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    futureContent[i] = seenFuture;
    if (tokens[i].type !== "space") seenFuture = true;
  }

  const parts: string[] = [];
  let hasContent = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.type === "space") {
      const newlines = (String(token.raw).match(/\n/g) ?? []).length;
      const blanks = hasContent
        ? Math.max(0, newlines - (futureContent[i] ? 2 : 1))
        : newlines;
      for (let n = 0; n < blanks; n += 1) parts.push("<p><br></p>");
      continue;
    }

    parts.push(marked.parser([token]) as string);

    // Headings include the blank line that follows them in their raw source.
    const trailing = /\n+$/.exec(String(token.raw));
    if (trailing) {
      const blanks = Math.max(0, trailing[0].length - 1);
      const extra = futureContent[i] ? Math.max(0, blanks - 1) : blanks;
      for (let n = 0; n < extra; n += 1) parts.push("<p><br></p>");
    }
    hasContent = true;
  }

  return sanitizeHtml(parts.join(""));
}

/**
 * Importing a file and exporting it unchanged must not corrupt it, so unknown
 * wrappers are unwrapped instead of dropped and non-local images become their
 * alt text. Remote images would break the app's offline promise.
 */
function normalizeContent(root: ParentNode): void {
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (INLINE_STYLE_TAGS.has(element.tagName)) {
      cleanStyle(element as HTMLElement);
      if (element.tagName === "SPAN" && !element.getAttribute("style")) unwrap(element);
    } else if (element.tagName === "IMG") {
      const image = element as HTMLImageElement;
      const src = image.getAttribute("src") ?? "";
      if (!/^data:image\//i.test(src)) {
        element.replaceWith(document.createTextNode(image.getAttribute("alt") ?? ""));
      }
    } else if (element.tagName === "A") {
      element.removeAttribute("target");
      if (!element.getAttribute("href")) unwrap(element);
    } else {
      // A style on a block (e.g. pasted from Word) has no Markdown mapping;
      // keep the content, drop the unsupported presentation.
      element.removeAttribute("style");
    }
  }
  stripLayoutWhitespace(root);
}

function unwrap(element: Element): void {
  element.replaceWith(...Array.from(element.childNodes));
}

/**
 * The editor uses white-space: pre-wrap so leading spaces survive. Marked's
 * pretty newlines between block tags would otherwise show as blank lines, and
 * caret-style markers are invisible implementation details, so both are
 * removed here.
 */
function stripLayoutWhitespace(root: ParentNode): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const remove: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.data.includes("\u200b")) node.data = node.data.replace(/\u200b/g, "");
    if (!node.data) {
      remove.push(node);
      continue;
    }
    if (!/^\s+$/.test(node.data) || !node.data.includes("\n")) continue;
    const parent = node.parentElement;
    if (parent?.closest("pre, code")) continue;
    const blockContainer =
      !parent ||
      parent === root ||
      ["BODY", "DIV", "BLOCKQUOTE", "LI", "UL", "OL", "SECTION", "ARTICLE"].includes(parent.tagName);
    if (blockContainer) remove.push(node);
  }
  for (const node of remove) node.remove();
}

// Styles may land on any inline element, not just <span> (execCommand often
// applies a highlight to the surrounding <u> or <b>). Keep them all.
const INLINE_STYLE_TAGS = new Set([
  "SPAN", "B", "STRONG", "I", "EM", "U", "S", "DEL", "STRIKE", "MARK", "CODE",
]);

const STYLE_PROPS = [
  "color",
  "font-size",
  "font-family",
  "background-color",
  "font-weight",
  "font-style",
  "text-decoration",
];

function cleanStyle(element: HTMLElement): void {
  const kept: string[] = [];
  for (const prop of STYLE_PROPS) {
    const value = element.style.getPropertyValue(prop).trim();
    if (!value) continue;
    if (prop === "color" || prop === "background-color") {
      const color = normalizeColor(value);
      if (color) kept.push(`${prop}:${color}`);
    } else if (prop === "font-size") {
      if (/^\d+(?:\.\d+)?(?:px|pt|em|rem|%)$/.test(value)) kept.push(`font-size:${value}`);
    } else if (prop === "font-weight") {
      if (/^(normal|bold|[1-9]00)$/.test(value)) kept.push(`font-weight:${value}`);
    } else if (prop === "font-style") {
      if (/^(normal|italic|oblique)$/.test(value)) kept.push(`font-style:${value}`);
    } else if (prop === "text-decoration") {
      if (/^(none|underline|line-through|underline line-through)$/.test(value)) {
        kept.push(`text-decoration:${value}`);
      }
    } else {
      const family = value.replace(/["']/g, "").trim();
      if (family && !/[<>{};]/.test(family)) kept.push(`font-family:${family}`);
    }
  }
  if (kept.length) element.setAttribute("style", kept.join(";"));
  else element.removeAttribute("style");
}

function normalizeColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (["transparent", "inherit", "initial", "unset", "currentcolor"].includes(v)) return null;
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/.exec(v);
  if (rgb) {
    if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
    return "#" + [rgb[1], rgb[2], rgb[3]]
      .map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0"))
      .join("");
  }
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) {
    return "#" + v.slice(1).split("").map((c) => c + c).join("");
  }
  if (/^[a-z]{3,20}$/.test(v)) return v;
  return null;
}

// ---------------------------------------------------------------- export ---

type BlockEntry = string | null; // null is one explicit blank line

/** Serialize an editor DOM node to Markdown (with inline HTML for styles). */
export function htmlToMarkdown(root: Node): string {
  const entries = nodeToBlocks(root);
  if (!entries.length) return "";
  if (entries.every((entry) => entry === null)) {
    return "\n".repeat(Math.max(1, entries.length));
  }
  return serializeEntries(entries) + "\n";
}

/** Join blocks: two newlines separate blocks; each null adds one blank line. */
function serializeEntries(entries: BlockEntry[]): string {
  let out = "";
  let wrote = false;
  for (const entry of entries) {
    if (entry === null) {
      out += "\n";
      continue;
    }
    if (wrote) out += "\n\n";
    out += entry;
    wrote = true;
  }
  return out;
}

function nodeToBlocks(node: Node): BlockEntry[] {
  const blocks: BlockEntry[] = [];
  let inlineNodes: ChildNode[] = [];

  const flush = () => {
    if (!inlineNodes.length) return;
    const text = inlineToMarkdown(inlineNodes).replace(/\u200b/g, "");
    if (text.trim()) blocks.push(protectLineStart(text.replace(/[ \t]+$/g, "")));
    else if (text.length) blocks.push(null);
    inlineNodes = [];
  };

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((child as Element).tagName)) {
      flush();
      if (isBlankBlock(child as HTMLElement)) {
        blocks.push(null);
        continue;
      }
      const block = blockToMarkdown(child as HTMLElement);
      if (block) blocks.push(block);
    } else if (child.nodeType === Node.TEXT_NODE) {
      if ((child as Text).data.trim() || inlineNodes.length) inlineNodes.push(child);
    } else {
      inlineNodes.push(child);
    }
  }
  flush();
  return blocks;
}

function isBlankBlock(el: HTMLElement): boolean {
  if (!["P", "DIV"].includes(el.tagName)) return false;
  if (el.querySelector("img, hr, li, ol, ul, pre, blockquote")) return false;
  return (el.textContent ?? "").replace(/[\s\u200b\u00a0]/g, "") === "";
}

function blockToMarkdown(el: HTMLElement): string | null {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    const text = inlineToMarkdown(el.childNodes).replace(/\u200b/g, "").trim();
    return text ? `${"#".repeat(level)} ${protectLineStart(text)}` : null;
  }
  switch (tag) {
    case "P":
    case "DIV": {
      if (hasBlockChildren(el)) {
        const inner = serializeEntries(nodeToBlocks(el));
        return inner || null;
      }
      const text = inlineToMarkdown(el.childNodes).replace(/\u200b/g, "").replace(/[ \t]+$/g, "");
      return text.trim() ? protectLineStart(text) : null;
    }
    case "UL":
    case "OL":
      return listToMarkdown(el);
    case "BLOCKQUOTE": {
      const inner = serializeEntries(nodeToBlocks(el));
      if (!inner.trim()) return null;
      return inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
    }
    case "PRE": {
      const code = (el.textContent ?? "").replace(/\u200b/g, "").replace(/\n$/, "");
      if (!code) return null;
      const longest = Math.max(0, ...(code.match(/`+/g) ?? []).map((run) => run.length));
      const fence = "`".repeat(Math.max(3, longest + 1));
      return fence + "\n" + code + "\n" + fence;
    }
    case "HR":
      return "---";
    default: {
      const text = inlineToMarkdown(el.childNodes).replace(/\u200b/g, "").replace(/[ \t]+$/g, "");
      return text.trim() ? protectLineStart(text) : null;
    }
  }
}

function hasBlockChildren(el: HTMLElement): boolean {
  return Array.from(el.children).some((child) => BLOCK_TAGS.has(child.tagName));
}

function listToMarkdown(list: HTMLElement): string {
  const ordered = list.tagName === "OL";
  const items = Array.from(list.children).filter((child) => child.tagName === "LI");
  const lines: string[] = [];
  const loose = items.some((item) =>
    Array.from(item.children).some((child) => child.tagName === "P" && (child.textContent ?? "").trim()),
  );

  items.forEach((item, index) => {
    const inlineParts: ChildNode[] = [];
    const nested: HTMLElement[] = [];
    for (const child of Array.from(item.childNodes)) {
      if (
        child.nodeType === Node.ELEMENT_NODE &&
        ["UL", "OL", "BLOCKQUOTE", "PRE"].includes((child as HTMLElement).tagName)
      ) {
        nested.push(child as HTMLElement);
      } else {
        inlineParts.push(child);
      }
    }

    const marker = ordered ? `${index + 1}. ` : "- ";
    const raw = inlineToMarkdown(inlineParts)
      .replace(/\u200b/g, "")
      .replace(/\s*\n\s*/g, " ")
      .trim();
    lines.push(marker + protectLineStart(raw));

    for (const child of nested) {
      const sub =
        child.tagName === "UL" || child.tagName === "OL"
          ? listToMarkdown(child)
          : blockToMarkdown(child) ?? "";
      if (sub) lines.push(...sub.split("\n").map((line) => "  " + line));
    }
    if (loose && index < items.length - 1) lines.push("");
  });

  return lines.join("\n");
}

function inlineToMarkdown(nodes: NodeListOf<ChildNode> | ChildNode[]): string {
  let out = "";
  for (const child of Array.from(nodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const data = (child as Text).data
        .replace(/\r\n?/g, "\n")
        .replace(/\u200b/g, "")
        .replace(/\n/g, "  \n");
      out += escapeMarkdown(data);
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as HTMLElement;
    const tag = el.tagName;
    const inner = () => inlineToMarkdown(el.childNodes);

    if (BLOCK_TAGS.has(tag) && tag !== "DIV" && tag !== "P") {
      // Blocks inside an inline context (rare, e.g. a list item's paragraph).
      out += tag === "BR" ? "\n" : inner();
      continue;
    }

    switch (tag) {
      case "BR":
        out += "  \n";
        break;
      case "STRONG":
      case "B":
        out += decorate(el, wrapInline("**", "**", inner()));
        break;
      case "EM":
      case "I":
        out += decorate(el, wrapInline("*", "*", inner()));
        break;
      case "U":
        out += decorate(el, wrapInline("<u>", "</u>", inner()));
        break;
      case "S":
      case "DEL":
      case "STRIKE":
        out += decorate(el, wrapInline("~~", "~~", inner()));
        break;
      case "MARK":
        out += decorate(el, wrapInline("==", "==", inner()));
        break;
      case "CODE":
        out += decorate(el, inlineCode((el.textContent ?? "").replace(/\n/g, " ")));
        break;
      case "A": {
        const href = (el.getAttribute("href") ?? "").replace(/\)/g, "%29").replace(/ /g, "%20");
        const label = inner().trim();
        out += decorate(el, label ? `[${label}](${href})` : href);
        break;
      }
      case "IMG": {
        const alt = escapeMarkdown(el.getAttribute("alt") ?? "");
        const src = el.getAttribute("src") ?? "";
        out += src ? `![${alt}](${src})` : alt;
        break;
      }
      case "SPAN":
        out += decorate(el, inner());
        break;
      default:
        out += inner();
    }
  }
  return out;
}


/** Attach inline styles from any element to the Markdown it produced. */
function decorate(el: HTMLElement, content: string): string {
  let result = content;
  const selfBold = el.tagName === "B" || el.tagName === "STRONG";
  const selfItalic = el.tagName === "I" || el.tagName === "EM";
  const selfUnderline = el.tagName === "U";
  const parentBold = Boolean(el.parentElement?.closest("b,strong"));
  const parentItalic = Boolean(el.parentElement?.closest("i,em"));
  const parentUnderline = Boolean(el.parentElement?.closest("u"));

  const weight = el.style.getPropertyValue("font-weight").trim();
  const weightNumber = Number.parseInt(weight, 10);
  if (weight) {
    if (weight === "bold" || (Number.isFinite(weightNumber) && weightNumber >= 600)) {
      if (!selfBold && !parentBold) result = wrapInline("**", "**", result);
    } else if ((weight === "normal" || weightNumber === 400) && (selfBold || parentBold)) {
      result = `<span style="font-weight:${weight}">${result}</span>`;
    }
  }

  const style = el.style.getPropertyValue("font-style").trim();
  if (style === "italic" || style === "oblique") {
    if (!selfItalic && !parentItalic) result = wrapInline("*", "*", result);
  } else if (style === "normal" && (selfItalic || parentItalic)) {
    result = `<span style="font-style:${style}">${result}</span>`;
  }

  const decoration = (
    el.style.getPropertyValue("text-decoration-line") ||
    el.style.getPropertyValue("text-decoration")
  ).trim();
  if (decoration.includes("underline")) {
    if (!selfUnderline && !parentUnderline) result = wrapInline("<u>", "</u>", result);
  } else if (decoration === "none" && (selfUnderline || parentUnderline)) {
    result = `<span style="text-decoration:none">${result}</span>`;
  }

  const background = normalizeColor(el.style.backgroundColor);
  if (background) result = wrapInline("==", "==", result);
  const kept: string[] = [];
  const color = normalizeColor(el.style.color);
  if (color) kept.push(`color:${color}`);
  if (el.style.fontSize) kept.push(`font-size:${el.style.fontSize}`);
  if (el.style.fontFamily) {
    kept.push(`font-family:${el.style.fontFamily.replace(/["']/g, "").trim()}`);
  }
  if (kept.length) {
    result = `<span style="${escapeAttribute(kept.join(";"))}">${result}</span>`;
  }
  return result;
}

function wrapInline(open: string, close: string, inner: string): string {
  const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner);
  if (!match) return inner;
  const [, lead, core, trail] = match;
  if (!core) return inner;
  return `${lead}${open}${core}${close}${trail}`;
}

function inlineCode(text: string): string {
  if (!text) return "";
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return fence + pad + text + pad + fence;
}

/** Escape characters that would otherwise start Markdown syntax or HTML. */
function escapeMarkdown(text: string): string {
  return text
    .replace(/([\\*_\[\]<>`|&])/g, "\\$1")
    .replace(/==/g, "\\=\\=")
    .replace(/~~/g, "\\~\\~");
}

/** A paragraph that starts with a marker must not become a heading/list. */
function protectLineStart(text: string): string {
  return text.replace(
    /^(\s*)(#{1,6}\s+|>|[-+*]\s+|\d+[.)]\s+)/gm,
    (_match, space: string, marker: string) => `${space}\\${marker[0]}${marker.slice(1)}`,
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
