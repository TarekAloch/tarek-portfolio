# Visual Web Testing Framework

## Overview

This project provides a powerful and configurable framework for automated web testing using Node.js and Puppeteer. It focuses on ensuring visual consistency, animation accuracy, and performance benchmarks by comparing a baseline (reference) version against a test (development) version of a web application or component.

Built with Node.js, the framework leverages Puppeteer for browser automation, `pixelmatch` for accurate visual comparisons, and standard browser Performance APIs for metrics collection. It is designed to help developers and QA teams efficiently catch regressions and validate UI/UX changes before deployment.

Key testing capabilities include:

*   **Visual Regression Testing:** Comparing component screenshots pixel-by-pixel.
*   **Animation Comparison:** Recording and comparing CSS/JavaScript animations frame-by-frame.
*   **Performance Monitoring:** Measuring key web performance metrics.

The framework uses simple command-line execution and a centralized configuration file, making it adaptable to various web development projects.

## Features ✨

*   **Component-Based Visual Testing:**
    *   Captures screenshots of specific UI components identified by stable CSS selectors.
    *   Performs pixel-level comparison between baseline and test screenshots using `pixelmatch`.
    *   Highlights visual differences in a dedicated "diff" image output.
    *   Detects significant dimension mismatches between component renderings.
    *   Generates detailed HTML reports with side-by-side image comparisons, difference percentages, and baseline HTML structure capture for easier debugging.
*   **Animation Recording & Comparison:**
    *   Records animation sequences triggered by configurable actions (e.g., hover, click, scroll, page load).
    *   Captures frames at a defined interval for both baseline and test sites.
    *   Generates comparison GIFs for easy visual inspection (**Requires ImageMagick v7+**).
    *   Produces an HTML report showing baseline and test GIFs side-by-side for direct comparison.
*   **Web Performance Testing:**
    *   Measures key performance metrics: Load Time, DOM Content Loaded (DCL), First Contentful Paint (FCP), Resource Count, Total Resource Size using standard browser Performance APIs.
    *   Compares metrics between the baseline and test sites.
    *   Generates comprehensive HTML reports with comparison tables and charts visualizing performance differences.
    *   Saves raw performance data in JSON format for potential further analysis.
*   **Configurable:**
    *   Easily configure baseline/test URLs, viewports, component selectors, comparison thresholds, animation timings, and more via a central `tests/config.js` file.
    *   Supports multiple standard viewports (desktop, tablet, mobile) out-of-the-box.
*   **Command-Line Driven:** Simple execution of different test types via standard `node` commands.
*   **Clear Reporting:** Generates easy-to-understand, self-contained HTML reports for each test type, stored locally within the project structure.

## Project Structure

The framework is organized within its dedicated directory:

```
Visual_Web_Testing_Framework/  # <-- Root folder for this framework
│
├── setup.js           # Initialization script (run first after install)
├── package.json       # Project dependencies & devDependencies
├── package-lock.json # Locked dependency versions
├── README.md         # This file (main documentation)
├── .gitignore        # Git ignore rules for this framework
├── .eslintrc.js      # ESLint configuration file (if included)
│
├── tests/             # Contains all test logic, config, and output directories
│   │
│   ├── config.js          # Main configuration (URLs, viewports, selectors)
│   ├── component-test.js   # Visual regression testing script
│   ├── animation-test.js  # Animation comparison script
│   └── performance-test.js # Performance metrics script
│   │
│   ├── screenshots/     # (Ignored by .gitignore) Stores test image outputs
│   │   ├── baseline/      # Baseline reference images
│   │   ├── test/          # Images from the site under test
│   │   └── diff/          # Generated difference images
│   │
│   ├── components/      # (Ignored by .gitignore) Stores baseline HTML snippets
│   │
│   ├── animations/      # (Ignored by .gitignore) Stores animation frames and GIFs
│   │
│   ├── reports/         # (Ignored by .gitignore) Stores generated HTML reports
│   │
│   └── performance/     # (Ignored by .gitignore) Stores raw JSON performance data
│
└── node_modules/      # (Ignored by .gitignore) Installed Node.js packages
```

## Prerequisites

Before using the framework, ensure you have the following installed on your system:

1.  **Node.js:** An LTS version (e.g., 18.x, 20.x or later) is recommended. Node.js includes `npm`. Download from [nodejs.org](https://nodejs.org/).
2.  **npm:** Node Package Manager (comes bundled with Node.js). Used for installing dependencies.
3.  **ImageMagick (v7+ Strongly Recommended):** Required **only** for GIF generation by the Animation Testing script (`animation-test.js`). Ensure the `magick` command-line tool is installed and accessible in your system's PATH. Download from [imagemagick.org](https://imagemagick.org/). *Note: Frame capture will still function without ImageMagick, but GIF creation will be skipped, and relevant warnings will appear in the console output.*

## Setup Instructions

1.  **Obtain Project Files:** Clone the repository containing this framework or download the `Visual_Web_Testing_Framework` directory.
2.  **Navigate to Framework Directory:**
    Open your terminal and change the current directory to this project's root folder.
    ```bash
    cd path/to/Visual_Web_Testing_Framework
    ```

3.  **Install Dependencies:**
    Install the required Node.js packages (including development tools like ESLint if present) listed in `package.json`.
    ```bash
    npm install
    ```

4.  **Run Initial Setup Script:**
    Execute the setup script. This creates the necessary output directory structure (e.g., `tests/screenshots`, `tests/reports`) and generates a default `tests/config.js` file if one doesn't already exist.
    ```bash
    node setup.js
    ```

5.  **❗ Configure `tests/config.js`:**
    **This is a crucial step!** Open the `tests/config.js` file. You **must** update the placeholder values and add your specific test targets:
    *   `baselineUrl`: Set this to the URL of your reference website or server (e.g., `https://your-production-site.com`).
    *   `testUrl`: Set this to the URL of the website version you are testing (e.g., your local development server `http://localhost:3000`).
    *   `components`: **Define the components** you want to test visually by adding configuration objects to this array (see Configuration section below for details). The default file contains commented-out examples.
    *   Review other settings (`threshold`, `viewports`, etc.) and adjust as necessary for your project's needs.

## Configuration (`tests/config.js`)

Test parameters are controlled via the `tests/config.js` file. Key options include:

*   `baselineUrl` (String): URL for the reference site.
*   `testUrl` (String): URL for the site under test.
*   `viewports` (Array): Define screen sizes. Requires objects with `{ name: String, width: Number, height: Number }`.
*   `defaultViewport` (String): The `name` of the viewport used if not specified via CLI argument.
*   `threshold` (Number): Pixelmatch sensitivity for visual tests (0.0 to 1.0, lower = stricter, e.g., 0.1).
*   `sizeDifferenceTolerance` (Number): Max allowed pixel difference in component dimensions before flagging a size mismatch error.
*   `components` (Array): Define components for visual and/or animation tests. Each object requires:
    *   `name` (String): Unique identifier (used in CLI and filenames).
    *   `selector` (String): **Stable CSS selector** (prefer IDs, `data-test-*` attributes) to locate the element. Avoid brittle selectors based on auto-generated classes.
    *   `interactiveTest` (String | null): Optional. Used to signal animation tests (set to `'animation'`).
    *   `animationTrigger` (String | null): Optional. If `interactiveTest` is `'animation'`, specifies the trigger (`'load'`, `'hover'`, `'click'`, `'scroll'`).
*   `animationDuration` (Number): Milliseconds duration for animation recording.
*   `animationFrameInterval` (Number): Milliseconds interval between capturing animation frames.
*   `animationScreenshotScope` (String): Scope for animation frames: `'viewport'` or `'component'`.
*   `performanceWaitUntil` (String): Puppeteer page load event to wait for in performance tests (e.g., `'load'`, `'networkidle2'`).

## Usage (Running Tests)

Execute tests using Node.js from your terminal, ensuring you are in the root `Visual_Web_Testing_Framework/` directory.

**1. Visual Component Testing:**

```bash
node tests/component-test.js <ComponentName> [ViewportName]
```

*   `<ComponentName>`: (Required) The `name` of a component defined in `tests/config.js`.
*   `[ViewportName]`: (Optional) The `name` of a viewport from `tests/config.js` (e.g., `mobile`). Defaults to `config.defaultViewport`.

**Example:**
```bash
# Test 'mainNav' component using the default viewport
node tests/component-test.js mainNav

# Test 'loginForm' component using the 'mobile' viewport
node tests/component-test.js loginForm mobile
```

**2. Animation Comparison Testing:**

```bash
node tests/animation-test.js <ComponentName> [TriggerAction] [ViewportName]
```

*   `<ComponentName>`: (Required) The `name` of the component.
*   `[TriggerAction]`: (Optional) Trigger action (`hover`, `click`, `scroll`, `load`). Defaults to `hover` unless overridden by `animationTrigger` in config.
*   `[ViewportName]`: (Optional) Viewport name. Defaults to `config.defaultViewport`.

**Example:**
```bash
# Record 'heroBanner' animation triggered on load (default viewport)
node tests/animation-test.js heroBanner load

# Record 'productCard' animation triggered on hover using 'tablet' viewport
node tests/animation-test.js productCard hover tablet
```

**3. Performance Testing:**

```bash
node tests/performance-test.js [ViewportName]
```

*   `[ViewportName]`: (Optional) Viewport name. Defaults to `config.defaultViewport`.

**Example:**
```bash
# Run performance tests using the 'desktop' viewport
node tests/performance-test.js desktop
```

## Test Output

Test results and artifacts are generated within the `tests/` subdirectories. These directories are intended to be ignored by version control (handled by the `.gitignore` file):

*   `tests/screenshots/baseline/`: Baseline images used for visual comparison.
*   `tests/screenshots/test/`: Images captured from the test URL.
*   `tests/screenshots/diff/`: Images highlighting pixel differences (generated only when differences > 0 are found).
*   `tests/components/`: Stores captured HTML structure of baseline components (can be helpful for debugging visual differences).
*   `tests/animations/`: Contains captured animation frames (`...-frames/`) and generated comparison GIFs (if ImageMagick is available and successful).
*   `tests/reports/`: Contains generated HTML reports for each test run. **Open these files in your web browser to view detailed visual results and performance metrics.**
*   `tests/performance/`: Contains raw performance data in JSON format generated by performance tests.

## Troubleshooting

*   **Browser Launch Issues:** Errors mentioning Chromium downloads, sandboxes, or missing shared libraries might require Puppeteer launch flags. Edit the `puppeteer.launch({ ... })` options in the `*.test.js` files and add relevant flags like `args: ['--no-sandbox', '--disable-setuid-sandbox']`. Consult Puppeteer's documentation for environment-specific troubleshooting.
*   **Selector Issues (`waitForSelector` timeout):**
    *   Verify selectors in `tests/config.js` are accurate and target elements present on both baseline and test pages (unless intentionally testing element absence).
    *   Prioritize stable selectors (unique IDs, `data-test-*` attributes). Avoid selectors reliant on dynamic or auto-generated CSS class names.
    *   If elements load slowly, consider increasing the `timeout` value (in milliseconds) for `page.waitForSelector` calls in the test scripts.
*   **Animation GIF Failures:** Confirm ImageMagick v7+ is installed and the `magick` command is in your system's PATH. The script currently executes `magick -delay...`. Check console output for errors from the `exec` call. If ImageMagick isn't found, warnings will be logged, but frame capture may still complete.
*   **Performance Metric Variability (`N/A` or Fluctuations):**
    *   Web performance can vary. Run tests multiple times or against stable environments for more reliable data.
    *   First Contentful Paint (FCP) might not be reported on very simple static pages. Check the console for `⚠️ FCP metric not available` warnings.
    *   Refer to the generated HTML performance report for specific error messages if metrics consistently fail.

## Future Enhancements (Ideas)

*   Integrate a Node.js GIF generation library (e.g., `gifencoder`) to remove the external ImageMagick dependency.
*   Expand testing capabilities to include more complex user interactions (e.g., form submissions, validating multi-step user flows).
*   Wrap tests within a dedicated test runner framework (e.g., Jest, Mocha, Playwright Test) for better test organization, execution control, and aggregated reporting.
*   Add options for automatically uploading reports and artifacts to cloud storage or CI/CD platforms.
*   Refine error handling and reporting for more granular failure diagnosis.
*   Allow viewport-specific selectors or test parameters within the component configuration in `tests/config.js`.
