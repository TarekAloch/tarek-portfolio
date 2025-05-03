// component-test.js
// Purpose: Performs visual regression testing for individual UI components.
//          Captures screenshots of a component from baseline and test URLs,
//          compares them visually using pixelmatch, and generates an HTML report.
// Usage: node tests/component-test.js <componentName> [viewportName]
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const chalk = require('chalk');
const { default: pixelmatch } = require('pixelmatch'); // Note: Ensure pixelmatch is correctly imported
const { PNG } = require('pngjs');
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
  return config.viewports.find(vp => vp.name === name) || config.viewports.find(vp => vp.name === config.defaultViewport);
}

// --- Main Test Function ---

/**
 * Tests a single component by comparing screenshots from baseline and test URLs.
 * @param {string} componentName - The name of the component (must match a key in config.components).
 * @param {string} [viewportName=config.defaultViewport] - The name of the viewport to use.
 */
async function testComponent(componentName, viewportName = config.defaultViewport) {
  const startTime = new Date(); // Record start time for the report
  const component = config.components.find(c => c.name === componentName);
  if (!component) {
    console.error(chalk.red(`Error: Component "${componentName}" not found in tests/config.js`));
    process.exitCode = 1; // Indicate failure
    return;
  }

  const viewport = getViewport(viewportName);
  console.log(chalk.blue(`▶️ Testing component: ${chalk.bold(componentName)} at ${viewport.name} (${viewport.width}x${viewport.height})`));

  let browser;
  let page;

  // Structure to hold test results
  const results = {
    baseline: { found: false, path: null, htmlPath: null, box: null, label: "Baseline" }, // Renamed from 'original'
    test: { found: false, path: null, box: null, label: "Test" },                           // Renamed from 'astro'
    diffPath: null,
    mismatchedPixels: -1, // -1 indicates comparison not performed or failed
    mismatchPercentage: -1,
    sizeMismatch: false,
    error: null,
  };

  const timestamp = startTime.toISOString().replace(/[:.]/g, '-'); // Consistent timestamp for related files
  const fileSuffix = `${componentName}-${viewport.name}-${timestamp}`;

  // Define output paths using sanitized directory names
  const baselineImgPath = path.join(__dirname, `screenshots/baseline/${fileSuffix}.png`);
  const testImgPath = path.join(__dirname, `screenshots/test/${fileSuffix}.png`);
  const diffImgPath = path.join(__dirname, `screenshots/diff/${fileSuffix}.png`);
  const baselineHtmlPath = path.join(__dirname, `components/baseline-${componentName}.html`); // For baseline HTML structure
  const reportPath = path.join(__dirname, `reports/component-${componentName}-${viewport.name}-${timestamp}.html`);

  try {
    browser = await puppeteer.launch({ headless: 'new' });
    page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height });

    // --- Capture Baseline ---
    console.log(chalk.yellow(`\n  Loading ${results.baseline.label} URL: ${config.baselineUrl}`));
    try {
      await page.goto(config.baselineUrl, { waitUntil: 'networkidle2', timeout: 30000 });
      // Small delay can sometimes help ensure rendering completes after network idle
      await new Promise(resolve => setTimeout(resolve, 500));
      await page.waitForSelector(component.selector, { visible: true, timeout: 15000 }); // Wait for element visibility
      const baselineElement = await page.$(component.selector);

      if (baselineElement) {
        results.baseline.box = await baselineElement.boundingBox();
        // Ensure the bounding box is valid before taking a screenshot
        if (results.baseline.box && results.baseline.box.width > 0 && results.baseline.box.height > 0) {
          await baselineElement.screenshot({ path: baselineImgPath }); // clip option removed, screenshot targets element directly
          results.baseline.found = true;
          results.baseline.path = baselineImgPath;
          console.log(chalk.green(`  ✓ Captured ${results.baseline.label} ${componentName} (${results.baseline.box.width}x${results.baseline.box.height})`));

          // Capture baseline HTML structure for debugging aid
          const baselineHTML = await page.evaluate((sel) => {
            // eslint-disable-next-line no-undef
            const el = document.querySelector(sel);
            return el ? el.outerHTML : null;
          }, component.selector);
          if (baselineHTML) {
            await fs.writeFile(baselineHtmlPath, baselineHTML);
            results.baseline.htmlPath = baselineHtmlPath;
            console.log(chalk.cyan(`    Saved baseline HTML structure: ${path.relative(process.cwd(), baselineHtmlPath)}`));
          } else {
            console.warn(chalk.yellow(`  ⚠️ Could not capture HTML for ${componentName} on ${results.baseline.label}.`));
          }
        } else {
          console.warn(chalk.yellow(`  ⚠️ Could not get valid bounding box for ${componentName} on ${results.baseline.label} site.`));
        }
      } else {
        console.warn(chalk.yellow(`  ⚠️ Component ${componentName} (${component.selector}) not found on ${results.baseline.label} site.`));
      }
    } catch (err) {
      console.error(chalk.red(`\n  Error processing ${results.baseline.label} site for ${componentName}: ${err.message}`));
      results.error = `${results.baseline.label} site error: ${err.message}`;
      // Optionally log stack trace for more detail: console.error(err.stack);
    }

    // --- Capture Test ---
    // Only proceed if baseline capture didn't have a critical error
    if (!results.error || results.error.startsWith('Baseline site error:')) {
        console.log(chalk.yellow(`\n  Loading ${results.test.label} URL: ${config.testUrl}`));
        try {
            await page.goto(config.testUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 500)); // Similar delay for consistency
            await page.waitForSelector(component.selector, { visible: true, timeout: 15000 });
            const testElement = await page.$(component.selector);

            if (testElement) {
                results.test.box = await testElement.boundingBox();
                if (results.test.box && results.test.box.width > 0 && results.test.box.height > 0) {
                    await testElement.screenshot({ path: testImgPath });
                    results.test.found = true;
                    results.test.path = testImgPath;
                    console.log(chalk.green(`  ✓ Captured ${results.test.label} ${componentName} (${results.test.box.width}x${results.test.box.height})`));
                } else {
                    console.warn(chalk.yellow(`  ⚠️ Could not get valid bounding box for ${componentName} on ${results.test.label} site.`));
                }
            } else {
                console.warn(chalk.yellow(`  ⚠️ Component ${componentName} (${component.selector}) not found on ${results.test.label} site.`));
            }
        } catch (err) {
            console.error(chalk.red(`\n  Error processing ${results.test.label} site for ${componentName}: ${err.message}`));
             // Append or set error, prioritizing baseline error if both occurred
            results.error = (results.error ? results.error + '; ' : '') + `${results.test.label} site error: ${err.message}`;
        }
    }


    // --- Compare Results ---
    if (results.baseline.found && results.test.found && results.baseline.box && results.test.box) {
      console.log(chalk.cyan(`\n  Comparing ${componentName} images...`));
      const { box: baselineBox } = results.baseline;
      const { box: testBox } = results.test;

      // 1. Check for significant size differences first
      const widthDiff = Math.abs(baselineBox.width - testBox.width);
      const heightDiff = Math.abs(baselineBox.height - testBox.height);

      if (widthDiff > config.sizeDifferenceTolerance || heightDiff > config.sizeDifferenceTolerance) {
        results.sizeMismatch = true;
        console.error(chalk.red(`  ❌ Component ${componentName} size mismatch!`));
        console.log(chalk.red(`     Baseline: ${baselineBox.width}x${baselineBox.height}, Test: ${testBox.width}x${testBox.height}`));
        results.error = (results.error ? results.error + '; ' : '') + `Component size mismatch detected.`;
      } else {
        // 2. Perform pixel comparison if sizes are within tolerance
        try {
          const baselinePng = PNG.sync.read(await fs.readFile(baselineImgPath));
          const testPng = PNG.sync.read(await fs.readFile(testImgPath));
          const { width, height } = baselinePng; // Use baseline dimensions as reference
          const diff = new PNG({ width, height });

          // Ensure test image dimensions match baseline before comparing
          // This should generally be true if sizeDifferenceTolerance passed, but it's a safeguard.
          if (testPng.width !== width || testPng.height !== height) {
            console.warn(chalk.yellow(`  ⚠️ Image dimensions differ slightly despite passing size check (${width}x${height} vs ${testPng.width}x${testPng.height}). Comparison might be less accurate.`));
            // Potential place to add image resizing logic if needed, e.g., using 'jimp'.
            // However, it's often better to fix the component rendering to match dimensions.
          }

          results.mismatchedPixels = pixelmatch(
            baselinePng.data,
            testPng.data,
            diff.data,
            width,
            height,
            { threshold: config.threshold } // Use threshold from config
          );

          results.mismatchPercentage = (results.mismatchedPixels / (width * height)) * 100;

          if (results.mismatchedPixels > 0) {
             await fs.writeFile(diffImgPath, PNG.sync.write(diff));
             results.diffPath = diffImgPath;
             // Use a higher threshold to distinguish minor vs significant visual difference reporting
             const SIGNIFICANT_DIFF_THRESHOLD = 1.0; // Example: Report > 1% as significant error
             if (results.mismatchPercentage > SIGNIFICANT_DIFF_THRESHOLD) {
                 console.error(chalk.red(`  ❌ Component ${componentName} has significant visual differences: ${results.mismatchPercentage.toFixed(2)}% (${results.mismatchedPixels} pixels)`));
             } else {
                  console.log(chalk.yellow(`  ⚠️ Component ${componentName} has minor visual differences: ${results.mismatchPercentage.toFixed(2)}% (${results.mismatchedPixels} pixels)`));
             }
          } else {
            console.log(chalk.green(`  ✓ Component ${componentName} matches visually.`));
          }
        } catch (compareError) {
          console.error(chalk.red(`\n  Error comparing images for ${componentName}: ${compareError.message}`));
          results.error = (results.error ? results.error + '; ' : '') + `Image comparison error: ${compareError.message}`;
        }
      }
    } else if (!results.baseline.found || !results.test.found) {
      console.error(chalk.red(`\n  ❌ Cannot perform visual comparison for ${componentName}: component not found on both sites.`));
       results.error = (results.error ? results.error + '; ' : '') + `Component not found on both sites.`;
    }

  } catch (error) {
    console.error(chalk.red(`\nUnhandled error during component test for ${componentName}:`), error);
    results.error = `Unhandled test error: ${error.message}`;
  } finally {
    // Ensure page and browser are closed
    if (page && !page.isClosed()) {
        await page.close();
    }
    if (browser) {
      await browser.close();
    }
  }

  // --- Generate HTML Report ---
  console.log(chalk.blue("\nGenerating HTML report..."));
  try {
    // Use relative paths for images and potentially HTML snippets in the report
    const baselineImgRelative = results.baseline.path ? path.relative(path.dirname(reportPath), results.baseline.path) : null;
    const testImgRelative = results.test.path ? path.relative(path.dirname(reportPath), results.test.path) : null;
    const diffImgRelative = results.diffPath ? path.relative(path.dirname(reportPath), results.diffPath) : null;
    // eslint-disable-next-line no-unused-vars
    const baselineHtmlRelative = results.baseline.htmlPath ? path.relative(path.dirname(reportPath), results.baseline.htmlPath) : null;

    // Helper to read HTML content safely
    let baselineHtmlContent = 'Baseline HTML not captured or file not found.';
    if (results.baseline.htmlPath && await fs.pathExists(results.baseline.htmlPath)) {
        try {
           baselineHtmlContent = await fs.readFile(results.baseline.htmlPath, 'utf8');
           // Basic escaping for display in <pre><code> block
           baselineHtmlContent = baselineHtmlContent.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
        } catch(htmlReadError) {
            console.error(`Error reading baseline HTML file: ${htmlReadError.message}`);
            baselineHtmlContent = `Error reading baseline HTML file: ${htmlReadError.message}`;
        }
    }

    const reportHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Component Test Report: ${componentName} (${viewport.name})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; line-height: 1.6; padding: 20px; color: #333; }
    .container { max-width: 1800px; margin: 0 auto; }
    h1, h2 { border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 16px; }
    .comparison { display: flex; flex-wrap: wrap; gap: 20px; border-bottom: 1px solid #eee; padding-bottom: 20px; margin-bottom: 20px; }
    .image-container { border: 1px solid #ccc; padding: 15px; background: #f9f9f9; border-radius: 4px; flex: 1; min-width: 300px; max-width: 32%; box-sizing: border-box; }
    .image-container img { max-width: 100%; height: auto; display: block; border: 1px solid #eee; }
    .image-container h2 { margin-top: 0; font-size: 1.1em; }
    .stats { background: #f0f0f0; padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 25px; font-size: 0.95em; }
    .stats p { margin: 8px 0; }
    .stats code { background: #e0e0e0; padding: 2px 5px; border-radius: 3px; font-family: Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace; }
    .label { font-weight: bold; color: #555; min-width: 120px; display: inline-block;}
    .error { color: #d32f2f; font-weight: bold; background: #ffebee; padding: 2px 6px; border-radius: 3px;}
    .warning { color: #ffa000; font-weight: bold; background: #fff8e1; padding: 2px 6px; border-radius: 3px; }
    .success { color: #388e3c; font-weight: bold; background: #e8f5e9; padding: 2px 6px; border-radius: 3px;}
    .html-output { margin-top: 20px; border: 1px solid #ddd; border-radius: 4px; }
    .html-output h2 { margin: 0; padding: 10px 15px; background: #f0f0f0; border-bottom: 1px solid #ddd; font-size: 1.1em;}
    .html-output pre { background: #2d2d2d; color: #ccc; padding: 15px; margin: 0; border-radius: 0 0 3px 3px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; max-height: 400px; font-family: Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace; font-size: 0.9em; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Component Test Report</h1>
    <div class="stats">
      <p><span class="label">Component:</span> ${componentName}</p>
      <p><span class="label">Selector:</span> <code>${component.selector}</code></p>
      <p><span class="label">Viewport:</span> ${viewport.name} (${viewport.width}x${viewport.height})</p>
      <p><span class="label">Timestamp:</span> ${startTime.toLocaleString()}</p>
      <p><span class="label">Baseline Size:</span> ${results.baseline.box ? `${results.baseline.box.width}x${results.baseline.box.height}` : 'N/A'}</p>
      <p><span class="label">Test Size:</span> ${results.test.box ? `${results.test.box.width}x${results.test.box.height}` : 'N/A'}</p>
      ${results.error ? `<p><span class="label">Status:</span> <span class="error">Error: ${results.error}</span></p>` : ''}
      ${results.sizeMismatch ? `<p><span class="label">Status:</span> <span class="error">Size Mismatch Detected!</span></p>` : ''}
      ${results.mismatchedPixels > 0 && !results.sizeMismatch ? `<p><span class="label">Visual Diff:</span> <span class="${results.mismatchPercentage > 1.0 ? 'error' : 'warning'}">${results.mismatchPercentage.toFixed(2)}% (${results.mismatchedPixels} pixels)</span></p>` : ''}
      ${results.mismatchedPixels === 0 && !results.sizeMismatch && results.baseline.found && results.test.found && !results.error ? `<p><span class="label">Status:</span> <span class="success">Components Match Visually</span></p>` : ''}
      ${results.mismatchedPixels === -1 && !results.sizeMismatch && !results.error && (!results.baseline.found || !results.test.found) ? '<p><span class="label">Status:</span> <span class="warning">Comparison N/A (component not found on both sites)</span></p>' : ''}
    </div>

    <div class="comparison">
      <div class="image-container">
        <h2>Baseline Image</h2>
        ${baselineImgRelative ? `<img src="${baselineImgRelative}" alt="Baseline ${componentName}">` : '<p class="error">Not Found/Captured</p>'}
      </div>
      <div class="image-container">
        <h2>Test Image</h2>
        ${testImgRelative ? `<img src="${testImgRelative}" alt="Test ${componentName}">` : '<p class="error">Not Found/Captured</p>'}
      </div>
      <div class="image-container">
        <h2>Difference</h2>
        ${diffImgRelative ? `<img src="${diffImgRelative}" alt="Difference between Baseline and Test">` : (results.baseline.found && results.test.found && !results.sizeMismatch && results.mismatchedPixels === 0 ? '<p class="success">No visual difference detected.</p>' : '<p class="warning">Diff image not generated (no difference, size mismatch, or error occurred).</p>')}
      </div>
    </div>

    ${results.baseline.htmlPath ? `
    <div class="html-output">
      <h2>Baseline HTML Structure</h2>
      <pre><code>${baselineHtmlContent}</code></pre>
      <p style="font-size: 0.8em; text-align: right; padding: 5px 15px; color: #777;">(Captured from baseline site for debugging)</p>
    </div>
    ` : ''}
  </div>
</body>
</html>`;
    await fs.writeFile(reportPath, reportHTML);
    console.log(chalk.green(`📊 Report generated: ${path.relative(process.cwd(), reportPath)}`));
  } catch (reportError) {
    console.error(chalk.red('Error generating HTML report:'), reportError);
    process.exitCode = 1; // Indicate failure
  }
}

// --- Command-Line Interface (CLI) Execution ---
if (require.main === module) {
  const componentNameArg = process.argv[2];
  const viewportNameArg = process.argv[3]; // Optional viewport name

  if (!componentNameArg) {
    console.error(chalk.red('Error: Please provide a component name defined in tests/config.js'));
     if (config?.components?.length > 0) {
         console.log(chalk.yellow('Available components:', config.components.map(c => c.name).join(', ') || 'None configured'));
    } else {
         console.log(chalk.yellow('No components found in config.js'));
    }
    console.log(chalk.cyan('\nUsage: node tests/component-test.js <ComponentName> [ViewportName]'));
    console.log(chalk.cyan('Example: node tests/component-test.js mainNav desktop'));
    console.log(chalk.cyan('Example: node tests/component-test.js loginForm mobile\n'));
    process.exit(1);
  }

  testComponent(componentNameArg, viewportNameArg)
    .then(() => {
      console.log(chalk.blue(`\n✅ Component testing process finished for ${componentNameArg}.`));
      if (process.exitCode !== 1) {
          process.exitCode = 0;
      }
    })
    .catch(err => {
      console.error(chalk.red(`\n❌ Component testing process failed for ${componentNameArg}:`), err);
      process.exitCode = 1;
    });
}

// Export for potential programmatic use
module.exports = { testComponent };