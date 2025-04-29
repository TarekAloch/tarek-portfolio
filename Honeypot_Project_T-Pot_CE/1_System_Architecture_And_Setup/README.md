# System Architecture and Setup 🏗️ 

## Overview

This section documents the system architecture and deployment methodology used for the T-Pot CE honeypot environment. A key challenge addressed in this project was successfully **co-hosting the multi-container T-Pot stack alongside existing production web services** on a single Oracle Cloud Infrastructure (OCI) ARM instance. Understanding this architecture is key to appreciating the configuration and troubleshooting steps detailed elsewhere in this portfolio.

## Contents 📜

*   **[System Architecture](./System_Architecture.md):** Comprehensive documentation of the honeypot deployment architecture, including:
    *   Core infrastructure components (OCI, Docker, Nginx, Cloudflare)
    *   Network traffic flow and routing logic
    *   Container relationships and key configurations
    *   Reverse proxy integration strategy (System Nginx vs. T-Pot Nginx)
    *   Secure administrative access methods
    *   A visual architecture diagram using Mermaid.

## Key Design Considerations ✨

The architecture documented herein addresses several critical requirements:

1.  **Resource Efficiency:** Maximizing the utility of a single cloud instance by supporting both production websites and security research systems.
2.  **Service Isolation:** Ensuring the honeypot services do not interfere with legitimate web traffic, primarily through careful Nginx proxying and Docker networking.
3.  **Secure Administration:** Maintaining reliable administrative access via a non-standard port (`[ADMIN_SSH_PORT]`) and custom firewall rules, even with T-Pot's dynamic rule modifications.
4.  **Traffic Management:** Leveraging System Nginx as the central reverse proxy to intelligently route traffic to appropriate services or honeypots based on hostname or lack thereof.
5.  **Realistic Deception:** Exposing honeypots on standard service ports where possible to attract and analyze authentic attack traffic.

## References 📚

This deployment utilizes T-Pot CE 24.04.1 by Deutsche Telekom Security GmbH. For more information on the base T-Pot project, see the [CITATION.cff](../CITATION.cff) file.