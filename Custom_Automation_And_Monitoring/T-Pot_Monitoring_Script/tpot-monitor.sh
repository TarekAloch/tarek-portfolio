#!/bin/bash

# T-Pot Honeypot Monitoring Script
# Author: Tarek Aloch
# Date: April 10, 2025
# Purpose: Comprehensive monitoring for T-Pot honeypot deployment
# Works with any honeypot configuration

# Version information
VERSION="1.0.0"

# Color codes for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Default configuration
DEBUG_MODE=0
OUTPUT_FORMAT="text"
CHECK_MODE="all"
SPECIFIC_CONTAINER=""
SPECIFIC_PORT=""
EXPORT_FILE=""
LOG_FILE="/tmp/tpot-monitor-$(date +%Y%m%d-%H%M%S).log"

# Status tracking
TOTAL_CHECKS=0
PASSED_CHECKS=0
WARNING_CHECKS=0
FAILED_CHECKS=0

# Display help message
show_help() {
    cat << EOF
T-Pot Honeypot Monitoring Script v${VERSION}
Usage: $0 [options]

Options:
  -h, --help             Show this help message
  -c, --container NAME   Check only the specified container
  -p, --port PORT        Check only the specified port
  -m, --mode MODE        Set check mode: all, containers, ports, system, iptables, connectivity
  -d, --debug            Enable debug output
  -o, --output FORMAT    Output format: text (default), json, csv
  -e, --export FILE      Export results to file
  -v, --version          Show version information

Examples:
  $0                     Run all checks
  $0 -c cowrie           Check only the Cowrie honeypot
  $0 -p 22               Check only port 22
  $0 -m iptables         Only check iptables configuration
  $0 -m connectivity     Only check external connectivity
  $0 -d -e report.txt    Run in debug mode and export to report.txt

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ "$#" -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -c|--container)
                SPECIFIC_CONTAINER="$2"
                shift 2
                ;;
            -p|--port)
                SPECIFIC_PORT="$2"
                shift 2
                ;;
            -m|--mode)
                CHECK_MODE="$2"
                shift 2
                ;;
            -d|--debug)
                DEBUG_MODE=1
                shift
                ;;
            -o|--output)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -e|--export)
                EXPORT_FILE="$2"
                shift 2
                ;;
            -v|--version)
                echo "T-Pot Honeypot Monitoring Script v${VERSION}"
                exit 0
                ;;
            *)
                echo "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

# Function to print colored status
print_status() {
    local status=$1
    local message=$2
    
    case $status in
        "OK")
            echo -e "[${GREEN}✓${NC}] $message"
            ((PASSED_CHECKS++))
            ;;
        "WARNING")
            echo -e "[${YELLOW}!${NC}] $message"
            ((WARNING_CHECKS++))
            ;;
        "ERROR")
            echo -e "[${RED}✗${NC}] $message"
            ((FAILED_CHECKS++))
            ;;
        *)
            echo -e "[$status] $message"
            ;;
    esac
    
    ((TOTAL_CHECKS++))
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $status: $message" >> $LOG_FILE
}

# Function to log debug information
log_debug() {
    if [ "$DEBUG_MODE" = "1" ]; then
        echo -e "${YELLOW}DEBUG:${NC} $1"
    fi
    echo "DEBUG: $1" >> $LOG_FILE
}

# Function to get all T-Pot honeypot containers
get_honeypot_containers() {
    # Get all containers that are part of the T-Pot deployment
    # Exclude infrastructure containers
    local containers=$(docker ps --format '{{.Names}}' | grep -v -E 'elasticsearch|kibana|logstash|nginx|tpotinit|map_redis|tanner_redis|map_web|map_data|ewsposter|spiderfoot')
    
    echo $containers
}

# Function to detect container ports
detect_container_ports() {
    local container=$1
    local network_mode=$(docker inspect --format '{{.HostConfig.NetworkMode}}' $container)
    local ports=()
    
    log_debug "Detecting ports for container $container with network mode $network_mode"
    
    if [ "$network_mode" == "host" ]; then
        # For host network mode, try to detect from container configuration or processes
        
        # Try to get ports from container configuration
        local exposed_ports=$(docker inspect --format '{{range $port, $_ := .Config.ExposedPorts}}{{$port}} {{end}}' $container)
        
        # If that doesn't work, try to detect listening ports inside the container
        if [ -z "$exposed_ports" ]; then
            # Try using netstat inside the container
            exposed_ports=$(docker exec $container bash -c "netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null" | grep 'LISTEN' | awk '{print $4}' | awk -F: '{print $NF}' | sort -n | uniq)
            
            # If that doesn't work, try checking process command lines
            if [ -z "$exposed_ports" ]; then
                exposed_ports=$(docker exec $container ps aux 2>/dev/null | grep -o -E '\-p [0-9]+' | awk '{print $2}')
                
                # For cowrie specifically, check the config file
                if [ "$container" == "cowrie" ]; then
                    local cowrie_ports=$(docker exec $container grep -A 3 "listen_endpoints" /home/cowrie/cowrie/cowrie.cfg 2>/dev/null | grep -o -E 'tcp:[0-9]+:' | cut -d':' -f2)
                    if [ -n "$cowrie_ports" ]; then
                        exposed_ports="$exposed_ports $cowrie_ports"
                    fi
                fi
            fi
        fi
        
        # Create port entries with host network mode
        for port in $exposed_ports; do
            # Clean up port format (remove /tcp, etc.)
            port=$(echo $port | sed 's/\/.*$//')
            ports+=("$port:$port:tcp:host")
            # Also check for UDP
            if docker exec $container bash -c "netstat -tuln 2>/dev/null || ss -tuln 2>/dev/null" | grep -q "$port.*udp"; then
                ports+=("$port:$port:udp:host")
            fi
        done
    else
        # For bridge network mode, use docker port command
        local port_mappings=$(docker port $container 2>/dev/null)
        
        if [ -n "$port_mappings" ]; then
            while read -r mapping; do
                # Parse the host:port->container_port/protocol format
                local host_part=$(echo $mapping | awk -F'->' '{print $1}')
                local container_part=$(echo $mapping | awk -F'->' '{print $2}')
                
                local host_port=$(echo $host_part | awk -F':' '{print $NF}')
                local container_port=$(echo $container_part | awk -F'/' '{print $1}')
                local protocol=$(echo $container_part | awk -F'/' '{print $2}')
                
                ports+=("$container_port:$host_port:$protocol:bridge")
            done <<< "$port_mappings"
        else
            # No port mappings found - container might be using internal ports only
            # Check exposed ports from container config
            local exposed_ports=$(docker inspect --format '{{range $port, $_ := .Config.ExposedPorts}}{{$port}} {{end}}' $container)
            
            for port in $exposed_ports; do
                # Extract port and protocol
                local container_port=$(echo $port | awk -F'/' '{print $1}')
                local protocol=$(echo $port | awk -F'/' '{print $2}')
                
                # For internal ports, assume they're mapped to localhost on the same port
                local host_port=$container_port
                
                # Check if this is a localhost-bound port by checking docker-compose.yml
                # This is T-Pot specific logic
                if grep -q "127.0.0.1:$host_port" "$HOME/tpotce/docker-compose.yml" 2>/dev/null; then
                    ports+=("$container_port:$host_port:$protocol:bridge-internal")
                else
                    ports+=("$container_port:$host_port:$protocol:bridge")
                fi
            done
        fi
    fi
    
    # Return the ports array
    for port in "${ports[@]}"; do
        echo $port
    done
}

# Function to check if a container is running
check_container_running() {
    local container=$1
    
    log_debug "Checking if container $container is running"
    
    if docker ps -q --filter "name=^/$container$" | grep -q .; then
        print_status "OK" "Container $container is running"
        return 0
    else
        if docker ps -a -q --filter "name=^/$container$" | grep -q .; then
            local status=$(docker inspect --format '{{.State.Status}}' $container)
            print_status "ERROR" "Container $container is not running (status: $status)"
        else
            print_status "ERROR" "Container $container does not exist"
        fi
        return 1
    fi
}

# Function to check if a port is listening
check_port_listening() {
    local port=$1
    local protocol=$2
    local interface=$3
    
    if [ -z "$interface" ]; then
        interface="0.0.0.0"
    fi
    
    log_debug "Checking if port $port/$protocol is listening on $interface"
    
    if [ "$protocol" == "tcp" ]; then
        if ss -tuln | grep -q "$interface:$port"; then
            print_status "OK" "Port $port/$protocol is listening on $interface"
            return 0
        elif [ "$interface" == "0.0.0.0" ] && ss -tuln | grep -q ":$port"; then
            print_status "OK" "Port $port/$protocol is listening"
            return 0
        else
            print_status "ERROR" "Port $port/$protocol is NOT listening on $interface"
            return 1
        fi
    elif [ "$protocol" == "udp" ]; then
        if ss -tuln | grep -q "$interface:$port.*udp"; then
            print_status "OK" "Port $port/$protocol is listening on $interface"
            return 0
        elif [ "$interface" == "0.0.0.0" ] && ss -tuln | grep -q ":$port.*udp"; then
            print_status "OK" "Port $port/$protocol is listening"
            return 0
        else
            print_status "ERROR" "Port $port/$protocol is NOT listening on $interface"
            return 1
        fi
    fi
}

# Function to check which process is listening on a specific port
check_process_for_port() {
    local port=$1
    local protocol=$2
    
    log_debug "Checking which process is using port $port/$protocol"
    
    local pid_info=""
    if [ "$protocol" == "tcp" ]; then
        pid_info=$(ss -tulnp | grep ":$port" | grep "tcp")
    elif [ "$protocol" == "udp" ]; then
        pid_info=$(ss -tulnp | grep ":$port" | grep "udp")
    fi
    
    if [ -n "$pid_info" ]; then
        local process=$(echo "$pid_info" | sed -E 's/.*users:\(\("([^"]*)".*\)/\1/')
        print_status "OK" "Port $port/$protocol is being used by process: $process"
        return 0
    else
        print_status "WARNING" "Could not determine which process is using port $port/$protocol"
        return 1
    fi
}

# Function to check if iptables is blocking a port
check_iptables_rules() {
    local port=$1
    local protocol=$2
    
    log_debug "Checking iptables rules for port $port/$protocol"
    
    # Check for explicit ACCEPT rules
    local accept_rule=$(sudo iptables -L INPUT -n | grep -E "ACCEPT.*dpt:$port" | wc -l)
    
    # Check for REJECT or DROP rules
    local block_rule=$(sudo iptables -L INPUT -n | grep -E "(REJECT|DROP).*dpt:$port" | wc -l)
    
    # Check for NFQUEUE rules that might affect this port
    local nfqueue_rule=$(sudo iptables -L INPUT -n | grep "NFQUEUE" | wc -l)
    
    # Check if there's a rule in raw table for this port (common in T-Pot)
    local raw_rule=0
    if command -v iptables-save >/dev/null 2>&1; then
        raw_rule=$(sudo iptables-save -t raw 2>/dev/null | grep -E "dpt:$port" | wc -l)
    fi
    
    # Check chain priorities (if NFQUEUE comes before ACCEPT)
    local has_nfqueue_before_accept=0
    if [ $nfqueue_rule -gt 0 ] && [ $accept_rule -gt 0 ]; then
        # Check rule positions
        local nfqueue_position=$(sudo iptables -L INPUT -n --line-numbers | grep "NFQUEUE" | head -1 | awk '{print $1}')
        local accept_position=$(sudo iptables -L INPUT -n --line-numbers | grep -E "ACCEPT.*dpt:$port" | head -1 | awk '{print $1}')
        
        if [ -n "$nfqueue_position" ] && [ -n "$accept_position" ] && [ $nfqueue_position -lt $accept_position ]; then
            has_nfqueue_before_accept=1
        fi
    fi
    
    if [ $block_rule -gt 0 ]; then
        print_status "ERROR" "Port $port/$protocol is explicitly BLOCKED by iptables"
        echo "   Suggested fix: sudo iptables -I INPUT -p $protocol --dport $port -j ACCEPT"
        return 1
    elif [ $has_nfqueue_before_accept -eq 1 ]; then
        print_status "ERROR" "NFQUEUE rule comes BEFORE ACCEPT for port $port/$protocol"
        echo "   Suggested fix: sudo iptables -I INPUT 1 -p $protocol --dport $port -j ACCEPT"
        return 1
    elif [ $accept_rule -gt 0 ]; then
        print_status "OK" "Port $port/$protocol has explicit ACCEPT rule in iptables"
        return 0
    elif [ $nfqueue_rule -gt 0 ]; then
        print_status "WARNING" "Port $port/$protocol might be affected by NFQUEUE rules"
        echo "   Suggested fix: sudo iptables -I INPUT 1 -p $protocol --dport $port -j ACCEPT"
        return 2
    elif [ $raw_rule -gt 0 ]; then
        print_status "WARNING" "Port $port/$protocol has rules in raw table"
        return 2
    else
        print_status "OK" "No blocking iptables rules found for port $port/$protocol"
        return 0
    fi
}

# Function to check if a port is accessible from the outside
check_port_accessible() {
    local port=$1
    local protocol=$2
    local host=$(hostname -I | awk '{print $1}')
    
    log_debug "Checking if port $port/$protocol is accessible from outside"
    
    if [ "$protocol" == "tcp" ]; then
        # For TCP ports, we can use nc to test locally
        timeout 3 nc -z -v -w1 $host $port &>/dev/null
        if [ $? -eq 0 ]; then
            print_status "OK" "Port $port/$protocol is accessible from local network"
            return 0
        else
            print_status "ERROR" "Port $port/$protocol is NOT accessible from local network"
            return 1
        fi
    elif [ "$protocol" == "udp" ]; then
        # For UDP, we can try a simple test with netcat if it supports UDP
        if nc -h 2>&1 | grep -q "udp"; then
            # This is a very basic check and might not be reliable for all UDP services
            timeout 3 nc -u -z -v -w1 $host $port &>/dev/null
            if [ $? -eq 0 ]; then
                print_status "OK" "UDP Port $port appears to be accessible from local network"
                return 0
            else
                print_status "WARNING" "UDP Port $port might not be accessible from local network"
                echo "   Note: UDP connectivity checks are not always reliable"
                return 2
            fi
        else
            print_status "WARNING" "Cannot check UDP port accessibility (netcat doesn't support UDP)"
            return 2
        fi
    fi
}

# Function to check external connectivity for the honeypot
check_honeypot_connectivity() {
    echo -e "\n${BOLD}Checking External Connectivity${NC}"
    
    # Get public IP
    local public_ip=$(curl -s https://ifconfig.me 2>/dev/null || wget -qO- https://ifconfig.me 2>/dev/null)
    if [ -n "$public_ip" ]; then
        print_status "OK" "Public IP address: $public_ip"
    else
        print_status "WARNING" "Could not determine public IP address"
    fi
    
    # Check Internet connectivity
    if ping -c 1 -W 2 8.8.8.8 &>/dev/null; then
        print_status "OK" "Internet connectivity is working"
    else
        print_status "ERROR" "Internet connectivity issue detected"
        echo "   This might affect external access to honeypots"
    fi
    
    # Check DNS resolution
    if host google.com &>/dev/null; then
        print_status "OK" "DNS resolution is working"
    else
        print_status "WARNING" "DNS resolution issue detected"
    fi
    
    # Check if the host is behind NAT
    local private_ip=$(hostname -I | awk '{print $1}')
    if [[ "$private_ip" == "10."* ]] || [[ "$private_ip" == "192.168."* ]] || [[ "$private_ip" == "172.1"* ]] || [[ "$private_ip" == "172.2"* ]] || [[ "$private_ip" == "172.3"* ]]; then
        if [ "$private_ip" != "$public_ip" ]; then
            print_status "WARNING" "Host appears to be behind NAT (Private IP: $private_ip, Public IP: $public_ip)"
            echo "   This might require port forwarding for honeypot access"
        fi
    fi
    
    # Check for common ports being blocked by ISP/firewall
    echo -e "\n${BOLD}Checking for Commonly Blocked Ports${NC}"
    # Test outbound connectivity on common ports
    local test_ports="21 22 23 25 80 443 445 1433 3306 5432"
    for port in $test_ports; do
        if timeout 3 nc -z -w1 portquiz.net $port &>/dev/null; then
            print_status "OK" "Outbound connectivity on port $port is working"
        else
            print_status "WARNING" "Outbound connectivity on port $port might be blocked"
            echo "   This might indicate your ISP is filtering this port"
        fi
    done
}

# Function to check if a port can be connected to locally
check_port_connectable() {
    local port=$1
    local protocol=$2
    
    log_debug "Checking if port $port/$protocol is connectable locally"
    
    if [ "$protocol" == "tcp" ]; then
        # For TCP, try to connect and see if something responds
        timeout 2 bash -c "echo '' > /dev/tcp/localhost/$port" 2>/dev/null
        if [ $? -eq 0 ]; then
            print_status "OK" "Port $port/tcp is connectable locally"
            return 0
        else
            print_status "WARNING" "Port $port/tcp is listening but might not be responding correctly"
            return 2
        fi
    elif [ "$protocol" == "udp" ]; then
        # For UDP, this is much harder to check reliably
        print_status "WARNING" "Cannot reliably check UDP port connectivity"
        return 2
    fi
}

# Function to check Nginx configuration for a port
check_nginx_for_port() {
    local port=$1
    
    log_debug "Checking Nginx configuration for port $port"
    
    # Check if Nginx is running
    if ! docker ps -q --filter "name=nginx" | grep -q .; then
        print_status "WARNING" "Nginx container is not running, skipping Nginx checks"
        return 2
    fi
    
    # Try checking system Nginx configuration first
    local nginx_conf_found=0
    if [ -f "/etc/nginx/sites-enabled/main.conf" ]; then
        if grep -q "listen.*$port" /etc/nginx/sites-enabled/main.conf; then
            nginx_conf_found=1
            local proxy_target=$(grep -A10 "listen.*$port" /etc/nginx/sites-enabled/main.conf | grep -o -E "proxy_pass [^;]+" | head -1 | awk '{print $2}')
            
            if [ -n "$proxy_target" ]; then
                print_status "OK" "System Nginx is configured to proxy port $port to $proxy_target"
                return 0
            fi
        fi
    fi
    
    # If not found in system Nginx, check Docker Nginx
    if [ $nginx_conf_found -eq 0 ]; then
        # Check Nginx configuration in container
        local nginx_conf=$(docker exec nginx cat /etc/nginx/conf.d/default.conf 2>/dev/null)
        if [ -z "$nginx_conf" ]; then
            nginx_conf=$(docker exec nginx cat /etc/nginx/nginx.conf 2>/dev/null)
        fi
        
        if echo "$nginx_conf" | grep -q "listen.*$port"; then
            local proxy_target=$(echo "$nginx_conf" | grep -A10 "listen.*$port" | grep -o -E "proxy_pass [^;]+" | head -1 | awk '{print $2}')
            
            if [ -n "$proxy_target" ]; then
                print_status "OK" "Docker Nginx is configured to proxy port $port to $proxy_target"
                return 0
            else
                print_status "WARNING" "Nginx is listening on port $port but no proxy_pass directive found"
                return 2
            fi
        else
            print_status "WARNING" "No Nginx configuration found for port $port"
            return 2
        fi
    fi
}

# Function to check container logs for errors
check_container_logs() {
    local container=$1
    
    log_debug "Checking logs for container $container"
    
    # Get last 20 lines of logs
    local log_output=$(docker logs --tail 20 $container 2>&1)
    
    # Check for common error patterns
    if echo "$log_output" | grep -qi -E "error|exception|fail|fatal|segmentation fault|killed"; then
        local error_count=$(echo "$log_output" | grep -i -E "error|exception|fail|fatal|segmentation fault|killed" | wc -l)
        print_status "WARNING" "Container $container has $error_count recent error logs"
        echo "$log_output" | grep -i -E "error|exception|fail|fatal|segmentation fault|killed" | head -3
        return 2
    else
        print_status "OK" "Container $container logs show no obvious errors"
        return 0
    fi
}

# Function to check container resources
check_container_resources() {
    local container=$1
    
    log_debug "Checking resources for container $container"
    
    # Get container stats (non-streaming)
    local stats=$(docker stats --no-stream $container 2>/dev/null)
    
    if [ -n "$stats" ]; then
        local cpu_usage=$(echo "$stats" | tail -n 1 | awk '{print $3}')
        local mem_usage=$(echo "$stats" | tail -n 1 | awk '{print $7}')
        
        print_status "OK" "Container $container resource usage: CPU: $cpu_usage, Memory: $mem_usage"
        
        # Warning if memory usage is high
        if [[ $mem_usage == *"%"* ]]; then
            local mem_pct=${mem_usage%"%"}
            if (( $(echo "$mem_pct > 90" | bc -l 2>/dev/null) )); then
                print_status "WARNING" "Container $container memory usage is very high: $mem_usage"
                return 2
            elif (( $(echo "$mem_pct > 75" | bc -l 2>/dev/null) )); then
                print_status "WARNING" "Container $container memory usage is high: $mem_usage"
                return 2
            fi
        fi
        
        return 0
    else
        print_status "WARNING" "Could not get resource statistics for container $container"
        return 2
    fi
}

# Function to check overall system health
check_system_health() {
    echo -e "\n${BOLD}Overall System Health${NC}"
    
    # Check disk space
    local disk_usage=$(df -h / | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ $disk_usage -gt 90 ]; then
        print_status "ERROR" "Disk usage is critical: $disk_usage%"
    elif [ $disk_usage -gt 75 ]; then
        print_status "WARNING" "Disk usage is high: $disk_usage%"
    else
        print_status "OK" "Disk usage is acceptable: $disk_usage%"
    fi
    
    # Check memory usage
    local memory_usage=$(free | grep Mem | awk '{print int($3/$2 * 100)}')
    if [ $memory_usage -gt 90 ]; then
        print_status "ERROR" "Memory usage is critical: $memory_usage%"
    elif [ $memory_usage -gt 75 ]; then
        print_status "WARNING" "Memory usage is high: $memory_usage%"
    else
        print_status "OK" "Memory usage is acceptable: $memory_usage%"
    fi
    
    # Check load average
    local load=$(uptime | awk -F'[a-z]:' '{ print $2}' | sed 's/,//g')
    local load_1m=$(echo $load | awk '{print $1}')
    local cpu_cores=$(nproc)
    local max_load=$(echo "$cpu_cores * 1.5" | bc 2>/dev/null || echo "$cpu_cores")
    
    if (( $(echo "$load_1m > $max_load" | bc -l 2>/dev/null) )); then
        print_status "WARNING" "System load is high: $load (on $cpu_cores cores)"
    else
        print_status "OK" "System load is normal: $load (on $cpu_cores cores)"
    fi
    
    # Check for failed Docker containers
    local failed_containers=$(docker ps -a -f status=exited -f status=dead --format "{{.Names}}")
    if [ -n "$failed_containers" ]; then
        print_status "ERROR" "Failed containers found: $failed_containers"
        echo "   Suggested fix: docker start $failed_containers"
    else
        print_status "OK" "No failed containers found"
    fi
    
    # Check for OOM killer activations
    local oom_count=$(dmesg | grep -c "Out of memory" 2>/dev/null)
    if [ $oom_count -gt 0 ]; then
        print_status "ERROR" "OOM killer has been activated $oom_count times"
        echo "   Suggested action: Check container memory limits"
    else
        print_status "OK" "No OOM killer activations detected"
    fi
    
    # Check Docker service
    if systemctl is-active --quiet docker 2>/dev/null; then
        print_status "OK" "Docker service is running"
    else
        print_status "ERROR" "Docker service is not running"
        echo "   Suggested fix: sudo systemctl start docker"
    fi
    
    # Check system uptime
    local uptime_seconds=$(cat /proc/uptime 2>/dev/null | awk '{print $1}' | cut -d. -f1)
    local uptime_days=$((uptime_seconds / 86400))
    
    if [ $uptime_days -gt 90 ]; then
        print_status "WARNING" "System uptime is $uptime_days days - consider scheduled reboots"
    else
        print_status "OK" "System uptime is $uptime_days days"
    fi
}

# Function to check T-Pot configuration
check_tpot_config() {
    echo -e "\n${BOLD}T-Pot Configuration${NC}"
    
    # Check if T-Pot services directory exists
    if [ -d "$HOME/tpotce" ]; then
        print_status "OK" "T-Pot installation directory exists at $HOME/tpotce"
    else
        print_status "WARNING" "T-Pot installation directory not found at $HOME/tpotce"
    fi
    
    # Check essential T-Pot services
    for svc in elasticsearch kibana logstash nginx; do
        if docker ps -q --filter "name=$svc" | grep -q .; then
            print_status "OK" "Core T-Pot service $svc is running"
        else
            print_status "ERROR" "Core T-Pot service $svc is not running"
        fi
    done
    
    # Check for T-Pot data directory
    if [ -d "$HOME/tpotce/data" ]; then
        print_status "OK" "T-Pot data directory exists"
        
        # Check disk space on data directory
        local data_disk_usage=$(df -h $HOME/tpotce/data | awk 'NR==2 {print $5}' | sed 's/%//')
        if [ $data_disk_usage -gt 90 ]; then
            print_status "ERROR" "T-Pot data directory disk usage is critical: $data_disk_usage%"
        elif [ $data_disk_usage -gt 75 ]; then
            print_status "WARNING" "T-Pot data directory disk usage is high: $data_disk_usage%"
        else
            print_status "OK" "T-Pot data directory disk usage is acceptable: $data_disk_usage%"
        fi
    else
        print_status "WARNING" "T-Pot data directory not found at $HOME/tpotce/data"
    fi
    
    # Check for T-Pot docker-compose file
    if [ -f "$HOME/tpotce/docker-compose.yml" ]; then
        print_status "OK" "T-Pot docker-compose file exists"
    else
        print_status "WARNING" "T-Pot docker-compose file not found"
    fi
}

# Function to check iptables nfqueue issue
check_iptables_nfqueue_issue() {
    echo -e "\n${BOLD}Checking for NFQUEUE Issues${NC}"
    
    # Check for NFQUEUE rules in the INPUT chain
    local nfqueue_rules=$(sudo iptables -L INPUT -n | grep "NFQUEUE" | wc -l)
    
    if [ $nfqueue_rules -gt 0 ]; then
        print_status "WARNING" "Found $nfqueue_rules NFQUEUE rules in the INPUT chain"
        echo "   These rules might be blocking honeypot connections"
        
        # List the NFQUEUE rules
        echo "   NFQUEUE rules:"
        sudo iptables -L INPUT -n | grep "NFQUEUE"
        
        # Check if there are explicit ACCEPT rules for honeypot ports
        local honeypot_ports="22 23 21 25 80 443 445 1433 3306 5432 5900 5901 8080 9200"
        
        for port in $honeypot_ports; do
            local accept_rule=$(sudo iptables -L INPUT -n | grep -E "ACCEPT.*dpt:$port" | wc -l)
            if [ $accept_rule -eq 0 ]; then
                print_status "WARNING" "No explicit ACCEPT rule for honeypot port $port"
                echo "   Suggested fix: sudo iptables -I INPUT 1 -p tcp --dport $port -j ACCEPT"
            fi
        done
        
        # Suggested fix information
        echo -e "\n   ${BOLD}Suggested resolution for NFQUEUE issues:${NC}"
        echo "   1. Add explicit ACCEPT rules for honeypot ports before the NFQUEUE rule:"
        echo "      sudo iptables -I INPUT 1 -p tcp --dport [port] -j ACCEPT"
        echo "   2. Or create a script to manage these rules and run it at startup:"
        echo "      Create /usr/local/bin/honeypot-iptables.sh with appropriate rules"
        echo "      Make it executable: chmod +x /usr/local/bin/honeypot-iptables.sh"
        echo "      Create a systemd service to run it at boot"
    else
        print_status "OK" "No NFQUEUE rules found in the INPUT chain"
    fi
}

# Function to check specific container
check_specific_container() {
    local container=$1
    
    echo -e "${BOLD}T-Pot Honeypot Monitoring - Container Check${NC}"
    echo "Date: $(date)"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "Container: $container"
    echo "----------------------------------------"
    
    # Check if container exists
    if ! docker ps -a --format '{{.Names}}' | grep -q "^$container$"; then
        print_status "ERROR" "Container $container does not exist"
        return 1
    fi
    
    # Check if container is running
    check_container_running $container
    if [ $? -ne 0 ]; then
        return 1
    fi
    
    # Check container logs for errors
    check_container_logs $container
    
    # Check container resources
    check_container_resources $container
    
    # Get container ports
    local ports=$(detect_container_ports $container)
    
    if [ -z "$ports" ]; then
        print_status "WARNING" "No ports detected for container $container"
        return 0
    fi
    
    # Check each port
    for port_config in $ports; do
        IFS=':' read -r internal_port external_port protocol network_mode <<< "$port_config"
        
        echo -e "\n${BOLD}Port $external_port/$protocol${NC}"
        
        # Check if port is listening
        if [[ "$network_mode" == *"internal"* ]]; then
            check_port_listening $external_port $protocol "127.0.0.1"
        else
            check_port_listening $external_port $protocol
        fi
        
        # Check which process is using the port
        check_process_for_port $external_port $protocol
        
        # Check iptables rules
        check_iptables_rules $external_port $protocol
        
        # Check if port is connectable
        check_port_connectable $external_port $protocol
        
        # If not internal, check if port is accessible from outside
        if [[ "$network_mode" != *"internal"* ]]; then
            check_port_accessible $external_port $protocol
        fi
        
        # Check if Nginx is configured for this port
        check_nginx_for_port $external_port
    done
}

# Function to check specific port
check_specific_port() {
    local port=$1
    
    echo -e "${BOLD}T-Pot Honeypot Monitoring - Port Check${NC}"
    echo "Date: $(date)"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "Port: $port"
    echo "----------------------------------------"
    
    # Check if port is listening (check both TCP and UDP)
    check_port_listening $port "tcp"
    check_port_listening $port "udp"
    
    # Check which process is using the port
    check_process_for_port $port "tcp"
    
    # Check iptables rules
    check_iptables_rules $port "tcp"
    
    # Check Nginx configuration
    check_nginx_for_port $port
    
    # Try to find container using this port
    local container=$(docker ps --format '{{.Names}}' | xargs -I{} sh -c "docker port {} 2>/dev/null | grep -q ':$port-' && echo {}" | head -1)
    
    if [ -n "$container" ]; then
        print_status "OK" "Port $port is mapped to container $container"
        check_container_running $container
    else
        print_status "WARNING" "Could not determine which container is using port $port"
    fi
    
    # Check if port is connectable
    check_port_connectable $port "tcp"
    
    # Check if port is accessible from outside
    check_port_accessible $port "tcp"
}

# Function to check all T-Pot honeypot services
check_all_honeypots() {
    echo -e "${BOLD}T-Pot Honeypot Monitoring${NC}"
    echo "Date: $(date)"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "----------------------------------------"
    
    # Get all honeypot containers
    local honeypot_containers=$(get_honeypot_containers)
    
    if [ -z "$honeypot_containers" ]; then
        print_status "ERROR" "No honeypot containers detected"
        return 1
    fi
    
    # Check each honeypot
    for container in $honeypot_containers; do
        echo -e "\n${BOLD}Checking honeypot: $container${NC}"
        
        # Check if container is running
        check_container_running $container
        if [ $? -ne 0 ]; then
            # Container not running, skip other checks
            continue
        fi
        
        # Check container logs for errors
        check_container_logs $container
        
        # Check container resources
        check_container_resources $container
        
        # Get container ports
        local ports=$(detect_container_ports $container)
        
        if [ -z "$ports" ]; then
            print_status "WARNING" "No ports detected for container $container"
            continue
        fi
        
        # Check each port
        for port_config in $ports; do
            IFS=':' read -r internal_port external_port protocol network_mode <<< "$port_config"
            
            echo -e "\n${BOLD}Port $external_port/$protocol${NC}"
            
            # Check if port is listening
            if [[ "$network_mode" == *"internal"* ]]; then
                check_port_listening $external_port $protocol "127.0.0.1"
            else
                check_port_listening $external_port $protocol
            fi
            
            # Check which process is using the port
            check_process_for_port $external_port $protocol
            
            # Check iptables rules
            check_iptables_rules $external_port $protocol
            
            # Check if port is connectable
            check_port_connectable $external_port $protocol
            
            # If not internal, check if port is accessible from outside
            if [[ "$network_mode" != *"internal"* ]]; then
                check_port_accessible $external_port $protocol
            fi
            
            # Check if Nginx is configured for this port
            check_nginx_for_port $external_port
        done
    done
    
    # Check overall system health
    check_system_health
    
    # Check T-Pot configuration
    check_tpot_config
    
    # Check for iptables nfqueue issues
    check_iptables_nfqueue_issue
    
    # Check honeypot connectivity
    check_honeypot_connectivity
    
    # Show summary
    echo -e "\n${BOLD}Summary${NC}"
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
    echo -e "Warnings: ${YELLOW}$WARNING_CHECKS${NC}"
    echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
    
    if [ $FAILED_CHECKS -gt 0 ]; then
        echo -e "\n${RED}${BOLD}There are issues that need attention!${NC}"
        echo "Check the log file for more details: $LOG_FILE"
    elif [ $WARNING_CHECKS -gt 0 ]; then
        echo -e "\n${YELLOW}${BOLD}System is running with warnings.${NC}"
        echo "Check the log file for more details: $LOG_FILE"
    else
        echo -e "\n${GREEN}${BOLD}All systems operational!${NC}"
    fi
    
    # Copy results to export file if specified
    if [ -n "$EXPORT_FILE" ]; then
        cat "$LOG_FILE" > "$EXPORT_FILE"
        echo "Results exported to $EXPORT_FILE"
    fi
    
    # Return appropriate exit code
    if [ $FAILED_CHECKS -gt 0 ]; then
        return 1
    elif [ $WARNING_CHECKS -gt 0 ]; then
        return 2
    else
        return 0
    fi
}

# Function to run port-specific checks only
run_port_checks() {
    echo -e "${BOLD}T-Pot Honeypot Monitoring - Port Status${NC}"
    echo "Date: $(date)"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "----------------------------------------"
    
    # Get all listening ports
    local listening_ports=$(ss -tuln | grep LISTEN | awk '{print $5}' | awk -F: '{print $NF}' | sort -n | uniq)
    
    if [ -z "$listening_ports" ]; then
        print_status "ERROR" "No listening ports detected"
        return 1
    fi
    
    for port in $listening_ports; do
        echo -e "\n${BOLD}Port $port${NC}"
        
        # Check if port is listening
        check_port_listening $port "tcp"
        
        # Check which process is using the port
        check_process_for_port $port "tcp"
        
        # Check iptables rules
        check_iptables_rules $port "tcp"
    done
}

# Function to run iptables checks only
run_iptables_checks() {
    echo -e "${BOLD}T-Pot Honeypot Monitoring - IPTables Configuration${NC}"
    echo "Date: $(date)"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
    echo "----------------------------------------"
    
    # Check for iptables nfqueue issues
    check_iptables_nfqueue_issue
    
    # Get list of common honeypot ports
    local honeypot_ports="22 23 21 25 80 443 445 1433 3306 5432 5900 8080 9200"
    
    echo -e "\n${BOLD}Checking iptables rules for common honeypot ports${NC}"
    
    for port in $honeypot_ports; do
        check_iptables_rules $port "tcp"
    done
}

# Main execution
main() {
    # Parse command line arguments
    parse_arguments "$@"
    
    # Start with log header
    echo "T-Pot Honeypot Monitoring Log - $(date)" > "$LOG_FILE"
    echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))" >> "$LOG_FILE"
    echo "Mode: $CHECK_MODE" >> "$LOG_FILE"
    echo "----------------------------------------" >> "$LOG_FILE"
    
    # Check if script is run as root
    if [ "$EUID" -ne 0 ]; then
        if ! command -v sudo &> /dev/null; then
            echo -e "${RED}Error: This script requires root privileges.${NC}"
            echo "Please run it as root or with sudo."
            exit 1
        fi
        echo -e "${YELLOW}Warning: This script requires root privileges for some checks.${NC}"
        echo "Some checks may not work properly without sudo."
    fi
    
    # Run the appropriate checks based on mode
    case "$CHECK_MODE" in
        "all")
            if [ -n "$SPECIFIC_CONTAINER" ]; then
                check_specific_container "$SPECIFIC_CONTAINER"
            elif [ -n "$SPECIFIC_PORT" ]; then
                check_specific_port "$SPECIFIC_PORT"
            else
                check_all_honeypots
            fi
            ;;
        "containers")
            if [ -n "$SPECIFIC_CONTAINER" ]; then
                check_specific_container "$SPECIFIC_CONTAINER"
            else
                # Just check container status for all honeypots
                echo -e "${BOLD}T-Pot Honeypot Container Status${NC}"
                echo "Date: $(date)"
                echo "Server: $(hostname) ($(hostname -I | awk '{print $1}'))"
                echo "----------------------------------------"
                
                local honeypot_containers=$(get_honeypot_containers)
                for container in $honeypot_containers; do
                    check_container_running $container
                    check_container_logs $container
                    check_container_resources $container
                done
            fi
            ;;
        "ports")
            if [ -n "$SPECIFIC_PORT" ]; then
                check_specific_port "$SPECIFIC_PORT"
            else
                run_port_checks
            fi
            ;;
        "system")
            check_system_health
            check_tpot_config
            ;;
        "iptables")
            run_iptables_checks
            ;;
        "connectivity")
            check_honeypot_connectivity
            ;;
        *)
            echo "Unknown check mode: $CHECK_MODE"
            show_help
            exit 1
            ;;
    esac
    
    # Show summary at the end
    echo -e "\n${BOLD}Summary${NC}"
    echo "Total checks: $TOTAL_CHECKS"
    echo -e "Passed: ${GREEN}$PASSED_CHECKS${NC}"
    echo -e "Warnings: ${YELLOW}$WARNING_CHECKS${NC}"
    echo -e "Failed: ${RED}$FAILED_CHECKS${NC}"
    
    if [ $FAILED_CHECKS -gt 0 ]; then
        echo -e "\n${RED}${BOLD}There are issues that need attention!${NC}"
        echo "Check the log file for more details: $LOG_FILE"
        exit 1
    elif [ $WARNING_CHECKS -gt 0 ]; then
        echo -e "\n${YELLOW}${BOLD}System is running with warnings.${NC}"
        echo "Check the log file for more details: $LOG_FILE"
        exit 2
    else
        echo -e "\n${GREEN}${BOLD}All systems operational!${NC}"
        exit 0
    fi
}

# Run the main function with all arguments
main "$@" 