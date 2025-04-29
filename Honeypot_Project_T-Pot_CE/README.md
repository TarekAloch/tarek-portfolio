# Honeypot Project: T-Pot CE Deployment & Customization


## Introduction

This section details the deployment, configuration, and challenges associated with setting up the T-Pot CE (Community Edition) honeypot environment on an Oracle Cloud Infrastructure (OCI) ARM server, specifically focusing on co-hosting it alongside other web services.

## Introduction

This section details the deployment, configuration, and challenges associated with setting up the T-Pot CE (Community Edition) honeypot environment on an Oracle Cloud Infrastructure (OCI) ARM server, specifically focusing on co-hosting it alongside other web services.

⚠️ **Heads-Up: Running Honeypots in Shared Spaces**

Figuring out how to run the full T-Pot suite while keeping my other websites online on the same OCI box was a key part of this project. It involved wrangling Nginx to route traffic correctly and creating custom firewall rules (managed with `systemd`) so T-Pot wouldn't accidentally lock me out – you can read about those adventures here. I put effort into keeping things separate and locking down admin access.

But remember the golden rule: **honeypots are built to attract attacks.** While co-hosting is *technically* possible, as shown here, mixing honeypots with critical systems or sensitive data significantly raises the stakes. If you're protecting crucial business operations or user info, this shared approach probably isn't the right fit without adding serious extra layers of security (think separate network segments, beefy intrusion prevention, etc.). 

The methods I used worked for *this* context, but please consider your own security needs carefully before running with this setup. Hope this helps, but use it responsibly! 


## Project Goals 🎯

*   Deploy a multi-service honeypot platform (T-Pot CE) to gather relevant threat intelligence from real-world attacks.
*   Customize the deployment for **co-hosting** alongside other web services on a single, resource-constrained server.
*   Implement secure and reliable data collection (ELK Stack) and visualization, including **securely exposing the live Attack Map visualization** via Cloudflare Tunnel while **sanitizing sensitive infrastructure data**.
*   Develop custom solutions for specific technical hurdles encountered, including network conflicts, firewall management, and data presentation security.

## Technologies Used 🛠️

*   **Honeypot Platform:** T-Pot CE (based on Debian)
*   **Containerization:** Docker, Docker Compose
*   **Web Server/Proxy:** Nginx (System Nginx & T-Pot Internal)
*   **Data Stack:** Elasticsearch, Logstash, Kibana (ELK Stack)
*   **Security/Tunneling:** Cloudflare Tunnel (`cloudflared`)
*   **Various Honeypots:** Cowrie, Heralding, Honeytrap, etc. (Optimized selection)
*   **Operating System:** Ubuntu Server (on OCI host)
*   **Cloud Platform:** Oracle Cloud Infrastructure (OCI)
*   **Scripting:** Bash (Monitoring/Admin), Python (Data Sanitization)

## Co-Hosting & Secure Map Exposure Approach 🌐🔒

A central challenge was adapting T-Pot to run effectively on a server hosting other applications. This involved:
*   Careful network configuration and port management to avoid conflicts.
*   Developing custom Nginx routing rules to separate honeypot traffic from legitimate site traffic.
*   Implementing advanced firewall management (`iptables` via `systemd`) to preserve administrative access.
*   **Securely routing the Live Attack Map** ([honeypot.tarek.ai](https://honeypot.tarek.ai)) through a Cloudflare Tunnel to the internal `map_web` service via the host Nginx proxy.
*   **Developing a server-side Python script modification** within the T-Pot `map_data` service to sanitize sensitive IP/hostname information *before* it reached the map visualization layer.

The detailed story of overcoming co-hosting challenges and implementing the data sanitization is available in the sub-directories below.

## Section Contents 🗺️

*   **[1_System_Architecture_And_Setup](./1_System_Architecture_And_Setup/)**: Describes the overall system architecture, data flow, and initial setup process.
*   **[2_CoHosting_Challenges_And_Solutions](./2_CoHosting_Challenges_And_Solutions/)**: Narrates the specific challenges and solutions related to running T-Pot alongside other services (including firewall management).
*   **[3_Nginx_Configuration_Strategy](./3_Nginx_Configuration_Strategy/)**: Explains the Nginx reverse proxy setup used for both the honeypot services and other applications.
*   **[4_Data_Sanitization_Subproject](./4_Data_Sanitization_Subproject/)**: Details the investigation and resolution of the Attack Map data sanitization issue.
*   **[5_Dashboard_Examples](./5_Dashboard_Examples/)**: Showcases examples of the data collected via Kibana dashboards and attack maps.