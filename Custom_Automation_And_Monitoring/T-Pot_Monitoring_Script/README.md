# T-Pot Monitoring Script (`tpot-monitor.sh`) 🩺

This directory contains `tpot-monitor.sh`, a comprehensive Bash script designed specifically to monitor the health, status, and configuration of a T-Pot CE honeypot deployment and the underlying host system.

## Motivation: Solving Operational Challenges

In managing a complex, multi-container T-Pot instance co-hosted with other services, I encountered several operational challenges:
*   Intermittent container failures or restart loops (like `p0f`) weren't always obvious.
*   Identifying resource bottlenecks (CPU/Memory/Disk) across numerous containers was time-consuming.
*   Diagnosing network connectivity issues or potential `iptables` conflicts required multiple manual checks.
*   Understanding which specific honeypot ports were active and correctly configured needed constant verification.

This script was developed to automate these checks, providing a single pane of glass for assessing the operational health of the entire deployment, significantly reducing troubleshooting time and helping to optimize the running configuration by identifying problematic containers.

## Key Design Goals / Philosophy 🧭

This script was built with the following core principles in mind:

*   **Configuration Agnostic:** Designed to work across various T-Pot configurations by **dynamically detecting active honeypot containers and their exposed ports**, regardless of Docker network mode (host vs. bridge) or specific port mappings, eliminating the need for manual configuration updates for different honeypot selections.
*   **Comprehensive Health Checks:** Goes beyond simple "is it running?" checks to analyze logs, resource usage, network accessibility, complex firewall rule interactions (including NFQUEUE rule order and raw table entries), Nginx proxy configurations, and core system health indicators.
*   **Actionable Insights:** Aims to not only identify problems (Errors/Warnings) but also provide context and potential troubleshooting suggestions, particularly for common `iptables` conflicts often encountered in T-Pot deployments.

## Why This Matters: Value Proposition ✨

Manually checking the status of ~20+ containers, their resource usage, associated ports, complex firewall rules, Nginx proxy settings, and system health is incredibly time-consuming and error-prone. This script **automates dozens of checks into a single command**, providing rapid, consistent, and deep visibility into the honeypot's operational status. In complex co-hosted environments, this proactive monitoring is crucial for maintaining stability and ensuring reliable data collection. It transforms hours of potential manual diagnosis into seconds of automated assessment.

## Features

*   **Container Monitoring:** ✅ Checks if essential honeypot containers (dynamically discovered) and core T-Pot services (Elasticsearch, Kibana, Nginx, etc.) are running using `docker ps`.
*   **Log Analysis:** 📄 Scans recent container logs (`docker logs --tail 20`) for common error patterns (error, exception, fail, fatal, killed).
*   **Resource Checks:** 💾 Monitors container CPU/Memory usage (`docker stats`) and overall system disk (`df`), memory (`free`), and load average (`uptime`).
*   **Port Status:** 🚦 **Dynamically detects listening ports** associated with containers across **host/bridge modes** (using `docker inspect`, `docker port`, `exec ss/netstat/ps`, T-Pot specific config checks), verifies port listening status (`ss`), checks local connectability (`nc`), and identifies the listening process (`ss -tulnp`).
*   **Network Configuration:**
    *   🛡️ **Deeply analyzes `iptables` rules** (`iptables -L`), specifically checking for explicit ACCEPT/BLOCK rules, identifying potentially problematic **NFQUEUE rules**, verifying correct **rule order precedence** (ACCEPT vs. NFQUEUE), checking for relevant rules in the **raw table**, and suggesting fixes for common T-Pot related firewall conflicts.
    *   🕸️ Checks if Nginx (system or Docker) is configured to proxy specific ports by inspecting config files (`grep`).
*   **Connectivity Checks:** 🌐 Verifies external connectivity (ping `8.8.8.8`, DNS resolution via `host`), checks public IP (`curl`), detects NAT presence, and tests outbound connectivity on common ports (`nc portquiz.net`) to identify potential ISP blocking.
*   **System Health:** ⚙️ Checks for failed Docker containers (`docker ps -a`), OOM killer activations (`dmesg`), Docker service status (`systemctl`), and system uptime (`uptime`).
*   **Flexible Execution:** ⚙️ Allows checking all components, specific containers (`-c`), specific ports (`-p`), or focusing on modes like `iptables` or `connectivity` (`-m`).
*   **Output & Logging:** 🎨 Provides colored console output (OK ✅, WARNING 🟡, ERROR ❌), supports debug mode (`-d`), and logs detailed results to a timestamped file in `/tmp/`.

## Usage

The script requires `sudo` or root privileges for certain checks (like `iptables`, `ss -p`, `dmesg`).

```bash
# Run all checks (requires sudo/root)
sudo ./tpot-monitor.sh

# Check only the 'cowrie' container
sudo ./tpot-monitor.sh -c cowrie

# Check only port 22 status
sudo ./tpot-monitor.sh -p 22

# Run only the iptables checks (deep analysis)
sudo ./tpot-monitor.sh -m iptables

# Enable debug output and export results
sudo ./tpot-monitor.sh -d -e tpot_report.txt

# Show help message
./tpot-monitor.sh --help