// Price alarms on the product chart (alarm-lines.js, page world): gold badges at the alarm prices,
// fed by alarms.js through data-dg-alarm-lines. Which alarms are published: tests/integration/alarm-lines.test.js.
// The mock chart's y-axis is set to 12..22, rounded out to its ticks (about 10..25; product 123, price 16,92).
const { test, expect, setFlag } = require('./fixtures');

let n = 0;
const alarm = o => ({ id: 'ln-' + (++n), productId: 123, name: 'Mock ETF', symbol: 'MOCK', currency: '€', price: 20, dir: 'above', repeat: 'each', on: true, created: 1, ...o });
async function seed(settings, alarms) {
  const opt = await settings();
  await opt.evaluate(a => chrome.storage.sync.set({ dgAlarms: a }), alarms);
  return opt;
}
const setAlarms = (opt, alarms) => opt.evaluate(a => chrome.storage.sync.set({ dgAlarms: a }), alarms);

// our badges: text and centre y, plus the plot's right edge in chart-local px
const drawn = page => page.evaluate(() => {
  const c = window.__chart, cr = c.container.getBoundingClientRect();
  const right = c.chartWidth - c.plotLeft - c.plotWidth + 2;
  const badges = [...c.container.querySelectorAll('[data-dg-alarm-badge]')].map(d => {
    const b = d.getBoundingClientRect();
    const bg = getComputedStyle(d).backgroundColor;
    return { text: d.textContent, y: Math.round((b.top + b.bottom) / 2 - cr.top), bell: !!d.querySelector('svg path'), bg, right: Math.round(cr.right - b.right) };
  }).sort((a, b) => a.y - b.y);
  return { badges, right };
});
const texts = async page => (await drawn(page)).badges.map(l => l.text);

test('gold badges at the switched-on alarms\' prices, each with a bell and the price, on the right edge', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 20 }), alarm({ price: 14.5, dir: 'below' }), alarm({ price: 18, on: false }), alarm({ productId: 456, price: 15 })]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['20,00', '14,50']); // top to bottom
  const d = await drawn(page);
  for (const b of d.badges) {
    expect(b.bg).toBe('rgb(224, 161, 0)'); // #e0a100
    expect(b.bell).toBe(true);
    expect(Math.abs(b.right - d.right)).toBeLessThanOrEqual(1);
  }
  // each badge sits at its price's y on the axis
  const c = await page.evaluate(() => {
    const c = window.__chart;
    return { y20: Math.round(c.yAxis[0].toPixels(20)), y145: Math.round(c.yAxis[0].toPixels(14.5)) };
  });
  expect(Math.abs(d.badges[0].y - c.y20)).toBeLessThanOrEqual(1);
  expect(Math.abs(d.badges[1].y - c.y145)).toBeLessThanOrEqual(1);
});

test('no plot lines are drawn: badges only', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 20 })]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['20,00']);
  const lines = await page.evaluate(() => (window.__chart.yAxis[0].plotLinesAndBands || []).filter(p => /^dg-alarm-/.test(p.id)).length);
  expect(lines).toBe(0);
});

test('alarms outside the chart range: a badge pinned to the top or bottom edge', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 30 }), alarm({ price: 8, dir: 'below' })]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['▲ 30,00', '▼ 8,00']);
  const d = await drawn(page);
  expect(d.badges.every(b => b.bg === 'rgb(224, 161, 0)')).toBe(true);
});

test('follow alarm changes live: edited, added, switched off, deleted', async ({ degiro, settings }) => {
  const a = alarm({ price: 20 }), b = alarm({ price: 13, dir: 'below' });
  const opt = await seed(settings, [a]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['20,00']);
  await setAlarms(opt, [{ ...a, price: 19.5 }]);
  await expect.poll(() => texts(page)).toEqual(['19,50']);
  await setAlarms(opt, [{ ...a, price: 19.5 }, b]);
  await expect.poll(() => texts(page)).toEqual(['19,50', '13,00']);
  await setAlarms(opt, [{ ...a, price: 19.5, on: false }, b]);
  await expect.poll(() => texts(page)).toEqual(['13,00']);
  await setAlarms(opt, []);
  await expect.poll(() => texts(page)).toEqual([]);
  await expect(page.locator('[data-dg-alarm-badge]')).toHaveCount(0);
});

for (const key of ['alarmLines', 'priceAlarms']) {
  test(`gone when ${key} is switched off, back when on`, async ({ degiro, settings }) => {
    const opt = await seed(settings, [alarm({ price: 20 })]);
    const { page } = await degiro({ orders: [] });
    await expect.poll(() => texts(page)).toEqual(['20,00']);
    await setFlag(opt, key, false);
    await expect.poll(() => texts(page)).toEqual([]);
    await expect(page.locator('[data-dg-alarm-badge]')).toHaveCount(0);
    await setFlag(opt, key, true);
    await expect.poll(() => texts(page)).toEqual(['20,00']);
  });
}

test('Settings: the switch sits under Price alarms and is greyed out while Price alarms is off', async ({ settings }) => {
  const opt = await settings();
  const row = opt.locator('label.row:has(input[data-key=alarmLines])');
  await expect(row).toContainText('Alarms on the chart');
  await expect(opt.locator('input[data-key=alarmLines]')).toBeChecked();
  await setFlag(opt, 'priceAlarms', false);
  await expect(row).toHaveClass(/disabled/);
  await setFlag(opt, 'priceAlarms', true);
  await expect(row).not.toHaveClass(/disabled/);
});

test('malformed values the page writes into the attribute are ignored; never parsed as HTML', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 20 })]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['20,00']);
  const bad = [
    'not json', 'null', '[]', '"x"', '{"l":[{"p":20,"d":"above"}]}',
    '{"id":"123","l":[{"p":20,"d":"above"}]}',
    '{"id":123,"l":[{"p":"20","d":"above"}]}',
    '{"id":123,"l":[{"p":-5,"d":"above"}]}',
    '{"id":123,"l":[{"p":0,"d":"above"}]}',
    '{"id":123,"l":[{"p":1e999,"d":"above"}]}',
    '{"id":123,"l":[{"p":20,"d":"sideways"}]}',
    '{"id":123,"l":[{"p":20,"d":"above"},{"p":"<img src=x onerror=window.__xss=1>","d":"above"}]}',
    '{"id":123,"l":[{"p":20}]}',
    '{"id":123,"l":{"p":20,"d":"above"}}',
    JSON.stringify({ id: 123, l: Array.from({ length: 26 }, (_, i) => ({ p: 13 + i / 10, d: 'above' })) }),
    '{"id":999,"l":[{"p":20,"d":"above"}]}' // valid, but another product
  ];
  for (const v of bad) {
    await page.evaluate(x => document.documentElement.setAttribute('data-dg-alarm-lines', x), v);
    await expect.poll(() => texts(page), v).toEqual([]);
    await expect(page.locator('[data-dg-alarm-badge]'), v).toHaveCount(0);
    // back to a valid value from the page: it is drawn (the page world can't tell who wrote it)
    await page.evaluate(() => document.documentElement.setAttribute('data-dg-alarm-lines', '{"id":123,"l":[{"p":20,"d":"above"}]}'));
    await expect.poll(() => texts(page), v).toEqual(['20,00']);
  }
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  expect(await page.locator('#chart img').count()).toBe(0);
});

test('no badges for another product: none on its page, and they go when navigating away', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 20 }), alarm({ productId: 456, price: 15 })]);
  const { page } = await degiro({ orders: [], url: 'https://trader.degiro.nl/trader/#/products/999/overview' });
  await expect.poll(() => page.evaluate(() => JSON.parse(document.documentElement.getAttribute('data-dg-status') || '{}').alarmLines)).toBe('idle');
  expect(await texts(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-dg-alarm-lines'))).toBeNull();
  await page.evaluate(() => { location.hash = '#/products/123/overview'; });
  await expect.poll(() => texts(page)).toEqual(['20,00']);
  await page.evaluate(() => { location.hash = '#/products/456/overview'; });
  await expect.poll(() => texts(page)).toEqual(['15,00']);
  await page.evaluate(() => { location.hash = '#/products/999/overview'; });
  await expect.poll(() => texts(page)).toEqual([]);
  await expect(page.locator('[data-dg-alarm-badge]')).toHaveCount(0);
});

test('badges move with the axis when the chart rescales', async ({ degiro, settings }) => {
  await seed(settings, [alarm({ price: 20 })]);
  const { page } = await degiro({ orders: [] });
  await expect.poll(() => texts(page)).toEqual(['20,00']);
  const before = (await drawn(page)).badges[0].y;
  await page.evaluate(() => window.__chart.yAxis[0].setExtremes(18, 24));
  await expect.poll(async () => {
    const d = await drawn(page);
    const y = Math.round(await page.evaluate(() => window.__chart.yAxis[0].toPixels(20)));
    return d.badges.length === 1 && Math.abs(d.badges[0].y - y) <= 1 && d.badges[0].y !== before;
  }).toBe(true);
  await page.evaluate(() => window.__chart.yAxis[0].setExtremes(30, 40)); // 20 is below even after rounding to ticks
  await expect.poll(() => texts(page)).toEqual(['▼ 20,00']);
});
