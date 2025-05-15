// setup.js
// Purpose: Initializes the testing environment for the Puppeteer testing framework.
// Creates necessary directory structure and a default config file if one doesn't exist.
// Usage: Run this script from the root directory of the testing framework project (e.g., `node setup.js`).
'use strict'; // Enforce stricter parsing and error handling

const fs = require('fs-extra'); // Using fs-extra for convenient 'ensureDir' and 'pathExists'
const chalk = require('chalk'); // For colorful console output
const path = require('path'); // Use path module for robust path joining

// --- Configuration ---

// Base directory for all test-related files and outputs.
// Assumes this script is in the project root (e.g., Web_Test_Framework/).
const testsBaseDir = path.join(__dirname, 'tests');

// Directory structure to ensure exists within testsBaseDir.
const dirsToEnsure = [
  'screenshots/baseline', // Baseline images for comparison
  'screenshots/test',     // Images captured from the site under test
  'screenshots/diff',     // Difference images highlighting discrepancies
  'components',           // For storing baseline HTML snippets (useful for debugging structure)
  'animations',           // For storing animation frames and generated GIFs
  'reports',              // For storing generated HTML test reports
  'performance'           // For storing raw performance JSON data
];

// Path to the configuration file within the tests directory.
const configPath = path.join(testsBaseDir, 'config.js');

// Default configuration template (SANITIZED).
// This will be written to config.js ONLY if the file doesn't already exist.
const defaultConfigContent = `// Default configuration - REVIEW AND UPDATE PLACEHOLDERS
module.exports = {
  // --- Essential URLs (IMPORTANT: Update these placeholders!) ---
  baselineUrl: 'http://localhost:8080', // URL of the reference site/server <-- UPDATE THIS
  testUrl: 'http://localhost:8081',     // URL of the site under test (dev server) <-- UPDATE THIS

  // Optional: Relative path from 'tests/' directory TO your project's source directory.
  // Only needed if using scripts that interact with the project source (like dev-workflow.js, if kept).
  // projectDir: '../my-web-project',

  // --- Viewport Definitions ---
  viewports: [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ],
  defaultViewport: 'desktop',

  // --- Component Testing Configuration ---
  threshold: 0.1, // Pixelmatch threshold (0-1, lower = less tolerant)
  sizeDifferenceTolerance: 2, // Max allowed pixel difference in dimensions

  // Add components to test here using STABLE selectors (IDs, data-attributes).
  components: [
    // { name: 'mainNav', selector: '#main-navigation', interactiveTest: null },
    // { name: 'loginForm', selector: '[data-testid="login-form"]', interactiveTest: null },
  ],

  // --- Animation Testing Configuration ---
  animationDuration: 2000,      // ms to record
  animationFrameInterval: 100,  // ms between frames
  animationScreenshotScope: 'viewport', // 'viewport' or 'component'

  // --- Performance Testing Configuration ---
  performanceWaitUntil: 'load', // 'load' or 'networkidle2'

  // --- Development Workflow (Watcher) Config (if using dev-workflow.js) ---
  // devWorkflowTestDelay: 2500, // ms delay after change before testing
};
`;

// --- Main Setup Function ---
(async () => {
  console.log(chalk.blue('Setting up Puppeteer testing environment...'));
  try {
    // 1. Ensure all necessary directories exist
    console.log(chalk.cyan('Ensuring test directories exist:'));
    for (const relativeDir of dirsToEnsure) {
      const fullPath = path.join(testsBaseDir, relativeDir);
      await fs.ensureDir(fullPath);
      console.log(chalk.green(`  ✓ ${path.relative(process.cwd(), fullPath)}`));
    }

    // 2. Create default config file if it doesn't exist
    if (!await fs.pathExists(configPath)) {
      console.log(chalk.yellow(`\nConfig file not found. Creating default at:`));
      console.log(chalk.yellow(`  ${path.relative(process.cwd(), configPath)}`));
      await fs.writeFile(configPath, defaultConfigContent);
      console.log(chalk.green(`  ✓ Default config file created successfully.`));
      console.log(chalk.yellow('\n❗ IMPORTANT: Please review and update the placeholder URLs'));
      console.log(chalk.yellow(`  (baselineUrl, testUrl) in tests/config.js`));
    } else {
      console.log(chalk.blue(`\nℹ️ Config file already exists:`));
      console.log(chalk.blue(`  ${path.relative(process.cwd(), configPath)}`));
      console.log(chalk.yellow('  Ensure it uses the correct keys (baselineUrl, testUrl, etc.).'));
    }

    console.log(chalk.blue('\nSetup verification complete! Environment ready.'));

  } catch (error) {
    console.error(chalk.red('\n--- Setup Failed ---'));
    console.error(chalk.red(`An error occurred during setup: ${error.message}`));
    console.error(error.stack); // Log stack trace for debugging
    process.exit(1); // Exit with a non-zero code to indicate failure
  }
})();