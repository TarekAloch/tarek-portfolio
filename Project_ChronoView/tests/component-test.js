// component-test.js
// Purpose: Performs visual regression testing for individual UI components.
//          Compares a current screenshot against a fixed baseline image.
//          Use --update-baseline flag to set the current state as the new baseline.
// Usage: node tests/component-test.js <componentName> [viewportName] [--update-baseline]
'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const chalk = require('chalk');
const { PNG } = require('pngjs');
const pixelmatch_module = require('pixelmatch');
const pixelmatch = pixelmatch_module.default; // Use default export
const path = require('path');
const config = require('./config'); // Load configuration
const { createReport } = require('./report');

// --- Threshold Constants ---
const NOISE_THRESHOLD_PERCENT = 4.0; // Primary diff % above which we trigger secondary check
const SECONDARY_THRESHOLD_PERCENT = 1.0; // Secondary diff % above which we consider it a significant change

// Define path for history file
const historyFilePath = path.join(__dirname, 'screenshots', 'diff_history.json');

// --- Argument Parsing ---
const args = process.argv.slice(2);
const componentNameArg = args.find(arg => !arg.startsWith('--') && isNaN(parseInt(arg))); // Find first non-flag, non-numeric arg
const viewportNameArg = args.find(arg => config.viewports.some(v => v.name === arg)); // Find arg matching a viewport name
const updateBaselineFlag = args.includes('--update-baseline');

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
 * @param {boolean} updateBaseline - Whether to update the baseline image instead of comparing.
 */
async function testComponent(componentName, viewportName = config.defaultViewport, updateBaseline = false) {
  const startTime = new Date(); // Record start time for the report
  const component = config.components.find(c => c.name === componentName);
  if (!component) {
    console.error(chalk.red(`Error: Component "${componentName}" not found in tests/config.js`));
    process.exitCode = 1; // Indicate failure
    return;
  }

  const viewport = getViewport(viewportName);
  const action = updateBaseline ? 'Updating Baseline for' : 'Testing';
  console.log(chalk.blue(`▶️ ${action} component: ${chalk.bold(componentName)} at ${viewport.name} (${viewport.width}x${viewport.height})`));

  let browser;
  let page;

  // Define paths
  const timestamp = startTime.toISOString().replace(/[:.]/g, '-');
  const fixedBaselineFileName = `${componentName}-${viewport.name}-BASELINE.png`;
  const fixedBaselinePath = path.join(__dirname, `screenshots/baseline/${fixedBaselineFileName}`);
  const testImgPath = path.join(__dirname, `screenshots/test/${componentName}-${viewport.name}-${timestamp}.png`);
  const diffImgPath = path.join(__dirname, `screenshots/diff/${componentName}-${viewport.name}-${timestamp}.png`);
  const reportPath = path.join(__dirname, `reports/component-${componentName}-${viewport.name}-${timestamp}.html`);
  // Baseline HTML capture path remains timestamped as it's just debug info for a specific run
  const baselineHtmlPath = path.join(__dirname, `components/${componentName}-${viewport.name}-${timestamp}-debug.html`); 

  // Structure to hold test results (adjusted for fixed baseline logic)
  const results = {
    baseline: { path: fixedBaselinePath, exists: false, box: null, label: "Baseline (Fixed)", mtime: null },
    test: { path: testImgPath, captured: false, box: null, label: "Test (Current)" },
    diffPath: null,
    mismatchedPixels: -1, 
    mismatchPercentage: -1,
    sizeMismatch: false,
    error: null,
  };

  // Initialize variables for Scenario B logic
  let finalStatus = 'unknown';
  let secondaryMismatchPercentage = -1;

  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath: '/usr/bin/chromium-browser',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    page = await browser.newPage();
    await page.setViewport({ width: viewport.width, height: viewport.height });

    // --- Capture Current State ---
    // Build URL with time window parameter
    const baseUrl = updateBaseline ? config.baselineUrl : config.testUrl;
    const timeWindowParam = config.defaultTimeWindowParam || ''; // Use default or empty string
    const urlToLoad = `${baseUrl}${timeWindowParam}`;

    console.log(chalk.yellow(`\n  Loading URL: ${urlToLoad}`));
    try {
      await page.goto(urlToLoad, { waitUntil: 'networkidle2', timeout: 30000 });
      console.log(chalk.cyan('  Waiting 5s for initial page load...'));
      await new Promise(resolve => setTimeout(resolve, 5000));

      // --- Interact with Filters (Namespace only) --- 
      const dropdownSelector = 'div.v-select__slot'; // Revert to simpler selector - assumes namespace is first
      const optionSelector = '::-p-text(~empty)';   
      const closeIconSelector = '.v-select.v-select--is-menu-active .v-input__icon--append .v-icon'; // Generic close icon
      
      console.log(chalk.cyan(`  Clicking namespace dropdown trigger: ${dropdownSelector}`));
      await page.waitForSelector(dropdownSelector, { visible: true, timeout: 10000 });
      await page.click(dropdownSelector);
      
      console.log(chalk.cyan(`  Waiting for and clicking namespace option: ${optionSelector}`));
      await page.waitForSelector(optionSelector, { visible: true, timeout: 10000 });
      await page.click(optionSelector);

      console.log(chalk.cyan(`  Clicking close icon to dismiss dropdown: ${closeIconSelector}`));
      await page.waitForSelector(closeIconSelector, { visible: true, timeout: 5000 });
      await page.click(closeIconSelector); 

      console.log(chalk.cyan('  Waiting 2s for map to redraw after filtering...'));
      await new Promise(resolve => setTimeout(resolve, 2000));

      // --- Time Window Setting REMOVED - Handled by URL Param --- 

      // --- End Interactions ---

      console.log(chalk.cyan(`  Looking for target component: ${component.selector}`));
      await page.waitForSelector(component.selector, { visible: true, timeout: 30000 }); 
      // --- Revert back to Element Screenshot Logic ---
      const currentElement = await page.$(component.selector);

      if (currentElement) {
        const currentBox = await currentElement.boundingBox();
        if (currentBox && currentBox.width > 0 && currentBox.height > 0) {
           if (updateBaseline) {
             // --- Update Baseline Mode (Element) ---
             // Archive existing
             if (await fs.pathExists(fixedBaselinePath)) {
                try {
                    const baselineStats = await fs.stat(fixedBaselinePath);
                    const mtime = baselineStats.mtime.toISOString().replace(/[:.]/g, '-');
                    const archivedBaselineName = `${componentName}-${viewport.name}-BASELINE-archived-${mtime}.png`;
                    const archivedBaselinePath = path.join(__dirname, `screenshots/baseline/${archivedBaselineName}`);
                    await fs.rename(fixedBaselinePath, archivedBaselinePath);
                    console.log(chalk.cyan(`  Archived existing baseline to: ${path.relative(process.cwd(), archivedBaselinePath)}`));
                } catch (archiveError) {
                    console.error(chalk.red(`  ⚠️ Error archiving existing baseline: ${archiveError.message}`));
                }
             }
             // Capture element screenshot
             await currentElement.screenshot({ path: fixedBaselinePath }); 
             results.baseline.exists = true;
             results.baseline.box = currentBox; // Use dimensions from boundingBox
             console.log(chalk.green.bold(`  ✓ Baseline Updated (Element): ${path.relative(process.cwd(), fixedBaselinePath)} (${currentBox.width}x${currentBox.height})`));
              // Optional: Capture HTML structure for debug
             // eslint-disable-next-line no-undef
             const baselineHTML = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.outerHTML : null; }, component.selector);
             if (baselineHTML) {
                await fs.writeFile(baselineHtmlPath, baselineHTML);
                console.log(chalk.cyan(`    Saved baseline update HTML structure: ${path.relative(process.cwd(), baselineHtmlPath)}`));
             }
           } else {
             // --- Comparison Mode (Element) ---
             await currentElement.screenshot({ path: testImgPath }); 
             results.test.captured = true;
             results.test.box = currentBox; // Use dimensions from boundingBox
             console.log(chalk.green(`  ✓ Captured Test image (Element): ${path.relative(process.cwd(), testImgPath)} (${currentBox.width}x${currentBox.height})`));
             // Optional: Capture HTML for debug
             // eslint-disable-next-line no-undef
             const testHTML = await page.evaluate((sel) => { const el = document.querySelector(sel); return el ? el.outerHTML : null; }, component.selector);
             if (testHTML) {
                 await fs.writeFile(baselineHtmlPath.replace('-debug.html', '-test-debug.html'), testHTML); // Save test html separately
                 console.log(chalk.cyan(`    Saved test run HTML structure: ${path.relative(process.cwd(), baselineHtmlPath.replace('-debug.html', '-test-debug.html'))}`));
             }
           }
        } else {
          throw new Error('Could not get valid bounding box for component.');
        }
      } else {
        throw new Error(`Component ${componentName} (${component.selector}) not found.`);
      }
      // --- End Element Screenshot Logic ---

    } catch (err) {
      console.error(chalk.red(`\n  Error capturing current state for ${componentName}: ${err.message}`));
      results.error = `Capture error: ${err.message}`;
      // Optionally log stack trace for more detail: console.error(err.stack);
    }


    // --- Compare Results (Only in Comparison Mode) ---
    if (!updateBaseline && results.test.captured && !results.error) {
      console.log(chalk.cyan(`\n  Checking for baseline: ${path.relative(process.cwd(), fixedBaselinePath)}`));
      if (await fs.pathExists(fixedBaselinePath)) {
        results.baseline.exists = true;
        console.log(chalk.cyan(`  Comparing ${componentName} images...`));
        
        try {
          const baselineStats = await fs.stat(fixedBaselinePath); // Get stats for mtime
          results.baseline.mtime = baselineStats.mtime; // Store mtime
          
          // --- New Asynchronous PNG Parsing using pipeline ---
          const parsePng = (filePath) => new Promise((resolve, reject) => {
              fs.createReadStream(filePath)
                  .pipe(new PNG())
                  .on('parsed', function() {
                      // Check if parsed data is valid
                      if (!this.data || typeof this.bitblt !== 'function') {
                          return reject(new Error(`Parsed PNG object is invalid or missing methods: ${filePath}`));
                      }
                      resolve(this); // Resolve with the parsed PNG object
                  })
                  .on('error', (err) => {
                      reject(new Error(`Failed to parse PNG: ${filePath}. Error: ${err.message}`));
                  });
          });

          let baselinePng;
          let testPng;
          console.log(chalk.cyan(`  Parsing baseline PNG async: ${fixedBaselinePath}`));
          baselinePng = await parsePng(fixedBaselinePath);
          console.log(chalk.cyan(`  Parsing test PNG async: ${testImgPath}`));
          testPng = await parsePng(testImgPath);
          // --- End Async Parsing ---

          // Store original dimensions for reporting
          results.baseline.box = { width: baselinePng.width, height: baselinePng.height }; 
          results.test.box = { width: testPng.width, height: testPng.height }; // Get test dimensions

          // --- Canvas-based Comparison Logic --- 
          // Goal: Always generate a diff, even if image dimensions change.
          // Method: Create canvases large enough to hold either image,
          //         draw each image onto its canvas, then compare the canvases.
          
          // 1. Determine the maximum dimensions required
          const maxWidth = Math.max(baselinePng.width, testPng.width);
          const maxHeight = Math.max(baselinePng.height, testPng.height);

          // 2. Create two canvases of the maximum size, initialized to white background
          //    (Using white helps visualize where one image is smaller than the other in the diff).
          const canvasBaseline = new PNG({ width: maxWidth, height: maxHeight });
          const canvasTest = new PNG({ width: maxWidth, height: maxHeight });
          // Fill canvases with white (RGBA: 255, 255, 255, 255)
          for (let i = 0; i < maxWidth * maxHeight * 4; i++) {
              canvasBaseline.data[i] = 255;
              canvasTest.data[i] = 255;
          }

          // 3. Draw the original images onto the top-left corner of their respective canvases
          //    The bitblt function copies pixel data from the source PNG to the destination PNG.
          baselinePng.bitblt(canvasBaseline, /*srcX*/ 0, /*srcY*/ 0, /*width*/ baselinePng.width, /*height*/ baselinePng.height, /*dstX*/ 0, /*dstY*/ 0);
          testPng.bitblt(canvasTest, /*srcX*/ 0, /*srcY*/ 0, /*width*/ testPng.width, /*height*/ testPng.height, /*dstX*/ 0, /*dstY*/ 0);

          // 4. Create the diff PNG context with the maximum dimensions
          const diff = new PNG({ width: maxWidth, height: maxHeight });

          // 5. Perform pixel comparison on the canvases
          //    Now compares canvasBaseline.data against canvasTest.data.
          //    The diff output will have dimensions maxWidth x maxHeight.
          results.mismatchedPixels = pixelmatch(
            canvasBaseline.data, 
            canvasTest.data, 
            diff.data, 
            maxWidth, // Use max dimensions
            maxHeight, // Use max dimensions
            { threshold: config.threshold } // Use configured threshold
          );
          
          // 6. Calculate mismatch percentage based on the total pixels in the larger canvas area
          results.mismatchPercentage = (results.mismatchedPixels / (maxWidth * maxHeight)) * 100;

          // --- End Canvas-based Comparison Logic ---

          // --- Conditional Secondary Check Logic ---
          console.log(chalk.blue(`  Primary Diff (Baseline vs Current): ${results.mismatchPercentage.toFixed(2)}%`));

          // Determine size mismatch status BEFORE deciding finalStatus
          if (results.baseline.box.width !== results.test.box.width || results.baseline.box.height !== results.test.box.height) {
              results.sizeMismatch = true;
          }

          if (results.mismatchPercentage <= NOISE_THRESHOLD_PERCENT) {
              // Primary diff is within noise threshold - consider it a match
              finalStatus = 'match';
              if (results.mismatchedPixels > 0) {
                  console.log(chalk.green(`  ✓ Component ${componentName} matches baseline (within noise threshold: ${results.mismatchPercentage.toFixed(2)}%)`));
              } else {
                  console.log(chalk.green(`  ✓ Component ${componentName} perfectly matches baseline.`));
              }
              // Also log size mismatch if it occurred
              if (results.sizeMismatch) {
                  console.log(chalk.yellow(`    (Note: Size mismatch detected: Baseline ${results.baseline.box.width}x${results.baseline.box.height}, Test ${results.test.box.width}x${results.test.box.height})`));
              }

          } else {
              // Primary diff exceeds noise threshold - perform secondary check
              console.log(chalk.yellow(`  ⚠️ Primary diff exceeds noise threshold (${NOISE_THRESHOLD_PERCENT.toFixed(1)}%). Performing secondary check (Current vs Previous Test)...`));

              // --- FIND PREVIOUS SUCCESSFUL TEST IMAGE FROM HISTORY ---
              let previousTestImagePath = null;
              let previousTestRunTimestamp = null; // To log which run we are comparing against
              try {
                  let history = [];
                  if (await fs.pathExists(historyFilePath)) {
                      const historyContent = await fs.readFile(historyFilePath, 'utf8');
                      if (historyContent) history = JSON.parse(historyContent);
                  }

                  // Filter for the same component and viewport, ensure it was successful (diff !== -1),
                  // ensure it HAS a testImage path recorded, and ensure the file exists.
                  const relevantHistory = history
                      .filter(entry =>
                          entry.component === componentName &&
                          entry.viewport === viewport.name &&
                          entry.diff !== -1 && // Must be a successful run
                          entry.testImage && // Must have the testImage path recorded
                          fs.pathExistsSync(path.join(__dirname, 'screenshots', entry.testImage)) // The image file must still exist
                      )
                      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)); // Sort descending by timestamp

                  // The current run isn't in history yet, so the latest valid one is the "previous"
                  if (relevantHistory.length > 0) {
                      const previousTestRun = relevantHistory[0];
                      // Construct the full path relative to the current script directory
                      previousTestImagePath = path.join(__dirname, 'screenshots', previousTestRun.testImage);
                      previousTestRunTimestamp = previousTestRun.timestamp;
                      console.log(chalk.cyan(`    Found previous successful test image: ${path.basename(previousTestImagePath)} from ${previousTestRunTimestamp}`));
                  } else {
                      console.log(chalk.yellow(`    Could not find a valid previous test image in history for secondary comparison.`));
                  }
              } catch (findError) {
                  console.error(chalk.red(`    Error reading or processing history file to find previous test image: ${findError.message}`));
              }
              // --- END FIND PREVIOUS TEST IMAGE ---


              // --- PERFORM SECONDARY COMPARISON (if previous image found) ---
              if (previousTestImagePath) {
                  try {
                      // Parse previous and current test images
                      const previousTestPng = await parsePng(previousTestImagePath);
                      const currentTestPng = testPng; // Already parsed earlier

                      // Use canvas comparison logic again for potentially different sizes
                      const secondaryMaxWidth = Math.max(previousTestPng.width, currentTestPng.width);
                      const secondaryMaxHeight = Math.max(previousTestPng.height, currentTestPng.height);

                      const canvasPrev = new PNG({ width: secondaryMaxWidth, height: secondaryMaxHeight });
                      const canvasCurr = new PNG({ width: secondaryMaxWidth, height: secondaryMaxHeight });
                      for (let i = 0; i < secondaryMaxWidth * secondaryMaxHeight * 4; i++) { canvasPrev.data[i] = 255; canvasCurr.data[i] = 255; }
                      previousTestPng.bitblt(canvasPrev, 0, 0, previousTestPng.width, previousTestPng.height, 0, 0);
                      currentTestPng.bitblt(canvasCurr, 0, 0, currentTestPng.width, currentTestPng.height, 0, 0);

                      const secondaryDiffPng = new PNG({ width: secondaryMaxWidth, height: secondaryMaxHeight });
                      const secondaryNumDiffPixels = pixelmatch(
                          canvasPrev.data,
                          canvasCurr.data,
                          secondaryDiffPng.data,
                          secondaryMaxWidth,
                          secondaryMaxHeight,
                          { threshold: config.threshold } // Use same pixelmatch threshold
                      );
                      secondaryMismatchPercentage = (secondaryNumDiffPixels / (secondaryMaxWidth * secondaryMaxHeight)) * 100;

                      console.log(chalk.blue(`    Secondary Diff (Current vs Previous): ${secondaryMismatchPercentage.toFixed(2)}%`));

                      // Interpret secondary result
                      if (secondaryMismatchPercentage <= SECONDARY_THRESHOLD_PERCENT) {
                          finalStatus = 'noise';
                          console.log(chalk.yellow(`    Secondary diff within threshold (${SECONDARY_THRESHOLD_PERCENT.toFixed(1)}%). Primary diff likely rendering noise.`));
                      } else {
                          finalStatus = 'significant';
                          console.error(chalk.red(`    ❌ Secondary diff exceeds threshold! Significant change detected.`));
                          process.exitCode = 1; // Set failure exit code ONLY if secondary check confirms significance
                      }
                      // Optionally save the secondary diff image
                      // const secondaryDiffOutputPath = diffImgPath.replace('.png', '-SECONDARY.png');
                      // await fs.writeFile(secondaryDiffOutputPath, PNG.sync.write(secondaryDiffPng));
                      // console.log(chalk.cyan(`      Secondary diff image saved to: ${path.basename(secondaryDiffOutputPath)}`));

                  } catch (secondaryCompareError) {
                      console.error(chalk.red(`    Error during secondary comparison: ${secondaryCompareError.message}`), secondaryCompareError.stack);
                      results.error = (results.error ? results.error + '; ' : '') + `Secondary comparison error: ${secondaryCompareError.message}`;
                      finalStatus = 'error'; // Mark as error if secondary check fails
                  }
              } else {
                  // No previous image found, cannot perform secondary check
                  // Treat high primary diff as potentially significant in this edge case
                  finalStatus = 'significant';
                  console.error(chalk.red(`  ❌ Primary diff exceeds noise threshold, but no previous test image found for secondary check. Reporting as significant.`));
                  process.exitCode = 1;
              }
          }
          // --- End Conditional Secondary Check Logic ---

          // Save the primary diff image ONLY if the primary comparison found mismatched pixels
          if (results.mismatchedPixels > 0) {
              await fs.writeFile(diffImgPath, PNG.sync.write(diff));
              results.diffPath = diffImgPath;
              console.log(chalk.cyan(`    Primary diff image saved: ${path.basename(diffImgPath)}`));
          }

        } catch (compareError) {
          console.error(chalk.red(`\n  Error comparing images for ${componentName}: ${compareError.message}`), compareError.stack);
          results.error = (results.error ? results.error + '; ' : '') + `Image comparison error: ${compareError.message}`;
        }
      } else {
         console.error(chalk.red(`\n  ❌ Baseline image not found: ${path.relative(process.cwd(), fixedBaselinePath)}`));
         console.log(chalk.yellow(`  Run with '--update-baseline' flag first to create it.`));
         results.error = 'Baseline image not found.';
         process.exitCode = 1; // Indicate failure
      }
    } else if (!updateBaseline && !results.test.captured && !results.error) {
         results.error = 'Test image could not be captured.'; // Should have been caught earlier, but safeguard
    }


  } catch (error) {
    console.error(chalk.red(`\nUnhandled error during component test for ${componentName}:`), error);
    results.error = `Unhandled test error: ${error.message}`;
    process.exitCode = 1; // Indicate failure
  } finally {
    // Ensure page and browser are closed
    if (page && !page.isClosed()) {
        try { await page.close(); } catch (e) { console.error("Error closing page:", e.message); }
    }
    if (browser) {
       try { await browser.close(); } catch(e) { console.error("Error closing browser:", e.message); }
    }
  }

  // --- Generate HTML Report (even if baseline update) ---
  console.log(chalk.blue("\nGenerating HTML report..."));
  let generatedReportPath = null; // Variable to store the path if generated
  try {
    // Use relative paths for images in the report
    // const baselineImgRelative = results.baseline.exists ? path.relative(path.dirname(reportPath), results.baseline.path) : null;
    // const testImgRelative = results.test.captured ? path.relative(path.dirname(reportPath), results.test.path) : null;
    // const diffImgRelative = results.diffPath ? path.relative(path.dirname(reportPath), results.diffPath) : null;

    // --- CALL THE IMPORTED createReport function ---
    const reportHTML = await createReport(
        componentName,
        viewport,
        path.basename(results.baseline.path), // Pass only filename
        results.test.captured ? path.basename(results.test.path) : null,
        results.diffPath ? path.basename(results.diffPath) : null,
        results.mismatchPercentage,       // Primary diff %
        results.baseline.exists,          // Moved up
        results.test.captured,          // Moved up
        results.baseline.box,             // Moved up
        results.test.box,                 // Moved up
        results.sizeMismatch,             // Moved up
        results.error,                    // Moved up
        updateBaseline,                 // Moved up
        startTime,                        // Moved up
        secondaryMismatchPercentage,      // Now correct position
        finalStatus                       // Now correct position
    );
    // --- END CALL ---

    await fs.writeFile(reportPath, reportHTML);
    console.log(chalk.green(`📊 Report generated: ${path.relative(process.cwd(), reportPath)}`));
    // Store the relative path ONLY if a diff occurred (or baseline update, though less relevant here)
    // --- MODIFICATION FOR HISTORY LOGGING ---
    // Always store the report path for comparison runs, regardless of diff outcome
    if (!updateBaseline || results.error) { // Store report path if comparison or baseline update had error
         generatedReportPath = path.relative(__dirname, reportPath); // Store relative path from tests dir
    }
    // --- END MODIFICATION ---
  } catch (reportError) {
    console.error(chalk.red('Error generating HTML report:'), reportError);
    // Don't override exit code if test itself passed/failed already
    if (process.exitCode !== 1) process.exitCode = 1; 
  }

  // --- Save Diff History ---
  // Moved history saving outside the main try...catch to ensure it attempts to save even if comparison fails
  // Make sure this runs only if it wasn't a baseline update OR if the baseline update failed
  if (!updateBaseline || results.error) {
      await saveDiffHistory(
          componentName,
          viewport.name,
          results.mismatchPercentage, // Primary diff percentage
          generatedReportPath,        // Relative path to report, if generated
          results.baseline.mtime,     // Baseline modification time
          results.test.box,           // Test image dimensions
          results.baseline.box,       // Baseline image dimensions
          finalStatus,                // Final status ('match', 'noise', 'significant', 'error', etc.)
          secondaryMismatchPercentage,// Secondary diff percentage (-1 if not run)
          results.test.captured ? results.test.path : null // Full path to the captured test image (or null if capture failed)
      );
  }
}

// --- Save Diff History Function ---
async function saveDiffHistory(componentName, viewportName, mismatchPercentage, reportFilePath, baselineMTime, testBox, baselineBox, finalDiffStatus, secondaryDiffPercent, currentTestImagePath) { // << ADD currentTestImagePath parameter
  let history = [];
  try {
    if (await fs.pathExists(historyFilePath)) {
      const existingHistory = await fs.readFile(historyFilePath, 'utf8');
      if (existingHistory && existingHistory.trim().length > 0) { // Check if file is not empty
          try {
              history = JSON.parse(existingHistory);
               // Ensure history is an array after parsing
              if (!Array.isArray(history)) {
                  console.warn(chalk.yellow('History data was not an array after parsing, resetting history.'));
                  history = [];
              }
          } catch (parseError) {
               console.error(chalk.red(`  Error parsing diff history JSON: ${parseError.message}. History will be reset.`));
               history = []; // Reset history if parsing fails
          }
      } else if (existingHistory && existingHistory.trim().length === 0) {
          console.log(chalk.blue('History file was empty, starting new history.'));
          history = []; // Ensure it's an array if file was just empty
      }
    } else {
         console.log(chalk.blue('History file not found, creating new one.'));
         history = []; // Ensure it's an array if file didn't exist
    }
  } catch (err) {
    console.error(chalk.red(`  Error reading diff history file: ${err.message}. History may be incomplete or reset.`));
    history = []; // Initialize as empty if read error occurs
  }

  // Ensure history is definitely an array before proceeding
  if (!Array.isArray(history)) {
      console.warn(chalk.yellow('History data somehow became non-array, resetting history.'));
      history = [];
  }


  const newHistoryEntry = {
    timestamp: new Date().toISOString(),
    component: componentName,
    viewport: viewportName,
    baseline_mtime: baselineMTime ? baselineMTime.toISOString() : null,
    // Ensure dimensions are strings without too many decimals, handle nulls gracefully
    test_dimensions: testBox ? `${Math.round(testBox.width)}x${Math.round(testBox.height)}` : 'N/A',
    baseline_dimensions: baselineBox ? `${Math.round(baselineBox.width)}x${Math.round(baselineBox.height)}` : 'N/A',
    diff: mismatchPercentage >= 0 ? mismatchPercentage : -1, // Store primary diff, use -1 for error/no comparison
    final_status: finalDiffStatus,
    secondary_diff_percent: secondaryDiffPercent === -1 ? null : secondaryDiffPercent, // Store secondary diff, use null if not applicable
    // Make paths relative to the 'screenshots' directory for portability
    reportFile: reportFilePath ? path.relative(path.join(__dirname, 'screenshots'), reportFilePath) : null,
    testImage: currentTestImagePath ? path.relative(path.join(__dirname, 'screenshots'), currentTestImagePath) : null // << ADDED relative testImage path
  };

  // Keep only the last N entries (e.g., 500) to prevent file from growing indefinitely
  const MAX_HISTORY_ENTRIES = 500;
  history.push(newHistoryEntry);
  if (history.length > MAX_HISTORY_ENTRIES) {
    history = history.slice(history.length - MAX_HISTORY_ENTRIES);
  }

  try {
      await fs.writeFile(historyFilePath, JSON.stringify(history, null, 2)); // Pretty print JSON
      console.log(chalk.magenta(`Difference history saved to ${path.relative(process.cwd(), historyFilePath)}`));
  } catch (writeError) {
       console.error(chalk.red(`  Error writing updated diff history file: ${writeError.message}`));
  }
}
// --- End Save Diff History ---

// --- Command-Line Interface (CLI) Execution ---
if (require.main === module) {
  if (!componentNameArg) {
    console.error(chalk.red('Error: Please provide a component name defined in tests/config.js'));
     if (config?.components?.length > 0) {
         console.log(chalk.yellow('Available components:', config.components.map(c => c.name).join(', ') || 'None configured'));
    } else {
         console.log(chalk.yellow('No components found in config.js'));
    }
    console.log(chalk.cyan('\nUsage: node tests/component-test.js <ComponentName> [ViewportName] [--update-baseline]'));
    console.log(chalk.cyan('Example: node tests/component-test.js mainNav desktop'));
    console.log(chalk.cyan('Example: node tests/component-test.js corootServiceMap --update-baseline\n'));
    process.exit(1);
  }

  // Use resolved arguments
  testComponent(componentNameArg, viewportNameArg || config.defaultViewport, updateBaselineFlag)
    .then(() => {
      console.log(chalk.blue(`\n✅ ${updateBaselineFlag ? 'Baseline update' : 'Comparison'} process finished for ${componentNameArg}.`));
      if (process.exitCode !== 1) {
          process.exitCode = 0;
      }
    })
    .catch(err => {
      console.error(chalk.red(`\n❌ ${updateBaselineFlag ? 'Baseline update' : 'Comparison'} process failed for ${componentNameArg}:`), err);
      process.exitCode = 1;
    });
}

// Export for potential programmatic use
module.exports = { testComponent };