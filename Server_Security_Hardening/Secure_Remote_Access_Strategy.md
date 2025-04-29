# Secure Remote Access Architecture 🔐

## Overview

Securing administrative access to the T-Pot host server, especially given its exposure to potential threats and its co-hosting role, required a multi-layered strategy focused on minimizing the external attack surface while enabling necessary internal access. This document outlines the core components of this secure access architecture.

## Core Principles

1.  **Minimize External Exposure:** Reduce the number of listening ports exposed directly to the internet to the absolute minimum.
2.  **Strong Authentication:** Mandate the use of robust, non-password-based authentication methods.
3.  **Least Privilege:** Restrict direct administrative access and elevate privileges only when necessary.
4.  **Firewall Resilience:** Ensure critical access pathways remain open despite dynamic firewall changes by other applications (like T-Pot).
5.  **Secure Internal Access:** Provide a mechanism to securely reach internal management interfaces without exposing them directly.

## Implementation Details

1.  **Single Hardened SSH Entry Point:**
    *   **Non-Standard Port:** The SSH daemon (`sshd`) listens exclusively on a non-standard, high port (`[ADMIN_SSH_PORT]`), avoiding common port 22 scanners. (`Port [ADMIN_SSH_PORT]` in `sshd_config`)
    *   **Key-Only Authentication:** Password authentication and root login are disabled (`PasswordAuthentication no`, `PermitRootLogin no`), enforcing stronger SSH key-based authentication.
    *   **Access Control:** Logins are restricted to specific administrative users (`AllowUsers`), and brute-force attempts are mitigated (`MaxAuthTries`).

2.  **Firewall Configuration (Multi-Layer):**
    *   **Cloud Layer (OCI):** Network Security Groups restrict inbound traffic primarily to `[ADMIN_SSH_PORT]` from trusted sources, plus necessary honeypot and web ports.
    *   **Host Layer (`iptables`):** A custom `systemd` service (`tpot-ssh-preserve.service`) guarantees the `iptables` rule allowing access to `[ADMIN_SSH_PORT]` takes precedence over potentially conflicting dynamic rules added by T-Pot, ensuring reliable admin connectivity. *(Detailed in Co-Hosting Case Study)*.


## Security Outcome

This architecture provides robust security by:
*   Drastically reducing the number of ports exposed to external scanning.
*   Enforcing strong, key-based SSH authentication.
*   Ensuring reliable admin access despite dynamic firewall changes.
*   **Providing secure, multiplexed access to all internal management tools via a single, authenticated SSH tunnel, managed efficiently through client-side configuration.**

This strategy demonstrates a practical application of defense-in-depth and secure access principles in a complex hosting environment.

---
*For a detailed explanation of the client-side SSH configuration strategy used to securely access multiple internal services via this hardened entry point, please see the [Case Study: Secure Multiplexed Access via SSH Config](../Troubleshooting_Case_Studies/1_CaseStudy_Secure_Multiplexed_Access_via_SSH_Config.md).*


*(Note: Sanitized placeholders like `[ADMIN_SSH_PORT]`, `[KIBANA_PORT]`, `[REDACTED_SERVER_IP]`, `[ADMIN_USER]` are used.)*