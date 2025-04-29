# Case Study: Attack Map Data Sanitization 

## 1. Introduction

Exposing honeypot data visualizations publicly, such as the T-Pot Attack Map hosted at `honeypot.tarek.ai`, requires careful sanitization to prevent leakage of sensitive infrastructure details. This case study chronicles the troubleshooting process undertaken to remove the server's real IP address (`[REDACTED_SERVER_IP]`) and internal hostname (`[REDACTED_HOSTNAME]`) from the map's data stream and UI.

## 2. Problem Statement

The T-Pot Attack Map, served via a backend service (`map_web`) and proxied by the host Nginx, displayed the server's sensitive IP and hostname within dynamically generated map popups. This information leakage needed to be mitigated before the map could be safely shared.

## 3. Investigation Phase 1: Server-Side Nginx `sub_filter`

*   **Hypothesis:** Nginx's `sub_filter` module could perform simple string replacements on the proxied HTTP response body, replacing sensitive data before it reached the browser.
*   **Implementation:** Added `sub_filter` directives to the `location /map/` block within `/etc/nginx/sites-available/honeypot.tarek.ai.conf`:
    ```nginx
    # Example Attempt (Simplified)
    sub_filter "[REDACTED_SERVER_IP]" "honeypot.tarek.ai";
    sub_filter "[REDACTED_HOSTNAME]" "honeypot";
    sub_filter_once off;
    sub_filter_types text/html application/javascript application/json; # Apply broadly
    ```
*   **Outcome:** **Failure.**
    *   While potentially effective for static text, `sub_filter` could not reliably target dynamically generated content within the map's JavaScript.
    *   More critically, enabling *any* `sub_filter` rules in this context caused severe performance issues (timeouts, connection errors) and broke the map's frontend JavaScript initialization.
*   **Conclusion:** Nginx `sub_filter` was unsuitable due to performance impact and inability to handle dynamic content effectively in this application. All `sub_filter` rules for sanitization were removed.

## 4. Investigation Phase 2: Content Security Policy (CSP) Issues

*   **Observation:** Even after removing `sub_filter`, browser console errors related to Content Security Policy (CSP) violations persisted, blocking external scripts like Cloudflare Insights.
*   **Root Cause:** A conflict existed between:
    *   A permissive CSP header added by Nginx (`add_header Content-Security-Policy "script-src 'self' 'unsafe-inline' static.cloudflareinsights.com;" always;`).
    *   A stricter, conflicting CSP embedded as a `<meta>` tag in the backend `map_web` application's `index.html` (`<meta http-equiv="Content-Security-Policy" content="script-src 'self'; object-src 'none'">`). The meta tag likely took precedence.
*   **Mitigation:** The conflicting `<meta>` tag needed to be removed or commented out. Initial attempts to do this via `sub_filter` failed (due to the performance issues noted above). The final resolution involved overriding the backend `index.html` using a Docker volume mount (detailed in Phase 5).

## 5. Investigation Phase 3: Client-Side JavaScript (`custom-sanitizer.js`)

*   **Hypothesis:** If server-side filtering failed, sanitization could be performed client-side using JavaScript to modify the DOM after the map content was loaded.
*   **Implementation:**
    1.  **Script (`custom-sanitizer.js`):** Developed a script using `MutationObserver` and `TreeWalker` to monitor the DOM for changes (specifically within map popups like `.leaflet-popup-content`) and replace sensitive strings in newly added text nodes. Logic was wrapped in a `DOMContentLoaded` listener.
    2.  **Nginx Serving:** Configured Nginx (`honeypot.tarek.ai.conf`) to serve this script via an `alias` directive under `location = /custom-sanitizer.js`.
    3.  **Injection:** The script tag (`<script src="/custom-sanitizer.js"></script>`) needed to be injected into the `map_web` backend's `index.html`. Initial non-persistent injection used `docker exec ... sed`.
*   **Outcome:** **Partial Success, Major Debugging Challenges.**
    *   The script logic seemed sound, but real-world browser testing yielded inconsistent results. Sanitization often failed, console logs showed mixed messages from old and new script versions, and the map sometimes rendered incorrectly.
    *   Stubborn caching (browser, Nginx, Cloudflare) was suspected of serving outdated script versions or interfering with execution. Hard refreshes and Nginx reloads were insufficient.

## 6. Investigation Phase 4: Puppeteer Verification

*   **Goal:** Eliminate client-side variables (caching, extensions) by using Puppeteer (headless Chromium) for automated testing directly on the server.
*   **Implementation:**
    1.  Installed Node.js/npm/Puppeteer.
    2.  Developed a test script (`check_map.js`) to navigate to the map URL, click a marker, wait for the popup, extract its content, and check for sensitive strings. Extensive logging was added.
*   **Outcome:** **Confirmation and Diagnosis.**
    *   Puppeteer tests consistently failed, confirming the issue wasn't client-side caching alone.
    *   Debugging revealed that the Nginx alias serving `/custom-sanitizer.js` was sometimes serving an old or incomplete version, despite file updates on the host. The exact cause of Nginx's serving inconsistency wasn't fully pinned down but might have related to its own caching or file handle mechanisms.
    *   This phase proved the client-side approach, while potentially workable, was fragile and susceptible to complex delivery/caching issues.

## 7. Investigation Phase 5: Python Backend Modification (Final Solution)

*   **Hypothesis:** The most robust solution is to sanitize the data at its source, before it's even published for the map backend to consume.
*   **Target:** The `DataServer_v2.py` script running within the T-Pot `map_data` container. This script queries Elasticsearch and publishes attack data to a Redis channel (`attack-map-production`), which the `map_web` container subscribes to.
*   **Implementation:**
    1.  **Script Modification:** Edited `DataServer_v2.py` to add find-and-replace logic for `[REDACTED_SERVER_IP]` and `[REDACTED_HOSTNAME]` within the `json_data` *before* it's published to Redis via `redis_publisher.publish()`. Also updated deprecated `datetime.datetime.utcnow()` calls.
    2.  **Persistent Override:** Configured a Docker volume mount for the `map_data` service (via Portainer stack editor) to map the modified script from the host (e.g., `/home/ubuntu/tpotce/data/map_data_override/DataServer_v2.py`) to the container's path (`/opt/t-pot-attack-map/DataServer_v2.py`), ensuring the fix persists across container restarts.
    3.  **CSP Fix:** Used a similar volume mount for the `map_web` service to override its `index.html`, providing a version where the problematic `<meta>` CSP tag was commented out.
    4.  **Cleanup:** Disabled the now-redundant client-side script injection and Nginx serving location for `custom-sanitizer.js`.
*   **Verification:**
    *   Inspecting data published to the Redis channel confirmed sanitized values.
    *   Checking the map page source and live popups showed no sensitive information.
    *   CSP errors related to the `<meta>` tag were resolved.
*   **Outcome:** **Success.** Server-side sanitization via Python script modification proved effective, robust, and easier to manage than the previous attempts.

## 8. Lessons Learned

*   **Sanitize at the Source:** Whenever possible, sanitize sensitive data as early in the data pipeline as possible (e.g., before publishing or storage) rather than relying on downstream filtering (like proxies or client-side scripts), which can be less reliable and performant.
*   **Nginx `sub_filter` Limitations:** Be cautious using `sub_filter` on complex, dynamically generated application responses. It can introduce significant performance overhead and break frontend JavaScript. It's best suited for simple replacements in static or semi-static content.
*   **Client-Side Scripting Challenges:** While powerful, client-side sanitization is vulnerable to caching issues, browser inconsistencies, and potential bypass. It also requires careful handling of dynamic content loading (e.g., using `MutationObserver`).
*   **Headless Browser Testing:** Tools like Puppeteer are invaluable for debugging frontend issues in a controlled server-side environment, helping to isolate problems by eliminating client-side variables like browser caching and extensions.
*   **Docker Volume Overrides:** Using Docker volume mounts to override specific configuration files or scripts within containers is an effective way to customize container behavior persistently without rebuilding images.
*   **CSP Conflicts:** Be aware of multiple CSP sources (HTTP headers vs. `<meta>` tags) and their potential conflicts. Headers are generally preferred, but embedded tags can interfere.

*(Note: Placeholders like `[REDACTED_SERVER_IP]`, `[REDACTED_HOSTNAME]` are used for sanitization.)* 