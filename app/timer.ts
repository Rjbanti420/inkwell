import { $ } from "./dom.js";
import { formatDuration, sessionStats } from "./words.js";

export type TimerMode = "countdown" | "stopwatch";

export interface TimerSummary {
  mode: TimerMode;
  elapsedMs: number;
  words: number;
  wpm: number;
  wordTracking: boolean;
}

export interface SessionHandle {
  startWords: number;
  getText: () => string;
}

export interface TimerCallbacks {
  beginSession: () => SessionHandle;
  onSummary: (summary: TimerSummary) => void;
}

/** Countdown/stopwatch with optional net-words-written tracking. */
export class TimerController {
  private toggleButton = $<HTMLButtonElement>("#timer-toggle");
  private chip = $<HTMLElement>("#timer-chip");
  private panel = $<HTMLElement>("#timer-panel");
  private modeSelect = $<HTMLSelectElement>("#timer-mode");
  private minutesInput = $<HTMLInputElement>("#timer-minutes");
  private minutesLabel = $<HTMLElement>("#minutes-label");
  private wordsCheckbox = $<HTMLInputElement>("#timer-words");
  private display = $<HTMLElement>("#timer-display");
  private startButton = $<HTMLButtonElement>("#timer-start");
  private finishButton = $<HTMLButtonElement>("#timer-finish");
  private resetButton = $<HTMLButtonElement>("#timer-reset");
  private stats = $<HTMLElement>("#timer-stats");
  private statWords = $<HTMLElement>("#stat-words");
  private statElapsed = $<HTMLElement>("#stat-elapsed");
  private statWpm = $<HTMLElement>("#stat-wpm");

  private mode: TimerMode = "countdown";
  private minutes = 15;
  private wordTracking = false;

  private running = false;
  private started = false;
  private hasSession = false;
  private runningSince: number | null = null;
  private elapsedMs = 0;
  private remainingMs = 0;
  private endAt = 0;
  private interval: number | undefined;

  private startWords = 0;
  private getSessionText: (() => string) | null = null;
  private sessionWordTracking = false;

  constructor(private readonly callbacks: TimerCallbacks) {
    this.toggleButton.addEventListener("click", () => this.togglePanel());
    $("#timer-close").addEventListener("click", () => this.togglePanel(false));

    this.modeSelect.addEventListener("change", () => {
      this.mode = this.modeSelect.value === "stopwatch" ? "stopwatch" : "countdown";
      this.minutesLabel.classList.toggle("disabled", this.mode === "stopwatch");
      this.reset();
    });

    this.minutesInput.addEventListener("change", () => {
      const parsed = Number.parseInt(this.minutesInput.value, 10);
      this.minutes = Number.isFinite(parsed) ? Math.min(600, Math.max(1, parsed)) : 15;
      this.minutesInput.value = String(this.minutes);
      if (!this.hasSession) this.resetDisplay();
      this.update();
    });

    this.wordsCheckbox.addEventListener("change", () => {
      this.wordTracking = this.wordsCheckbox.checked;
      this.update();
    });

    this.startButton.addEventListener("click", () => {
      if (this.running) this.pause();
      else this.start();
    });
    this.finishButton.addEventListener("click", () => this.finish());
    this.resetButton.addEventListener("click", () => this.reset());

    this.reset();
  }

  isOpen(): boolean {
    return !this.panel.hidden;
  }

  togglePanel(force?: boolean): void {
    const show = force ?? this.panel.hidden;
    this.panel.hidden = !show;
    this.toggleButton.setAttribute("aria-expanded", String(show));
    if (show) this.minutesInput.focus();
  }

  private start(): void {
    if (!this.started) {
      const session = this.callbacks.beginSession();
      this.startWords = session.startWords;
      this.getSessionText = session.getText;
      this.sessionWordTracking = this.wordTracking;
      this.started = true;
      this.hasSession = true;
      this.elapsedMs = 0;
      this.remainingMs = this.minutes * 60_000;
    }

    const now = Date.now();
    this.runningSince = now;
    this.running = true;
    if (this.mode === "countdown") {
      if (this.remainingMs <= 0) this.remainingMs = this.minutes * 60_000;
      this.endAt = now + this.remainingMs;
    }
    this.setConfigEnabled(false);
    window.clearInterval(this.interval);
    this.interval = window.setInterval(() => this.tick(), 200);
    this.update();
  }

  private pause(): void {
    if (!this.running) return;
    const now = Date.now();
    if (this.runningSince !== null) this.elapsedMs += now - this.runningSince;
    this.runningSince = null;
    this.running = false;
    if (this.mode === "countdown") this.remainingMs = Math.max(0, this.endAt - now);
    window.clearInterval(this.interval);
    this.update();
  }

  private tick(): void {
    if (!this.running) return;
    if (this.mode === "countdown" && Date.now() >= this.endAt) {
      this.finish(true);
      return;
    }
    this.update();
  }

  private finish(auto = false): void {
    if (!this.started && !this.running) return;
    const now = Date.now();
    if (this.running && this.runningSince !== null) this.elapsedMs += now - this.runningSince;
    this.runningSince = null;
    this.running = false;
    window.clearInterval(this.interval);

    if (this.mode === "countdown") this.remainingMs = Math.max(0, this.endAt - now);
    this.started = false;
    this.setConfigEnabled(true);
    this.update();

    if (this.getSessionText) {
      const stats = sessionStats(this.startWords, this.getSessionText(), this.elapsedMs);
      this.callbacks.onSummary({
        mode: this.mode,
        elapsedMs: this.elapsedMs,
        words: stats.words,
        wpm: stats.wpm,
        wordTracking: this.sessionWordTracking,
      });
    }
    if (auto) this.remainingMs = 0;
    this.update();
  }

  private reset(): void {
    this.running = false;
    this.started = false;
    this.hasSession = false;
    this.runningSince = null;
    this.elapsedMs = 0;
    this.getSessionText = null;
    window.clearInterval(this.interval);
    this.setConfigEnabled(true);
    this.resetDisplay();
    this.update();
  }

  private resetDisplay(): void {
    this.remainingMs = this.minutes * 60_000;
    this.display.textContent = this.mode === "countdown"
      ? formatDuration(this.remainingMs)
      : formatDuration(0);
    this.chip.textContent = this.mode === "countdown"
      ? formatDuration(this.remainingMs)
      : "0:00";
  }

  private currentElapsed(): number {
    return this.elapsedMs + (this.running && this.runningSince !== null ? Date.now() - this.runningSince : 0);
  }

  private currentRemaining(): number {
    if (this.running) return Math.max(0, this.endAt - Date.now());
    return this.remainingMs;
  }

  private setConfigEnabled(enabled: boolean): void {
    this.modeSelect.disabled = !enabled;
    this.minutesInput.disabled = !enabled;
    this.wordsCheckbox.disabled = !enabled;
  }

  private update(): void {
    const elapsed = this.currentElapsed();
    const timeText = this.mode === "countdown" ? formatDuration(this.currentRemaining()) : formatDuration(elapsed);
    this.display.textContent = timeText;
    this.chip.textContent = timeText;
    this.startButton.textContent = this.running ? "Pause" : this.started ? "Resume" : "Start";
    this.finishButton.disabled = !this.started && !this.running;
    this.minutesLabel.classList.toggle("disabled", this.mode === "stopwatch");

    const showStats = this.hasSession && this.sessionWordTracking && this.getSessionText;
    this.stats.hidden = !showStats;
    if (showStats && this.getSessionText) {
      const stats = sessionStats(this.startWords, this.getSessionText(), elapsed);
      this.statWords.textContent = String(stats.words);
      this.statElapsed.textContent = formatDuration(elapsed);
      this.statWpm.textContent = String(stats.wpm);
      this.stats.classList.toggle("negative", stats.words < 0);
    }
  }
}
