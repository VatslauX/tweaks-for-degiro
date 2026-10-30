// End-to-end tests: Chromium with the unpacked extension against a mocked trader.degiro.nl.
module.exports = {
  testDir: 'tests/e2e',
  timeout: 30000,
  workers: 3,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
};
