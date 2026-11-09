import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.NodeFilter = dom.window.NodeFilter;

const {
  carrierHasText,
  carrierStyle,
  clampFontSize,
  insertCarrier,
  nextFontSize,
  stripCarrierMarker,
} = await import("../ui/js/format.js");

const base = {
  bold: false,
  italic: false,
  underline: false,
  color: null,
  fontSize: null,
  fontFamily: null,
  background: null,
};

function paragraph(text) {
  const element = document.createElement("p");
  element.textContent = text;
  document.body.append(element);
  return element;
}

function caretAtEnd(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  return range;
}

test("font size clamps to 8-200 and steps grow with size", () => {
  assert.equal(clampFontSize(1), 8);
  assert.equal(clampFontSize(500), 200);
  assert.equal(clampFontSize(Number.NaN), 17);
  assert.equal(nextFontSize(17, 1), 18);
  assert.equal(nextFontSize(24, 1), 26);
  assert.equal(nextFontSize(47, 1), 49);
  assert.equal(nextFontSize(48, 1), 52);
  assert.equal(nextFontSize(200, 1), 200);
  assert.equal(nextFontSize(8, -1), 8);
});

test("carrier style only writes declarations that differ from the context", () => {
  assert.equal(carrierStyle({}, base), "");
  assert.equal(carrierStyle({ fontSize: "48px" }, base), "font-size: 48px");
  assert.equal(carrierStyle({ bold: true }, base), "font-weight: 700");
  assert.equal(carrierStyle({ italic: true }, base), "font-style: italic");
  assert.equal(carrierStyle({ underline: true }, base), "text-decoration: underline");
  assert.equal(
    carrierStyle({ color: null }, { ...base, color: "#112233" }),
    "color: var(--editor-ink)",
  );
  assert.equal(
    carrierStyle({ background: "#fde68a" }, base),
    "background-color: #fde68a",
  );
  assert.equal(
    carrierStyle({ background: null }, { ...base, background: "#fde68a" }),
    "background-color: var(--editor-bg)",
  );
  assert.equal(
    carrierStyle({ fontFamily: "Arial, sans-serif" }, { ...base, fontFamily: "Arial, sans-serif" }),
    "",
  );
});

test("a size carrier survives typing and can be rebuilt after Backspace", () => {
  const element = paragraph("hello");
  const pending = { fontSize: "48px" };
  const range = caretAtEnd(element);
  const carrier = insertCarrier(range, carrierStyle(pending, base));
  assert.ok(carrier, "carrier was inserted");
  assert.equal(carrier.textContent, "\u200b");
  assert.equal(carrier.style.fontSize, "48px");

  // Typing inserts the character after the zero-width marker.
  carrier.firstChild.data += "A";
  stripCarrierMarker(carrier, null);
  assert.equal(carrier.textContent, "A");
  assert.equal(carrier.style.fontSize, "48px");
  assert.equal(carrierHasText(carrier), true);

  // Backspace removes the last character and the browser may remove the span.
  carrier.remove();
  assert.equal(pending.fontSize, "48px", "pending format does not live in the removed DOM");
  const rebuilt = insertCarrier(caretAtEnd(element), carrierStyle(pending, base));
  assert.ok(rebuilt);
  assert.equal(rebuilt.style.fontSize, "48px");
  assert.equal(rebuilt.textContent, "\u200b");
});
