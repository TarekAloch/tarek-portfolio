# Nginx Configuration: Default Honeypot Proxy (`main.conf`)

This document describes the Nginx configuration, typically found in `/etc/nginx/sites-available/main.conf`, that acts as the **default handler** for incoming web traffic and traffic on specific honeypot ports. It ensures that any web requests not explicitly matching a configured domain name (like `honeypot.tarek.ai` or other legitimate sites) are directed to honeypots.

## Configuration File

The relevant configuration is typically located at `/etc/nginx/sites-available/main.conf` and enabled via a symlink in `/etc/nginx/sites-enabled/`. It contains `server` blocks with the `default_server` directive.

## Key Objectives

1.  **Catch-All Web Traffic:** Handle web requests (ports 80/443) made directly to the server's IP address (`[REDACTED_SERVER_IP]`) or to domains pointed at the server but not explicitly defined in other Nginx site configurations.
2.  **Proxy to Web Honeypots:** Forward unmatched HTTP (port 80) traffic to the Snare honeypot and unmatched HTTPS (port 443) traffic to the h0neytr4p honeypot, both running internally.
3.  **Restore Client IP:** Use Cloudflare headers (`CF-Connecting-IP`) to ensure the honeypots receive the original attacker's IP address, not Cloudflare's.
4.  **Proxy Specific Ports:** Listen on other standard honeypot ports (e.g., 9100, 9200, 631, 6379) and proxy traffic to the corresponding internal T-Pot honeypot services.
5.  **Logging:** Maintain specific log formats and files for honeypot traffic.

## Sanitized Configuration Snippets & Explanation

```nginx
# /etc/nginx/sites-available/main.conf (Relevant Sections)

# Define custom log format including forwarded/real IPs
log_format honeypot_format '$remote_addr - $remote_user [$time_local] '
                         '"$request" $status $body_bytes_sent '
                         '"$http_referer" "$http_user_agent" '
                         'forwarded="$http_x_forwarded_for" '
                         'real_ip="$realip_remote_addr" '
                         'host="$host"';

# Define rate limiting zones (optional but recommended)
# limit_req_zone $binary_remote_addr zone=http_honeypot:10m rate=10r/s;
# limit_req_zone $binary_remote_addr zone=https_honeypot:10m rate=10r/s;

# --- Default HTTP Server Block ---
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    # Cloudflare IP Restoration (Apply if Cloudflare is used for DNS/Proxying the IP)
    # If traffic hits the IP directly *without* Cloudflare proxying,
    # $remote_addr will be the real IP, and these rules are benign.
    set_real_ip_from 103.21.244.0/22; # Add all Cloudflare IP ranges...
    # ... (other Cloudflare ranges) ...
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 2a06:98c0::/29;
    real_ip_header CF-Connecting-IP;
    # Use $realip_remote_addr in log_format to get the correct IP

    # Default action: Forward all unmatched HTTP traffic to 'Snare' honeypot
    location / {
        proxy_bind 0.0.0.0; # Ensure binding works correctly
        proxy_pass http://127.0.0.1:[SNARE_INTERNAL_PORT]; # Example: 8080

        # Pass essential headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr; # Nginx's view of connecting IP
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (optional, if Snare needs it)
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";

        # Apply rate limiting (optional)
        # limit_req zone=http_honeypot burst=20 nodelay;

        access_log /var/log/nginx/http-honeypot-access.log honeypot_format;
        
        # Logging configuration with rotation
        # Nginx logs are managed by logrotate with daily rotation, 
        # 14-day retention, and compression to prevent disk space issues
        # while maintaining sufficient forensic history for analysis.
    }

    # Specific path proxies (Optional - depends on T-Pot config)
    # Example: Forward /wordpress/ to Wordpot
    # location /wordpress/ {
    #     proxy_pass http://127.0.0.1:8084/; # Wordpot internal port
    #     # ... (proxy headers as above) ...
    #     access_log /var/log/nginx/wordpot-access.log honeypot_format;
    # }
}

# --- Default HTTPS Server Block ---
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    # Basic SSL Config (No specific domain match needed)
    # Use a self-signed (snakeoil) or basic cert. Doesn't need validation by client.
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Basic SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    # ... (basic cipher suite) ...

    # Cloudflare IP Restoration (Repeat from HTTP block)
    set_real_ip_from 103.21.244.0/22; # Add all Cloudflare IP ranges...
    # ... (other Cloudflare ranges) ...
    set_real_ip_from 2a06:98c0::/29;
    real_ip_header CF-Connecting-IP;
    real_ip_recursive on; # If Nginx is behind another proxy

    # Default action: Forward all unmatched HTTPS traffic to 'h0neytr4p' honeypot
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass https://127.0.0.1:8043; # h0neytr4p internal HTTPS port

        # Pass essential headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (optional)
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";

        # Disable SSL verification for the internal connection to h0neytr4p
        proxy_ssl_verify off;

        # Apply rate limiting (optional)
        # limit_req zone=https_honeypot burst=20 nodelay;

        access_log /var/log/nginx/https-honeypot-access.log combined; # Or honeypot_format
    }
}

# --- Specific Port Honeypot Proxies ---

# Example: Miniprint Honeypot (Printer - Port 9100)
server {
    listen 9100;
    # Cloudflare IP Restoration headers can be added here if needed/applicable

    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:9101; # Internal Miniprint port
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        access_log /var/log/nginx/miniprint-access.log honeypot_format;
    }
}

# Example: Elasticpot Honeypot (Elasticsearch - Port 9200)
server {
    listen 9200;
    # Cloudflare IP Restoration headers if needed

    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:9201; # Internal Elasticpot port
        # ... (proxy headers as above) ...
        access_log /var/log/nginx/elasticpot-access.log honeypot_format;
    }
}

# Add similar server blocks for other ports needing proxying
# (e.g., 631 -> IPPHoney, 6379 -> RedisHoneypot)
```

**Key Points:**

*   **`default_server`:** This flag is key. These server blocks handle traffic only if no other `server_name` matches the request's `Host` header.
*   **Web Honeypot Proxy:** Unmatched HTTP goes to Snare (e.g., on `127.0.0.1:[SNARE_INTERNAL_PORT]`), unmatched HTTPS goes to h0neytr4p (on `127.0.0.1:8043`).
*   **Cloudflare IP:** The `set_real_ip_from` and `real_ip_header` directives are essential if Cloudflare proxies traffic to the server's IP, ensuring logs capture the true source IP.
*   **Basic SSL:** The HTTPS `default_server` uses a basic/snakeoil certificate because it doesn't need browser validation; its purpose is just to terminate the SSL connection before proxying internally.
*   **Port Proxies:** Separate `server` blocks listen on specific honeypot ports (like 9100, 9200) and proxy them to the corresponding internal Docker service ports. This is necessary for honeypots that cannot bind directly to the host port or require header manipulation provided by Nginx.
*   **Logging:** Custom log formats (`honeypot_format`) help capture relevant information, including the real client IP restored from Cloudflare headers.

*(Note: Placeholders like `[REDACTED_SERVER_IP]`, `[SNARE_INTERNAL_PORT]` are used for sanitization.)* 

# Default Honeypot Proxy Configuration (`main.conf`)

This Nginx configuration file (`/etc/nginx/sites-available/main.conf`, typically symlinked to `/etc/nginx/sites-enabled/main.conf`) serves as the **default handler** for web traffic hitting the server on ports 80 (HTTP) and 443 (HTTPS) that does *not* match any other specific `server_name` defined in other configuration files (like `tarek.ai.conf`, `cbsworcester.conf`, etc.). Its primary purpose is to route this potentially malicious or reconnaissance traffic to designated web honeypots.

## Key Functions

1.  **Default Server:** Uses the `default_server` directive on `listen 80` and `listen 443 ssl` to catch all traffic not claimed by more specific server blocks.
2.  **HTTP (Port 80) Handling:**
    *   Listens on port 80 for both IPv4 and IPv6.
    *   The main `location /` block proxies all requests to the **Snare** honeypot, typically listening internally on `http://127.0.0.1:8080`.
    *   Includes specific `location` blocks (e.g., `/wordpress/`, `/admin/`, `/api/`, `/log4j/`, `/gopot/`, `/hellpot/`, `/log4pot/`) that proxy traffic to other specific HTTP honeypots (Wordpot, Gopot, Hellpot, Log4pot) listening on internal ports.
    *   Sets essential proxy headers (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`) to preserve original client information.
    *   Enables WebSocket support.
    *   Applies rate limiting (`limit_req zone=http_honeypot`) to mitigate simple DoS attacks.
    *   Uses a custom log format (`honeypot_format`) for detailed logging (`http-honeypot-access.log`).
3.  **HTTPS (Port 443) Handling:**
    *   Listens on port 443 for both IPv4 and IPv6, using SSL/TLS.
    *   Specifies SSL certificates (`ssl-cert-snakeoil.pem` by default, but ideally replaced with a valid certificate, e.g., from Cloudflare Origin CA or Let's Encrypt for a generic name) to establish the encrypted connection.
    *   Configures strong SSL protocols (`TLSv1.2`, `TLSv1.3`) and ciphers.
    *   Includes `set_real_ip_from` directives for Cloudflare IP ranges and uses `real_ip_header CF-Connecting-IP` to restore the true visitor IP address.
    *   The main `location /` block proxies all requests to the **H0neytr4p** honeypot, typically listening internally on `https://127.0.0.1:8043`.
    *   Sets essential proxy headers, enables WebSocket support, and disables SSL verification (`proxy_ssl_verify off;`) for the internal connection to the honeypot.
    *   Sets longer proxy timeouts suitable for honeypot interactions.
    *   Logs access (`https-honeypot-access.log`).
4.  **Non-Web Honeypot Proxying:**
    *   Contains separate `server` blocks listening on specific non-standard ports used by certain honeypots (e.g., 9100 for Miniprint, 9200 for Elasticpot, 631 for IPPHoney, 6379 for Redishoneypot, 5555 for ADBHoney).
    *   These blocks proxy traffic received on the host port to the corresponding honeypot service listening internally (e.g., 9101, 9201, 6311, 6380, 5556 respectively).
    *   Crucially, they also set the `X-Real-IP` and `X-Forwarded-For` headers, ensuring these honeypots also receive the original attacker's IP address rather than just `127.0.0.1`.
5.  **Domain Redirects:**
    *   Includes server blocks listening on port 80 for specific older domains (`tarekaloch.com`, `taloch.com`) that issue a permanent redirect (301) to the primary domain (`https://tarek.ai`).

## Snippet Example (HTTPS Default Proxy)

```nginx
# HTTPS server - catches all requests not matched by other server blocks
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    
    # SSL configuration (snakeoil default)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    
    # Cloudflare support - real IP restoration
    # ... (set_real_ip_from directives) ...
    real_ip_header CF-Connecting-IP;
    real_ip_recursive on;
    
    # Forward all HTTPS traffic to h0neytr4p honeypot
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass https://127.0.0.1:8043; # Target H0neytr4p
        
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        
        proxy_ssl_verify off; # Allow self-signed cert from honeypot
        
        # ... (Timeouts, Logging) ...
    }
}
```

## Snippet Example (Non-Web Honeypot Proxy - Miniprint)

```nginx
# Miniprint Honeypot
server {
    listen 9100;
    
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:9101; # Target Miniprint internal port
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        access_log /var/log/nginx/miniprint-access.log honeypot_format;
    }
}
```

This configuration ensures that any web traffic not explicitly handled by configurations for legitimate domains is directed towards appropriate honeypots, maximizing the capture surface while protecting the real services. 