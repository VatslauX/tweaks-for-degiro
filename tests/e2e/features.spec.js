// Regression tests for every feature, against the mocked DEGIRO page.
const { test, expect, setFlag } = require('./fixtures');

// centre-Y of each order badge vs. its dashed plot line, in chart coordinates
async function badgeGeometry(page) {
  return page.evaluate(() => {
    const c = Highcharts.charts.filter(Boolean).at(-1);
    const cr = c.container.getBoundingClientRect();
    const lines = {};
    (c.yAxis[0].plotLinesAndBands || []).filter(p => /^dg-ord/.test(p.id)).forEach(p => {
      const b = p.svgElem.element.getBoundingClientRect();
      lines[p.options.value] = (b.top + b.bottom) / 2 - cr.top;
    });
    const badges = [...c.container.querySelectorAll('div')].filter(d => /^(▲ |▼ )?(BUY|SELL) /.test(d.textContent) && !d.children.length)
      .map(d => { const b = d.getBoundingClientRect(); return { text: d.textContent, y: (b.top + b.bottom) / 2 - cr.top, x: b.left - cr.left }; });
    return { lines, badges };
  });
}

async function dragOnChart(page, fromFrac, toFrac) {
  const box = await page.locator('#chart .highcharts-container').boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * (fromFrac + toFrac) / 2, y, { steps: 3 });
  await page.mouse.move(box.x + box.width * toFrac, y, { steps: 3 });
  await page.mouse.up();
}

test.describe('Bid/ask spread', () => {
  test('adds a Spread row at the bottom of the Ask column', async ({ degiro }) => {
    const { page } = await degiro();
    const row = page.locator('#askCol > [data-spread-row]');
    await expect(row).toHaveText(/Spread€ 0,04 \(0,24%\)$/);
    // it is the last row so both columns stay aligned
    expect(await page.evaluate(() => document.querySelector('#askCol').lastElementChild.hasAttribute('data-spread-row'))).toBe(true);
  });

  test('updates when the quote changes', async ({ degiro }) => {
    const { page } = await degiro();
    await expect(page.locator('[data-spread-row]')).toHaveCount(1);
    await page.evaluate(() => { document.querySelectorAll('#askCol dd span')[1].textContent = '€ 17,00'; });
    await expect(page.locator('[data-spread-row] dd')).toHaveText(/€ 0,10 \(0,59%\)$/);
  });
});

test.describe('Hide sections', () => {
  test('hides Cash compensation, keeps other sections', async ({ degiro }) => {
    const { page } = await degiro();
    await expect(page.locator('#cash')).toBeHidden();
    await expect(page.locator('#other')).toBeVisible();
  });

  test('un-hides a box that DEGIRO reuses for another section', async ({ degiro }) => {
    const { page } = await degiro();
    await expect(page.locator('#cash')).toBeHidden();
    // a reused box gets the other section's title and hook
    await page.evaluate(() => { const c = document.querySelector('#cash'); c.setAttribute('data-name', 'accountSummary'); c.querySelector('h3').firstChild.data = 'Account summary'; });
    await expect(page.locator('#cash')).toBeVisible();
    await page.evaluate(() => { document.querySelector('#cash h3').firstChild.data = 'Cash compensation'; });
    await expect(page.locator('#cash')).toBeHidden();
  });

  test('does not climb into a much taller single-child wrapper', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => {
      const col = document.createElement('div');
      col.id = 'tallCol';
      col.style.height = '2000px';
      const s = document.createElement('section');
      const h = document.createElement('h3');
      h.textContent = 'Cash compensation';
      s.append(h);
      col.append(s);
      document.querySelector('main').append(col);
    });
    await expect(page.locator('#tallCol section')).toBeHidden();
    await expect(page.locator('#tallCol')).toBeVisible();
  });

  test('un-hides a box when DEGIRO later loads other widgets or prices into it', async ({ degiro }) => {
    const { page } = await degiro();
    await expect(page.locator('#cash')).toBeHidden();
    await page.evaluate(() => {
      const w = document.createElement('div');
      const h = document.createElement('h3');
      h.textContent = 'Key figures';
      w.append(h);
      document.getElementById('cashWrap').append(w);
    });
    await expect(page.locator('#cashWrap')).toBeVisible();
    await expect(page.locator('#cashWrap h3', { hasText: 'Key figures' })).toBeVisible();
    await expect(page.locator('#cash')).toBeHidden(); // a smaller box for Cash compensation itself
  });

  test('Cash compensation is found by its hook in any DEGIRO language', async ({ degiro }) => {
    const { page } = await degiro({ initScript: () => {
      document.addEventListener('DOMContentLoaded', () => { document.querySelector('#cash h3').textContent = 'Compensación de efectivo'; });
    } });
    await expect(page.locator('#cash')).toBeHidden();
    await expect(page.locator('#other')).toBeVisible();
  });

  test('real layout (all widgets in one mainPageSection): hides only the widget, never the page', async ({ degiro, settings }) => {
    const { page } = await degiro({ initScript: () => { window.__MOCK_MAIN_SECTION = true; } });
    await expect(page.locator('#cash')).toBeHidden();
    for (const id of ['#chart', '#pricing', '#other', '#divSection']) await expect(page.locator(id)).toBeVisible();
    await expect(page.locator('[data-name=mainPageSection]')).toBeVisible();
    // a title whose widget holds the prices, or a heading straight in the shared section: nothing is hidden
    const opt = await settings();
    await opt.fill('#hiddenTitles', 'Pricing data\nCash compensation');
    await page.evaluate(() => {
      const h = document.createElement('h3');
      h.textContent = 'Cash compensation';
      document.querySelector('[data-name=mainPageSection]').append(h);
    });
    await page.bringToFront();
    await expect(page.locator('#cash')).toBeHidden();
    await page.waitForTimeout(300);
    for (const id of ['#chart', '#pricing', '[data-field=BidPrice]', '[data-name=mainPageSection] > h3']) await expect(page.locator(id)).toBeVisible();
  });
});

test.describe('Main chart only', () => {
  test('a smaller extra chart gets no badges, and period change still uses the price chart', async ({ degiro }) => {
    const { page } = await degiro();
    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
    await expect(page.locator('#dg-period-change')).toBeVisible();
    // a mini chart created after the price chart (last in Highcharts.charts), e.g. a sparkline
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'mini';
      div.style.cssText = 'width:200px;height:80px';
      document.querySelector('main').append(div);
      const d = window.__chartData.slice(-10);
      new Highcharts.Chart({ chart: { renderTo: 'mini', type: 'line', animation: false }, title: { text: null },
        legend: { enabled: false }, credits: { enabled: false }, xAxis: { type: 'datetime' },
        yAxis: { min: 12, max: 22 }, plotOptions: { series: { animation: false } }, series: [{ data: d }] });
    });
    await page.waitForTimeout(2500);
    const mini = await page.evaluate(() => {
      const c = Highcharts.charts.filter(Boolean).at(-1);
      return {
        lines: (c.yAxis[0].plotLinesAndBands || []).filter(p => /^dg-ord/.test(p.id)).length,
        badges: [...c.container.querySelectorAll('div')].filter(d => !d.querySelector('div') && /BUY|SELL/.test(d.textContent)).length,
        sel: c.container.hasAttribute('data-dg-sel')
      };
    });
    expect(mini).toEqual({ lines: 0, badges: 0, sel: false });
    expect(await page.evaluate(() => [...document.querySelectorAll('#chart div')]
      .filter(d => !d.querySelector('div') && /BUY|SELL/.test(d.textContent)).length)).toBe(4);
    await expect(page.locator('#dg-period-change')).toBeVisible();
  });
});

test.describe('Chart range selection', () => {
  test('drag shows % change, prices and endpoint dots', async ({ degiro }) => {
    const { page } = await degiro();
    await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
    await dragOnChart(page, 0.2, 0.6);
    const label = page.locator('#chart .highcharts-container > div', { hasText: '→' });
    await expect(label).toBeVisible();
    await expect(label).toHaveText(/[+-]?\d+,\d{3} \([+-]?\d+,\d{2}%\)\d+,\d{3} → \d+,\d{3} · /);
    const dots = await page.evaluate(() => [...document.querySelectorAll('#chart .highcharts-container div')]
      .filter(d => d.style.borderRadius === '50%' && d.style.display === 'block').length);
    expect(dots).toBe(2);
  });

  test('percentage matches the chart data', async ({ degiro }) => {
    const { page } = await degiro();
    await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
    await dragOnChart(page, 0.1, 0.9);
    const { shown, p1, p2 } = await page.evaluate(() => {
      const label = [...document.querySelectorAll('#chart .highcharts-container div')].find(d => /%\)/.test(d.textContent) && d.style.display === 'block');
      const m = label.textContent.match(/\(([+-]?\d+,\d+)%\)(\d+,\d+) → (\d+,\d+)/);
      return { shown: parseFloat(m[1].replace(',', '.')), p1: parseFloat(m[2].replace(',', '.')), p2: parseFloat(m[3].replace(',', '.')) };
    });
    expect(shown).toBeCloseTo((p2 - p1) / p1 * 100, 1);
  });

  test('click without drag clears the selection', async ({ degiro }) => {
    const { page } = await degiro();
    await page.waitForFunction(() => Highcharts.charts.some(c => c?.container?.hasAttribute('data-dg-sel')));
    await dragOnChart(page, 0.2, 0.6);
    const box = await page.locator('#chart .highcharts-container').boundingBox();
    await page.mouse.click(box.x + 100, box.y + 100);
    const visible = await page.evaluate(() => [...document.querySelectorAll('#chart .highcharts-container div')].some(d => /%\)/.test(d.textContent) && d.style.display === 'block'));
    expect(visible).toBe(false);
  });
});

test.describe('Open orders on the chart', () => {
  test('shows this product’s orders only, centred on their lines', async ({ degiro }) => {
    const { page } = await degiro();
    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
    const { lines, badges } = await badgeGeometry(page);
    const byText = Object.fromEntries(badges.map(b => [b.text, b]));
    expect(Object.keys(byText).sort()).toEqual(['BUY 100 · 15,50', 'BUY 200 · 14,10', 'SELL 200 · 17,65', '▼ BUY 50 · 9,50'].sort());
    for (const [text, price] of [['SELL 200 · 17,65', 17.65], ['BUY 100 · 15,50', 15.5], ['BUY 200 · 14,10', 14.1]]) {
      expect(Math.abs(byText[text].y - lines[price])).toBeLessThanOrEqual(1.5);
    }
    expect(byText['▼ BUY 50 · 9,50']).toBeTruthy(); // out of range -> bottom row, no line
    expect(lines[9.5]).toBeUndefined();
  });

  test('badges of nearby orders sit side by side, each on its own line', async ({ degiro }) => {
    const near = [
      { productId: 123, product: 'Mock ETF', buysell: 'B', size: 100, price: 15.1, stopPrice: 0, orderType: 'LIMIT' },
      { productId: 123, product: 'Mock ETF', buysell: 'B', size: 200, price: 15.05, stopPrice: 0, orderType: 'LIMIT' },
      { productId: 123, product: 'Mock ETF', buysell: 'B', size: 300, price: 15.0, stopPrice: 0, orderType: 'LIMIT' },
      { productId: 123, product: 'Mock ETF', buysell: 'B', size: 50, price: 9.5, stopPrice: 0, orderType: 'LIMIT' }
    ];
    const { page } = await degiro({ orders: near });
    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
    const { lines, badges } = await badgeGeometry(page);
    const by = Object.fromEntries(badges.map(b => [b.text, b]));
    const inside = [['BUY 100 · 15,10', 15.1], ['BUY 200 · 15,05', 15.05], ['BUY 300 · 15,00', 15]];
    for (const [text, price] of inside) expect(Math.abs(by[text].y - lines[price])).toBeLessThanOrEqual(1.5);
    // they don't overlap: each is further right than the previous one
    const xs = inside.map(([t]) => by[t].x).sort((a, b) => a - b);
    expect(new Set(xs).size).toBe(3);
    const boxes = await page.evaluate(() => [...Highcharts.charts.at(-1).container.querySelectorAll('div')]
      .filter(d => /^(▼ )?BUY /.test(d.textContent) && !d.children.length).map(d => d.getBoundingClientRect().toJSON()));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      expect(overlap).toBe(false);
    }
  });

  test('badges stay on their lines after the axis changes', async ({ degiro }) => {
    const { page } = await degiro();
    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
    await page.evaluate(() => Highcharts.charts.at(-1).yAxis[0].setExtremes(13, 19));
    await expect.poll(async () => {
      const { lines, badges } = await badgeGeometry(page);
      const b = badges.find(x => x.text === 'BUY 100 · 15,50');
      return b && lines[15.5] != null ? Math.abs(b.y - lines[15.5]) : 99;
    }, { timeout: 5000 }).toBeLessThanOrEqual(1.5);
  });

  test('clicking a badge opens Adjust order for that order and restores the panel', async ({ degiro }) => {
    const { page } = await degiro();
    const badge = page.locator('#chart div', { hasText: /^BUY 100 · 15,50$/ });
    await expect(badge).toBeVisible({ timeout: 8000 });
    await badge.click();
    await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
    await expect(page.locator('#limit')).toHaveValue('15.5');
    await expect.poll(() => page.evaluate(() => window.__log.join(','))).toBe('panel:expand,edit:1,panel:minimise');
    // the click must not start a range selection
    const selecting = await page.evaluate(() => [...document.querySelectorAll('#chart .highcharts-container div')].some(d => /%\)/.test(d.textContent) && d.style.display === 'block'));
    expect(selecting).toBe(false);
  });
});

test.describe('Adjust order: click outside closes', () => {
  test('outside click presses Cancel and nothing else', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => window.__openAdjust({ size: 100, price: 15.5 }));
    await page.click('#outside');
    await expect(page.locator('[data-name=orderDetails]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__log)).toEqual(['cancel']);
  });

  test('clicks inside the panel do not close it', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => window.__openAdjust({ size: 100, price: 15.5 }));
    await page.click('#limit');
    await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
    expect(await page.evaluate(() => window.__log)).toEqual([]);
  });

  test('clicks in dialogs outside the layout are ignored', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => { window.__openAdjust({ size: 100, price: 15.5 }); window.__openDialog(); });
    await page.click('#dialogBtn');
    await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
  });

  test('falls back to × when there is no Cancel, never to other buttons', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => { window.__openAdjust({ size: 1, price: 1 }); document.getElementById('cancel').remove(); });
    await page.click('#outside');
    expect(await page.evaluate(() => window.__log)).toEqual(['cross']);
  });

  test('does nothing when neither Cancel nor × exists', async ({ degiro }) => {
    const { page } = await degiro();
    await page.evaluate(() => { window.__openAdjust({ size: 1, price: 1 }); document.getElementById('cancel').remove(); document.getElementById('cross').remove(); });
    await page.click('#outside');
    await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
    expect(await page.evaluate(() => window.__log)).toEqual([]);
  });
});

test.describe('Settings (feature flags)', () => {
  test('each switch turns its feature off and on live', async ({ degiro, settings }) => {
    const { page } = await degiro();
    const opt = await settings();
    await expect(page.locator('[data-spread-row]')).toHaveCount(1);

    await setFlag(opt, 'spread', false);
    await expect(page.locator('[data-spread-row]')).toHaveCount(0);
    await setFlag(opt, 'spread', true);
    await expect(page.locator('[data-spread-row]')).toHaveCount(1);

    await setFlag(opt, 'hideSections', false);
    await expect(page.locator('#cash')).toBeVisible();
    await setFlag(opt, 'hideSections', true);
    await expect(page.locator('#cash')).toBeHidden();

    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
    await setFlag(opt, 'orders', false);
    await expect.poll(async () => (await badgeGeometry(page)).badges.length).toBe(0);
    await setFlag(opt, 'orders', true);
    await expect.poll(async () => (await badgeGeometry(page)).badges.length, { timeout: 8000 }).toBe(4);
  });

  test('hidden section titles are editable', async ({ degiro, settings }) => {
    const { page } = await degiro();
    const opt = await settings();
    await opt.fill('#hiddenTitles', 'Other section');
    await expect(page.locator('#other')).toBeHidden();
    await expect(page.locator('#cash')).toBeVisible();
  });

  test('range selection can be switched off', async ({ degiro, settings }) => {
    const { page } = await degiro();
    const opt = await settings();
    await setFlag(opt, 'chartSelect', false);
    await page.bringToFront();
    await page.waitForTimeout(300);
    await dragOnChart(page, 0.2, 0.6);
    const visible = await page.evaluate(() => [...document.querySelectorAll('#chart .highcharts-container div')].some(d => /%\)/.test(d.textContent) && d.style.display === 'block'));
    expect(visible).toBe(false);
  });

  test('click-outside close can be switched off', async ({ degiro, settings }) => {
    const { page } = await degiro();
    const opt = await settings();
    await setFlag(opt, 'adjustClose', false);
    await page.bringToFront();
    await page.evaluate(() => window.__openAdjust({ size: 1, price: 1 }));
    await page.click('#outside');
    await expect(page.locator('[data-name=orderDetails]')).toBeVisible();
  });
});

test.describe('Spread row styling', () => {
  test('uses the same font as the Ask row', async ({ degiro }) => {
    const { page } = await degiro();
    await expect(page.locator('[data-spread-row]')).toHaveCount(1);
    const f = await page.evaluate(() => {
      const font = el => { const s = getComputedStyle(el); return [s.fontSize, s.fontWeight, s.lineHeight].join(' '); };
      const askDt = [...document.querySelectorAll('#askCol dt')].find(d => d.textContent.trim() === 'Ask');
      const row = document.querySelector('[data-spread-row]');
      return {
        askLabel: font(askDt.querySelector('span')), spreadLabel: font(row.querySelector('dt span') || row.querySelector('dt')),
        askValue: font(askDt.nextElementSibling.querySelector('span')), spreadValue: font(row.querySelector('dd span') || row.querySelector('dd'))
      };
    });
    expect(f.spreadLabel).toBe(f.askLabel);
    expect(f.spreadValue).toBe(f.askValue);
  });
});
