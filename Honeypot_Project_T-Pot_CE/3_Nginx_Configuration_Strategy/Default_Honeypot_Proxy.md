# Nginx Configuration: Default Honeypot Proxy (`main.conf`)

This document describes the Nginx configuration, typically found in `/etc/nginx/sites-available/main.conf` (and enabled via symlink), that acts as the **default handler** for incoming web traffic (Ports 80/443) and traffic on specific other honeypot ports. It ensures that any requests *not* explicitly matching a configured domain name (like `tarek.ai` or `honeypot.tarek.ai`) are strategically directed to appropriate honeypot services.

## Configuration File

The relevant configuration is typically located at `/etc/nginx/sites-available/main.conf` and enabled via a symlink in `/etc/nginx/sites-enabled/`. It contains `server` blocks marked with the `default_server` directive.

## Key Objectives & Functions

1.  **Catch-All Web Traffic:** Handle web requests (ports 80/443) made directly to the server's IP address (`[REDACTED_SERVER_IP]`) or to domains pointed at the server but not explicitly defined elsewhere. This traffic is treated as potentially malicious or reconnaissance.
2.  **Proxy to Web Honeypots:** Forward unmatched HTTP (port 80) traffic primarily to the Snare honeypot, and unmatched HTTPS (port 443) traffic to the h0neytr4p honeypot, both running internally. Specific paths on port 80 can be routed to other web honeypots (Wordpot, etc.).
3.  **Restore Client IP:** Use Cloudflare headers (`CF-Connecting-IP`) via the `ngx_http_realip_module` to ensure the honeypots receive the original attacker's IP address, crucial for accurate logging and threat analysis.
4.  **Proxy Specific Non-Web Ports:** Listen on other standard service ports known to attract attacks (e.g., 9100 - Printer, 9200 - Elasticsearch, 631 - IPP, 6379 - Redis) and proxy this traffic to the corresponding specialized internal T-Pot honeypot containers (Miniprint, Elasticpot, IPPHoney, RedisHoneypot).
5.  **Domain Redirects:** Handle requests for older domains (`tarekaloch.com`, `taloch.com`) and redirect them permanently (301) to the primary site (`https://tarek.ai`).
6.  **Logging:** Maintain specific log formats (`honeypot_format`) and dedicated log files for honeypot traffic, including the restored client IP, ensuring efficient log rotation.

## Sanitized Configuration Snippets & Explanation

```nginx
# /etc/nginx/sites-available/main.conf (Relevant Sections)

# Define custom log format including forwarded/real IPs
# This format ensures the actual source IP (after Cloudflare restoration) is logged.
log_format honeypot_format '$remote_addr - $remote_user [$time_local] '
                         '"$request" $status $body_bytes_sent '
                         '"$http_referer" "$http_user_agent" '
                         'forwarded="$http_x_forwarded_for" '
                         'real_ip="$realip_remote_addr" '
                         'host="$host"';

# Define rate limiting zones (Optional but recommended for basic DoS mitigation)
# limit_req_zone $binary_remote_addr zone=http_honeypot:10m rate=10r/s;
# limit_req_zone $binary_remote_addr zone=https_honeypot:10m rate=10r/s;

# --- Default HTTP Server Block (Port 80 Catch-All) ---
server {
    listen 80 default_server;
    listen [::]:80 default_server;

    # Cloudflare IP Restoration
    # These directives use Cloudflare's provided IP ranges to identify traffic
    # coming through their proxy and extract the original visitor IP from the
    # CF-Connecting-IP header. $realip_remote_addr then holds the true source IP.
    set_real_ip_from 103.21.244.0/22;
    # ... (List all other current Cloudflare IP ranges here) ...
    set_real_ip_from 198.41.128.0/17;
    set_real_ip_from 2a06:98c0::/29;
    real_ip_header CF-Connecting-IP;

    # Default action: Forward all unmatched HTTP traffic to 'Snare' honeypot
    location / {
        proxy_bind 0.0.0.0; # Ensure Nginx binds correctly for proxying
        proxy_pass http://127.0.0.1:[SNARE_INTERNAL_PORT]; # e.g., 8080

        # Pass essential headers to the backend honeypot
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr; # IP seen by Nginx
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; # Includes original client IP if proxied
        proxy_set_header X-Forwarded-Proto $scheme; # http or https

        # WebSocket support (Optional, uncomment if needed by a honeypot behind '/')
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";

        # Apply rate limiting (Optional)
        # limit_req zone=http_honeypot burst=20 nodelay;

        # Log using the custom format; log rotation is handled by system's logrotate utility
        access_log /var/log/nginx/http-honeypot-access.log honeypot_format;
    }

    # Specific path proxies (Route specific URIs to different honeypots if needed)
    # Example: Forward /wordpress/ requests to Wordpot internal service
    # location /wordpress/ {
    #     proxy_pass http://127.0.0.1:8084/; # Wordpot internal port example
    #     proxy_set_header Host $host;
    #     proxy_set_header X-Real-IP $remote_addr;
    #     # ... other headers ...
    #     access_log /var/log/nginx/wordpot-access.log honeypot_format;
    # }
    # Add similar location blocks for /admin/, /api/, /log4j/, etc. if routing
    # to Gopot, Hellpot, Log4pot respectively is desired.
}

# --- Default HTTPS Server Block (Port 443 Catch-All) ---
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;

    # Basic SSL Config for Catch-All
    # Uses a self-signed (snakeoil) cert by default. This is sufficient as its only purpose
    # is to terminate the SSL connection for direct IP access before proxying internally.
    # Browser warnings are expected and irrelevant for this honeypot traffic.
    # Could be replaced with a Cloudflare Origin CA cert or LE cert for a generic name if desired.
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Basic SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    # Recommended: Add a strong cipher suite here

    # Cloudflare IP Restoration (Repeat from HTTP block for consistency)
    set_real_ip_from 103.21.244.0/22;
    # ... (other Cloudflare ranges) ...
    set_real_ip_from 2a06:98c0::/29;
    real_ip_header CF-Connecting-IP;
    real_ip_recursive on; # Important if Nginx itself is behind another proxy layer

    # Default action: Forward all unmatched HTTPS traffic to 'h0neytr4p' honeypot
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass https://127.0.0.1:8043; # h0neytr4p internal HTTPS port

        # Pass essential headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme; # Should be 'https'

        # WebSocket support (Optional)
        # proxy_http_version 1.1;
        # proxy_set_header Upgrade $http_upgrade;
        # proxy_set_header Connection "upgrade";

        # Disable SSL verification for the internal connection to h0neytr4p
        # This is necessary if h0neytr4p uses a self-signed certificate internally.
        proxy_ssl_verify off;

        # Apply rate limiting (Optional)
        # limit_req zone=https_honeypot burst=20 nodelay;

        # Logging
        access_log /var/log/nginx/https-honeypot-access.log combined; # Or honeypot_format
        error_log /var/log/nginx/https-honeypot-error.log warn;
    }
}

# --- Specific Non-Web Port Honeypot Proxies ---
# These server blocks listen on common attack ports and proxy to specialized honeypots.

# Example: Miniprint Honeypot (Printer - Port 9100)
server {
    listen 9100;
    # Optional: Cloudflare IP Restoration if needed for specific scenarios

    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:9101; # Internal Miniprint port example
        # Pass IP headers so Miniprint sees the attacker's real IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        access_log /var/log/nginx/miniprint-access.log honeypot_format;
    }
}

# Example: Elasticpot Honeypot (Elasticsearch - Port 9200)
server {
    listen 9200;
    # Optional: Cloudflare IP Restoration

    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:9201; # Internal Elasticpot port example
        # Pass IP headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        access_log /var/log/nginx/elasticpot-access.log honeypot_format;
    }
}

# Example: IPPHoney (IPP Printer Protocol - Port 631)
server {
    listen 631;
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:6311; # Internal IPPHoney port example
        # ... (proxy headers with IPs) ...
        access_log /var/log/nginx/ipphoney-access.log honeypot_format;
    }
}

# Example: RedisHoneypot (Redis Protocol - Port 6379)
server {
    listen 6379;
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:6380; # Internal RedisHoneypot port example
        # ... (proxy headers with IPs) ...
        access_log /var/log/nginx/redishoneypot-access.log honeypot_format;
    }
}

# Example: ADBHoney (Android Debug Bridge - Port 5555)
server {
    listen 5555;
    location / {
        proxy_bind 0.0.0.0;
        proxy_pass http://127.0.0.1:5556; # Internal ADBHoney port example
        # ... (proxy headers with IPs) ...
        access_log /var/log/nginx/adbhoney-access.log honeypot_format;
    }
}

# --- Old Domain Redirects ---
# These ensure traffic to legacy domains reaches the primary site.
server {
    listen 80;
    server_name tarekaloch.com www.tarekaloch.com;
    return 301 https://tarek.ai$request_uri;
}

server {
    listen 80;
    server_name taloch.com www.taloch.com;
    return 301 https://tarek.ai$request_uri;
}