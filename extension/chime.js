// The price alarms' chime: two short tones made with Web Audio, so no sound file ships. Chrome on macOS shows
// notifications without a sound, so the extension plays its own. Loaded by the isolated-world content scripts (the
// DEGIRO tab whose check fired an alarm), by offscreen.html (the background check's, with DEGIRO closed) and by the
// settings page (a test notification).

/**
 * Plays the chime. False when Web Audio isn't there or refuses. A page plays sound only once it has been clicked or
 * typed in (Chrome's autoplay rule): callers in a tab check `navigator.userActivation` first.
 * @returns {boolean}
 */
function dgPlayChime() {
  try {
    const Ctx = globalThis.AudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const t0 = ctx.currentTime + 0.02;
    // a rising pair (A5, then E6), each fading out over half a second
    for (const [freq, at] of [[880, 0], [1318.5, 0.18]]) {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.3, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.55);
    }
    setTimeout(() => { ctx.close().catch(() => {}); }, 1500);
    return true;
  } catch (e) { return false; }
}
