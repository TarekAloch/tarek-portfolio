# Nginx Configuration: honeypot.tarek.ai Domain 🗺️🔒

This document details the Nginx configuration specifically used to handle traffic directed to the `honeypot.tarek.ai` domain. This configuration is crucial for securely exposing specific T-Pot visualization components (the Attack Map) via Cloudflare Tunnel while protecting administrative interfaces.

## Configuration File

The relevant configuration is typically located at `/etc/nginx/sites-available/honeypot.tarek.ai.conf` and enabled via a symlink in `/etc/nginx/sites-enabled/`.

## Key Objectives

1.  **Secure Access Endpoint:** Serve as the internal endpoint (`127.0.0.1:[CF_TUNNEL_TARGET_PORT]`) for the `cloudflared` service, receiving traffic securely tunneled from Cloudflare's edge for `honeypot.tarek.ai`.
2.  **Expose Attack Map:** Proxy requests for the `/map/` path and `/websocket` path to the internal T-Pot Attack Map backend service (`map_web` container listening on `127.0.0.1:[MAP_BACKEND_PORT]`).
3.  **Serve Landing Page:** Provide a simple static HTML landing page for the domain root (`/`).
4.  **Block Admin Access:** Explicitly block access to sensitive T-Pot management interface paths (e.g., `/kibana/`, `/elasticsearch/`) when accessed via this public domain, returning a 404.
5.  **Apply Security Headers:** Add necessary security headers, including a Content Security Policy (CSP) suitable for the Attack Map application.

## Sanitized Configuration Snippets & Explanation

```nginx
# /etc/nginx/sites-available/honeypot.tarek.ai.conf (Illustrative Snippets)

# Map variable for WebSocket upgrades (Standard practice)
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Main Server Block - Listens Internally for Cloudflare Tunnel
server {
    listen 127.0.0.1:[CF_TUNNEL_TARGET_PORT]; # e.g., 64293
    server_name honeypot.tarek.ai;

    # SSL configuration might be needed here depending on tunnel setup
    # ssl_certificate /path/to/cert.pem;
    # ssl_certificate_key /path/to/key.pem;

    # --- Security Headers ---
    # Example: Content Security Policy tailored for Attack Map
    # 'unsafe-inline' is often required for map libraries but reduces XSS protection.
    add_header Content-Security-Policy "script-src 'self' 'unsafe-inline';" always;
    # Add other headers like HSTS, X-Frame-Options etc. as appropriate

    # --- Block Admin Paths ---
    location ^~ /kibana/ { return 404; }
    location ^~ /elasticsearch/ { return 404; }
    # Add other T-Pot admin paths here...

    # --- Proxy Attack Map Application ---
    location /map/ {
        proxy_pass http://127.0.0.1:[MAP_BACKEND_PORT]/; # Target map backend root

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr; # Will be 127.0.0.1 from tunnel
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme; # Should be 'https' if tunnel terminates SSL

        # WebSocket Support (Essential for live map updates)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;

        # Other proxy settings (timeouts, buffers) can be tuned here
        proxy_read_timeout 90s; # Adjust as needed
        proxy_send_timeout 90s;
        proxy_ssl_verify off; # If backend uses self-signed cert
    }

    # --- Proxy WebSocket Endpoint ---
    location /websocket {
        proxy_pass http://127.0.0.1:[MAP_BACKEND_PORT]/websocket; # Target specific path

        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        # Ensure appropriate headers are passed for WebSocket origin checks etc.
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 3600s; # Long timeout for persistent connection
        proxy_send_timeout 3600s;
    }

    # --- Serve Static Landing Page ---
    location / {
        root /var/www/html/honeypot.tarek.ai; # Path to your landing page files
        index index.html;
        try_files $uri $uri/ =404; # Standard static file serving
    }

    # --- Logging ---
    access_log /var/log/nginx/honeypot.tarek.ai-access.log;
    error_log /var/log/nginx/honeypot.tarek.ai-error.log warn;

    # --- Historical Note: Failed sub_filter Sanitization Attempt ---
    # Previous attempts to use Nginx 'sub_filter' within this block to sanitize
    # sensitive IPs ([REDACTED_SERVER_IP]) and hostnames ([REDACTED_HOSTNAME])
    # from the map's output failed due to performance issues and JavaScript
    # conflicts, ultimately requiring a server-side Python modification.
    # See the Data Sanitization Subproject section for details.

```    
