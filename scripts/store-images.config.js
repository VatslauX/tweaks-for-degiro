// Chrome Web Store images: npm run store-images (not part of npm test).
module.exports = {
  testDir: '.',
  testMatch: 'store-images.spec.js',
  timeout: 60000,
  workers: 1,
  reporter: [['list']]
};
