#!/usr/bin/env python3
"""
Seed script – creates a sample canary config and starts an analysis job.
Usage:  python seed.py [--host http://localhost:3000] [--duration 120]
"""
import argparse
import json
import sys
import urllib.request
import urllib.error

SAMPLE_CONFIG = {
    "name": "sample-canary",
    "description": "Sample config targeting the built-in mock exporter metrics",
    "canary_selector": {"deployment": "canary"},
    "baseline_selector": {"deployment": "baseline"},
    "analysis_duration": 120,
    "step_interval": 15,
    "pass_threshold": 75.0,
    "marginal_threshold": 50.0,
    "metrics": [
        {
            "name": "latency_p99",
            "query_template": "latency_p99_seconds{deployment='{deployment}'}",
            "weight": 3.0,
            "direction": "lower_is_better",
        },
        {
            "name": "error_rate",
            "query_template": "error_rate{deployment='{deployment}'}",
            "weight": 3.0,
            "direction": "lower_is_better",
        },
        {
            "name": "cpu_usage",
            "query_template": "cpu_usage_percent{deployment='{deployment}'}",
            "weight": 1.0,
            "direction": "lower_is_better",
        },
        {
            "name": "memory_usage_mb",
            "query_template": "memory_usage_bytes{deployment='{deployment}'} / 1024 / 1024",
            "weight": 1.0,
            "direction": "lower_is_better",
        },
    ],
}


def post(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def get(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://localhost:3000")
    parser.add_argument("--duration", type=int, default=None,
                        help="Override analysis duration in seconds (default: use config value)")
    args = parser.parse_args()
    host = args.host.rstrip("/")

    # 1 – Create (or reuse) config
    print("Creating canary config ...")
    try:
        config = post(f"{host}/api/configs", SAMPLE_CONFIG)
        config_id = config["id"]
        print(f"  Config created  : {config_id}  ({config['name']})")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        # 409 = already exists – fetch existing
        if e.code == 409:
            configs = get(f"{host}/api/configs")
            existing = next((c for c in configs if c["name"] == SAMPLE_CONFIG["name"]), None)
            if not existing:
                print(f"Config conflict but could not find existing config. {body}")
                sys.exit(1)
            config_id = existing["id"]
            print(f"  Config exists   : {config_id}  (reusing)")
        else:
            print(f"Failed to create config (HTTP {e.code}): {body}")
            sys.exit(1)

    # 2 – Launch analysis run
    print("Starting analysis job ...")
    run_payload = {"config_id": config_id}
    if args.duration:
        run_payload["duration"] = args.duration
    job = post(f"{host}/api/runs", run_payload)
    job_id = job["id"]
    print(f"  Job started     : {job_id}")
    print(f"  Status          : {job['status']}")
    print()
    print("Watch live in the UI:")
    print(f"  http://localhost:5173  →  Jobs  →  Details")
    print()
    print("Or poll via API:")
    print(f"  curl {host}/api/runs/{job_id}")


if __name__ == "__main__":
    main()
