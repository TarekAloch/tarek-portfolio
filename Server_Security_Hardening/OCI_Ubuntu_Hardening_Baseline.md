# OCI Ubuntu Host Hardening Baseline 🛡️

This document outlines the foundational security hardening measures implemented on the Oracle Cloud Infrastructure (OCI) Ubuntu server hosting the T-Pot deployment. These steps were critical for minimizing the host's attack surface while allowing the honeypot services to function safely alongside other applications.

## Key Hardening Practices

1.  **Secure Remote Access (SSH Daemon Configuration):**
    *   **Non-Standard Port:** Configured the SSH daemon (`sshd`) to listen exclusively on a non-standard, high port (`[ADMIN_SSH_PORT]`) via `/etc/ssh/sshd_config.d/`, significantly reducing exposure to automated port 22 scans.
    *   **Authentication Hardening:** Disabled root login (`PermitRootLogin no`) and password-based authentication (`PasswordAuthentication no`), mandating SSH key-based authentication only via `sshd_config`.
    *   **Access Control:** Restricted logins to specific administrative user accounts using the `AllowUsers` directive and configured `MaxAuthTries` to mitigate brute-force attempts. *(Note: The client-side strategy for accessing internal services securely via this single SSH port using tunneling and `~/.ssh/config` is detailed in the [Secure Remote Access Architecture](./Secure_Remote_Access_Strategy.md) document within this section).*

2.  **Firewall Configuration:**
    *   **Cloud Layer (OCI):** Utilized OCI Network Security Groups (NSGs) / Security Lists as the primary external firewall. Inbound rules were configured restrictively, allowing traffic ONLY to essential public ports: `[ADMIN_SSH_PORT]`, Nginx web ports (80/443), and specific standard ports targeted by directly exposed honeypots (e.g., 22, 23, 25).
    *   **Host Layer (`iptables`):** While T-Pot dynamically manages many firewall rules, the underlying host policy aims for 'default deny' where feasible. Acknowledging potential conflicts, a custom systemd service (`ssh-port-preserve.service`) was implemented to **proactively insert `ACCEPT` rules** for `[ADMIN_SSH_PORT]` at the top of the `INPUT` chain on boot/restart. This crucial step prevents T-Pot's `f2b-sshd` rules from inadvertently blocking necessary administrative access. *(See Co-Hosting narrative for detailed `iptables` conflict resolution).*

3.  **System Updates and Patch Management:**
    *   **Automated Security Updates:** Configured `unattended-upgrades` to automatically apply critical security patches daily, ensuring timely remediation of known vulnerabilities.
    *   **Manual Review:** Regularly reviewed available updates (`apt list --upgradable`) and applied non-security or major version upgrades manually after assessing potential impact.

4.  **User Account Management:**
    *   **Least Privilege:** Operated primarily via a dedicated non-root user account with necessary `sudo` privileges configured via `/etc/sudoers.d/`. Root account usage was minimized.
    *   **Account Hygiene:** Default or unused system accounts were reviewed and disabled where possible.

5.  **Service Minimization:**
    *   **Reduced Footprint:** Conducted a review of running services (`systemctl list-units --type=service --state=running`). Services not essential for the host OS, Docker/T-Pot operation, Nginx proxying, or core system functions were disabled (`systemctl disable --now <service_name>`) to minimize the potential attack surface.

6.  **Monitoring and Log Review (Host Level):**
    *   **Log Aggregation (Internal):** Leveraged the existing T-Pot ELK stack primarily for honeypot logs. Essential host system logs (e.g., `/var/log/auth.log`, `syslog`, `journalctl`) were monitored through standard Linux review practices.
    *   **Failed Login Monitoring:** Monitored `/var/log/auth.log` specifically for repeated failed logins, unusual source IPs, or indications of successful unauthorized access targeting the admin port `[ADMIN_SSH_PORT]`.
    *   **Configuration Auditing:** Periodically reviewed critical configuration files (`sshd_config`, `nginx` configs, `sudoers`) for unintended changes or misconfigurations, using local `git` for tracking changes in key directories like `/etc/nginx/sites-available/`.

## Continuous Improvement

These baseline measures provide essential protection. Further enhancements considered include more advanced host-based intrusion detection (`fail2ban` beyond SSH), system call auditing (`auditd`), file integrity monitoring (`AIDE`), and centralized logging for host system events to provide deeper visibility beyond the honeypot data.

*(Note: Sanitized placeholders like `[ADMIN_SSH_PORT]` are used.)*