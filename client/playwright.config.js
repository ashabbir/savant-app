const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./tests_ui",
  timeout: 60000,
  expect: {
    timeout: 15000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
});
