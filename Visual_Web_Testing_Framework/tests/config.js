// Default configuration - REVIEW AND UPDATE PLACEHOLDERS
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
    { name: 'heading', selector: 'h1', interactiveTest: null },
    { name: 'paragraph', selector: 'p', interactiveTest: null },
    // Maybe one that only exists on site 2:
    { name: 'button', selector: 'button', interactiveTest: null },
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
