#!/usr/bin/env python3
"""
DataServer Script (Sanitized Version)

This script is responsible for querying Elasticsearch for T-Pot honeypot logs,
processing the data, sanitizing sensitive information (like the host server's IP
and hostname), and publishing the processed/sanitized events to a Redis channel
for consumption by the Attack Map visualization frontend.

Key Functions:
- Connects to Elasticsearch and Redis (assumed to be running locally or 
  within the T-Pot Docker network).
- Periodically queries Elasticsearch for recent honeypot events.
- Processes hits, extracting relevant fields (IPs, ports, geo-location, 
  honeypot type, timestamp, etc.).
- Determines the likely service/protocol based on the destination port.
- **Sanitizes specific destination IPs and hostnames within the event data 
  before publishing.**
- Publishes the structured/sanitized event data as JSON to the specified Redis 
  channel.
- Also periodically queries and publishes overall honeypot hit statistics.
- Includes basic error handling for Elasticsearch/Redis connection issues.

Modifications from original:
- Added sanitization logic to replace specific IP ([SENSITIVE_IP]) and hostname 
  patterns ([SENSITIVE_HOSTNAME_PATTERN]) with placeholders ([REPLACEMENT_IP], 
  [REPLACEMENT_HOSTNAME]) before publishing to Redis.
"""
import datetime
import json
import time
import os
# Required libraries - These are expected to be pre-installed
# within the T-Pot 'map_data' Docker container environment. 
# Linter warnings for missing imports can be disregarded when analyzing
# this script outside of its target container.
import pytz
import redis
import re
from elasticsearch import Elasticsearch, exceptions as es_exceptions
from tzlocal import get_localzone 
from datetime import timezone # Import timezone explicitly


# Within T-Pot: es = Elasticsearch('http://elasticsearch:9200') and redis_ip = 'map_redis'
# es = Elasticsearch('http://127.0.0.1:[ES_API_PORT]')
# redis_ip = '127.0.0.1'
es = Elasticsearch('http://elasticsearch:9200')
redis_ip = 'map_redis'
redis_instance = None
redis_channel = 'attack-map-production'
version = 'Data Server 2.2.6 (Sanitized)' # Updated version string
local_tz = get_localzone()
output_text = os.getenv("TPOT_ATTACKMAP_TEXT")

event_count = 1
ips_tracked = {}
ports = {}
ip_to_code = {}
countries_to_code = {}
countries_tracked = {}
continent_tracked = {}

# Color Codes for Attack Map
service_rgb = {
    'FTP': '#ff0000',
    'SSH': '#ff8000',
    'TELNET': '#ffff00',
    'EMAIL': '#80ff00',
    'SQL': '#00ff00',
    'DNS': '#00ff80',
    'HTTP': '#00ffff',
    'HTTPS': '#0080ff',
    'VNC': '#0000ff',
    'SNMP': '#8000ff',
    'SMB': '#bf00ff',
    'MEDICAL': '#ff00ff',
    'RDP': '#ff0060',
    'SIP': '#ffccff',
    'ADB': '#ffcccc',
    'OTHER': '#ffffff'
}


def connect_redis(redis_ip):
    r = redis.StrictRedis(host=redis_ip, port=6379, db=0)
    return r


def push_honeypot_stats(honeypot_stats):
    redis_instance = connect_redis(redis_ip)
    tmp = json.dumps(honeypot_stats)
    # print(tmp)
    redis_instance.publish(redis_channel, tmp)


def get_honeypot_stats(timedelta):
    ES_query_stats = {
        "bool": {
            "must": [],
            "filter": [
                {
                    "terms": {
                        "type.keyword": [
                            "Adbhoney", "Beelzebub", "Ciscoasa", "CitrixHoneypot", "ConPot",
                            "Cowrie", "Ddospot", "Dicompot", "Dionaea", "ElasticPot",
                            "Endlessh", "Galah", "Glutton", "Go-pot", "H0neytr4p", "Hellpot", "Heralding",
                            "Honeyaml", "Honeytrap", "Honeypots", "Log4pot", "Ipphoney", "Mailoney",
                            "Medpot", "Miniprint", "Redishoneypot", "Sentrypeer", "Tanner", "Wordpot"
                        ]
                    }
                },
                {
                    "range": {
                        "@timestamp": {
                            "format": "strict_date_optional_time",
                            "gte": "now-" + timedelta,
                            "lte": "now"
                        }
                    }
                }
            ]
        }
    }
    return ES_query_stats


def update_honeypot_data():
    processed_data = []
    last = {"1m", "1h", "24h"}
    mydelta = 10
    # Use timezone-aware UTC time
    time_last_request = datetime.datetime.now(timezone.utc) - datetime.timedelta(seconds=mydelta)
    while True:
        # Use timezone-aware UTC time
        now = datetime.datetime.now(timezone.utc)
        # Get the honeypot stats every 10s (last 1m, 1h, 24h)
        if now.second%10 == 0 and now.microsecond < 500000:
            honeypot_stats = {}
            for i in last:
                try:
                    es_honeypot_stats = es.search(index="logstash-*", aggs={}, size=0, track_total_hits=True, query=get_honeypot_stats(i))
                    honeypot_stats.update({"last_"+i: es_honeypot_stats['hits']['total']['value']})
                except Exception as e:
                    print(e)
            honeypot_stats.update({"type": "Stats"})
            push_honeypot_stats(honeypot_stats)

        # Get the last 100 new honeypot events every 0.5s
        # Use timezone-aware UTC time and ISO 8601 format
        mylast_iso = time_last_request.isoformat(timespec='milliseconds') + 'Z'
        mynow_iso = (datetime.datetime.now(timezone.utc) - datetime.timedelta(seconds=mydelta)).isoformat(timespec='milliseconds') + 'Z'

        ES_query = {
            "bool": {
                "must": [
                    {
                        "query_string": {
                            "query": (
                                "type:(Adbhoney OR Beelzebub OR Ciscoasa OR CitrixHoneypot OR ConPot OR Cowrie "
                                "OR Ddospot OR Dicompot OR Dionaea OR ElasticPot OR Endlessh OR Galah OR Glutton OR Go-pot OR H0neytr4p "
                                "OR Hellpot OR Heralding OR Honeyaml OR Honeypots OR Honeytrap OR Ipphoney OR Log4pot OR Mailoney "
                                "OR Medpot OR Miniprint OR Redishoneypot OR Sentrypeer OR Tanner OR Wordpot)"
                            )
                        }
                    }
                ],
                "filter": [
                    {
                        "range": {
                            "@timestamp": {
                                # Use ISO 8601 format for range query
                                "gte": mylast_iso,
                                "lte": mynow_iso,
                                "format": "strict_date_optional_time||epoch_millis"
                            }
                        }
                    }
                ]
            }
        }

        # Update time_last_request for the next iteration *before* the search
        time_last_request = datetime.datetime.now(timezone.utc) - datetime.timedelta(seconds=mydelta)

        try:
            res = es.search(index="logstash-*", size=100, query=ES_query)
            hits = res['hits']
            if len(hits['hits']) != 0:
                for hit in hits['hits']:
                    try:
                        process_datas = process_data(hit)
                        if process_datas != None:
                            processed_data.append(process_datas)
                    except Exception as e_proc:
                        # Log processing errors for individual hits if needed
                        # print(f"Error processing hit {hit.get('_id', 'N/A')}: {e_proc}")
                        pass
        except es_exceptions.RequestError as e_search:
            print(f"Elasticsearch search error: {e_search}")
            # Potentially handle specific search errors, e.g., bad query, timeout
        except Exception as e_generic:
            print(f"Generic error during Elasticsearch search: {e_generic}")


        if len(processed_data) != 0:
            push(processed_data)
            processed_data = []
        time.sleep(0.5)


def process_data(hit):
#    global dst_ip, dst_lat, dst_long
    alert = {}
    alert["honeypot"] = hit["_source"]["type"]
    alert["country"] = hit["_source"]["geoip"].get("country_name", "")
    alert["country_code"] = hit["_source"]["geoip"].get("country_code2", "")
    alert["continent_code"] = hit["_source"]["geoip"].get("continent_code", "")
    # Ensure geoip_ext exists and contains location data
    if "geoip_ext" in hit["_source"] and isinstance(hit["_source"]["geoip_ext"], dict):
        alert["dst_lat"] = hit["_source"]["geoip_ext"].get("latitude", 0.0) # Default to 0.0 if missing
        alert["dst_long"] = hit["_source"]["geoip_ext"].get("longitude", 0.0) # Default to 0.0 if missing
        alert["dst_ip"] = hit["_source"]["geoip_ext"].get("ip", "")
        alert["dst_iso_code"] = hit["_source"]["geoip_ext"].get("country_code2", "")
        alert["dst_country_name"] = hit["_source"]["geoip_ext"].get("country_name", "")
    else:
        # Handle cases where geoip_ext might be missing or not a dictionary
        alert["dst_lat"], alert["dst_long"], alert["dst_ip"] = 0.0, 0.0, ""
        alert["dst_iso_code"], alert["dst_country_name"] = "", ""

    alert["tpot_hostname"] = hit["_source"].get("t-pot_hostname", "unknown_host") # Provide default
    alert["event_time"] = str(hit["_source"]["@timestamp"][0:10]) + " " + str(hit["_source"]["@timestamp"][11:19])
    alert["iso_code"] = hit["_source"]["geoip"].get("country_code2", "")
    alert["latitude"] = hit["_source"]["geoip"].get("latitude", 0.0) # Default to 0.0
    alert["longitude"] = hit["_source"]["geoip"].get("longitude", 0.0) # Default to 0.0
    alert["dst_port"] = hit["_source"].get("dest_port", 0) # Provide default
    alert["protocol"] = port_to_type(alert["dst_port"]) # Use the defaulted port
    alert["src_ip"] = hit["_source"].get("src_ip", "")
    alert["src_port"] = hit["_source"].get("src_port", 0) # Provide default
    alert["ip_rep"] = hit["_source"].get("ip_rep", "reputation unknown") # Provide default

    if not alert["src_ip"] == "":
        try:
            alert["color"] = service_rgb[alert["protocol"].upper()]
        except:
            alert["color"] = service_rgb["OTHER"]
        return alert
    else:
        # Avoid printing excessive logs for potentially common empty src_ip cases
        # print("SRC IP EMPTY")
        return None # Return None if src_ip is empty to avoid processing invalid data


def port_to_type(port):
    # Ensure port is an integer, handle potential errors
    try:
        port_int = int(port)
    except (ValueError, TypeError):
        return "OTHER" # Return OTHER if conversion fails

    # Dictionary mapping ports/ranges to types
    port_map = {
        (21, 20): "FTP",
        (22, 2222): "SSH",
        (23, 2223): "TELNET",
        (25, 143, 110, 993, 995): "EMAIL",
        (53,): "DNS",
        (80, 81, 8080, 8888): "HTTP",
        (161,): "SNMP",
        (443, 8443): "HTTPS",
        (445,): "SMB",
        (1433, 1521, 3306): "SQL",
        (2575, 11112): "MEDICAL",
        (5900,): "VNC",
        (3389,): "RDP",
        (5060, 5061): "SIP",
        (5555,): "ADB",
    }

    # Check ranges/specific ports
    for ports, type_name in port_map.items():
        if port_int in ports:
            return type_name

    # If no specific type matches, return the port number as string or "OTHER"
    # Returning the port number might be more informative for unmapped ports
    # return str(port_int)
    return "OTHER"


def push(alerts):
    global ips_tracked, continent_tracked, countries_tracked, ip_to_code, ports, event_count, countries_to_code

    try:
        redis_instance = connect_redis(redis_ip)
        redis_instance.ping() # Check connection
    except redis.exceptions.ConnectionError as e:
        print(f"Redis connection error: {e}. Cannot push data.")
        return # Exit function if Redis is unavailable

    processed_alerts = 0 # Counter for successfully processed alerts in this batch

    for alert in alerts:
        # Basic validation: Ensure required fields are present and somewhat valid
        if not all(k in alert for k in ['src_ip', 'country', 'country_code', 'continent_code', 'iso_code', 'dst_port']) or not alert['src_ip']:
            # print(f"Skipping alert due to missing key fields: {alert.get('event_time', 'N/A')}")
            continue # Skip this alert if essential data is missing

        ips_tracked[alert["src_ip"]] = ips_tracked.get(alert["src_ip"], 0) + 1
        continent_tracked[alert["continent_code"]] = continent_tracked.get(alert["continent_code"], 0) + 1
        countries_tracked[alert["country"]] = countries_tracked.get(alert["country"], 0) + 1
        ip_to_code[alert["src_ip"]] = alert["iso_code"]
        countries_to_code[alert["country"]] = alert["country_code"]
        ports[alert["dst_port"]] = ports.get(alert["dst_port"], 0) + 1

        if output_text == "ENABLED":
            try:
                # Convert UTC to local time
                my_time = datetime.datetime.strptime(alert["event_time"], "%Y-%m-%d %H:%M:%S")
                my_time = my_time.replace(tzinfo=pytz.UTC)  # Assuming event_time is in UTC
                local_event_time = my_time.astimezone(local_tz)
                local_event_time_str = local_event_time.strftime("%Y-%m-%d %H:%M:%S")

                # Build the table data
                table_data = [
                    [local_event_time_str, alert["country"], alert["src_ip"], alert["ip_rep"].title(),
                     alert["protocol"], alert["honeypot"], alert.get("tpot_hostname", "N/A")] # Use .get for hostname
                ]

                # Define the minimum width for each column
                min_widths = [19, 20, 15, 18, 10, 14, 14]

                # Format and print each line with aligned columns
                for row in table_data:
                    formatted_line = " | ".join(
                        "{:<{width}}".format(str(value)[:min_widths[i]], width=min_widths[i]) # Truncate long values
                        for i, value in enumerate(row))
                    print(formatted_line)
            except Exception as e_print:
                print(f"Error formatting/printing text output: {e_print}")


        # Prepare JSON data, using .get() for potentially missing keys
        json_data = {
            "protocol": alert.get("protocol", "OTHER"),
            "color": alert.get("color", service_rgb["OTHER"]),
            "iso_code": alert.get("iso_code", ""),
            "honeypot": alert.get("honeypot", "Unknown"),
            "ips_tracked": ips_tracked, # This sends the entire dict each time, consider alternatives if large
            "src_port": alert.get("src_port", 0),
            "event_time": alert.get("event_time", ""),
            "src_lat": alert.get("latitude", 0.0),
            "src_ip": alert.get("src_ip", ""),
            "ip_rep": alert.get("ip_rep", "reputation unknown").title(),
            "continents_tracked": continent_tracked, # Entire dict
            "type": "Traffic",
            "country_to_code": countries_to_code, # Entire dict
            "dst_long": alert.get("dst_long", 0.0),
            "continent_code": alert.get("continent_code", ""),
            "dst_lat": alert.get("dst_lat", 0.0),
            "ip_to_code": ip_to_code, # Entire dict
            "countries_tracked": countries_tracked, # Entire dict
            "event_count": event_count + processed_alerts, # Use counter for accurate count in batch
            "country": alert.get("country", ""),
            "src_long": alert.get("longitude", 0.0),
            "unknowns": {}, # Seems unused, keep or remove
            "dst_port": alert.get("dst_port", 0),
            "dst_ip": alert.get("dst_ip", ""),
            "dst_iso_code": alert.get("dst_iso_code", ""),
            "dst_country_name": alert.get("dst_country_name", ""),
            "tpot_hostname": alert.get("tpot_hostname", "unknown_host")
        }
        # json_data["ips_tracked"] = ips_tracked # Redundant assignment

        processed_alerts += 1 # Increment counter for this alert

        # --- BEGIN SANITIZATION LOGIC ---
        # import re is already added at the top

        # IMPORTANT: In this publicly documented version, the values below act as placeholders / examples.
        # In the actual running deployment, SENSITIVE_IP would hold the real server IP 
        # and SENSITIVE_HOSTNAME_PATTERN would match the real internal hostnames.

        # EXAMPLE Placeholder for the actual sensitive IP to find
        SENSITIVE_IP = '192.0.2.1' # Use a documentation IP (RFC 5737) or similar placeholder
        REPLACEMENT_IP = 'honeypot.example.com' # Generic replacement domain

        # EXAMPLE Placeholder regex pattern for sensitive hostnames 
        SENSITIVE_HOSTNAME_PATTERN = re.compile(r'internal-node-\d+', re.IGNORECASE) # Generic example pattern
        REPLACEMENT_HOSTNAME = 'honeypot-node' # Generic replacement

        # Sanitize Destination IP if it matches the placeholder SENSITIVE_IP
        if json_data.get('dst_ip') == SENSITIVE_IP:
            json_data['dst_ip'] = REPLACEMENT_IP
            # print(f"Sanitized dst_ip: {json_data['dst_ip']}") # Keep commented out

        # Sanitize T-Pot Hostname if present and matches the placeholder SENSITIVE_HOSTNAME_PATTERN
        if 'tpot_hostname' in json_data and isinstance(json_data['tpot_hostname'], str):
            original_hostname = json_data['tpot_hostname']
            json_data['tpot_hostname'] = SENSITIVE_HOSTNAME_PATTERN.sub(REPLACEMENT_HOSTNAME, original_hostname)
            # if original_hostname != json_data['tpot_hostname']: # Keep commented out
            #    print(f"Sanitized tpot_hostname from '{original_hostname}' to '{json_data['tpot_hostname']}'")

        # --- END SANITIZATION LOGIC ---

        try:
            tmp = json.dumps(json_data)
            redis_instance.publish(redis_channel, tmp)
        except redis.exceptions.RedisError as e_pub:
            print(f"Redis publish error: {e_pub}")
            # Potentially break loop or implement retry logic if publish fails
        except TypeError as e_json:
            print(f"JSON serialization error: {e_json}. Data: {json_data}")
            # Log the problematic data structure


    # Update the global event count *after* processing the batch
    event_count += processed_alerts


if __name__ == '__main__':
    print(version)
    while True: # Keep running even after exceptions
        try:
            update_honeypot_data()
        except es_exceptions.ConnectionError:
            print("[ ] Waiting 10s for Elasticsearch Connection ...")
            time.sleep(10)
        except redis.exceptions.ConnectionError:
             print("[ ] Waiting 10s for Redis Connection ...")
             time.sleep(10)
        except Exception as e_main:
            # Catch other potential exceptions in the main loop
            print(f"Unhandled exception in main loop: {e_main}")
            print("[ ] Restarting data update loop in 15 seconds...")
            time.sleep(15)

    # Removed unreachable code below the infinite loop
    # except KeyboardInterrupt:
    #     print('\nSHUTTING DOWN')
    #     exit() 