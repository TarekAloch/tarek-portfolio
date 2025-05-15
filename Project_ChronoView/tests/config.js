// Default configuration - REVIEW AND UPDATE PLACEHOLDERS
module.exports = {
  // --- Essential URLs (IMPORTANT: Update these placeholders!) ---
  baselineUrl: 'http://localhost:[YOUR_COROOT_UI_PORT]/path/to/map', // URL of the reference site/server <-- Coroot Service Map URL
  testUrl: 'http://localhost:[YOUR_COROOT_UI_PORT]/path/to/map',     // URL of the site under test (dev server) <-- Coroot Service Map URL (same as baseline)
  defaultTimeWindowParam: '?from=now-1h',            // Default Coroot time window query param

  // Optional: Relative path from 'tests/' directory TO your project's source directory.
  // Only needed if using scripts that interact with the project source (like dev-workflow.js, if kept).
  // projectDir: '../my-web-project',

  // --- Viewport Definitions ---
  viewports: [
    { name: 'desktop', width: 1920, height: 1117 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 667 },
  ],
  defaultViewport: 'desktop',

  // --- Component Testing Configuration ---
  threshold: 0.01, // Pixelmatch threshold (0-1, lower = less tolerant)
  sizeDifferenceTolerance: 5, // Allowable pixel difference in width/height before flagging size mismatch

  // Add components to test here using STABLE selectors (IDs, data-attributes).
  components: [
    // { name: 'mainNav', selector: '#main-navigation', interactiveTest: null },
    // { name: 'loginForm', selector: '[data-testid="login-form"]', interactiveTest: null },
    // { name: 'heading', selector: 'h1', interactiveTest: null }, // Keep previous examples if useful
    // { name: 'paragraph', selector: 'p', interactiveTest: null },
    // { name: 'button', selector: 'button', interactiveTest: null },
    //{ name: 'filterArea', selector: 'div.categories', interactiveTest: null }, // Previous temporary diagnostic component
    { name: 'namespaceDropdownTrigger', selector: 'div.v-select__slot', interactiveTest: null }, // Try targeting the slot div
    { name: 'emptyNamespaceOption', selector: '::-p-text(~empty)', interactiveTest: null }, // Try Puppeteer text selector
    { name: 'corootServiceMap', selector: 'svg[data-v-1c2b2776]', interactiveTest: null }, // More specific selector for map SVG
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

// Add reporting thresholds here
module.exports.reportingThresholds = {
    warn: 10,  // Percentage difference above which to show a warning (Yellow)
    alert: 30  // Percentage difference above which to show an alert (Red)
};
