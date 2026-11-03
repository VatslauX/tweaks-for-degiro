// End-to-end tests: Chromium with the unpacked extension against a mocked trader.degiro.nl.
module.exports = {
  testDir: 'tests/e2e',
  timeout: 30000,
  workers: process.env.CI ? 4 : 6, // GitHub's runners have 4 cores
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
};
