# Nginx Configuration Strategy: Enabling Co-Hosting 🧭🚦

## Overview

This section details the **critical Nginx configuration strategy** developed to enable the co-existence of the T-Pot honeypot suite and multiple legitimate web applications on a single host server. A robust, flexible routing approach was essential to correctly handle diverse traffic types, isolate services, ensure security, and accurately log attacker information.

## Core Strategy: Site-Specific Routing + Default Honeypot Proxy

The foundation of this solution lies in leveraging Nginx's server block matching logic combined with careful proxying:

1.  **Site-Specific Configurations:**
    *   Dedicated `server` blocks (e.g., `tarek.ai.conf`, `honeypot.tarek.ai.conf`) utilize `server_name` directives to precisely handle traffic for known public domains.
    *   These blocks manage crucial functions like SSL/TLS termination (using valid certs compatible with Cloudflare "Full (strict)"), HTTP-to-HTTPS redirection, serving static content, and reverse proxying to specific application backends (like the T-Pot Attack Map).

2.  **Default Honeypot Proxy (`main.conf`):**
    *   A catch-all configuration using the `default_server` flag handles traffic *not* matching specific `server_name` directives (typically direct IP access or scans for unconfigured domains). This traffic is assumed malicious or exploratory.
    *   This default block intelligently **proxies** web traffic (Ports 80/443) to internal web honeypots (Snare, h0neytr4p) designed to engage such probes.
    *   Crucially, it also includes dedicated `server` blocks listening on other standard service ports (e.g., 9100 for printing, 6379 for Redis) which proxy traffic to specialized internal T-Pot honeypots, ensuring maximum capture surface while preserving original attacker IP information via `X-Forwarded-For` headers.

**Resulting Traffic Flow Logic:**

*   Request hits Nginx -> `Host` header checked.
*   **Match?** -> Routed via site-specific config (Website / Attack Map).
*   **No Match / IP Access?** -> Routed via `default_server` config to appropriate web honeypot.
*   **Specific Honeypot Port Hit (e.g., 9100)?** -> Handled by dedicated proxy block in `main.conf`.

## Why This Strategy Was Effective ✨

This tailored Nginx configuration was key to solving the co-hosting challenge:

*   **Targeted Isolation:** Precisely separates legitimate production traffic from honeypot interactions, preventing interference.
*   **Maximized Intelligence:** Ensures unassigned IP-based traffic and scans are captured by dedicated honeypots, rather than being dropped or hitting real services.
*   **Configuration Clarity:** Using separate files for distinct sites/functions enhances maintainability compared to a single monolithic config.
*   **Infrastructure Compatibility:** Allows correct SSL/TLS handling for public sites while using simpler internal configurations for honeypot proxies.
*   **Accurate Logging:** Incorporates Cloudflare IP restoration (`set_real_ip_from`) ensuring accurate source IP logging even behind a CDN/proxy.

## Files in this Section 📄

*   **[Honeypot_Domain_Proxy.md](./Honeypot_Domain_Proxy.md):** Explains the specific logic for handling the `honeypot.tarek.ai` domain, including Cloudflare Tunnel integration, Attack Map proxying, and blocking admin UI access.
*   **[Default_Honeypot_Proxy.md](./Default_Honeypot_Proxy.md):** Details the `main.conf` catch-all logic for proxying web traffic and specific ports to various internal honeypots.