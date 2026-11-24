/**
 * All audio is synthesised with WebAudio; there are no assets. Sound is off by
 * default and the choice is remembered. The context suspends when the tab hides.
 */
const KEY = 'foldline:sound';

let ctx: AudioContext | null = null;
let enabled = false;
try {
  enabled = localStorage.getItem(KEY) === 'on';
} catch {
  enabled = false;
}

function ensure(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freq: number, delay: number, dur: number, type: OscillatorType, peak: number): void {
  const audio = ensure();
  if (!audio) return;
  const t0 = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(audio.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sound = {
  get enabled(): boolean {
    return enabled;
  },
  set(value: boolean): void {
    enabled = value;
    try {
      localStorage.setItem(KEY, value ? 'on' : 'off');
    } catch {
      /* storage can be blocked; the toggle still works for the session */
    }
    if (value) tone(440, 0, 0.06, 'sine', 0.06);
  },
  fold(): void {
    tone(196, 0, 0.09, 'triangle', 0.12);
    tone(98, 0, 0.12, 'sine', 0.08);
  },
  undo(): void {
    tone(147, 0, 0.09, 'triangle', 0.1);
  },
  solve(): void {
    tone(523, 0, 0.16, 'sine', 0.1);
    tone(784, 0.1, 0.26, 'sine', 0.09);
  },
  blocked(): void {
    tone(110, 0, 0.07, 'square', 0.05);
  },
};

document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) void ctx.suspend();
  else if (enabled) void ctx.resume();
});
