import assert from "node:assert/strict";
import test from "node:test";

const { countWords, countChars, sessionStats, selectionCounts, formatDuration } = await import(
  "../ui/js/words.js"
);

test("word counting handles whitespace and unicode", () => {
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   \n\t "), 0);
  assert.equal(countWords("one"), 1);
  assert.equal(countWords("  one   two\nthree  "), 3);
  assert.equal(countWords("héllo wörld — ok"), 4);
});

test("character counting includes whitespace", () => {
  assert.equal(countChars(""), 0);
  assert.equal(countChars("a b\nc"), 5);
});

test("selection counts only report a real selection", () => {
  assert.equal(selectionCounts(""), null);
  assert.deepEqual(selectionCounts("two words"), { words: 2, chars: 9 });
});

test("word-tracking reports net new words, not the document total", () => {
  const startWords = countWords("one two three");
  const stats = sessionStats(startWords, "one two three four five", 2 * 60_000);
  assert.equal(stats.words, 2, "only the two new words count");
  assert.equal(stats.wpm, 1);
  assert.equal(stats.elapsedMs, 120_000);
});

test("deleting more than was written reports negative words and no inflated wpm", () => {
  const startWords = countWords("one two three four");
  const stats = sessionStats(startWords, "one two", 60_000);
  assert.equal(stats.words, -2);
  assert.equal(stats.wpm, 0);
});

test("zero elapsed time never divides by zero", () => {
  const stats = sessionStats(0, "one two", 0);
  assert.equal(stats.words, 2);
  assert.equal(stats.wpm, 0);
});

test("durations format for short and long sessions", () => {
  assert.equal(formatDuration(0), "0:00");
  assert.equal(formatDuration(65_000), "1:05");
  assert.equal(formatDuration(3_725_000), "1:02:05");
});
