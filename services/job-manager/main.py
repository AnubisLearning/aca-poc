"""
Job Manager Service
===================
Manages the lifecycle of canary analysis jobs:
  - Create / Start / Pause / Resume / Stop / Cancel / Re-run
  - Drives the analysis loop (calls Analysis Engine at each step)
  - Persists snapshots + final results via Results Service
  - Publishes state changes to Redis pub/sub for real-time UI updates

Job state machine
-----------------
  pending → running → completed
                    ↘ failed
            ↕ paused
  any → cancelled
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
import redis.asyncio as aioredis
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# ── Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    database_url: str = "postgresql://aca:aca_secret@localhost:5432/aca"
    redis_url: str = "redis://localhost:6379"
    analysis_engine_url: str = "http://localhost:8003"
    config_service_url: str = "http://localhost:8001"
    results_service_url: str = "http://localhost:8005"
    service_port: int = 8004

    class Config:
        env_file = ".env"


settings = Settings()

_db_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(_db_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# ── ORM ────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class AnalysisJobORM(Base):
    __tablename__ = "analysis_jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    config_id: Mapped[uuid.UUID] = mapped_column(sa.UUID(as_uuid=True), nullable=False)
    status: Mapped[str] = mapped_column(
        sa.Enum("pending", "running", "paused", "completed", "failed", "cancelled",
                name="job_status", create_type=False),
        nullable=False, default="pending"
    )
    start_time: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    end_time: Mapped[Optional[datetime]] = mapped_column(sa.DateTime(timezone=True))
    duration: Mapped[int] = mapped_column(sa.Integer, nullable=False, default=300)
    progress: Mapped[float] = mapped_column(sa.Float, nullable=False, default=0.0)
    error_msg: Mapped[Optional[str]] = mapped_column(sa.Text)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


# ── Pydantic models ────────────────────────────────────────────────────────

class JobCreate(BaseModel):
    config_id: uuid.UUID
    duration: Optional[int] = None  # override config duration


class JobResponse(BaseModel):
    id: uuid.UUID
    config_id: uuid.UUID
    status: str
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    duration: int
    progress: float
    error_msg: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class JobControl(BaseModel):
    action: str  # start | pause | resume | stop | cancel


# ── Global state ──────────────────────────────────────────────────────────
# Tracks running async tasks per job id

_running_tasks: Dict[str, asyncio.Task] = {}
_pause_events: Dict[str, asyncio.Event] = {}  # set = running, clear = paused
_stop_events: Dict[str, asyncio.Event] = {}   # set = stop requested

_redis: aioredis.Redis
_http: httpx.AsyncClient


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis, _http
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    _redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    _http = httpx.AsyncClient(timeout=60.0)
    yield
    for task in _running_tasks.values():
        task.cancel()
    await _redis.aclose()
    await _http.aclose()
    await engine.dispose()


# ── Helpers ────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def orm_to_response(obj: AnalysisJobORM) -> JobResponse:
    return JobResponse(
        id=obj.id,
        config_id=obj.config_id,
        status=obj.status,
        start_time=obj.start_time,
        end_time=obj.end_time,
        duration=obj.duration,
        progress=obj.progress,
        error_msg=obj.error_msg,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
    )


async def _publish_event(job_id: str, event_type: str, payload: dict):
    """Publish job state to Redis channel for SSE/WebSocket relay."""
    msg = json.dumps({"job_id": job_id, "event": event_type, "data": payload})
    await _redis.publish(f"job:{job_id}", msg)
    await _redis.publish("jobs:all", msg)


async def _get_config(config_id: str) -> dict:
    r = await _http.get(f"{settings.config_service_url}/configs/{config_id}")
    r.raise_for_status()
    return r.json()


async def _call_analysis_engine(
    job_id: str,
    config: dict,
    start_time: float,
    end_time: float,
) -> dict:
    payload = {
        "job_id": job_id,
        "config_id": config["id"],
        "metrics": config["metrics"],
        "canary_selector": config["canary_selector"],
        "baseline_selector": config["baseline_selector"],
        "start_time": start_time,
        "end_time": end_time,
        "step": config["step_interval"],
        "pass_threshold": config["pass_threshold"],
        "marginal_threshold": config["marginal_threshold"],
    }
    r = await _http.post(f"{settings.analysis_engine_url}/analyze", json=payload)
    r.raise_for_status()
    return r.json()


async def _save_snapshot(job_id: str, score: float, metric_scores: list, progress: float):
    try:
        await _http.post(
            f"{settings.results_service_url}/snapshots",
            json={
                "job_id": job_id,
                "score": score,
                "metric_scores": metric_scores,
                "progress": progress,
            },
        )
    except Exception:
        pass  # Non-critical


async def _save_final_result(job_id: str, config_id: str, analysis_result: dict):
    try:
        await _http.post(
            f"{settings.results_service_url}/results",
            json={
                "job_id": job_id,
                "config_id": config_id,
                "score": analysis_result["score"],
                "recommendation": analysis_result["recommendation"],
                "metric_scores": analysis_result["metric_results"],
                "raw_data": analysis_result,
            },
        )
    except Exception:
        pass


# ── Analysis loop ──────────────────────────────────────────────────────────

async def _run_analysis_loop(job_id: str, config: dict, duration: int):
    """
    Background task that drives periodic analysis over `duration` seconds.
    Respects pause / stop signals.
    """
    pause_ev = _pause_events[job_id]
    stop_ev = _stop_events[job_id]
    pause_ev.set()  # initially running

    step = config["step_interval"]
    window_start = time.time()
    window_end = window_start + duration
    last_result: Optional[dict] = None
    error_msg: Optional[str] = None

    try:
        while True:
            now = time.time()
            elapsed = now - window_start
            progress = min(elapsed / duration, 1.0)

            # ── Pause gate ──────────────────────────────────────────────
            await pause_ev.wait()

            # ── Stop gate ───────────────────────────────────────────────
            if stop_ev.is_set():
                break

            # ── Done? ───────────────────────────────────────────────────
            if now >= window_end:
                progress = 1.0

            # ── Call analysis engine ────────────────────────────────────
            query_start = max(window_start, now - step * 2)
            query_end = now

            try:
                result = await _call_analysis_engine(
                    job_id, config, query_start, query_end
                )
                last_result = result
                await _save_snapshot(
                    job_id,
                    result["score"],
                    result["metric_results"],
                    progress,
                )
                await _publish_event(
                    job_id,
                    "snapshot",
                    {
                        "score": result["score"],
                        "recommendation": result["recommendation"],
                        "metric_results": result["metric_results"],
                        "progress": round(progress, 4),
                    },
                )
            except Exception as exc:
                await _publish_event(job_id, "analysis_error", {"error": str(exc)})

            # ── Update progress in DB ────────────────────────────────────
            async with SessionLocal() as session:
                obj = await session.get(AnalysisJobORM, uuid.UUID(job_id))
                if obj:
                    obj.progress = round(progress, 4)
                    obj.updated_at = _now_utc()
                    await session.commit()

            if progress >= 1.0:
                break

            await asyncio.sleep(step)

    except asyncio.CancelledError:
        error_msg = "Job cancelled"
    except Exception as exc:
        error_msg = str(exc)

    # ── Finalise job ──────────────────────────────────────────────────────
    final_status = "completed"
    if stop_ev.is_set():
        final_status = "cancelled"
    elif error_msg and not last_result:
        final_status = "failed"

    async with SessionLocal() as session:
        obj = await session.get(AnalysisJobORM, uuid.UUID(job_id))
        if obj:
            obj.status = final_status
            obj.end_time = _now_utc()
            obj.progress = 1.0 if final_status == "completed" else obj.progress
            if error_msg:
                obj.error_msg = error_msg
            obj.updated_at = _now_utc()
            await session.commit()

    if last_result and final_status == "completed":
        await _save_final_result(job_id, config["id"], last_result)

    await _publish_event(
        job_id,
        "job_status",
        {
            "status": final_status,
            "score": last_result["score"] if last_result else None,
            "recommendation": last_result["recommendation"] if last_result else None,
        },
    )

    # Cleanup
    _running_tasks.pop(job_id, None)
    _pause_events.pop(job_id, None)
    _stop_events.pop(job_id, None)


# ── App ────────────────────────────────────────────────────────────────────

app = FastAPI(title="Job Manager", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "job-manager", "running_jobs": len(_running_tasks)}


@app.post("/jobs", response_model=JobResponse, status_code=201)
async def create_job(payload: JobCreate):
    # Validate config exists
    try:
        config = await _get_config(str(payload.config_id))
    except Exception:
        raise HTTPException(status_code=404, detail="Config not found")

    duration = payload.duration or config["analysis_duration"]

    async with SessionLocal() as session:
        obj = AnalysisJobORM(
            config_id=payload.config_id,
            status="pending",
            duration=duration,
        )
        session.add(obj)
        await session.commit()
        await session.refresh(obj)
        job_id = str(obj.id)

    await _publish_event(job_id, "job_status", {"status": "pending"})
    return orm_to_response(obj)


@app.get("/jobs", response_model=List[JobResponse])
async def list_jobs(
    status: Optional[str] = None,
    config_id: Optional[uuid.UUID] = None,
    skip: int = 0,
    limit: int = 50,
):
    async with SessionLocal() as session:
        q = sa.select(AnalysisJobORM).order_by(AnalysisJobORM.created_at.desc())
        if status:
            q = q.where(AnalysisJobORM.status == status)
        if config_id:
            q = q.where(AnalysisJobORM.config_id == config_id)
        q = q.offset(skip).limit(limit)
        result = await session.execute(q)
        return [orm_to_response(r) for r in result.scalars()]


@app.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: uuid.UUID):
    async with SessionLocal() as session:
        obj = await session.get(AnalysisJobORM, job_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Job not found")
        return orm_to_response(obj)


@app.post("/jobs/{job_id}/control", response_model=JobResponse)
async def control_job(job_id: uuid.UUID, control: JobControl, background_tasks: BackgroundTasks):
    job_id_str = str(job_id)
    async with SessionLocal() as session:
        obj = await session.get(AnalysisJobORM, job_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Job not found")

        action = control.action.lower()

        # ── start ──────────────────────────────────────────────────────────
        if action == "start":
            if obj.status not in ("pending",):
                raise HTTPException(
                    status_code=409, detail=f"Cannot start job in status '{obj.status}'"
                )
            try:
                config = await _get_config(str(obj.config_id))
            except Exception:
                raise HTTPException(status_code=404, detail="Config not found")

            obj.status = "running"
            obj.start_time = _now_utc()
            obj.updated_at = _now_utc()
            await session.commit()
            await session.refresh(obj)

            # Start background loop
            _pause_events[job_id_str] = asyncio.Event()
            _stop_events[job_id_str] = asyncio.Event()
            task = asyncio.create_task(
                _run_analysis_loop(job_id_str, config, obj.duration)
            )
            _running_tasks[job_id_str] = task
            await _publish_event(job_id_str, "job_status", {"status": "running"})

        # ── pause ──────────────────────────────────────────────────────────
        elif action == "pause":
            if obj.status != "running":
                raise HTTPException(
                    status_code=409, detail="Job is not running"
                )
            if job_id_str in _pause_events:
                _pause_events[job_id_str].clear()
            obj.status = "paused"
            obj.updated_at = _now_utc()
            await session.commit()
            await session.refresh(obj)
            await _publish_event(job_id_str, "job_status", {"status": "paused"})

        # ── resume ─────────────────────────────────────────────────────────
        elif action == "resume":
            if obj.status != "paused":
                raise HTTPException(
                    status_code=409, detail="Job is not paused"
                )
            if job_id_str in _pause_events:
                _pause_events[job_id_str].set()
            obj.status = "running"
            obj.updated_at = _now_utc()
            await session.commit()
            await session.refresh(obj)
            await _publish_event(job_id_str, "job_status", {"status": "running"})

        # ── stop / cancel ──────────────────────────────────────────────────
        elif action in ("stop", "cancel"):
            if obj.status in ("completed", "failed", "cancelled"):
                raise HTTPException(
                    status_code=409, detail=f"Job already {obj.status}"
                )
            if job_id_str in _stop_events:
                _stop_events[job_id_str].set()
            if job_id_str in _pause_events:
                _pause_events[job_id_str].set()  # unblock pause so task exits
            if job_id_str in _running_tasks:
                _running_tasks[job_id_str].cancel()
            obj.status = "cancelled"
            obj.end_time = _now_utc()
            obj.updated_at = _now_utc()
            await session.commit()
            await session.refresh(obj)
            await _publish_event(job_id_str, "job_status", {"status": "cancelled"})

        # ── re-run ─────────────────────────────────────────────────────────
        elif action == "rerun":
            if obj.status not in ("completed", "failed", "cancelled"):
                raise HTTPException(
                    status_code=409,
                    detail="Can only re-run completed, failed, or cancelled jobs",
                )
            # Reset the job
            obj.status = "pending"
            obj.start_time = None
            obj.end_time = None
            obj.progress = 0.0
            obj.error_msg = None
            obj.updated_at = _now_utc()
            await session.commit()
            await session.refresh(obj)
            await _publish_event(job_id_str, "job_status", {"status": "pending"})

        else:
            raise HTTPException(status_code=400, detail=f"Unknown action '{action}'")

        return orm_to_response(obj)


@app.delete("/jobs/{job_id}", status_code=204)
async def delete_job(job_id: uuid.UUID):
    job_id_str = str(job_id)
    if job_id_str in _stop_events:
        _stop_events[job_id_str].set()
    if job_id_str in _pause_events:
        _pause_events[job_id_str].set()
    if job_id_str in _running_tasks:
        _running_tasks[job_id_str].cancel()

    async with SessionLocal() as session:
        obj = await session.get(AnalysisJobORM, job_id)
        if obj:
            await session.delete(obj)
            await session.commit()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.service_port, reload=False)
