# System Architecture: Co-Hosted T-Pot CE Deployment

This document outlines the architecture of the T-Pot CE honeypot deployment, specifically designed for **co-hosting** alongside other web services on a single Oracle Cloud Infrastructure (OCI) Ubuntu ARM server. This setup utilizes Cloudflare for edge security and DNS, with a host-level System Nginx instance acting as the primary traffic director and reverse proxy.

## Core Components

1.  **OCI Ubuntu Host:** The underlying ARM-based virtual machine running Ubuntu, hosting all services : aka. '(`[REDACTED_HOSTNAME]`)'
2.  **Cloudflare:** Provides DNS, CDN, DDoS protection, and WAF capabilities. It acts as the initial entry point for web traffic destined for public domains (Ports 80/443). SSL/TLS mode is set to "Full (strict)", requiring valid origin certificates. 
    ##### *Note: If attackers discover the server's actual IP address, they can bypass all Cloudflare security protections by connecting directly to the IP, potentially exposing the server to attacks that would otherwise be blocked. However, this architecture is designed to route such direct IP access to honeypot services rather than production websites.*
3.  **Cloudflare Tunnel (`cloudflared`):** A specific tunnel service running on the host, securely connecting the host to the Cloudflare edge without exposing public ports (other than those needed for honeypots/admin). It forwards traffic for `honeypot.tarek.ai` to the System Nginx listening internally on `127.0.0.1:[CF_TUNNEL_TARGET_PORT]`.
4.  **System Nginx:** The main Nginx instance installed directly on the host (`/etc/nginx/`). Crucial for traffic routing:
    *   **Listens Externally:** On ports 80 and 443 for traffic hitting the server's public IP directly, and on specific honeypot ports (e.g., 9100, 9200, 631, 6379, 5555) intended for direct honeypot interaction (proxied internally).
    *   **Listens Internally:** On `127.0.0.1:[CF_TUNNEL_TARGET_PORT]` to receive traffic specifically for `honeypot.tarek.ai` from the Cloudflare Tunnel.
    *   **Virtual Hosts:** Routes traffic for known domains (`tarek.ai`, `cbsworcester.com`) to their webroots. The configuration for `honeypot.tarek.ai` proxies map/websocket traffic to the internal T-Pot map service.
    *   **Default Server (`main.conf`):** Catches traffic hitting the server IP directly on ports 80/443 or for unknown hostnames. Proxies HTTP to Snare (`127.0.0.1:[SNARE_INTERNAL_PORT]`) and HTTPS to H0neytr4p (`127.0.0.1:8043`). Also proxies specific external ports (e.g., 9100) to internal honeypot containers (e.g., Miniprint on `127.0.0.1:9101`), ensuring client IP headers are passed.
5.  **Docker & T-Pot CE:** The honeypot suite runs within Docker containers managed via `docker-compose` and Portainer.
    *   **Directly Exposed Honeypots:** Key honeypots (Cowrie, Heralding, Mailoney, etc.) bind directly to standard ports (22, 23, 25, 3389, etc.) on the host network interface (`0.0.0.0:<port>`), receiving traffic allowed by the OCI firewall.
    *   **Internally Exposed Honeypots:** Web honeypots (Snare, H0neytr4p, etc.) and those proxied by System Nginx (Miniprint, Elasticpot, etc.) bind *only* to localhost (`127.0.0.1:<internal_port>`).
    *   **Backend Services:** ELK Stack (Elasticsearch, Logstash, Kibana), Redis variants run internally within Docker networks (`tpotce_nginx_local`), not exposed directly. Elasticsearch API is accessible internally at `127.0.0.1:[ES_API_PORT]`.
    *   **T-Pot Internal Nginx:** Handles routing *within* the T-Pot stack, primarily for management UIs like Kibana, accessible via SSH tunnel to `127.0.0.1:[T_POT_WEB_UI_PORT]`. Also listens on `127.0.0.1:[TPOT_INTERNAL_PROXY_PORT]` for potential sensor inputs.
6.  **Administrative Access:** Secured exclusively via SSH on a non-standard port (`[ADMIN_SSH_PORT]`), protected by key-based authentication and specific `iptables` rules managed by the custom `tpot-ssh-preserve.service` systemd unit to prevent T-Pot's dynamic rules from causing lockouts.
7.  **OCI Security List / NSG:** The cloud provider's firewall allows ingress traffic *only* to necessary ports: `[ADMIN_SSH_PORT]`, ports 80/443 (for Nginx/Cloudflare), and the standard ports used by directly exposed honeypots (22, 23, 25, etc.).

## Network Traffic Flow Examples

*   **Legitimate Web Request (`https://tarek.ai`):** Internet User -> Cloudflare -> OCI Firewall (443) -> System Nginx (vhost match) -> Serves content.
*   **Honeypot Attack Map (`https://honeypot.tarek.ai/map/`):** Internet User -> Cloudflare -> Cloudflare Tunnel -> System Nginx (listens on `[CF_TUNNEL_TARGET_PORT]`, vhost match) -> Proxy to T-Pot `map_web` container (`127.0.0.1:[MAP_BACKEND_PORT]`).
*   **Direct IP Web Attack (`http://[REDACTED_SERVER_IP]`):** Attacker -> OCI Firewall (80) -> System Nginx (`default_server`) -> Proxy to Snare honeypot (`127.0.0.1:[SNARE_INTERNAL_PORT]`).
*   **Direct SSH Attack (`ssh [REDACTED_SERVER_IP]`):** Attacker -> OCI Firewall (22) -> Cowrie honeypot container (listening directly on 0.0.0.0:22).
*   **Printer Honeypot Attack (`telnet [REDACTED_SERVER_IP] 9100`):** Attacker -> OCI Firewall (9100) -> System Nginx (listens on 9100) -> Proxy to Miniprint honeypot (`127.0.0.1:9101`).
*   **Admin SSH Access (`ssh -p [ADMIN_SSH_PORT] [REDACTED_SERVER_IP]`):** Admin -> OCI Firewall (`[ADMIN_SSH_PORT]`) -> Host SSH daemon (`sshd`).

## Visualizations

### Overall System Architecture
The following diagram illustrates the high-level flow of traffic and component interaction:

```mermaid
graph LR
    subgraph Internet
        User[/"👤 User / Attacker"/]
        Cloudflare[/"☁️ Cloudflare<br>(DNS / Proxy / WAF)"/]
    end

    subgraph "OCI Cloud ([REDACTED_SERVER_IP])"
        OCI_FW[/"🔥 OCI Security List<br>(Firewall)"/]
        subgraph "Host Server (Ubuntu - [REDACTED_HOSTNAME])"
            Cloudflared[/"🚇 cloudflared<br>(Tunnel Service)"/]
            Sys_Nginx[/"🕸️ System Nginx<br>(Ports 80, 443, 9100, etc.<br>+ Internal [CF_TUNNEL_TARGET_PORT])"/]
            Admin_SSH[/"🔐 Admin SSH<br>(Port [ADMIN_SSH_PORT])"/]
            Docker[/"🐳 Docker Engine"/]
        end
    end

    subgraph "Docker Containers (T-Pot CE)"
        subgraph "Web Honeypots (Internal Only)"
            Snare["Snare<br>(Internal Port e.g., 8080)"]
            H0neytr4p["H0neytr4p<br>(Internal Port 8043)"]
            OtherWeb["..."]
        end
        subgraph "Direct Exposure Honeypots"
            Cowrie["Cowrie<br>(Host Ports 22, 23)"]
            Heralding["Heralding<br>(Host Ports 3389, 143, etc.)"]
            Mailoney["Mailoney<br>(Host Port 25)"]
            OtherDirect["..."]
        end
        subgraph "Proxied Non-Web Honeypots (Internal Only)"
             Miniprint["Miniprint<br>(Internal Port e.g., 9101)"]
             Elasticpot["Elasticpot<br>(Internal Port e.g., 9201)"]
             RedisHP["RedisHP<br>(Internal Port e.g., 6380)"]
        end
        subgraph "T-Pot Backend & Map"
            TPot_Nginx["T-Pot Nginx<br>(Internal [T_POT_WEB_UI_PORT])"]
            MapWeb["Map Web<br>(Internal [MAP_BACKEND_PORT])"]
            ELK["ELK Stack / Redis<br>(Internal Network)"]
        end
    end

    User -- "DNS Lookup" --> Cloudflare
    User -- "HTTPS (tarek.ai)" --> Cloudflare
    User -- "HTTPS (honeypot.tarek.ai)" --> Cloudflare
    User -- "HTTP/S (Direct IP)" --> OCI_FW
    User -- "SSH/Other Ports" --> OCI_FW

    Cloudflare -- "Proxied Web Traffic (80/443)" --> OCI_FW
    Cloudflare -- "Tunnel for honeypot.tarek.ai" --> Cloudflared

    OCI_FW -- "Port [ADMIN_SSH_PORT]" --> Admin_SSH
    OCI_FW -- "Ports 80, 443, 9100, etc." --> Sys_Nginx
    OCI_FW -- "Ports 22, 23, 25, etc." --> Docker

    Cloudflared -- "honeypot.tarek.ai traffic" --> Sys_Nginx

    Sys_Nginx -- "tarek.ai / *.com traffic" --> WebRoot["🌐 Legit Web Root"]
    Sys_Nginx -- "Default HTTP (IP Access)" --> Snare
    Sys_Nginx -- "Default HTTPS (IP Access)" --> H0neytr4p
    Sys_Nginx -- "Port 9100 Traffic" --> Miniprint
    Sys_Nginx -- "Port 9200 Traffic" --> Elasticpot
    Sys_Nginx -- "Port 6379 Traffic" --> RedisHP
    Sys_Nginx -- "/map/ or /websocket traffic" --> MapWeb

    Docker -- ":22, :23" --> Cowrie
    Docker -- ":25" --> Mailoney
    Docker -- ":3389, :143" --> Heralding
    Docker -- "Other Direct Ports" --> OtherDirect

    %% Internal Connections
    MapWeb --> ELK
    TPot_Nginx --> ELK
    Snare --> ELK
    Cowrie --> ELK
    Heralding --> ELK
    Miniprint --> ELK
    Elasticpot --> ELK
    RedisHP --> ELK

    %% Admin SSH Tunnel Access to T-Pot UI
    Admin_SSH -- "|SSH Tunnel|" --> TPot_Nginx
```   



### Layered Architecture View
The following diagram shows the system organized into key functional layers:

```mermaid
flowchart TB
    subgraph Internet["Internet"]
        Client["👤 External Clients / Attackers"]
    end

    subgraph ExternalLayer["External Layer (Host Ports)"]
        SSH["SSH Honeypot<br>Port 22"]:::honeypot
        TELNET["Telnet Honeypot<br>Port 23"]:::honeypot
        HTTP["HTTP Input<br>Port 80"]:::proxyInput
        HTTPS["HTTPS Input<br>Port 443"]:::proxyInput
        OTHER["Other Direct Honeypots<br>(Ports 21, 25, 445, etc.)"]:::honeypot
        AdminSSH["Admin SSH<br>[ADMIN_SSH_PORT]"]:::admin
    end

    subgraph ProxyLayer["Proxy Layer (System Nginx)"]
        Nginx["⚙️ Nginx Reverse Proxy"]:::proxy
        CFTunnel["🚇 Cloudflare Tunnel<br>(Connects to Nginx on [CF_TUNNEL_TARGET_PORT])"]:::proxy
    end

    subgraph InternalLayer["Internal Services Layer (127.0.0.1)"]
        SnareBackend["Snare Backend<br>e.g., 8080"]:::internalHP
        H0neytr4pBackend["H0neytr4p Backend<br>e.g., 8043"]:::internalHP
        OtherBackends["Other Proxied Honeypots<br>(Miniprint, RedisHP, etc.)"]:::internalHP
    end

    subgraph AdminLayer["Admin & Dashboard Layer (127.0.0.1)"]
        Elasticsearch["Elasticsearch<br>[ES_API_PORT]"]:::admin
        Kibana["Kibana<br>[KIBANA_PORT]"]:::admin
        MapViz["Attack Map<br>[MAP_BACKEND_PORT]"]:::admin
        Glances["Glances Monitoring<br>[GLANCES_PORT]"]:::admin
        TPotNginx["T-Pot Nginx<br>[T_POT_WEB_UI_PORT]"]:::admin
    end

    Client --> SSH
    Client --> TELNET
    Client --> HTTP
    Client --> HTTPS
    Client --> OTHER
    Client -- Direct Secure Access --> AdminSSH
    Client -- honeypot.tarek.ai --> CFTunnel

    HTTP --> Nginx
    HTTPS --> Nginx
    OTHER -- Specific Ports (9100 etc) --> Nginx

    Nginx -- "Default HTTP Route" --> SnareBackend
    Nginx -- "Default HTTPS Route" --> H0neytr4pBackend
    Nginx -- "Specific Port Routes" --> OtherBackends
    Nginx -- "/map/ Route" --> MapViz

    CFTunnel -- "Forwards to Nginx Listener" --> Nginx

    %% Internal Connections (Conceptual)
    InternalLayer -- Logs --> Elasticsearch
    SSH -- Logs --> Elasticsearch
    TELNET -- Logs --> Elasticsearch
    OTHER -- Logs --> Elasticsearch
    Elasticsearch --> Kibana
    Elasticsearch --> MapViz

    AdminSSH -- "|SSH Tunnel|" --> TPotNginx
    AdminSSH -- "|SSH Tunnel|" --> Glances
    TPotNginx -- Proxies --> Kibana

    classDef honeypot fill:#ff9900,stroke:#333,stroke-width:1px,color:#000
    classDef admin fill:#6699ff,stroke:#333,stroke-width:2px,color:#fff
    classDef proxy fill:#99cc99,stroke:#333,stroke-width:1px,color:#000
    classDef proxyInput fill:#cceeff,stroke:#333,stroke-width:1px,color:#000
    classDef internalHP fill:#ffe0b3,stroke:#333,stroke-width:1px,color:#000

    %% Legend (Optional) - Corrected Syntax
    subgraph Legend
        H["Direct Honeypot"]:::honeypot
        I["Internal Honeypot"]:::internalHP
        PI["Web Input Ports"]:::proxyInput
        P["Proxy/Router"]:::proxy
        A["Admin/Dashboard"]:::admin
    end
```


### Network Traffic Flow & Port Mapping
This diagram focuses specifically on the network layers, public port exposure, and how the Nginx routing layer directs traffic between external ports and internal honeypot services:

```mermaid

flowchart LR
    subgraph Internet["External Network"]
        Attackers["🏴‍☠️ Attackers /🧑‍💼️ Clients"]
    end

    subgraph PublicPorts["Public-Facing Ports (0.0.0.0 / Host)"]
        direction TB
        Port22["Port 22<br>SSH Honeypot<br>(Cowrie)"]:::honeypot
        Port23["Port 23<br>Telnet Honeypot<br>(Cowrie)"]:::honeypot
        Port80["Port 80<br>HTTP Input"]:::proxyInput
        Port443["Port 443<br>HTTPS Input"]:::proxyInput
        PortSMB["Port 445<br>SMB Honeypot<br>(Heralding)"]:::honeypot
        PortFTP["Port 21<br>FTP Honeypot<br>(Heralding)"]:::honeypot
        PortOther["Other Standard<br>Honeypot Ports<br>(25, 3389, etc.)"]:::honeypot
        PortSpecificProxied["Specific Ports<br>Proxied by Nginx<br>(9100, 9200, 631, 6379, 5555)"]:::proxyInput
        PortAdmin["[ADMIN_SSH_PORT]<br>Secure Admin Access"]:::admin
    end

    subgraph NginxLayer["Nginx Routing Layer (System Nginx)"]
        direction TB
        MainConf["📄 main.conf<br>(Default Server Proxy)"]:::proxy
        HoneypotConf["📄 honeypot.tarek.ai.conf<br>(Listens on [CF_TUNNEL_TARGET_PORT])"]:::proxy
    end

    subgraph InternalServices["Internal Services (127.0.0.1)"]
        direction TB
        Snare["Snare<br>e.g., 8080"]:::internalHP
        H0neytr4p["H0neytr4p<br>e.g., 8043"]:::internalHP
        Wordpot["Wordpot<br>e.g., 8084"]:::internalHP
        GOPOT["GO-Pot<br>e.g., 8081"]:::internalHP
        Hellpot["Hellpot<br>e.g., 8082"]:::internalHP
        Log4pot["Log4pot<br>e.g., 8083"]:::internalHP
        IPPHoney["IPPHoney<br>e.g., 6311"]:::internalHP
        RedisPot["RedisHoneypot<br>e.g., 6380"]:::internalHP
        ADBHoney["ADBHoney<br>e.g., 5556"]:::internalHP
        Miniprint["Miniprint<br>e.g., 9101"]:::internalHP
        Elasticpot["Elasticpot<br>e.g., 9201"]:::internalHP
    end

    subgraph AdminDashboards["Admin & Dashboard Layer (127.0.0.1)"]
        direction TB
        ESPort["Elasticsearch<br>[ES_API_PORT]"]:::admin
        KibanaPort["Kibana<br>[KIBANA_PORT]"]:::admin
        MapPort["Attack Map<br>[MAP_BACKEND_PORT]"]:::admin
        GlancesPort["Glances<br>[GLANCES_PORT]"]:::admin
        TPotUIPort["T-Pot Web UI<br>(Via [T_POT_WEB_UI_PORT])"]:::admin
    end

    Attackers --> Port22
    Attackers --> Port23
    Attackers --> Port80
    Attackers --> Port443
    Attackers --> PortSMB
    Attackers --> PortFTP
    Attackers --> PortOther
    Attackers --> PortSpecificProxied
    Attackers -- Secure Connection --> PortAdmin

    Port80 --> MainConf
    Port443 --> MainConf
    PortSpecificProxied --> MainConf

    MainConf -- "Default HTTP -->" --> Snare
    MainConf -- "Default HTTPS -->" --> H0neytr4p
    MainConf -- "Proxy Port 631 -->" --> IPPHoney
    MainConf -- "Proxy Port 6379 -->" --> RedisPot
    MainConf -- "Proxy Port 5555 -->" --> ADBHoney
    MainConf -- "Proxy Port 9100 -->" --> Miniprint
    MainConf -- "Proxy Port 9200 -->" --> Elasticpot
    %% Added other proxied web honeypots based on main.conf source
    MainConf -- "Proxy Path /wordpress/ -->" --> Wordpot
    MainConf -- "Proxy Path /admin/ -->" --> GOPOT
    MainConf -- "Proxy Path /api/ -->" --> Hellpot
    MainConf -- "Proxy Path /log4j/ -->" --> Log4pot


    HoneypotConf -- "--> /map/, /websocket" --> MapPort

    PortAdmin -- Direct SSH --> HostOS["Host OS SSHD"]

    classDef admin fill:#6699ff,stroke:#333,stroke-width:2px,color:#fff
    classDef honeypot fill:#ff9900,stroke:#333,stroke-width:1px,color:#000
    classDef proxy fill:#99cc99,stroke:#333,stroke-width:1px,color:#000
    classDef proxyInput fill:#cceeff,stroke:#333,stroke-width:1px,color:#000
    classDef internalHP fill:#ffe0b3,stroke:#333,stroke-width:1px,color:#000

    subgraph Legend
        H["Direct Honeypot"]:::honeypot
        I["Internal Honeypot"]:::internalHP
        PI["Input Ports"]:::proxyInput
        P["Nginx Config"]:::proxy
        A["Admin/Dashboard"]:::admin
    end
```

### High-Level  Overview
This diagram provides a simplified, high-level conceptual overview of the main architectural layers and their interactions:

```mermaid
graph TD
    Internet((Internet))

    subgraph ExternalLayer["External-Facing Layer"]
        ExtHoneypots["Honeypot Services<br>(SSH, Web, DB, Other)"]:::honeypot
        AdminSSH["Admin SSH<br>[ADMIN_SSH_PORT]"]:::admin
    end

    subgraph ProxyLayer["Proxy & Routing Layer"]
        Nginx{"🕸️ Nginx Router<br>(System & T-Pot Internal)"/}:::proxy
        CFTunnel["Cloudflare Tunnel<br>[CF_TUNNEL_TARGET_PORT]"]:::proxy
    end

    subgraph InternalLayer["Internal Services Layer"]
        HoneypotBackends["Internal Honeypot Backends<br>(Snare, H0neytr4p, Proxied...)"]:::internalHP
    end

    subgraph AdminLayer["Admin & Dashboard Layer"]
        ELK["ELK Stack<br>[ES_API_PORT] / [KIBANA_PORT]"]:::admin
        MapViz["Attack Map Viz<br>[MAP_BACKEND_PORT]"]:::admin
        Monitoring["System Monitoring<br>[GLANCES_PORT]"]:::admin
    end

    %% External Connections
    Internet -- "Attack Traffic" --> ExtHoneypots
    Internet -- "Admin Access" --> AdminSSH
    Internet -- "Web Traffic (honeypot.tarek.ai)" --> CFTunnel
    Internet -- "Web Traffic (Direct IP / Other)" --> Nginx

    %% Routing & Internal Flow
    CFTunnel -- "Forwards to" --> Nginx
    ExtHoneypots -- "Directly Exposed Traffic Logs" --> ELK
    ExtHoneypots -- "Traffic via Proxy Ports" --> Nginx
    Nginx -- "Proxies to Internal Honeypots" --> HoneypotBackends
    Nginx -- "Proxies Map Request" --> MapViz
    HoneypotBackends -- Logs --> ELK

    %% Admin Access & Data Viewing
    AdminSSH -- "|Secure Tunnel|" --> Monitoring
    AdminSSH -- "|Secure Tunnel|" --> ELK 
    %% Data source for map
    ELK --> MapViz 

    %% Styling
    classDef admin fill:#6699ff,stroke:#333,stroke-width:2px,color:#fff
    classDef honeypot fill:#ff9900,stroke:#333,stroke-width:1px,color:#000
    classDef proxy fill:#99cc99,stroke:#333,stroke-width:1px,color:#000
    classDef internalHP fill:#ffe0b3,stroke:#333,stroke-width:1px,color:#000

    subgraph Legend
        H(["Honeypot Services"]):::honeypot
        I(["Internal Backends"]):::internalHP
        A(["Admin/Mgmt Services"]):::admin
        P(["Proxy Components"]):::proxy
    end
```