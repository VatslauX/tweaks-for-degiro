// The background check's chime (offscreen.html): the service worker has no audio, so it opens this hidden page
// (chrome.offscreen, reason AUDIO_PLAYBACK; Chrome closes it after 30 s without sound). It plays the chime when it
// opens, and again when the worker asks while it is still open. Only chrome.runtime is available here.
(() => {
  dgPlayChime();
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || msg?.type !== 'dg-chime-play') return;
    reply(dgPlayChime()); // the worker tells its asker whether it played
  });
})();
