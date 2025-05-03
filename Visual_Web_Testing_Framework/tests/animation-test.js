// animation-test.js
// Purpose: Captures animations frame-by-frame from two web pages (baseline vs test)
//          and generates comparison GIFs using ImageMagick.
// Usage: node tests/animation-test.js <componentName> [triggerAction] [viewportName]
'use strict';

// **************************************************************************
// * External Dependency: ImageMagick                                       *
// * ---------------------------------------------------------------------- *
// * This script relies on the 'convert' command-line tool from ImageMagick *
// * (imagemagick.org) to create GIF animations from captured frames.       *
// * Ensure ImageMagick is installed and 'convert' is accessible in your    *
// * system's PATH for GIF generation to work.                              *
// *                                                                        *
// * If ImageMagick is unavailable, frame capture will still occur,         *
// * but GIF creation will be skipped, and warnings will be logged.         *
// **************************************************************************

const puppeteer = require('puppeteer');
const fs = require('fs-extra');
const chalk = require('chalk');
const path = require('path');
const { exec } = require('child_process'); // For calling ImageMagick ('convert')
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
 * Records an animation sequence for a specific component on baseline and test sites.
 * @param {string} componentName - The name of the component (must match a key in config.components).
 * @param {string} [triggerAction='hover'] - Action to trigger the animation ('hover', 'click', 'scroll', 'load', or custom defined in config).
 * @param {string} [viewportName=config.defaultViewport] - The name of the viewport to use.
 */
async function recordAnimation(componentName, triggerAction = 'hover', viewportName = config.defaultViewport) {
  const component = config.components.find(c => c.name === componentName);
  if (!component) {
    console.error(chalk.red(`Error: Component "${componentName}" not found in tests/config.js`));
    process.exitCode = 1; // Indicate failure
    return;
  }

  // Determine the actual trigger, potentially overriding CLI arg with config value
  const effectiveTrigger = component.interactiveTest === 'animation' && component.animationTrigger
    ? component.animationTrigger
    : triggerAction;

  const viewport = getViewport(viewportName);
  console.log(chalk.blue(`▶️ Recording animation for component: ${chalk.bold(componentName)}`));
  console.log(chalk.blue(`  Trigger: ${effectiveTrigger}, Viewport: ${viewport.name} (${viewport.width}x${viewport.height})`));

  let browser;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-'); // ISO timestamp for unique filenames
  const reportPath = path.join(__dirname, `reports/animation-${componentName}-${viewport.name}-${timestamp}.html`);
  const results = {
    baseline: { gif: null, frames: 0, label: "Baseline" },
    test: { gif: null, frames: 0, label: "Test" },
    error: null
  };

  try {
    browser = await puppeteer.launch({ headless: 'new' }); // Use modern headless mode

    for (const siteType of ['baseline', 'test']) { // Loop through baseline and test sites
      let page = null; // Define page in the outer scope for finally block
      const siteLabel = results[siteType].label; // "Baseline" or "Test"
      const url = config[siteType + 'Url']; // Get URL from config (config.baselineUrl or config.testUrl)
      const framesDir = path.join(__dirname, `animations/${siteType}-${componentName}-${viewport.name}-${timestamp}-frames`);
      const gifPath = path.join(__dirname, `animations/${siteType}-${componentName}-${viewport.name}-${timestamp}.gif`);

      console.log(chalk.yellow(`\n  Loading ${siteLabel} URL: ${url}`));

      try {
        page = await browser.newPage();
        await page.setViewport({ width: viewport.width, height: viewport.height });

        // Navigate and wait for page stability
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Determine element for component-scoped screenshots, if configured
        let elementForScope = null;
        if (config.animationScreenshotScope === 'component') {
          try {
            // Attempt to find the element specified in config
            await page.waitForSelector(component.selector, { visible: true, timeout: 10000 });
            elementForScope = await page.$(component.selector);
            if (!elementForScope) {
              console.warn(chalk.yellow(`  ⚠️ Component selector "${component.selector}" not found for scope screenshot on ${siteLabel}. Falling back to viewport.`));
            }
          } catch (e) {
            // Handle cases where selector might not be found or visible in time
            console.warn(chalk.yellow(`  ⚠️ Could not find component selector "${component.selector}" for scope screenshot on ${siteLabel}. Falling back to viewport. Error: ${e.message}`));
          }
        }

        console.log(chalk.cyan(`  Starting animation recording (${config.animationDuration}ms) on ${siteLabel}...`));
        await fs.ensureDir(framesDir); // Ensure directory for frames exists
        let frameCount = 0;
        const capturedFrames = []; // Store paths to frames for potential GIF creation

        // --- Trigger the Animation Action ---
        try {
          console.log(chalk.magenta(`    Triggering action: ${effectiveTrigger}`));
          switch (effectiveTrigger) {
            case 'hover':
              await page.hover(component.selector);
              break;
            case 'click':
              await page.click(component.selector);
              break;
            case 'scroll':
              // Evaluate script in browser context to scroll element into view
              await page.evaluate((selector) => {
                // Use ESLint directive to ignore 'document' not defined in Node context
                // eslint-disable-next-line no-undef
                document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, component.selector);
              // Wait for scroll animation to likely finish
              await new Promise(resolve => setTimeout(resolve, 500));
              break;
            case 'load':
              // Animation occurs on load, no explicit action needed here
              break;
            // Add cases for other custom triggers defined in config.js if needed
            // e.g., case 'megaMenu': await page.hover(...); break;
            default:
              console.warn(chalk.yellow(`    Unknown trigger action: ${effectiveTrigger}. Recording static page state.`));
          }
          // Wait briefly *after* triggering for transitions/animations to potentially initiate
          await new Promise(resolve => setTimeout(resolve, 150));
        } catch (triggerError) {
          // Log error if triggering action fails, but continue recording frames
          console.error(chalk.red(`    Error triggering animation (${effectiveTrigger}) on ${siteLabel}: ${triggerError.message}`));
        }

        // --- Record Frames Sequentially ---
        const recordingStartTime = Date.now();
        while (Date.now() - recordingStartTime < config.animationDuration) {
          try {
            const framePath = path.join(framesDir, `frame-${frameCount.toString().padStart(3, '0')}.png`);
            let screenshotOptions = {};
            let targetElementOrPage = page; // Default to page (viewport) screenshot

            // If scope is 'component' and element was found, target the element
            if (config.animationScreenshotScope === 'component' && elementForScope) {
              targetElementOrPage = elementForScope;
            } else {
              screenshotOptions.fullPage = false; // Ensure viewport, not full page if targeting page
            }

            // Capture the screenshot
            const frameData = await targetElementOrPage.screenshot(screenshotOptions);
            await fs.writeFile(framePath, frameData);
            capturedFrames.push(framePath);
            frameCount++;
          } catch (captureError) {
            console.error(chalk.red(`    Error capturing frame ${frameCount} on ${siteLabel}: ${captureError.message}`));
            // Log error but attempt to continue capturing subsequent frames
          }
          // Wait for the configured interval before capturing the next frame
          await new Promise(resolve => setTimeout(resolve, config.animationFrameInterval));
        }

        console.log(chalk.green(`  ✓ Recorded ${frameCount} frames for ${siteLabel}.`));
        results[siteType].frames = frameCount;

        // --- Attempt GIF Creation using ImageMagick ---
        if (frameCount > 0) {
          const framePattern = path.join(framesDir, 'frame-*.png');
          // ImageMagick 'convert' command parameters:
          // -delay: time between frames in 1/100ths of a second
          // -loop 0: loop infinitely
          const cmd = `magick -delay ${config.animationFrameInterval / 10} -loop 0 "${framePattern}" "${gifPath}"`;

          console.log(chalk.cyan(`  Attempting GIF creation via ImageMagick...`));
          console.log(chalk.gray(`    Command: ${cmd}`));

          // Execute the command asynchronously
          await new Promise((resolve) => { // Wrap exec in Promise, always resolve to prevent hanging
            exec(cmd, (error, stdout, stderr) => {
              if (error) {
                // Handle failure (likely ImageMagick not installed or command error)
                console.error(chalk.red(`  ❌ GIF creation failed for ${siteLabel}: ${error.message}`));
                console.warn(chalk.yellow("     => Is ImageMagick ('convert' command) installed and in PATH? See script header."));
                console.warn(chalk.yellow(`     => Frames saved individually in: ${path.relative(process.cwd(), framesDir)}`));
                // Append error message to overall results for reporting
                results.error = (results.error ? results.error + '; ' : '') + `ImageMagick GIF creation failed for ${siteType}.`;
              } else {
                // Handle success
                console.log(chalk.green(`  ✓ Animation GIF created: ${path.relative(process.cwd(), gifPath)}`));
                results[siteType].gif = gifPath; // Store path to the created GIF
              }
              if (stderr && !error) { // Log stderr output only if it's not part of an error message
                // Log ImageMagick warnings or informational output if any
                console.warn(chalk.yellow(`    ImageMagick stderr: ${stderr.trim()}`));
              }
              resolve(); // Resolve the promise regardless of GIF creation outcome
            });
          });
        }
      } catch (pageError) {
        // Catch broader errors during page processing
        console.error(chalk.red(`\n  Error processing ${siteLabel} page: ${pageError.message}`), pageError.stack);
        results.error = (results.error ? results.error + '; ' : '') + `Error processing ${siteType} page: ${pageError.message}`;
      } finally {
        // Ensure page is closed even if errors occurred during processing
        if (page && !page.isClosed()) {
          await page.close();
        }
      }
    } // End siteType loop (baseline, test)

  } catch (browserError) {
    // Catch errors related to browser launch or setup
    console.error(chalk.red(`\nUnhandled error during animation recording for ${componentName}:`), browserError);
    results.error = `Unhandled browser error: ${browserError.message}`;
    process.exitCode = 1; // Indicate failure
  } finally {
    // Ensure browser is closed in all cases
    if (browser) {
      await browser.close();
    }
  }

  // --- Generate HTML Report ---
  console.log(chalk.blue("\nGenerating HTML report..."));
  try {
    // Ensure report directory exists
    await fs.ensureDir(path.dirname(reportPath));

    // Use relative paths for images in the HTML report for portability
    const baselineGifRelative = results.baseline.gif ? path.relative(path.dirname(reportPath), results.baseline.gif) : null;
    const testGifRelative = results.test.gif ? path.relative(path.dirname(reportPath), results.test.gif) : null;

    // Basic HTML report template
    const reportHTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Animation Test Report: ${componentName} (${viewport.name})</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"; line-height: 1.6; padding: 20px; color: #333; }
    .container { max-width: 1600px; margin: 0 auto; }
    h1, h2 { border-bottom: 1px solid #eee; padding-bottom: 8px; margin-bottom: 16px; }
    .comparison { display: flex; flex-wrap: wrap; gap: 20px; justify-content: space-around; }
    .image-container { border: 1px solid #ccc; padding: 15px; background: #f9f9f9; border-radius: 4px; flex: 1; min-width: 400px; max-width: 48%; box-sizing: border-box; text-align: center; }
    .image-container img { max-width: 100%; height: auto; display: block; border: 1px solid #eee; margin: 10px auto; }
    .image-container h2 { margin-top: 0; font-size: 1.1em; }
    .stats { background: #f0f0f0; padding: 15px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 25px; font-size: 0.95em; }
    .stats p { margin: 8px 0; }
    .stats code { background: #e0e0e0; padding: 2px 5px; border-radius: 3px; font-family: Consolas, Monaco, "Andale Mono", "Ubuntu Mono", monospace; }
    .error { color: #d32f2f; font-weight: bold; background: #ffebee; padding: 3px 8px; border-radius: 3px;}
    .warning { color: #ffa000; font-weight: bold; background: #fff8e1; padding: 3px 8px; border-radius: 3px; }
    .label { font-weight: bold; color: #555; min-width: 150px; display: inline-block;}
  </style>
</head>
<body>
  <div class="container">
    <h1>Animation Test Report</h1>
    <div class="stats">
        <p><span class="label">Component:</span> ${componentName}</p>
        <p><span class="label">Selector:</span> <code>${component.selector}</code></p>
        <p><span class="label">Viewport:</span> ${viewport.name} (${viewport.width}x${viewport.height})</p>
        <p><span class="label">Trigger Action:</span> ${effectiveTrigger}</p>
        <p><span class="label">Recording Duration:</span> ${config.animationDuration}ms</p>
        <p><span class="label">Frame Interval:</span> ${config.animationFrameInterval}ms</p>
        <p><span class="label">Screenshot Scope:</span> ${config.animationScreenshotScope}</p>
        <p><span class="label">Timestamp:</span> ${new Date(timestamp.replace(/-/g, ':')).toLocaleString()}</p>
        ${results.error ? `<p><span class="label">Status:</span> <span class="error">Error(s) Occurred: ${results.error}</span></p>` : ''}
        ${!results.baseline.gif && results.baseline.frames > 0 ? `<p><span class="label">Baseline GIF:</span> <span class="warning">Creation failed (ImageMagick issue?). Frames saved.</span></p>` : ''}
        ${!results.test.gif && results.test.frames > 0 ? `<p><span class="label">Test GIF:</span> <span class="warning">Creation failed (ImageMagick issue?). Frames saved.</span></p>` : ''}
        ${!results.error && results.baseline.gif && results.test.gif ? `<p><span class="label">Status:</span> <span style="color:green; font-weight:bold;">GIFs generated successfully for comparison.</span></p>` : ''}
    </div>
    <div class="comparison">
      <div class="image-container">
        <h2>Baseline Animation (${results.baseline.frames} frames)</h2>
        ${baselineGifRelative ? `<img src="${baselineGifRelative}" alt="Baseline Animation for ${componentName}">` : '<p class="error">GIF not available</p>'}
      </div>
      <div class="image-container">
        <h2>Test Animation (${results.test.frames} frames)</h2>
         ${testGifRelative ? `<img src="${testGifRelative}" alt="Test Animation for ${componentName}">` : '<p class="error">GIF not available</p>'}
      </div>
    </div>
  </div>
</body>
</html>`;
    // Write the report file
    await fs.writeFile(reportPath, reportHTML);
    console.log(chalk.green(`📊 Report generated: ${path.relative(process.cwd(), reportPath)}`));
  } catch (reportError) {
    // Catch errors specifically during report generation/writing
    console.error(chalk.red('Error generating HTML report:'), reportError);
    process.exitCode = 1; // Indicate failure
  }
}

// --- Command-Line Interface (CLI) Execution ---
// Only run if script is executed directly from the command line
if (require.main === module) {
  const componentNameArg = process.argv[2];
  const triggerActionArg = process.argv[3]; // Optional trigger action (defaults to 'hover')
  const viewportNameArg = process.argv[4]; // Optional viewport name (defaults to config.defaultViewport)

  // Validate required component name argument
  if (!componentNameArg) {
    console.error(chalk.red('Error: Please provide a component name defined in tests/config.js'));
    // Attempt to list available components from config for user guidance
    if (config?.components?.length > 0) {
         console.log(chalk.yellow('Available components:', config.components.map(c => c.name).join(', ') || 'None configured'));
    } else {
         console.log(chalk.yellow('No components found or defined in config.js'));
    }
    console.log(chalk.cyan('\nUsage: node tests/animation-test.js <ComponentName> [TriggerAction] [ViewportName]'));
    console.log(chalk.cyan('Example: node tests/animation-test.js mainNav hover desktop'));
    console.log(chalk.cyan('Example: node tests/animation-test.js heroBanner load mobile\n'));
    process.exit(1); // Exit with error code
  }

  // Execute the main function
  recordAnimation(componentNameArg, triggerActionArg, viewportNameArg)
    .then(() => {
      console.log(chalk.blue(`\n✅ Animation testing process finished for ${componentNameArg}.`));
      // Ensure exit code reflects success if no prior errors set it to 1
      if (process.exitCode !== 1) {
          process.exitCode = 0;
      }
    })
    .catch(err => {
      // Catch any unhandled promise rejections from the async function
      console.error(chalk.red(`\n❌ Animation testing process encountered an unhandled error for ${componentNameArg}:`), err);
      process.exitCode = 1; // Ensure exit code reflects error
    });
}

// Export the main function for potential programmatic use
module.exports = { recordAnimation };