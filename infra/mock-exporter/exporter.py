"""
Mock Prometheus exporter that simulates baseline and canary metrics.

Metrics exposed:
  http_request_duration_seconds{deployment="baseline|canary", quantile}
  http_requests_total{deployment="baseline|canary", status}
  error_rate{deployment="baseline|canary"}
  cpu_usage_percent{deployment="baseline|canary"}
  memory_usage_bytes{deployment="baseline|canary"}
  latency_p99{deployment="baseline|canary"}

The canary periodically introduces controlled anomalies so analysis has
something meaningful to detect.
"""

import math
import os
import random
import time
import threading

from prometheus_client import (
    Gauge, Counter, Histogram, start_http_server, REGISTRY
)

PORT = int(os.getenv("EXPORTER_PORT", "8000"))

# ── Metric definitions ─────────────────────────────────────────────────────

request_duration = Gauge(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["deployment", "quantile"],
)
requests_total = Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["deployment", "status"],
)
error_rate_gauge = Gauge(
    "error_rate",
    "Fraction of requests that resulted in an error (0-1)",
    ["deployment"],
)
cpu_gauge = Gauge(
    "cpu_usage_percent",
    "CPU usage percentage",
    ["deployment"],
)
memory_gauge = Gauge(
    "memory_usage_bytes",
    "Memory usage in bytes",
    ["deployment"],
)
latency_p99 = Gauge(
    "latency_p99_seconds",
    "99th percentile latency in seconds",
    ["deployment"],
)

# ── Simulation helpers ─────────────────────────────────────────────────────

_start = time.time()


def elapsed() -> float:
    return time.time() - _start


def noisy(base: float, pct: float = 0.05) -> float:
    """Return base ± pct random noise."""
    return base * (1 + random.uniform(-pct, pct))


def anomaly_factor(deployment: str) -> float:
    """
    Canary has a cyclic anomaly every 120 s (sin wave adds up to +40 %).
    Baseline stays stable.
    """
    if deployment == "baseline":
        return 1.0
    t = elapsed()
    # Anomaly window: active every 2 minutes for ~45 s
    cycle = t % 120
    if 40 <= cycle <= 85:
        return 1.0 + 0.40 * math.sin(math.pi * (cycle - 40) / 45)
    return 1.0


def update_metrics():
    for deployment in ("baseline", "canary"):
        af = anomaly_factor(deployment)

        # Latency
        base_lat = 0.050 if deployment == "baseline" else 0.055
        p50 = noisy(base_lat * af)
        p90 = noisy(base_lat * 1.6 * af)
        p99 = noisy(base_lat * 3.0 * af)

        request_duration.labels(deployment=deployment, quantile="0.5").set(p50)
        request_duration.labels(deployment=deployment, quantile="0.9").set(p90)
        request_duration.labels(deployment=deployment, quantile="0.99").set(p99)
        latency_p99.labels(deployment=deployment).set(p99)

        # Request counts (increment counters)
        success_rate = noisy(0.98 if deployment == "baseline" else 0.95 * (1 / af))
        success_rate = max(0.0, min(1.0, success_rate))
        requests_total.labels(deployment=deployment, status="200").inc(
            noisy(100) * success_rate
        )
        requests_total.labels(deployment=deployment, status="500").inc(
            noisy(100) * (1 - success_rate)
        )

        # Error rate
        err = noisy(0.02 if deployment == "baseline" else 0.05 * af)
        error_rate_gauge.labels(deployment=deployment).set(max(0.0, min(1.0, err)))

        # CPU
        base_cpu = 30.0 if deployment == "baseline" else 32.0
        cpu_gauge.labels(deployment=deployment).set(noisy(base_cpu * af, 0.08))

        # Memory
        base_mem = 256 * 1024 * 1024  # 256 MB
        memory_gauge.labels(deployment=deployment).set(
            noisy(base_mem * (1.0 + 0.1 * (af - 1.0)), 0.03)
        )


def simulation_loop():
    while True:
        update_metrics()
        time.sleep(5)


if __name__ == "__main__":
    print(f"Starting mock exporter on :{PORT}")
    start_http_server(PORT)
    simulation_loop()
