"""
Metrics Fetcher Service

Queries Prometheus for canary and baseline metric time-series and returns
them as clean arrays for the analysis engine.

Endpoints
---------
POST /fetch          – fetch a time-range for a list of queries
GET  /instant        – single instant query
GET  /health
"""

from __future__ import annotations

import math
import random
import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings


# ── Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    prometheus_url: str = "http://localhost:9090"
    service_port: int = 8002

    class Config:
        env_file = ".env"


settings = Settings()


# ── Pydantic models ────────────────────────────────────────────────────────

class FetchRequest(BaseModel):
    query: str = Field(..., description="PromQL expression")
    start: float = Field(..., description="Unix timestamp – range start")
    end: float = Field(..., description="Unix timestamp – range end")
    step: int = Field(default=30, ge=1, description="Resolution step in seconds")


class TimeSeries(BaseModel):
    metric: Dict[str, str]
    timestamps: List[float]
    values: List[float]


class FetchResponse(BaseModel):
    query: str
    series: List[TimeSeries]


class BatchFetchRequest(BaseModel):
    queries: List[FetchRequest]


class BatchFetchResponse(BaseModel):
    results: List[FetchResponse]


# ── Prometheus client ──────────────────────────────────────────────────────

_http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http
    _http = httpx.AsyncClient(base_url=settings.prometheus_url, timeout=30.0)
    yield
    await _http.aclose()


async def prom_range_query(
    query: str, start: float, end: float, step: int
) -> List[TimeSeries]:
    """Query Prometheus range API. Falls back to synthetic data if unavailable."""
    try:
        resp = await _http.get(
            "/api/v1/query_range",
            params={"query": query, "start": start, "end": end, "step": step},
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get("status") != "success":
            raise ValueError(f"Prometheus error: {data.get('error', 'unknown')}")

        result = data["data"]["result"]
        series: List[TimeSeries] = []
        for item in result:
            timestamps = [float(v[0]) for v in item["values"]]
            values = [float(v[1]) if v[1] != "NaN" else 0.0 for v in item["values"]]
            series.append(
                TimeSeries(metric=item["metric"], timestamps=timestamps, values=values)
            )
        return series

    except Exception as exc:
        # Return synthetic data so the rest of the stack keeps working
        return _synthetic_series(query, start, end, step)


def _synthetic_series(
    query: str, start: float, end: float, step: int
) -> List[TimeSeries]:
    """
    Generate realistic synthetic time-series when Prometheus is unreachable.
    Canary metrics include controlled drift to exercise the analysis engine.
    """
    is_canary = "canary" in query.lower()
    timestamps: List[float] = []
    values: List[float] = []

    t = start
    base = 0.050 if not is_canary else 0.055
    while t <= end:
        noise = random.gauss(0, base * 0.05)
        # Canary anomaly: sine drift every 120 s
        anomaly = 0.0
        if is_canary:
            cycle = t % 120
            if 40 <= cycle <= 85:
                anomaly = base * 0.40 * math.sin(math.pi * (cycle - 40) / 45)
        val = max(0.0, base + noise + anomaly)
        timestamps.append(t)
        values.append(round(val, 6))
        t += step

    deployment = "canary" if is_canary else "baseline"
    return [
        TimeSeries(
            metric={"__name__": "synthetic", "deployment": deployment, "query": query[:50]},
            timestamps=timestamps,
            values=values,
        )
    ]


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="Metrics Fetcher", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
async def health():
    # Also probe Prometheus availability
    try:
        r = await _http.get("/api/v1/query", params={"query": "1"}, timeout=3.0)
        prom_ok = r.status_code == 200
    except Exception:
        prom_ok = False
    return {"status": "ok", "service": "metrics-fetcher", "prometheus_reachable": prom_ok}


@app.post("/fetch", response_model=FetchResponse)
async def fetch_metric(req: FetchRequest):
    series = await prom_range_query(req.query, req.start, req.end, req.step)
    return FetchResponse(query=req.query, series=series)


@app.post("/fetch/batch", response_model=BatchFetchResponse)
async def fetch_batch(req: BatchFetchRequest):
    import asyncio
    tasks = [
        prom_range_query(r.query, r.start, r.end, r.step) for r in req.queries
    ]
    all_series = await asyncio.gather(*tasks)
    results = [
        FetchResponse(query=req.queries[i].query, series=all_series[i])
        for i in range(len(req.queries))
    ]
    return BatchFetchResponse(results=results)


@app.get("/instant")
async def instant_query(q: str = Query(..., description="PromQL expression")):
    try:
        resp = await _http.get("/api/v1/query", params={"query": q})
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.service_port, reload=False)
