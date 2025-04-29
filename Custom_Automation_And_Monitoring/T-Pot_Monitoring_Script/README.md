# T-Pot Monitoring Script (`tpot-monitor.sh`) 🩺

This directory contains `tpot-monitor.sh`, a comprehensive Bash script designed specifically to monitor the health, status, and configuration of a T-Pot CE honeypot deployment and the underlying host system.

## Motivation: Solving Operational Challenges

In managing a complex, multi-container T-Pot instance co-hosted with other services, I encountered several operational challenges:
*   Intermittent container failures or restart loops (like `p0f`) weren't always obvious.
*   Identifying resource bottlenecks (CPU/Memory/Disk) across numerous containers was time-consuming.
*   Diagnosing network connectivity issues or potential `iptables` conflicts required multiple manual checks.
*   Understanding which specific honeypot ports were active and correctly configured needed constant verification.

This script was developed to automate these checks, providing a single pane of glass for assessing the operational health of the entire deployment, significantly reducing troubleshooting time and helping to optimize the running configuration by identifying problematic containers.

## Features


## Features

*   **Container Monitoring:** ✅ Checks if essential honeypot containers and core T-Pot services (Elasticsearch, Kibana, Nginx, etc.) are running using `docker ps`.


*   **Log Analysis:** 📄 Scans recent container logs (`docker logs --tail 20`) for common error patterns (error, exception, fail, fatal, killed).


*   **Resource Checks:** 💾 Monitors container CPU/Memory usage (`docker stats`) and overall system disk (`df`), memory (`free`), and load average (`uptime`).


*   **Port Status:** 🚦 Detects listening ports associated with containers (`docker inspect`, `docker port`, `ss`), checks if they are accessible (`nc`), identifies the listening process (`ss -tulnp`), and intelligently handles different Docker network modes (host vs. bridge).


*   **Network Configuration:**
    *   🛡️ Analyzes `iptables` rules (`iptables -L`), specifically looking for common T-Pot issues like NFQUEUE rules potentially blocking honeypot ports and checking for explicit ACCEPT/BLOCK rules.
    *   🕸️ Checks if Nginx (system or Docker) is configured to proxy specific ports by inspecting config files (`grep`).


*   **Connectivity Checks:** 🌐 Verifies external connectivity (ping `8.8.8.8`, DNS resolution via `host`), checks public IP (`curl`), detects NAT presence, and tests outbound connectivity on common ports (`nc portquiz.net`).


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

# Run only the iptables checks
sudo ./tpot-monitor.sh -m iptables

# Enable debug output and export results
sudo ./tpot-monitor.sh -d -e tpot_report.txt

# Show help message
./tpot-monitor.sh --help
```