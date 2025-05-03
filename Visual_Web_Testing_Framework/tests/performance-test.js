// performance-test.js
// Purpose: Measures key web performance metrics (load time, FCP, DOMContentLoaded, resources)
//          for baseline and test URLs and generates a comparative HTML report with charts.
// Usage: node tests/performance-test.js [viewportName]
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const chalk = require('chalk');
const path = require('path');
const config = require('./config'); // Load configuration

// --- Helper Functions ---

/**
 * Gets the viewport configuration object by name.
 * Falls back to the default viewport specified in config.js.
 * @param {string} name - The name of the viewport (e.g., 'desktop').
 * @returns {object} The viewport object { name, width, height }.
 */
function getViewport(name) {
  // Ensures config and viewports array exist, falling back to a default if necessary
  const viewports = config?.viewports || [{ name: 'desktop', width: 1280, height: 800 }]; // Default if config missing
  const defaultViewportName = config?.defaultViewport || 'desktop';
  return viewports.find(vp => vp.name === name) || viewports.find(vp => vp.name === defaultViewportName) || viewports[0]; // Final fallback
}

/**
 * Navigates to a URL and gathers key performance metrics using Puppeteer.
 * @param {object} page - The Puppeteer page object.
 * @param {string} url - The URL to test.
 * @param {string} [waitUntil='load'] - The page load event to wait for (e.g., 'load', 'networkidle2').
 * @returns {Promise<object>} An object containing performance metrics or an error message.
 */
async function getPerformanceMetrics(page, url, waitUntil = 'load') {
  const metrics = {
    loadTime: null,             // Time until specified waitUntil event fires
    domContentLoaded: null,     // Time until DOMContentLoaded event fires
    firstContentfulPaint: null, // Time until the first content is painted
    resourceCount: 0,           // Total number of resources loaded
    totalResourceSizeKB: 0,     // Total size of loaded resources (transfer size)
    error: null
  };

  try {
    // Disable cache for accurate measurement on fresh loads
    await page.setCacheEnabled(false);

    const navigationStartTime = Date.now();
    // Navigate to the page and wait for the specified condition
    await page.goto(url, {
      // Use configured value or fallback to default 'load'
      waitUntil: waitUntil || config.performanceWaitUntil || 'load',
      timeout: 45000 // Generous timeout for potentially slow loads
    });
    metrics.loadTime = Date.now() - navigationStartTime; // Record time until waitUntil condition met

    // --- Use browser's Performance API for more detailed metrics ---

    // Get Navigation Timing metrics safely
    const timing = await page.evaluate(() => JSON.stringify(performance?.timing)); // Add optional chaining
    if (!timing) throw new Error("performance.timing API not available or returned null.");
    const navTiming = JSON.parse(timing);
    const navStart = navTiming.navigationStart;

    if (navStart > 0 && navTiming.domContentLoadedEventEnd > 0) { // Ensure values are valid
      metrics.domContentLoaded = navTiming.domContentLoadedEventEnd - navStart;
    } else {
      console.warn(chalk.yellow(`  ⚠️ DOMContentLoaded metric unavailable for ${url}.`));
    }

    // Get First Contentful Paint (FCP) safely
    const fcpStartTime = await page.evaluate(() => {
      // Check if performance and getEntriesByType exist
      if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
          return null;
      }
      const paintEntry = performance.getEntriesByType('paint').find(entry => entry.name === 'first-contentful-paint');
      return paintEntry ? paintEntry.startTime : null; // Return startTime directly or null if not found
    });

    if (fcpStartTime !== null && fcpStartTime >= 0) { // Ensure FCP time is valid
      metrics.firstContentfulPaint = Math.round(fcpStartTime);
    } else {
      // Use console.warn for clarity in logs
      console.warn(chalk.yellow(`  ⚠️ FCP metric not available for ${url}. Simple page or browser timing issue?`));
      // --- Alternative Metric Consideration ---
      // If FCP is consistently unavailable, Time to First Byte (TTFB) could be used as a fallback indicator.
      // Example: TTFB = navTiming.responseStart - navStart;
      // metrics.firstContentfulPaint = (navStart && navTiming.responseStart) ? (navTiming.responseStart - navStart) : null;
    }

    // Get resource loading information safely
    const resources = await page.evaluate(() => {
         if (typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') {
            return []; // Return empty array if API not available
         }
         return performance.getEntriesByType('resource').map(r => ({
            name: r.name,
            size: r.transferSize || 0, // Use transferSize if available (actual bytes over network)
            type: r.initiatorType
         }));
    });
    metrics.resourceCount = resources.length;
    metrics.totalResourceSizeKB = resources.reduce((sum, resource) => sum + resource.size, 0) / 1024;

  } catch (err) {
    metrics.error = `Failed to load or gather metrics: ${err.message}`;
    console.error(chalk.red(`  Error gathering performance for ${url}: ${err.message}`));
    // Optionally log stack for debugging: console.error(err.stack);
  }
  return metrics;
}


// --- Main Test Function ---

/**
 * Runs performance tests on baseline and test URLs for a given viewport.
 * @param {string} [viewportName=config.defaultViewport] - The name of the viewport configuration to use.
 */
async function testPerformance(viewportName = config.defaultViewport) {
  const viewport = getViewport(viewportName); // Use helper to get viewport config
  console.log(chalk.blue(`▶️ Starting performance testing at ${viewport.name} (${viewport.width}x${viewport.height})...`));

  let browser;
  const results = {
    timestamp: new Date().toISOString(),
    viewport: viewport,
    baseline: null, // Stores baseline metrics object
    test: null,     // Stores test metrics object
  };

  // Generate paths for report and raw data files
  const timestampFile = results.timestamp.replace(/[:.]/g, '-');
  const reportPath = path.join(__dirname, `reports/performance-${viewport.name}-${timestampFile}.html`);
  const rawDataPath = path.join(__dirname, `performance/results-${viewport.name}-${timestampFile}.json`);

  try {
    browser = await puppeteer.launch({ headless: 'new' });

    // --- Test Baseline Site ---
    console.log(chalk.yellow(`\n  Testing Baseline performance: ${config.baselineUrl}`));
    const baselinePage = await browser.newPage();
    await baselinePage.setViewport({ width: viewport.width, height: viewport.height });
    results.baseline = await getPerformanceMetrics(baselinePage, config.baselineUrl, config.performanceWaitUntil);
    await baselinePage.close();

    // --- Test Site Under Test ---
    console.log(chalk.yellow(`\n  Testing Test performance: ${config.testUrl}`));
    const testPage = await browser.newPage();
    await testPage.setViewport({ width: viewport.width, height: viewport.height });
    results.test = await getPerformanceMetrics(testPage, config.testUrl, config.performanceWaitUntil);
    await testPage.close();

    // --- Generate Comparison Report ---
    console.log(chalk.blue('\nGenerating performance report...'));
    // Pass validated results to report generator
    await generatePerformanceReport(results, reportPath, rawDataPath);

  } catch (error) {
    console.error(chalk.red('\nError during performance testing run:'), error);
    process.exitCode = 1; // Indicate failure
  } finally {
    if (browser) {
      await browser.close();
    }
  }
  return results; // Return results object
}

// --- Report Generation Function ---

/**
 * Generates an HTML report comparing performance metrics.
 * @param {object} results - The results object containing baseline and test metrics.
 * @param {string} reportPath - Path to save the HTML report.
 * @param {string} rawDataPath - Path to save the raw JSON results.
 */
async function generatePerformanceReport(results, reportPath, rawDataPath) {
  // Calculate differences safely, handling potential nulls/errors
  const differences = {};
  const metricsToCompare = ['loadTime', 'domContentLoaded', 'firstContentfulPaint', 'resourceCount', 'totalResourceSizeKB'];
  // Check if both baseline and test results exist and are error-free before calculating diffs
  let canCompare = results.baseline && results.test && !results.baseline.error && !results.test.error;

  if (canCompare) {
    metricsToCompare.forEach(metric => {
      const baselineValue = results.baseline[metric];
      const testValue = results.test[metric];
      // Ensure values are valid numbers and baseline is not zero before calculating percentage
      if (typeof baselineValue === 'number' && typeof testValue === 'number' && baselineValue !== 0) {
        differences[metric] = ((baselineValue - testValue) / baselineValue) * 100;
      } else {
        // If comparison isn't possible (e.g., N/A in one), mark difference as null
        differences[metric] = null;
      }
    });
  } else {
      // If comparison isn't possible, ensure differences object reflects this
      metricsToCompare.forEach(metric => { differences[metric] = null; });
  }


  // Helper to format metrics for display, handling null/undefined
  const formatMetric = (value, unit = '') => {
    if (value == null || typeof value !== 'number' || isNaN(value)) return 'N/A'; // Check for null, undefined, NaN
    return `${value.toFixed(unit === 'KB' || unit === '%' ? 2 : 0)}${unit}`;
  };

  // Helper to format the difference column with color coding
  const formatDiff = (diffValue) => {
    if (diffValue == null || isNaN(diffValue)) return 'N/A'; // Check for null, undefined, NaN
    const absDiff = Math.abs(diffValue).toFixed(2);
    // Lower values are generally better for performance metrics
    const isBetter = diffValue > 0;
    const cssClass = isBetter ? 'better' : 'worse';
    const label = isBetter ? 'faster / fewer / smaller' : 'slower / more / larger';
    return `<span class="${cssClass}">${absDiff}% ${label}</span>`;
  };

  // --- HTML Report Template ---
  // (Using the same well-formatted template as before)
  const reportHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Performance Test Report (${results.viewport.name})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; line-height: 1.6; max-width: 1000px; margin: auto; padding: 20px; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    th, td { padding: 12px 15px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f2f2f2; font-weight: 600; white-space: nowrap; }
    td:nth-child(1) { font-weight: 500; } /* Metric name */
    tr:hover { background-color: #f9f9f9; }
    .better { color: #2e7d32; font-weight: 500; } /* Green */
    .worse { color: #c62828; font-weight: 500; } /* Red */
    .chart-container { width: 95%; max-width: 700px; margin: 45px auto; padding: 20px; border: 1px solid #eee; border-radius: 5px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    h1, h2 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 8px; margin-top: 30px; }
    h1 { margin-top: 0;}
    .stats { background: #f0f0f0; padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 25px; font-size: 0.95em; }
    .stats p { margin: 8px 0; }
    .stats strong { color: #555; }
    .error { color: #c62828; font-style: italic; background: #ffebee; padding: 3px 8px; border-radius: 3px; }
    em { font-size: 0.9em; color: #666; }
  </style>
  <!-- Chart.js library (Hosted Locally) -->
  <script src="../vendor/chart.min.js"></script>
</head>
<body>
  <h1>Performance Test Report</h1>
  <div class="stats">
      <p><strong>Viewport:</strong> ${results.viewport.name} (${results.viewport.width}x${results.viewport.height})</p>
      <p><strong>Timestamp:</strong> ${new Date(results.timestamp).toLocaleString()}</p>
      <p><strong>Baseline URL:</strong> ${config.baselineUrl}</p>
      <p><strong>Test URL:</strong> ${config.testUrl}</p>
      ${results.baseline?.error ? `<p class="error">Baseline Site Error: ${results.baseline.error}</p>` : ''}
      ${results.test?.error ? `<p class="error">Test Site Error: ${results.test.error}</p>` : ''}
  </div>

  <h2>Summary Comparison</h2>
  <table>
    <thead>
      <tr>
        <th>Metric</th>
        <th>Baseline</th>
        <th>Test</th>
        <th>Difference (%)</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Load Time <em>(waitUntil: ${config.performanceWaitUntil || 'load'})</em></td>
        <td>${formatMetric(results.baseline?.loadTime, ' ms')}</td>
        <td>${formatMetric(results.test?.loadTime, ' ms')}</td>
        <td>${formatDiff(differences.loadTime)}</td>
      </tr>
      <tr>
        <td>DOM Content Loaded</td>
        <td>${formatMetric(results.baseline?.domContentLoaded, ' ms')}</td>
        <td>${formatMetric(results.test?.domContentLoaded, ' ms')}</td>
        <td>${formatDiff(differences.domContentLoaded)}</td>
      </tr>
      <tr>
        <td>First Contentful Paint (FCP)</td>
        <td>${formatMetric(results.baseline?.firstContentfulPaint, ' ms')}</td>
        <td>${formatMetric(results.test?.firstContentfulPaint, ' ms')}</td>
        <td>${formatDiff(differences.firstContentfulPaint)}</td>
      </tr>
      <tr>
        <td>Resource Count</td>
        <td>${formatMetric(results.baseline?.resourceCount)}</td>
        <td>${formatMetric(results.test?.resourceCount)}</td>
         <td>${formatDiff(differences.resourceCount)}</td>
      </tr>
      <tr>
        <td>Total Resource Size</td>
        <td>${formatMetric(results.baseline?.totalResourceSizeKB, ' KB')}</td>
        <td>${formatMetric(results.test?.totalResourceSizeKB, ' KB')}</td>
         <td>${formatDiff(differences.totalResourceSizeKB)}</td>
      </tr>
    </tbody>
  </table>
  <p><em>Note: Performance metrics can vary between runs. Positive difference % indicates the Test site is faster/smaller/fewer resources. N/A indicates metric could not be captured or compared.</em></p>

  ${canCompare ? `
  <h2>Charts</h2>
  <div class="chart-container">
    <canvas id="timingChart"></canvas>
  </div>
  <div class="chart-container">
    <canvas id="resourceChart"></canvas>
  </div>

  <script>
    try {
      // Timing Chart Data (using nullish coalescing for safety)
      const timingLabels = ['Load Time', 'DOM Content Loaded', 'First Contentful Paint (FCP)'];
      const baselineTimingData = [
        ${results.baseline?.loadTime ?? null},
        ${results.baseline?.domContentLoaded ?? null},
        ${results.baseline?.firstContentfulPaint ?? null}
      ];
      const testTimingData = [
        ${results.test?.loadTime ?? null},
        ${results.test?.domContentLoaded ?? null},
        ${results.test?.firstContentfulPaint ?? null}
      ];

      const timingCtx = document.getElementById('timingChart').getContext('2d');
      new Chart(timingCtx, {
        type: 'bar',
        data: {
          labels: timingLabels,
          datasets: [
            {
              label: 'Baseline (ms)', data: baselineTimingData,
              backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1
            },
            {
              label: 'Test (ms)', data: testTimingData,
              backgroundColor: 'rgba(255, 99, 132, 0.6)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1
            }
          ]
        },
        options: {
          indexAxis: 'y', // Horizontal bars
          plugins: { title: { display: true, text: 'Timing Metrics (Lower is Better)' } },
          scales: { x: { beginAtZero: true, title: { display: true, text: 'Time (ms)' } } }
        }
      });

      // Resource Chart Data
      const resourceLabels = ['Resource Count', 'Total Resource Size (KB)'];
      const baselineResourceData = [
        ${results.baseline?.resourceCount ?? null},
        ${results.baseline?.totalResourceSizeKB?.toFixed(2) ?? null} // Keep toFixed(2) for KB
      ];
      const testResourceData = [
        ${results.test?.resourceCount ?? null},
        ${results.test?.totalResourceSizeKB?.toFixed(2) ?? null} // Keep toFixed(2) for KB
      ];

      const resourceCtx = document.getElementById('resourceChart').getContext('2d');
      new Chart(resourceCtx, {
        type: 'bar',
        data: {
          labels: resourceLabels,
          datasets: [
            {
              label: 'Baseline', data: baselineResourceData,
               backgroundColor: 'rgba(54, 162, 235, 0.6)', borderColor: 'rgba(54, 162, 235, 1)', borderWidth: 1
            },
            {
              label: 'Test', data: testResourceData,
               backgroundColor: 'rgba(255, 99, 132, 0.6)', borderColor: 'rgba(255, 99, 132, 1)', borderWidth: 1
            }
          ]
        },
        options: {
           plugins: { title: { display: true, text: 'Resource Metrics (Lower is Better)' } },
           scales: { y: { beginAtZero: true } }
        }
      });
    } catch (chartError) {
        console.error("Error rendering charts:", chartError);
        // Optionally display an error message in the HTML
        document.body.insertAdjacentHTML('beforeend', '<p class="error">Error rendering charts. Check console.</p>');
    }
  </script>
  ` : '<p>Charts could not be generated due to missing or invalid performance data.</p>'}
</body>
</html>`;

  try {
    // Ensure report and data directories exist before writing
    await fs.ensureDir(path.dirname(reportPath));
    await fs.ensureDir(path.dirname(rawDataPath));

    // Write the HTML report file
    await fs.writeFile(reportPath, reportHTML);
    console.log(chalk.green(`📊 Performance report generated: ${path.relative(process.cwd(), reportPath)}`));

    // Save raw data (using writeJSON for automatic formatting)
    await fs.writeJSON(rawDataPath, results, { spaces: 2 }); // Pretty-print JSON
    console.log(chalk.blue(`💾 Raw performance data saved: ${path.relative(process.cwd(), rawDataPath)}`));
  } catch (writeError) {
    console.error(chalk.red(`Error writing report or raw data file: ${writeError.message}`));
    process.exitCode = 1; // Indicate failure
  }
}

// --- Command-Line Interface (CLI) Execution ---
// Only run if script is executed directly from the command line
if (require.main === module) {
  const viewportNameArg = process.argv[2]; // Optional: specify viewport from CLI

  testPerformance(viewportNameArg)
    .then(results => {
      console.log(chalk.blue(`\n✅ Performance testing process finished.`));
      // Optionally log a quick summary to console if successful and data exists
      if (results?.baseline?.loadTime != null && results?.test?.loadTime != null) {
         console.log(chalk.cyan(`  Summary | Baseline Load: ${results.baseline.loadTime}ms | Test Load: ${results.test.loadTime}ms`));
      }
      // Ensure exit code reflects success if no prior errors set it to 1
      if (process.exitCode !== 1) {
        process.exitCode = 0;
      }
    })
    .catch(err => {
      // Catch unhandled promise rejections from the async function
      console.error(chalk.red(`\n❌ Performance testing process failed:`), err);
      process.exitCode = 1; // Ensure exit code reflects error
    });
}

// Export for potential programmatic use
module.exports = { testPerformance };