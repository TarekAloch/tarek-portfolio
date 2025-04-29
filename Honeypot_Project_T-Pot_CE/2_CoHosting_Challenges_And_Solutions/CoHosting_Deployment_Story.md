# Case Study: Co-Hosting T-Pot CE Honeypot with Web Services

## 1. Introduction

Deploying the T-Pot Community Edition (CE) honeypot suite presents significant benefits for threat intelligence gathering. However, its default assumption of having dedicated host resources, particularly standard network ports (like 80, 443, 22), creates significant challenges when attempting to co-host it with other essential services, such as administrative SSH access and legitimate web applications, on a single server. This case study details the challenges encountered and solutions implemented to achieve stable co-existence on an Oracle Cloud Infrastructure (OCI) ARM server.

Containerization via Docker, while providing essential isolation, adds layers of complexity through intricate container networking, port mapping requirements, shared resource management, and persistent volume configurations. Navigating these Docker-specific hurdles was crucial for the project's success.

## 2. Problem Statement

The primary challenges requiring custom solutions were:

*   **Port Conflicts:** T-Pot's numerous honeypots (especially web and SSH emulators like Cowrie) inherently conflict with the system's Nginx reverse proxy (ports 80/443 needed for production websites) and the essential administrative SSH service (port 22). Simply mapping ports led to immediate binding failures.
*   **Firewall Management & Admin Lockout:** T-Pot's automated `iptables` modifications, particularly the `f2b-sshd` chain designed to block attackers interacting with the port 22 honeypot, proved overly aggressive. **Diagnosing the cause of intermittent administrative lockouts was challenging**, as standard SSH troubleshooting failed due to these dynamic, honeypot-triggered firewall rules blocking access even to the designated non-standard admin port (`[ADMIN_SSH_PORT]`). Rules from the `recent` module compounded the issue.
*   **Resource Optimization & Honeypot Selection:** The default T-Pot configuration included honeypots (like Dionaea) that were resource-intensive and functionally overlapped with other, more specialized honeypots. This led to inefficiencies and exacerbated port conflicts on the shared server.

## 3. Investigation and Resolution Process

### 3.1. Addressing Port Conflicts: Nginx as the Gatekeeper

*   **Initial Approach:** Attempting to bind conflicting honeypots to `127.0.0.1` on non-standard ports worked initially but necessitated an overly complex and brittle system Nginx configuration to proxy traffic back.
*   **Refined Strategy (Nginx Routing):**
    *   **Admin SSH:** The host's SSH service was decisively relocated to `[ADMIN_SSH_PORT]`, dedicating the standard port 22 solely to the Cowrie honeypot.
    *   **Web Traffic (80/443):** The system-level Nginx was designated the exclusive listener on external ports 80/443. It intelligently routes traffic:
        *   Requests matching configured `server_name` blocks (e.g., `tarek.ai`) are served directly.
        *   A `default_server` block acts as a catch-all for direct IP access or unknown domains, proxying HTTP traffic to an internal Snare instance (`127.0.0.1:[SNARE_INTERNAL_PORT]`) and HTTPS traffic to an internal h0neytr4p instance (`127.0.0.1:8043`).
    *   **Other Honeypots:** Non-conflicting honeypots were configured to bind directly to their standard ports externally.

### 3.2. Stabilizing Firewall Rules: Systemd to the Rescue

*   **Problem:** The T-Pot-managed `iptables` rules (blocking IPs interacting with port 22) were blocking admin access to `[ADMIN_SSH_PORT]` because they were evaluated *before* the rule allowing admin access.
*   **Solution:** A custom script and systemd service were created to ensure admin access rules always have priority.
    1.  **Prioritization Script (`preserve-admin.sh` - Conceptual):** Developed a script containing `iptables` commands specifically designed to insert (`-I`) `ACCEPT` rules for `[ADMIN_SSH_PORT]` at the **top** of the `INPUT` chain and, as a defense-in-depth measure, `RETURN` rules at the top of T-Pot's `f2b-sshd` chain. It also included logic to clean up conflicting `recent` module rules.
    2.  **Systemd Service (`ssh-port-preserve.service` - Conceptual):** Defined a `oneshot` systemd service unit to execute the prioritization script. **Crucially, using `Before=tpot.service` ensured this service runs *after* Docker and T-Pot potentially start but *before* the T-Pot service fully initializes its firewall rules, allowing the script to reliably insert the admin rules with top priority.**
    3.  **Enablement:** Enabling the service (`systemctl enable ssh-port-preserve.service`) automated this fix during boot and restarts.

### 3.3. Optimizing Honeypot Selection (Dionaea Removal & Override File Discovery)

*   **Analysis:** Dionaea's broad emulation created resource strain and port conflicts (FTP, SMB, SQL) better handled by dedicated honeypots like Heralding.
*   **Action:** Removed Dionaea entirely from the primary `docker-compose.yml`, reassigning ports to specialized alternatives.
*   **Troubleshooting:** Encountered perplexing `docker compose up` failures still referencing Dionaea. The investigation eventually uncovered an unmanaged `docker-compose.override.yml` file containing a stale Dionaea definition, which Docker Compose was implicitly merging.
*   **Resolution:** Renaming the override file (`docker-compose.override.yml.old`) prevented its automatic inclusion and resolved the deployment failures.

## 4. Final Configuration State

*   System Nginx expertly routes external web traffic, separating legitimate sites from honeypot interactions directed to internal Snare/h0neytr4p instances.
*   Admin SSH remains secure and accessible on `[ADMIN_SSH_PORT]`.
*   Cowrie effectively captures port 22 interactions, protected by T-Pot's dynamic blocking.
*   A streamlined set of specialized honeypots binds directly to other standard ports.
*   The custom systemd service guarantees `iptables` rules prioritize administrative access over T-Pot's dynamic rules.
*   Dionaea is removed, optimizing resource usage.
*   Internal management interfaces (Kibana) are accessed securely via SSH tunnel to `127.0.0.1:[T_POT_WEB_UI_PORT]`.
*   **Benefit:** This resolved configuration creates a **robust, multi-purpose environment** that maximizes threat intelligence gathering via broad honeypot exposure while guaranteeing the reliability of production services and maintaining secure, prioritized administrative access.

## 5. Lessons Learned

*   **Co-Hosting Requires Strategic Proxying:** Directly exposing standard ports from multiple applications on one host is generally infeasible. A well-configured reverse proxy (Nginx) acting as a traffic director based on hostnames/defaults is essential.
*   **Firewall Rule Order is Paramount:** When integrating tools that dynamically manipulate `iptables`, proactively managing rule execution order (e.g., using systemd service dependencies and `iptables -I` for top insertion) is critical to preserve essential connectivity. Never assume default rule application order will suffice.
*   **Beware Implicit Configurations:** Always check for hidden or implicit configuration files (like `docker-compose.override.yml`) that tools might automatically load, as they can override explicit settings and cause unexpected behavior.
*   **Specialize for Efficiency:** In complex or resource-limited environments, favor deploying multiple, focused, specialized tools over a single monolithic application attempting to cover all bases. This often leads to better performance, stability, and easier conflict resolution.
*   **Secure Admin Access Proactively:** Establishing and hardening secure administrative pathways (`[ADMIN_SSH_PORT]`, SSH key auth, firewall rules) should be a top priority *before* deploying potentially disruptive security tools that might interfere with access.

*(Note: Placeholders like `[ADMIN_SSH_PORT]`, `[SNARE_INTERNAL_PORT]`, `[T_POT_WEB_UI_PORT]` are used for sanitization.)*