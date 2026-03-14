"""
Analysis Engine Service
=======================
Performs SAX + HMM canary analysis on time-series data fetched from the
Metrics Fetcher service.

Endpoints
---------
POST /analyze            – run a full analysis for a job
POST /analyze/metric     – analyse a single metric pair (debug)
GET  /health
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings

from hmm_model import combined_metric_score


# ── Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    metrics_fetcher_url: str = "http://localhost:8002"
    service_port: int = 8003

    class Config:
        env_file = ".env"


settings = Settings()

_http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _http
    _http = httpx.AsyncClient(base_url=settings.metrics_fetcher_url, timeout=60.0)
    yield
    await _http.aclose()


# ── Request / Response models ──────────────────────────────────────────────

class MetricSpec(BaseModel):
    name: str
    query_template: str
    weight: float = 1.0
    pass_threshold: float = 75.0
    direction: str = "no_direction"


class AnalyzeRequest(BaseModel):
    job_id: str
    config_id: str
    metrics: List[MetricSpec]
    canary_selector: Dict[str, str] = Field(default={"deployment": "canary"})
    baseline_selector: Dict[str, str] = Field(default={"deployment": "baseline"})
    start_time: float = Field(..., description="Unix timestamp – window start")
    end_time: float = Field(..., description="Unix timestamp – window end")
    step: int = Field(default=30, ge=5)
    pass_threshold: float = 75.0
    marginal_threshold: float = 50.0


class MetricResult(BaseModel):
    metric_name: str
    score: float          # 0-100
    sax_score: float      # 0-1
    hmm_score: float      # 0-1
    weight: float
    pass_threshold: float
    status: str           # "pass" | "fail" | "nodata"
    canary_mean: Optional[float]
    baseline_mean: Optional[float]
    direction: str


class AnalyzeResponse(BaseModel):
    job_id: str
    config_id: str
    score: float          # 0-100 weighted aggregate
    recommendation: str   # "rollout" | "rollback" | "inconclusive"
    metric_results: List[MetricResult]
    analysis_time_ms: float


class SingleMetricRequest(BaseModel):
    canary_values: List[float]
    baseline_values: List[float]
    direction: str = "no_direction"
    name: str = "metric"


# ── Helpers ────────────────────────────────────────────────────────────────

def _build_query(template: str, selector: Dict[str, str]) -> str:
    """Substitute selector values into the PromQL template."""
    # Primary substitution: {deployment}
    deployment = selector.get("deployment", list(selector.values())[0] if selector else "")
    query = template.replace("{deployment}", deployment)
    # Allow any key substitution
    for k, v in selector.items():
        query = query.replace(f"{{{k}}}", v)
    return query


async def _fetch_series(query: str, start: float, end: float, step: int) -> List[float]:
    """Fetch and flatten a single time-series from the metrics fetcher."""
    try:
        resp = await _http.post(
            "/fetch",
            json={"query": query, "start": start, "end": end, "step": step},
        )
        resp.raise_for_status()
        data = resp.json()
        series = data.get("series", [])
        if not series:
            return []
        # Take the first matching series
        return series[0]["values"]
    except Exception:
        return []


def _compute_recommendation(
    score: float, pass_threshold: float, marginal_threshold: float
) -> str:
    if score >= pass_threshold:
        return "rollout"
    if score < marginal_threshold:
        return "rollback"
    return "inconclusive"


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="Analysis Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "analysis-engine"}


@app.post("/analyze/metric", response_model=MetricResult)
async def analyze_single_metric(req: SingleMetricRequest):
    """Debug endpoint to analyse a single pre-fetched metric pair."""
    c = np.array(req.canary_values, dtype=float)
    b = np.array(req.baseline_values, dtype=float)
    score, sax_s, hmm_s = combined_metric_score(c, b, direction=req.direction)
    status = "pass" if score >= 75.0 else ("nodata" if (len(c) == 0 or len(b) == 0) else "fail")
    return MetricResult(
        metric_name=req.name,
        score=score,
        sax_score=sax_s,
        hmm_score=hmm_s,
        weight=1.0,
        pass_threshold=75.0,
        status=status,
        canary_mean=float(c.mean()) if len(c) > 0 else None,
        baseline_mean=float(b.mean()) if len(b) > 0 else None,
        direction=req.direction,
    )


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    t_start = time.perf_counter()

    import asyncio

    metric_results: List[MetricResult] = []

    # Fetch all metrics concurrently
    async def process_metric(metric: MetricSpec) -> MetricResult:
        canary_query = _build_query(metric.query_template, req.canary_selector)
        baseline_query = _build_query(metric.query_template, req.baseline_selector)

        canary_vals, baseline_vals = await asyncio.gather(
            _fetch_series(canary_query, req.start_time, req.end_time, req.step),
            _fetch_series(baseline_query, req.start_time, req.end_time, req.step),
        )

        if not canary_vals or not baseline_vals:
            return MetricResult(
                metric_name=metric.name,
                score=0.0,
                sax_score=0.0,
                hmm_score=0.0,
                weight=metric.weight,
                pass_threshold=metric.pass_threshold,
                status="nodata",
                canary_mean=None,
                baseline_mean=None,
                direction=metric.direction,
            )

        c = np.array(canary_vals, dtype=float)
        b = np.array(baseline_vals, dtype=float)
        score, sax_s, hmm_s = combined_metric_score(c, b, direction=metric.direction)

        if len(c) == 0 or len(b) == 0:
            status = "nodata"
        elif score >= metric.pass_threshold:
            status = "pass"
        else:
            status = "fail"

        return MetricResult(
            metric_name=metric.name,
            score=score,
            sax_score=sax_s,
            hmm_score=hmm_s,
            weight=metric.weight,
            pass_threshold=metric.pass_threshold,
            status=status,
            canary_mean=float(c.mean()),
            baseline_mean=float(b.mean()),
            direction=metric.direction,
        )

    results = await asyncio.gather(*[process_metric(m) for m in req.metrics])
    metric_results = list(results)

    # Weighted aggregate score (exclude nodata metrics)
    scorable = [r for r in metric_results if r.status != "nodata"]
    if scorable:
        total_weight = sum(r.weight for r in scorable)
        aggregate = sum(r.score * r.weight for r in scorable) / total_weight
    else:
        aggregate = 0.0

    aggregate = round(aggregate, 2)
    recommendation = _compute_recommendation(
        aggregate, req.pass_threshold, req.marginal_threshold
    )

    elapsed_ms = (time.perf_counter() - t_start) * 1000

    return AnalyzeResponse(
        job_id=req.job_id,
        config_id=req.config_id,
        score=aggregate,
        recommendation=recommendation,
        metric_results=metric_results,
        analysis_time_ms=round(elapsed_ms, 1),
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.service_port, reload=False)
