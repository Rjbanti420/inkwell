export type KeySound = "key" | "space" | "backspace" | "enter";

/**
 * Tiny Web Audio typewriter. No audio files: every sound is a filtered noise
 * burst or oscillator, generated on demand. All nodes are created at play time
 * (cheap) so fast typing never waits for a decode or file load.
 */
export class TypewriterAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;
  private muted = false;

  setVolume(value: number): void {
    this.volume = Math.max(0, Math.min(1, value));
    this.applyGain();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyGain();
  }

  isMuted(): boolean {
    return this.muted;
  }

  private applyGain(): void {
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.015);
  }

  ensure(): AudioContext | null {
    if (this.muted || this.volume === 0) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
      this.noise = this.makeNoise(this.ctx);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  play(kind: KeySound): void {
    if (!this.ensure()) return;
    switch (kind) {
      case "key":
        // Slightly randomized pitch and level so repeated keys feel physical.
        this.click(2100 + Math.random() * 1000, 0.26, 0.05, 1.5);
        this.tone(150 + Math.random() * 40, 0.025, 0.03, "triangle");
        break;
      case "space":
        // The space bar is the heaviest, dullest key on a typewriter.
        this.click(850 + Math.random() * 120, 0.32, 0.075, 0.9);
        this.tone(80, 0.07, 0.055, "sine", 55);
        break;
      case "backspace":
        // Softer and shorter, as if nudging the carriage.
        this.click(1250 + Math.random() * 200, 0.11, 0.035, 2);
        break;
      case "enter":
        this.click(700, 0.16, 0.06, 1);
        this.carriage();
        window.setTimeout(() => this.bell(), 45);
        break;
    }
  }

  private bell(): void {
    this.tone(1568, 0.09, 0.85, "sine");
    this.tone(2093, 0.045, 0.65, "sine");
    this.tone(3136, 0.02, 0.4, "sine");
  }

  private carriage(): void {
    this.click(520, 0.2, 0.16, 0.7);
    this.tone(95, 0.09, 0.13, "sine", 55);
  }

  private click(frequency: number, gain: number, duration: number, q: number): void {
    const ctx = this.ctx;
    const master = this.master;
    const noise = this.noise;
    if (!ctx || !master || !noise) return;

    const now = ctx.currentTime + 0.001;
    const source = ctx.createBufferSource();
    source.buffer = noise;

    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = q;

    const amp = ctx.createGain();
    const peak = Math.max(0.0002, gain * (0.88 + Math.random() * 0.24));
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(peak, now + 0.0025);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(amp);
    amp.connect(master);
    source.start(now, Math.random() * 0.2, duration + 0.02);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      amp.disconnect();
    };
  }

  private tone(frequency: number, gain: number, duration: number, type: OscillatorType, endFrequency?: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    if (endFrequency) osc.frequency.exponentialRampToValueAtTime(endFrequency, now + duration);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, now);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), now + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(amp);
    amp.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      amp.disconnect();
    };
  }

  private makeNoise(ctx: AudioContext): AudioBuffer {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
