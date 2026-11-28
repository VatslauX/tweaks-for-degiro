// Integration-test harness: the real isolated-world content scripts (manifest.json, the entry without
// world "MAIN") run against the mock pages in JSDOM, under Node, with no browser. Test tooling only.
//
//   const world = createWorld();                                  // one fake browser profile
//   const tab = await world.open({ fixture: 'favourites', hash: '/favourites' });
//   await world.advance(200);                                     // virtual time: timers, frames, storage
//
// What is faked:
//  - chrome.storage.sync/.local (shared by every tab of the world, JSON-copied values, onChanged delivered
//    asynchronously to all tabs, optional latency and failures), chrome.i18n (real _locales files),
//    chrome.runtime (id, onMessage: tab.message(msg) delivers one and returns the reply).
//  - Time: Date, setTimeout/setInterval and requestAnimationFrame of every tab run on ONE virtual clock per
//    world. Nothing waits for real time; tests move it with world.advance(ms) or tab.flush().
//  - jsdom gaps the scripts rely on: CSS.escape, TextEncoder, crypto.randomUUID.
// Not covered: layout (sizes, visibility, sticky, clamping): jsdom has none. That stays in Playwright.
// The `portfolio` fixture's own script calls fetch() for its canvas chart, which jsdom has neither of;
// open it with `globals: { fetch: () => new Promise(() => {}) }` so that chart's load() parks at its
// first await forever, leaving the holdings table itself (and the extension's scripts) to run normally
// — only the chart/canvas stays Playwright-only.
// Mock pages: their inline <script>s are run (like the page would), the extension's scripts after them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { JSDOM, VirtualConsole } = require('jsdom');
const { newCalls, answer, DEFAULT_ORDERS } = require('../fixtures/mock-api');

const ROOT = path.resolve(__dirname, '../..');
// DGT_EXTENSION_DIR points at a scratch copy of extension/ (used to prove a test fails against broken code)
const EXT = process.env.DGT_EXTENSION_DIR || path.join(ROOT, 'extension');
const FRAME_MS = 16;

const json = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- chrome.i18n: messages.json with Chrome's $1..$9 substitution ----------
const messageCache = new Map();
function messages(lang) {
  if (!messageCache.has(lang)) {
    const file = path.join(EXT, '_locales', lang, 'messages.json');
    messageCache.set(lang, JSON.parse(fs.readFileSync(fs.existsSync(file) ? file : path.join(EXT, '_locales/en/messages.json'), 'utf8')));
  }
  return messageCache.get(lang);
}
function getMessage(lang, key, subs) {
  const m = messages(lang)[key] || messages('en')[key];
  if (!m) return '';
  const list = subs == null ? [] : Array.isArray(subs) ? subs : [subs];
  return m.message.replace(/\$(\d)/g, (_, d) => String(list[+d - 1] ?? ''));
}

// the content scripts of one world (the isolated one, or world "MAIN"), in manifest order
function worldScripts(main) {
  const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
  const entry = manifest.content_scripts.find(c => (c.world === 'MAIN') === main);
  return entry.js.map(f => ({ file: f, code: fs.readFileSync(path.join(EXT, f), 'utf8') }));
}
const isolatedScripts = () => worldScripts(false);

// What the page-world scripts reach of the page: read from the tab's window when used, so they share its
// DOM, events, layout fakes and virtual clock. Their own global (`globalThis`) is separate, like Chrome's
// MAIN world is from the isolated one: no `chrome`, and a `__dgt` of their own.
const PAGE_GLOBALS = ['document', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage', 'performance', 'PerformanceObserver',
  'fetch', 'getComputedStyle', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'innerWidth', 'innerHeight', 'devicePixelRatio',
  'scrollX', 'scrollY', 'matchMedia', 'CSS', 'URL', 'URLSearchParams', 'AbortController', 'AbortSignal', 'DOMException', 'MutationObserver',
  'Node', 'Element', 'HTMLElement', 'HTMLCanvasElement', 'SVGElement', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'PointerEvent',
  'FocusEvent', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'Date',
  'Highcharts', 'TextEncoder', 'queueMicrotask'];
const HIGHCHARTS = () => fs.readFileSync(require.resolve('highcharts/highcharts.js'), 'utf8');

function createWorld({ storage = {}, start = new Date(2026, 9, 29, 10, 0, 0).getTime() } = {}) {
  /** @type {Set<any>} */
  const tabs = new Set();
  /** @type {Error[]} */
  const errors = []; // uncaught errors from scripts and timers in any tab
  /** @type {{ area: string, keys: string[], at: number }[]} */
  const log = []; // every storage write that changed something

  // ---------- the virtual clock ----------
  let now = start, seq = 0;
  /** @type {{ id: number, tab: any, at: number, fn: () => void, every?: number, kind: 'timer' | 'frame' }[]} */
  let queue = [];
  const addTimer = (tab, fn, ms, kind, every) => {
    const id = ++seq;
    queue.push({ id, tab, at: now + (kind === 'frame' ? FRAME_MS : Math.max(0, Number(ms) || 0)), fn, kind, every });
    return id;
  };
  const clear = id => { queue = queue.filter(e => e.id !== id); };
  function run(e) {
    if (e.every) e.at = now + Math.max(1, e.every); else queue = queue.filter(x => x !== e);
    try { e.fn(); } catch (err) { errors.push(err); }
  }
  // real microtasks and immediates: promise chains, mutation observers and storage callbacks settle here
  const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(r => setImmediate(r)); };
  const due = limit => queue.filter(e => e.at <= limit).sort((a, b) => a.at - b.at || a.id - b.id)[0];

  // ---------- storage ----------
  const faults = { get: false, set: false };
  const latency = { get: 0, set: 0 }; // virtual ms before a read / write happens
  const areas = {};
  for (const name of ['sync', 'local']) areas[name] = { name, data: json(storage[name] || {}) };

  // a storage operation: runs `fn` after the configured latency (microtask when 0), as a Promise
  function op(kind, fn) {
    return new Promise((resolve, reject) => {
      const go = () => {
        try {
          if (faults[kind]) throw new Error(`storage ${kind} failed (test fault)`);
          resolve(fn());
        } catch (e) { reject(e); }
      };
      if (latency[kind] > 0) addTimer(null, go, latency[kind], 'timer'); else Promise.resolve().then(go);
    });
  }
  function applySet(area, items) {
    const changes = {};
    for (const [k, v] of Object.entries(items || {})) {
      const old = area.data[k], val = json(v);
      if (val === undefined || same(old, val)) continue;
      area.data[k] = val;
      changes[k] = old === undefined ? { newValue: json(val) } : { oldValue: json(old), newValue: json(val) };
    }
    emit(area, changes);
  }
  function emit(area, changes) {
    if (!Object.keys(changes).length) return;
    log.push({ area: area.name, keys: Object.keys(changes), at: now });
    for (const tab of tabs) {
      if (tab.dead) continue;
      Promise.resolve().then(() => {
        if (tab.dead) return;
        for (const fn of tab.listeners) { try { fn(json(changes), area.name); } catch (e) { errors.push(e); } }
      });
    }
  }
  function pick(area, keys) {
    if (keys == null) return json(area.data);
    const out = {};
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) { for (const k of keys) if (k in area.data) out[k] = json(area.data[k]); return out; }
    for (const [k, d] of Object.entries(keys)) out[k] = k in area.data ? json(area.data[k]) : json(d);
    return out;
  }
  // chrome.storage.<area>: Promise, or callback when one is given (as in MV3)
  function areaApi(area, tab) {
    const call = (kind, fn, args) => {
      if (tab.dead) throw new Error('Extension context invalidated.'); // like Chrome, for a script whose extension is gone
      const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null;
      const p = op(kind, () => fn(...args));
      if (!cb) return p;
      p.then(cb, () => cb(undefined));
      return undefined;
    };
    return {
      get: (...a) => call('get', keys => pick(area, keys), a.length ? a : [null]),
      set: (...a) => call('set', items => { applySet(area, items); }, a),
      remove: (...a) => call('set', keys => {
        const gone = {};
        for (const k of [].concat(keys)) if (k in area.data) { gone[k] = { oldValue: area.data[k] }; delete area.data[k]; }
        emit(area, gone);
      }, a)
    };
  }

  // ---------- the network, for tabs opened with `page: true` ----------
  // fetch() answers from tests/fixtures/mock-api.js (or the test's `respond`); every answered request
  // becomes a resource timing entry, as in Chrome, which is how orders.js and portfolio.js find DEGIRO's
  // session. AbortSignal.timeout runs on the virtual clock, so a hung request times out in virtual time.
  function netApi(tab, { orders, respond }) {
    const win = tab.window;
    const calls = tab.calls = newCalls();
    // the tab is in front (jsdom says 'prerender'): orders.js polls only a visible page
    Object.defineProperty(win.document, 'visibilityState', { configurable: true, get: () => 'visible' });
    win.__MOCK_ORDERS = orders || DEFAULT_ORDERS; // the product mock's Outstanding panel lists the same orders as /update
    /** @type {{ name: string, entryType: string }[]} */ const entries = [];
    /** @type {((list: any) => void)[]} */ const observers = [];
    /** a request DEGIRO itself made (or ours): seen in performance entries and by every PerformanceObserver */
    tab.resource = href => {
      const entry = { name: new win.URL(href, win.location.href).href, entryType: 'resource' };
      entries.push(entry);
      for (const fn of observers) Promise.resolve().then(() => { try { fn({ getEntries: () => [entry] }); } catch (e) { errors.push(e); } });
    };
    Object.defineProperty(win, 'performance', { configurable: true, value: {
      now: () => now, getEntriesByType: type => (type === 'resource' ? [...entries] : []), getEntries: () => [...entries]
    } });
    win.PerformanceObserver = class { constructor(fn) { this.fn = fn; } observe() { observers.push(this.fn); } disconnect() {} };
    win.AbortSignal.timeout = ms => {
      const c = new win.AbortController();
      addTimer(tab, () => c.abort(new win.DOMException('signal timed out', 'TimeoutError')), ms, 'timer');
      return c.signal;
    };
    tab.requests = /** @type {string[]} */ ([]);
    win.fetch = (input, init = {}) => new Promise((resolve, reject) => {
      const u = new win.URL(String(input), win.location.href);
      tab.requests.push(u.pathname + u.search);
      const a = answer(new URL(u.href), { calls, orders, respond });
      const signal = init.signal;
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener('abort', () => reject(signal.reason));
      if (a === 'hang') return; // never answered (until the signal aborts it)
      Promise.resolve().then(() => {
        if (signal?.aborted || tab.closed) return;
        tab.resource(u.href);
        const status = a ? a.status ?? 200 : 404, body = a ? a.body ?? '' : '';
        resolve({ ok: status >= 200 && status < 300, status, url: u.href,
          json: async () => JSON.parse(body), text: async () => body });
      });
    });
  }

  const world = {
    errors, tabs, faults, latency, log,
    /** current virtual time (ms) */
    get now() { return now; },
    /** the stored data of an area, as plain JSON (what a fresh tab would read) */
    stored: (area = 'sync') => json(areas[area].data),
    /** write storage as another context would (the options page, another device), events included */
    set: (area, items) => { applySet(areas[area], items); return world.flush(); },
    /** erase an area as chrome.storage.<area>.clear() does (the settings' "Clear saved data"), events included */
    clear: area => {
      const a = areas[area], gone = {};
      for (const k of Object.keys(a.data)) { gone[k] = { oldValue: a.data[k] }; delete a.data[k]; }
      emit(a, gone);
      return world.flush();
    },
    /** Run everything due now (frames, zero-delay timers), then pending promises and storage events, until quiet. */
    async flush() {
      for (let i = 0; i < 200; i++) {
        await settle();
        const e = queue.find(x => x.kind === 'frame') || due(now);
        if (!e) return;
        // one batch per round: everything due now runs, whatever it schedules waits for the next round
        const batch = queue.filter(x => x.kind === 'frame' || x.at <= now);
        for (const b of batch) if (queue.includes(b)) run(b);
      }
      throw new Error('world.flush(): never quiet after 200 rounds (a render loop?)');
    },
    /** Jump the clock (a sleeping laptop, a background tab): overdue timers run once, not once per missed tick. */
    async skip(ms) { now += ms; await world.flush(); },
    /** Move the virtual clock forward, running timers, frames and storage in order. */
    async advance(ms) {
      const target = now + ms;
      await settle();
      for (let n = 0; ; n++) {
        if (n > 100000) throw new Error('world.advance(): too many timers');
        const e = due(target);
        if (!e) break;
        now = Math.max(now, e.at);
        run(e);
        await settle();
      }
      now = target;
      await world.flush();
    },

    /**
     * Open a tab on a mock page and run the extension's isolated-world scripts in it.
     * @param {{ fixture?: string, hash?: string, settings?: Record<string, any>, lang?: string, globals?: Record<string, any>,
     *   page?: boolean, highcharts?: boolean, orders?: any[], respond?: (u: URL) => any }} [o]
     *   globals: the mocks' switches (window.__MOCK_PRICES …), set before the page's own script runs.
     *   page: also run the page-world scripts (world "MAIN"), in a global of their own over the same DOM, with
     *   DEGIRO's JSON endpoints answered by tests/fixtures/mock-api.js (`orders`, `respond` as in the e2e
     *   `degiro()` fixture: fulfill options or 'hang'); tab.calls counts them, as the e2e `calls` does.
     *   highcharts: load the real Highcharts (node_modules, the version the mock page loads) before the page's script.
     *   layout: a stand-in for layout and canvas drawing (see below), for code that only asks whether something is shown.
     *   localStorage: the DEGIRO origin's localStorage before any script runs (e.g. portfolio.js's dgTweaksCashLines).
     */
    async open({ fixture = 'favourites', hash = '', settings, lang = 'en', globals = {}, page = false, highcharts = false, layout = false,
      orders, respond, localStorage = {} } = {}) {
      if (settings) applySet(areas.sync, settings);
      const html = fs.readFileSync(path.join(ROOT, 'tests/fixtures', `${fixture}.html`), 'utf8');
      const virtualConsole = new VirtualConsole();
      virtualConsole.on('jsdomError', e => errors.push(e));
      // the extension must not log (console.warn/error would show here); forward them to the test output
      virtualConsole.on('warn', (...a) => console.warn('[tab]', ...a));
      virtualConsole.on('error', (...a) => console.error('[tab]', ...a));
      const dom = new JSDOM(html, { url: `https://trader.degiro.nl/trader/#${hash.replace(/^#/, '')}`, runScripts: 'outside-only', virtualConsole });
      const win = dom.window;
      const tab = { world, window: win, document: win.document, listeners: [], messageListeners: [], closed: false, dead: false, dom };
      tabs.add(tab);

      // ---- browser APIs ----
      let extensionId = 'test-extension-id';
      const chromeApi = {
        storage: { sync: areaApi(areas.sync, tab), local: areaApi(areas.local, tab), onChanged: { addListener: fn => tab.listeners.push(fn) } },
        i18n: { getMessage: (key, subs) => getMessage(lang, key, subs), getUILanguage: () => lang },
        runtime: {
          get id() { return extensionId; }, // gone once the extension is disabled or removed
          onMessage: { addListener: fn => tab.messageListeners.push(fn) },
          getManifest: () => JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'))
        }
      };
      tab.disableExtension = () => { extensionId = undefined; tab.dead = true; };
      Object.defineProperty(win, 'chrome', { value: chromeApi, configurable: true });
      if (!win.TextEncoder) win.TextEncoder = TextEncoder;
      if (!win.CSS) win.CSS = { escape: s => String(s).replace(/[^\w-]/g, c => `\\${c}`) };
      if (!win.crypto?.randomUUID) win.crypto = { getRandomValues: a => nodeCrypto.getRandomValues(a), randomUUID: () => nodeCrypto.randomUUID() };
      if (!win.matchMedia) win.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
      win.setTimeout = (fn, ms, ...a) => addTimer(tab, () => fn(...a), ms, 'timer');
      win.setInterval = (fn, ms, ...a) => addTimer(tab, () => fn(...a), ms, 'timer', Math.max(1, Number(ms) || 0));
      win.clearTimeout = win.clearInterval = clear;
      win.requestAnimationFrame = fn => addTimer(tab, () => fn(now), 0, 'frame');
      win.cancelAnimationFrame = clear;
      const RealDate = win.Date;
      win.Date = class extends RealDate {
        constructor(...a) { if (a.length) super(...a); else super(now); }
        static now() { return now; }
      };
      for (const [k, v] of Object.entries(localStorage)) win.localStorage.setItem(k, v);
      if (page) netApi(tab, { orders, respond });
      if (layout) {
        // a stand-in for layout: every page element that isn't display:none is 1000 × 400 at the top left, so code
        // that only asks "is it shown, is it the largest" (mainChart(), visibility checks) can run; never sizes.
        // The extension's own elements measure 0 × 0, as their offsetWidth/offsetHeight already do in jsdom, so
        // its overlap checks (order badges) see nothing in the way
        win.Element.prototype.getBoundingClientRect = function () {
          let n = this, shown = !this.closest?.('[data-dg-own]');
          for (; shown && n && n.nodeType === 1; n = n.parentElement) if (win.getComputedStyle(n).display === 'none') { shown = false; break; }
          const w = shown ? 1000 : 0, h = shown ? 400 : 0;
          return { width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() { return {}; } };
        };
        // and for drawing: a 2D context that draws nothing and reads back blank pixels (jsdom has no canvas)
        win.HTMLCanvasElement.prototype.getContext = function () {
          const canvas = this;
          return new Proxy({}, {
            get(t, k) {
              if (k === 'canvas') return canvas;
              if (k === 'getImageData') return (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) });
              if (k === 'measureText') return s => ({ width: String(s).length * 7 });
              if (k in t) return t[k];
              return () => {};
            },
            set(t, k, v) { t[k] = v; return true; }
          });
        };
      }
      Object.assign(win, globals);

      // ---- scripts ----
      const ctx = dom.getInternalVMContext();
      const exec = (code, filename) => new vm.Script(code, { filename }).runInContext(ctx);
      if (highcharts) {
        // jsdom has no SVG text measuring: a box per character, so Highcharts can lay out its axes and plot area
        const box = function () { const n = (this.textContent || '').length; return { x: 0, y: 0, width: n * 6, height: n ? 12 : 0 }; };
        win.SVGElement.prototype.getBBox = box;
        win.SVGElement.prototype.getComputedTextLength = function () { return box.call(this).width; };
        exec(HIGHCHARTS(), 'highcharts.js'); // the mock page's <script src="/mock/highcharts.js">
      }
      // the mock page's own scripts (they build the page, like DEGIRO's would); wrapped so their
      // consts can't clash with the extension's top-level names. Taken from the parsed document
      // (runScripts: 'outside-only' keeps JSDOM from running them itself), in document order;
      // the list is collected before any of them runs.
      const inline = [...win.document.querySelectorAll('script:not([src])')].map(s => s.textContent);
      for (const code of inline) exec(`(function () {\n${code}\n})();`, `${fixture}.html`);
      for (const s of isolatedScripts()) exec(s.code, path.join(EXT, s.file));
      if (page) {
        const sandbox = {};
        for (const name of PAGE_GLOBALS) {
          Object.defineProperty(sandbox, name, {
            get() { const v = win[name]; return typeof v === 'function' && /^[a-z]/.test(name) ? v.bind(win) : v; },
            configurable: true
          });
        }
        Object.assign(sandbox, { window: win, console });
        const pageCtx = vm.createContext(sandbox);
        const execPage = (code, filename) => new vm.Script(code, { filename }).runInContext(pageCtx);
        for (const s of worldScripts(true)) execPage(s.code, path.join(EXT, s.file));
        tab.page = {
          run: code => execPage(code, 'test'),
          /** a page-world expression's value as plain JSON */
          json: code => JSON.parse(execPage(`JSON.stringify(${code})`, 'test'))
        };
      }

      // ---- helpers for tests ----
      tab.run = code => exec(code, 'test');
      /** an expression's value as plain JSON (objects made in the tab's realm don't deep-equal ours) */
      tab.json = code => JSON.parse(exec(`JSON.stringify(${code})`, 'test'));
      tab.$ = sel => win.document.querySelector(sel);
      tab.$$ = sel => [...win.document.querySelectorAll(sel)];
      /** features whose run() threw, in both worlds: the scheduler only records that as the status 'error',
       *  so world.errors never sees it (e.g. a global the page world is missing) */
      tab.failed = () => {
        const failed = st => Object.keys(st || {}).filter(k => st[k] === 'error');
        return [...failed(tab.json('globalThis.__dgt?.status() || {}')), ...(tab.page ? failed(tab.page.json('globalThis.__dgt?.status() || {}')) : [])];
      };
      tab.flush = () => world.flush();
      tab.close = () => { tabs.delete(tab); tab.closed = true; queue = queue.filter(e => e.tab !== tab); win.close(); };
      /** change the price DEGIRO shows (the mock's own helper) */
      tab.setPrice = (id, v) => win.__setPrice(id, v);
      tab.showList = name => win.__showList(name);
      /** in-app navigation: hash route changes (jsdom's own hashchange is asynchronous in real time) */
      tab.go = async h => {
        win.history.pushState(null, '', `#${h.replace(/^#/, '')}`);
        win.dispatchEvent(new win.HashChangeEvent('hashchange'));
        await world.flush();
      };
      /** like the options page: write the flag to chrome.storage.sync */
      tab.setFlag = async (key, on) => { await chromeApi.storage.sync.set({ [key]: on }); await world.flush(); };
      /** like the toolbar popup: send a chrome.runtime message to this tab and return the reply, as plain JSON */
      tab.message = (msg, sender = { id: extensionId }) => {
        let reply;
        for (const fn of tab.messageListeners) { try { fn(msg, sender, r => { reply = r; }); } catch (e) { errors.push(e); } }
        return json(reply);
      };
      /** everything the extension added carries data-dg-own */
      tab.owned = () => tab.$$('[data-dg-own]');
      await world.flush();
      return tab;
    }
  };
  return world;
}

/** a stored price alarm (see extension/alarm-rules.js) */
let alarmSeq = 0;
const alarm = (o = {}) => ({ id: `a${++alarmSeq}`, productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 17,
  dir: 'above', repeat: 'once', on: true, created: 1, ...o });

module.exports = { createWorld, alarm, EXT, ROOT };
