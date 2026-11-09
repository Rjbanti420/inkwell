/** Count words in plain text. Unicode-aware whitespace splitting. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/u).length : 0;
}

export function countChars(text: string): number {
  return text.length;
}

export interface SessionStats {
  words: number;
  elapsedMs: number;
  wpm: number;
}

/**
 * Net words written since a session started. Negative means the writer
 * deleted more than they added; that is reported as-is so it is honest.
 */
export function sessionStats(
  startWordCount: number,
  currentText: string,
  elapsedMs: number,
): SessionStats {
  const words = countWords(currentText) - startWordCount;
  const minutes = elapsedMs / 60_000;
  const wpm = minutes > 0 && words > 0 ? Math.round(words / minutes) : 0;
  return { words, elapsedMs, wpm };
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? h + ":" : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

/** Counts for the current selection, or null when the selection is empty. */
export function selectionCounts(text: string): { words: number; chars: number } | null {
  if (!text) return null;
  return { words: countWords(text), chars: countChars(text) };
}
