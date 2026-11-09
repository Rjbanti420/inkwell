import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

// The Markdown module needs a DOM before it is imported (DOMPurify binds to it).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.NodeFilter = dom.window.NodeFilter;
globalThis.DOMParser = dom.window.DOMParser;

const { markdownToHtml, htmlToMarkdown, sanitizeHtml } = await import("../ui/js/markdown.js");

function container(html) {
  const element = document.createElement("div");
  element.innerHTML = html;
  return element;
}

function roundTrip(markdown) {
  return htmlToMarkdown(container(markdownToHtml(markdown)));
}

function textOf(html) {
  return container(html).textContent.replace(/\s+/gu, " ").trim();
}

const SAMPLE = [
  "# A title",
  "",
  "Some **bold**, *italic*, ==highlighted== and <u>underlined</u> words.",
  "",
  '## A section with a [link](https://example.com/page)',
  "",
  "- first item",
  "- second item",
  "",
  "> A quoted line.",
  "",
  "```",
  "const answer = 42;",
  "```",
  "",
  "---",
  "",
  '<span style="color:#e11d2e;font-size:18px;font-family:Georgia">styled text</span>',
  "",
].join("\n");

test("Markdown round-trip is stable for the supported constructs", () => {
  const once = roundTrip(SAMPLE);
  const twice = roundTrip(once);

  assert.equal(twice, once, "exporting a re-imported document must be identical");

  for (const expected of [
    "# A title",
    "**bold**",
    "*italic*",
    "==highlighted==",
    "<u>underlined</u>",
    "## A section",
    "[link](https://example.com/page)",
    "- first item",
    "> A quoted line.",
    "const answer = 42;",
    "---",
    '<span style="color:#e11d2e;font-size:18px;font-family:Georgia">styled text</span>',
  ]) {
    assert.ok(once.includes(expected), `missing from export: ${expected}`);
  }
});

test("import then export preserves all text", () => {
  const imported = markdownToHtml(SAMPLE);
  const exported = htmlToMarkdown(container(imported));
  const reimported = markdownToHtml(exported);

  assert.equal(textOf(reimported), textOf(imported));
});

test("inline styles survive import and export", () => {
  const markdown =
    '<span style="color:#112233;font-size:22px;font-family:Georgia">Georgia text</span>\n\n' +
    '<span style="font-family:\'Times New Roman\', Times, serif">Times text</span>\n';
  const html = markdownToHtml(markdown);

  assert.match(html, /color:#112233/i);
  assert.match(html, /font-size:22px/i);
  assert.match(html, /font-family:Georgia/i);
  assert.match(html, /Georgia text/);
  assert.match(html, /Times text/);

  const exported = htmlToMarkdown(container(html));
  assert.match(exported, /<span style="color:#112233;font-size:22px;font-family:Georgia">/);
  assert.match(exported, /font-family:Times New Roman, Times, serif/);
  assert.equal(roundTrip(exported), exported);
});

test("styles applied to inline tags survive export", () => {
  const html = '<p><u style="background-color: rgb(253, 230, 138)">both</u></p>';
  const exported = htmlToMarkdown(container(html));
  assert.match(exported, /==<u>both<\/u>==/);
  assert.equal(roundTrip(exported), exported);
});

test("legacy shorthand colors are normalized instead of dropped", () => {
  const markdown = '<span style="color:#e11">short</span>\n';
  const exported = roundTrip(markdown);
  assert.match(exported, /color:#ee1111/);
  assert.match(exported, /short/);
});

test("imported and pasted HTML cannot execute scripts", () => {
  const dirty =
    '<p>Safe <strong>bold</strong></p>' +
    "<script>window.pwned = 1</script>" +
    '<img src="x" onerror="window.pwned = 2">' +
    '<a href="javascript:alert(1)">bad link</a>' +
    '<p style="background-image:url(javascript:alert(3))">text</p>';

  const cleaned = sanitizeHtml(dirty);
  assert.ok(!/script/i.test(cleaned), cleaned);
  assert.ok(!/onerror/i.test(cleaned), cleaned);
  assert.ok(!/javascript:/i.test(cleaned), cleaned);
  assert.match(cleaned, /Safe/);
  assert.match(cleaned, /<strong>bold<\/strong>/);

  const fromMarkdown = markdownToHtml("Hello <script>alert(1)</script> world");
  assert.ok(!/script/i.test(fromMarkdown), fromMarkdown);
  assert.match(fromMarkdown, /Hello/);
});

test("remote images are dropped, local data images survive", () => {
  const remote = sanitizeHtml('<p>before <img src="https://example.com/x.png" alt="alt text"> after</p>');
  assert.ok(!remote.includes("<img"), remote);
  assert.match(remote, /alt text/);

  const data = sanitizeHtml('<img src="data:image/png;base64,AAAA" alt="dot">');
  assert.match(data, /data:image\/png/);
});

test("empty Markdown exports empty and blank lines are preserved", () => {
  assert.equal(roundTrip(""), "");
  assert.equal(roundTrip("\n\n  \n"), "\n\n\n");
});

test("saved files reopen with identical spacing and structure", () => {
  for (const name of ["spacing.md", "nested.md", "lists.md"]) {
    const source = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
    const exported = roundTrip(source);
    assert.equal(exported, source, `${name} changed during a save/reopen round-trip`);
    assert.equal(roundTrip(exported), exported, `${name} is not stable on a second round-trip`);
  }
});

test("lists keep blank lines and two-space nested indentation", () => {
  const source = readFileSync(new URL("./fixtures/lists.md", import.meta.url), "utf8");
  const html = markdownToHtml(source);
  assert.match(html, /<ul>[\s\S]*<li>first item[\s\S]*<ul>/);
  assert.match(html, /<ol>[\s\S]*<li>first numbered/);
  const exported = htmlToMarkdown(container(html));
  assert.equal(exported, source);
  assert.match(exported, /\n  - nested item\n/);
  assert.match(exported, /\n  - mixed bullet\n/);
  assert.match(exported, /\n    1\. grandchild numbered\n/);
  assert.match(exported, /^Intro paragraph\.\n\n- first item/m);
  assert.match(exported, /3\. third numbered\n\n- parent/m);
});

test("inline font weight from a caret carrier exports as bold", () => {
  const html = '<p>plain <span style="font-weight:700">bold</span> end</p>';
  assert.equal(roundTrip(html), "plain **bold** end\n");
  const combined = '<p><span style="font-weight:700;font-style:italic;text-decoration:underline">all</span></p>';
  const exported = roundTrip(combined);
  assert.match(exported, /\*\*\*all\*\*\*/);
  assert.match(exported, /<u>.*all.*<\/u>/);
  assert.equal(roundTrip(exported), exported);
});

test("a color reset after a colored run leaves the following text plain", () => {
  const html =
    '<p>alpha<span style="color:#dc2626">X</span><span class="caret-style">Y</span> beta</p>';
  const markdown = htmlToMarkdown(container(html));
  assert.match(markdown, /<span style="color:#dc2626">X<\/span>Y/u);
  assert.equal(roundTrip(markdown), markdown);
});

test("single line breaks inside a paragraph become hard breaks", () => {
  assert.equal(roundTrip("line one\nline two\n"), "line one  \nline two\n");
});

