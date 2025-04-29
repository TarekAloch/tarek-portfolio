# Data Sanitization Subproject 🛡️

## Overview

A critical requirement for publicly exposing visualizations derived from the honeypot data, specifically the T-Pot Attack Map, was to prevent the leakage of sensitive infrastructure details. This section documents the challenge and the eventual solution implemented to sanitize the data stream powering the map.

## The Problem: Information Leakage 💧

The T-Pot Attack Map visualization, when proxied via Nginx to `honeypot.tarek.ai`, initially included sensitive information in the data sent to the browser and displayed in map popups:

*   **Server IP Address:** The public IP address of the OCI server (`[REDACTED_SERVER_IP]`) was exposed.
*   **Server Hostname:** The internal hostname (`[REDACTED_HOSTNAME]`) was exposed.

This leakage posed a security risk and needed to be addressed before the map could be safely shared.

## Investigation & Attempts 🕵️‍♂️

Several methods were investigated and attempted to achieve server-side sanitization:

1.  **Nginx `sub_filter`:** Initial attempts involved using Nginx's `sub_filter` module within the `honeypot.tarek.ai.conf` proxy configuration to replace the sensitive strings in the HTTP response body. *(Failed due to performance/breakage)*.
2.  **Client-Side JavaScript:** A subsequent attempt involved injecting custom JavaScript (`custom-sanitizer.js`) into the map's HTML page to modify the DOM content after rendering. *(Functional but complex and prone to caching issues)*.

## Solution: Python Backend Script Modification 🐍 ✅

The successful and currently implemented solution involved modifying the Python script responsible for querying Elasticsearch and publishing data to the Redis channel used by the Attack Map backend.

*   **Target:** The `DataServer_v2.py` script running within the T-Pot `map_data` Docker container.
*   **Method:** Logic was added directly into the Python script to perform find-and-replace operations on the sensitive IP (`[REDACTED_SERVER_IP]`) and hostname (`[REDACTED_HOSTNAME]`) patterns within the data *before* it was published to Redis.
*   **Implementation:** The modified script (`DataServer_v2_sanitized.py` in this repository) is made persistent within the running container using a Docker volume mount, overriding the original script.

This server-side approach ensures that sensitive data is sanitized at the source, before ever reaching the map's web backend, Redis, or the browser, providing a robust and reliable solution.

## Why This Sanitization Matters: Fundamental Security Principles 🧭

Sanitizing this data wasn't just cosmetic; it directly aligns with core security principles crucial for operating public-facing security tools like honeypots safely:

1.  **Principle of Least Exposure:** Minimizing the unnecessary disclosure of internal infrastructure details (server IPs, internal hostnames) significantly reduces the attack surface and information available to potential adversaries analyzing the honeypot's behavior or traffic.
2.  **Defense in Depth:** While firewalls and access controls form outer layers, sanitizing data at the source adds an internal layer of protection, preventing sensitive information from leaking out even if other layers are bypassed or misconfigured.
3.  **Balance of Intelligence vs. Risk:** The goal is to gather valuable threat intelligence from honeypot interactions without creating undue risk by revealing specifics about the underlying infrastructure hosting the honeypot.
4.  **Operational Security (OPSEC):** Implementing robust sanitization is a key aspect of maintaining good OPSEC for any system, especially one designed to interact with potentially hostile traffic.

These techniques can and should be transferred over to other projects (when applicable) to maintain a security-minded focus.

## Adapting for Your Environment

If you wish to use the `DataServer_v2_sanitized.py` script in your own T-Pot deployment to sanitize different IP addresses or hostnames, you will need to modify the following variables within the script's `--- BEGIN SANITIZATION LOGIC ---` block:

*   `SENSITIVE_IP`: Change the placeholder IP string to the actual IP address you want to hide.
*   `REPLACEMENT_IP`: Change the placeholder domain to the value you want to replace the sensitive IP with.
*   `SENSITIVE_HOSTNAME_PATTERN`: Update the `re.compile()` pattern to match the specific hostname(s) you need to hide. Remember to handle case-insensitivity (`re.IGNORECASE`) if needed.
*   `REPLACEMENT_HOSTNAME`: Change the placeholder string to the value you want to replace sensitive hostnames with.

Ensure the modified script is then used to replace the original `DataServer_v2.py` in your `map_data` container, typically via a persistent Docker volume mount.

## Files in this Section 📂

*   **[CaseStudy_Attack_Map_Data_Sanitization.md](./CaseStudy_Attack_Map_Data_Sanitization.md):** Provides a detailed narrative of the investigation process.
*   **[DataServer_v2_sanitized.py](./DataServer_v2_sanitized.py):** The modified Python script containing the implemented sanitization logic.

*(Note: Placeholders like `[REDACTED_SERVER_IP]`, `[REDACTED_HOSTNAME]` are used for sanitization.)*