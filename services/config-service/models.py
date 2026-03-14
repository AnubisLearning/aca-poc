from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ── Metric definition ──────────────────────────────────────────────────────

class MetricConfig(BaseModel):
    name: str = Field(..., description="Unique metric name within this config")
    query_template: str = Field(
        ...,
        description=(
            "PromQL query template. Use {deployment} as placeholder for the "
            "selector label value, e.g. "
            "rate(http_requests_total{deployment='{deployment}'}[1m])"
        ),
    )
    weight: float = Field(
        default=1.0,
        ge=0.0,
        le=10.0,
        description="Relative weight when aggregating into final score",
    )
    pass_threshold: float = Field(
        default=75.0,
        ge=0.0,
        le=100.0,
        description="Minimum per-metric score to consider it passing",
    )
    direction: str = Field(
        default="no_direction",
        description=(
            "lower_is_better | higher_is_better | no_direction  "
            "Hints the scoring direction for directional metrics"
        ),
    )


# ── Config create / update ─────────────────────────────────────────────────

class CanaryConfigCreate(BaseModel):
    name: str
    description: Optional[str] = None
    metrics: List[MetricConfig] = Field(..., min_length=1)
    canary_selector: Dict[str, str] = Field(
        default={"deployment": "canary"},
        description="Label selector identifying canary workload in Prometheus",
    )
    baseline_selector: Dict[str, str] = Field(
        default={"deployment": "baseline"},
        description="Label selector identifying baseline workload in Prometheus",
    )
    analysis_duration: int = Field(
        default=300,
        ge=30,
        description="Total analysis window in seconds",
    )
    step_interval: int = Field(
        default=30,
        ge=5,
        description="Step interval between Prometheus queries in seconds",
    )
    pass_threshold: float = Field(
        default=75.0,
        ge=0.0,
        le=100.0,
        description="Overall score >= this → rollout recommendation",
    )
    marginal_threshold: float = Field(
        default=50.0,
        ge=0.0,
        le=100.0,
        description="Overall score < this → rollback recommendation",
    )


class CanaryConfigUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    metrics: Optional[List[MetricConfig]] = None
    canary_selector: Optional[Dict[str, str]] = None
    baseline_selector: Optional[Dict[str, str]] = None
    analysis_duration: Optional[int] = None
    step_interval: Optional[int] = None
    pass_threshold: Optional[float] = None
    marginal_threshold: Optional[float] = None


class CanaryConfigResponse(BaseModel):
    id: uuid.UUID
    name: str
    description: Optional[str]
    metrics: List[MetricConfig]
    canary_selector: Dict[str, str]
    baseline_selector: Dict[str, str]
    analysis_duration: int
    step_interval: int
    pass_threshold: float
    marginal_threshold: float
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
