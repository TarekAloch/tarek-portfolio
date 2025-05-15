const { PNG } = require('pngjs');
const path = require('path');
const config = require('./config'); // Load configuration

// Define thresholds here for now, mirroring component-test.js
const NOISE_THRESHOLD_PERCENT = 4.0;
const SECONDARY_THRESHOLD_PERCENT = 1.0;

/**
 * Generates an HTML report comparing baseline and test images.
 * @param {string} testName - Name of the test/component.
 * @param {object} viewport - Viewport object { name, width, height }.
 * @param {string} baselineImage - Filename of the baseline image.
 * @param {string} testImage - Filename of the test image.
 * @param {string|null} diffImage - Filename of the diff image (or null if no diff).
 * @param {number} diffPercentage - Percentage difference (-1 if error).
 * @param {boolean} baselineExists - Whether the baseline image exists.
 * @param {boolean} testCaptured - Whether the test image was captured.
 * @param {object|null} baselineBox - Bounding box of baseline component.
 * @param {object|null} testBox - Bounding box of test component.
 * @param {boolean} sizeMismatch - Whether a size mismatch was detected.
 * @param {string|null} error - Error message if any occurred.
 * @param {boolean} updateBaseline - If the run was for updating baseline.
 * @param {Date} startTime - The Date object representing when the test started.
 * @param {number} secondaryMismatchPercentage - The secondary diff % (-1 if not applicable).
 * @param {string} finalStatus - The final interpretation ('match', 'noise', 'significant', 'error', 'unknown').
 * @returns {string} HTML report content.
 */
async function createReport(testName, viewport, baselineImage, testImage, diffImage, diffPercentage, baselineExists, testCaptured, baselineBox, testBox, sizeMismatch, error, updateBaseline, startTime, secondaryMismatchPercentage, finalStatus) {

    // Determine status message and class based on results
    let statusClass = '';
    let statusText = '';

    if (updateBaseline) {
        statusClass = 'success';
        statusText = 'Baseline Updated Successfully';
    } else if (error != null) {
        statusClass = 'error';
        const errorString = String(error);
        statusText = `Error: ${errorString.substring(0, 100)}${errorString.length > 100 ? '...' : ''}`;
    } else if (!baselineExists) {
        statusClass = 'error';
        statusText = 'Baseline Missing';
    } else if (sizeMismatch) {
        statusClass = 'error';
        statusText = 'Size Mismatch Detected!';
    } else if (diffPercentage > 0) {
        statusClass = diffPercentage > config.reportingThresholds.alert ? 'error' : 'warning';
        statusText = 'Differences Detected'; // Keep status concise, diff shown separately
    } else if (diffPercentage === 0) {
        statusClass = 'success';
        statusText = 'Components Match Visually';
    } else { // diffPercentage < 0 (comparison didn't run or failed)
        statusClass = 'warning';
        statusText = 'Comparison could not be performed.';
    }

    // Determine color class based on percentage for the diff display
    let diffDisplayClass = 'success'; // Default to success (0% diff)
    if (diffPercentage > config.reportingThresholds.alert) { // Use config value
      diffDisplayClass = 'error';
    } else if (diffPercentage >= config.reportingThresholds.warn) { // Use config value
      diffDisplayClass = 'warning';
    } else if (diffPercentage > 0) {
        // Keep warning for any diff > 0 for simplicity
        diffDisplayClass = 'warning';
    } else if (diffPercentage === 0) {
         diffDisplayClass = 'success';
    } // Negative diffPercentage implies comparison error, handled by statusMessage

    const statusMessage = `<p><span class="label">Status:</span> <span class="${statusClass}">${statusText}</span></p>`;
    const diffMessage = (baselineExists && testCaptured && !sizeMismatch && diffPercentage >= 0)
        ? `<p><span class="label">Visual Diff:</span> <span class="${diffDisplayClass}">${diffPercentage.toFixed(2)}% (${Math.round(diffPercentage/100 * (baselineBox?.width*baselineBox?.height || 0))} pixels)</span></p>` // Approx pixels
        : ''; // Only show diff percentage if comparison was successful

    // Construct relative paths assuming report is in tests/reports/
    const baselineImagePath = baselineExists ? `../screenshots/baseline/${baselineImage}` : '';
    const testImagePath = testCaptured ? `../screenshots/test/${testImage}` : '';
    const diffImagePath = diffImage ? `../screenshots/diff/${diffImage}` : '';

    // Determine status text and color based on finalStatus
    let statusColor = '#dc3545'; // Red for error by default
    let secondaryText = '';

    if (error != null) {
        const errorString = String(error);
        statusText = `Error: ${errorString.substring(0, 100)}${errorString.length > 100 ? '...' : ''}`;
        statusColor = '#dc3545';
    } else if (updateBaseline) {
        statusText = 'Baseline Updated';
        statusColor = '#0d6efd'; // Blue for baseline update
    } else if (!baselineExists) {
        statusText = 'Baseline Missing';
    } else if (!testCaptured) {
        statusText = 'Test Image Capture Failed';
    } else {
        const primaryDiff = diffPercentage.toFixed(2);
        switch (finalStatus) {
            case 'match':
                statusText = `Match (< ${NOISE_THRESHOLD_PERCENT.toFixed(1)}% baseline diff)`;
                statusColor = '#198754'; // Green
                if (diffPercentage > 0) {
                     statusText += `: ${primaryDiff}%`; // Show actual diff if > 0
                }
                break;
            case 'noise':
                statusText = `Noise? (${primaryDiff}% baseline diff)`;
                statusColor = '#ffc107'; // Yellow
                if (secondaryMismatchPercentage >= 0) {
                    secondaryText = ` | Secondary Diff (vs Previous): ${secondaryMismatchPercentage.toFixed(2)}%`;
                }
                break;
            case 'significant':
                statusText = `Significant Change Detected! (${primaryDiff}% baseline diff)`;
                statusColor = '#dc3545'; // Red
                 if (secondaryMismatchPercentage >= 0) {
                    secondaryText = ` | Secondary Diff (vs Previous): ${secondaryMismatchPercentage.toFixed(2)}%`;
                } else {
                    secondaryText = ' (Secondary check skipped or failed)';
                }
                break;
            default:
                statusText = `Unknown Status (Primary Diff: ${primaryDiff}%)`;
                statusColor = '#6c757d'; // Grey
        }
    }

    const statusMessageFinal = `<p><span class="label">Status:</span> <span style="color: ${statusColor}; font-weight: bold;">${statusText}${secondaryText}</span></p>`;
    const diffMessageFinal = (baselineExists && testCaptured && !sizeMismatch && diffPercentage >= 0)
        ? `<p><span class="label">Visual Diff:</span> <span class="${diffDisplayClass}">${diffPercentage.toFixed(2)}% (${Math.round(diffPercentage/100 * (baselineBox?.width*baselineBox?.height || 0))} pixels)</span></p>` // Approx pixels
        : ''; // Only show diff percentage if comparison was successful

    const reportHTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Visual Test Report: ${testName} (${viewport.name}) ${updateBaseline ? '- Baseline Update' : ''}</title>
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
        .error { color: #d32f2f; font-weight: bold; background: #ffebee; padding: 2px 6px; border-radius: 3px;} /* Red */
        .warning { color: #ffa000; font-weight: bold; background: #fff8e1; padding: 2px 6px; border-radius: 3px; } /* Yellow/Orange */
        .success { color: #388e3c; font-weight: bold; background: #e8f5e9; padding: 2px 6px; border-radius: 3px;} /* Green */

        /* --- Modal Styles --- */
        .modal {
            display: none; 
            position: fixed; 
            z-index: 1000; 
            left: 0;
            top: 0;
            width: 100%; 
            height: 100%; 
            overflow: auto; 
            background-color: rgba(0,0,0,0.8); 
            padding-top: 50px; 
        }
        .modal-content {
            margin: auto;
            display: block;
            max-width: 90%;
            max-height: 90vh;
        }
        .modal-close {
            position: absolute;
            top: 15px;
            right: 35px;
            color: #f1f1f1;
            font-size: 40px;
            font-weight: bold;
            transition: 0.3s;
        }
        .modal-close:hover,
        .modal-close:focus {
            color: #bbb;
            text-decoration: none;
            cursor: pointer;
        }
        /* --- End Modal Styles --- */
    </style>
</head>
<body>
    <div class="container">
        <h1>Visual Test Report ${updateBaseline ? '<span class="success" style="font-size: 0.8em; vertical-align: middle;">(Baseline Updated)</span>' : ''}</h1>
        <div class="stats">
            <p><span class="label">Component:</span> ${testName}</p>
            <p><span class="label">Viewport:</span> ${viewport.name} (${viewport.width}x${viewport.height})</p>
            <p><span class="label">Timestamp:</span> ${startTime.toLocaleString()}</p>
            <p><span class="label">Baseline File:</span> <code>${baselineImage}</code></p>
            ${!updateBaseline && testCaptured ? `<p><span class="label">Test Image File:</span> <code>${testImage}</code></p>`: ''}
            <p><span class="label">Baseline Size:</span> ${baselineBox ? `${baselineBox.width}x${baselineBox.height}` : (baselineExists ? 'Error reading size' : 'N/A')}</p>
            ${!updateBaseline && testCaptured ? `<p><span class="label">Test Size:</span> ${testBox ? `${testBox.width}x${testBox.height}` : 'N/A'}</p>` : ''}
            ${statusMessageFinal}
            ${diffMessageFinal}
        </div>

         ${!updateBaseline ? `
        <div class="comparison">
            <div class="image-container">
                <h2>Baseline Image</h2>
                ${baselineExists ? `<img class="report-image" src="${baselineImagePath}" alt="Baseline Image" style="cursor: pointer;" title="Click to zoom">` : '<p class="error">Baseline Missing</p>'}
            </div>
            <div class="image-container">
                <h2>Test Image</h2>
                 ${testCaptured ? `<img class="report-image" src="${testImagePath}" alt="Test Image" style="cursor: pointer;" title="Click to zoom">` : '<p class="error">Not Captured</p>'}
            </div>
             <div class="image-container">
                <h2>Difference</h2>
                ${diffImagePath 
                    ? `<img class="report-image" src="${diffImagePath}" alt="Difference" style="cursor: pointer;" title="Click to zoom">` 
                    : (baselineExists && testCaptured && diffPercentage >= 0 
                        ? (diffPercentage === 0 
                            ? '<p class="success">No visual difference detected.</p>' 
                            : '<p class="warning">Differences were within noise thresholds (diff image not applicable or not generated if pixels matched after canvas alignment).</p>') 
                        : '<p class="warning">Diff image not generated or not applicable (e.g., error, baseline update, or no test image).</p>')
                }
            </div>
        </div>
        ` : `
         <div class="comparison">
             <div class="image-container" style="max-width: 48%;">
                 <h2>New Baseline Image Saved</h2>
                  ${baselineExists && baselineImage ? `<a href="${baselineImagePath}" target="_blank"><img class="report-image" src="${baselineImagePath}" alt="New Baseline ${testName}" style="cursor: pointer;" title="Click to zoom"></a>` : '<p class="error">Error saving or displaying baseline</p>'}
             </div>
         </div>
        `}

    </div>

    <!-- --- Modal HTML Structure --- -->
    <div id="imageModal" class="modal">
        <span class="modal-close" title="Close">&times;</span>
        <img class="modal-content" id="modalImage">
    </div>
    <!-- --- End Modal HTML --- -->

     <script>
        // --- Modal Javascript --- 
        const modal = document.getElementById("imageModal");
        const reportImages = document.querySelectorAll(".report-image"); // Get all report images
        const modalImg = document.getElementById("modalImage");
        const closeBtn = document.querySelector(".modal-close");

        reportImages.forEach(img => {
             img.onclick = function(){
                 if (this.src && this.src !== window.location.href) { // Check if src is not empty and not just the page URL
                     modal.style.display = "block";
                     modalImg.src = this.src;
                 }
             }
         });

        if (closeBtn) {
             closeBtn.onclick = function() {
                 modal.style.display = "none";
            }
        }

        window.onclick = function(event) {
             if (event.target == modal) {
                 modal.style.display = "none";
            }
        }
        // --- End Modal Javascript ---
     </script>
</body>
</html>`;

    return reportHTML;
}

module.exports = { createReport };
