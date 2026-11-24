// The alarm-data lock, client side (DEGIRO tabs and the settings page). Alarm data (sync 'dgAlarms', local
// 'dgAlarmState' and 'dgAlarmEvents') is read, merged and written back by DEGIRO tabs, the settings page and the
// background worker, which share no Web Lock (the tabs run on DEGIRO's origin): writes a few ms apart would lose one
// of them. The worker (background.js) keeps one lock in memory: one holder at a time, DEGIRO tabs and the settings
// page before the worker's own write, in turn otherwise. A client opens a port (only so its going, a closed or
// crashed tab, frees the lock) and asks with a message; the worker's reply `true` is its turn. Disconnecting the port
// releases it. Without an answer within 2 s, or with the worker unreachable, the write goes ahead without the lock:
// an alarm never waits on it for longer.
const dgAlarmLock = (() => {
  const WAIT = 2000;
  const none = () => {};
  /**
   * Wait for the lock; resolves with the function that releases it (a no-op when going without it).
   * @returns {Promise<() => void>}
   */
  const hold = () => new Promise(resolve => {
    /** @type {chrome.runtime.Port | null} */ let port = null;
    let done = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */ let timer;
    const drop = () => { try { port?.disconnect(); } catch (e) {} };
    /** @param {boolean} held */
    const finish = held => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (held) { resolve(drop); return; }
      drop(); // out of the worker's queue: a turn granted later would keep the others waiting
      resolve(none);
    };
    try {
      const token = crypto.randomUUID();
      port = chrome.runtime.connect({ name: `dg-lock:${token}` });
      // the worker went (stopped, restarting) while this one waited: on without the lock. Once held: the write finishes
      port.onDisconnect.addListener(() => { void chrome.runtime.lastError; finish(false); });
      timer = setTimeout(() => finish(false), WAIT);
      chrome.runtime.sendMessage({ type: 'dg-lock', token }).then(r => finish(r === true), () => finish(false));
    } catch (e) { finish(false); } // the extension's context is gone (updated, disabled): as before, no lock
  });
  /**
   * Run `fn` holding the lock (or without it, see above), released when it settles.
   * @template T @param {() => Promise<T>} fn @returns {Promise<T>}
   */
  const run = async fn => {
    const release = await hold();
    try { return await fn(); } finally { release(); }
  };
  return Object.freeze({ hold, run });
})();
