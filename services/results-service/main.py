"""
Results Service
===============
Stores and retrieves analysis results and real-time snapshots.

Endpoints
---------
POST   /results            – persist a final analysis result
GET    /results            – list results (with filters)
GET    /results/{id}       – single result
GET    /results/job/{job_id} – result for a specific job

POST   /snapshots          – save an intermediate progress snapshot
GET    /snapshots/{job_id} – list all snapshots for a job

GET    /health
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import redis.asyncio as aioredis
import sqlalchemy as sa
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pydantic_settings import BaseSettings
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


# ── Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    database_url: str = "postgresql://aca:aca_secret@localhost:5432/aca"
    redis_url: str = "redis://localhost:6379"
    service_port: int = 8005

    class Config:
        env_file = ".env"


settings = Settings()

_db_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(_db_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# ── ORM ────────────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class AnalysisResultORM(Base):
    __tablename__ = "analysis_results"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(sa.UUID(as_uuid=True), nullable=False)
    config_id: Mapped[uuid.UUID] = mapped_column(sa.UUID(as_uuid=True), nullable=False)
    score: Mapped[float] = mapped_column(sa.Float, nullable=False)
    recommendation: Mapped[str] = mapped_column(
        sa.Enum("rollout", "rollback", "inconclusive",
                name="recommendation", create_type=False),
        nullable=False
    )
    metric_scores: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    raw_data: Mapped[Optional[dict]] = mapped_column(sa.JSON)
    created_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class AnalysisSnapshotORM(Base):
    __tablename__ = "analysis_snapshots"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    job_id: Mapped[uuid.UUID] = mapped_column(sa.UUID(as_uuid=True), nullable=False)
    snapshot_at: Mapped[datetime] = mapped_column(
        sa.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    score: Mapped[Optional[float]] = mapped_column(sa.Float)
    metric_scores: Mapped[list] = mapped_column(sa.JSON, nullable=False, default=list)
    progress: Mapped[float] = mapped_column(sa.Float, nullable=False, default=0.0)


# ── Pydantic models ────────────────────────────────────────────────────────

class ResultCreate(BaseModel):
    job_id: uuid.UUID
    config_id: uuid.UUID
    score: float
    recommendation: str
    metric_scores: List[Dict[str, Any]]
    raw_data: Optional[Dict[str, Any]] = None


class ResultResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    config_id: uuid.UUID
    score: float
    recommendation: str
    metric_scores: List[Dict[str, Any]]
    raw_data: Optional[Dict[str, Any]]
    created_at: datetime

    model_config = {"from_attributes": True}


class SnapshotCreate(BaseModel):
    job_id: uuid.UUID
    score: Optional[float]
    metric_scores: List[Dict[str, Any]] = []
    progress: float


class SnapshotResponse(BaseModel):
    id: uuid.UUID
    job_id: uuid.UUID
    snapshot_at: datetime
    score: Optional[float]
    metric_scores: List[Dict[str, Any]]
    progress: float

    model_config = {"from_attributes": True}


from typing import Any


# ── App lifecycle ──────────────────────────────────────────────────────────

_redis: aioredis.Redis


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _redis
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    _redis = await aioredis.from_url(settings.redis_url, decode_responses=True)
    yield
    await _redis.aclose()
    await engine.dispose()


app = FastAPI(title="Results Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


# ── Result endpoints ───────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "results-service"}


@app.post("/results", response_model=ResultResponse, status_code=201)
async def create_result(payload: ResultCreate):
    async with SessionLocal() as session:
        # Upsert: one result per job_id
        existing = await session.execute(
            sa.select(AnalysisResultORM).where(
                AnalysisResultORM.job_id == payload.job_id
            )
        )
        obj = existing.scalar_one_or_none()
        if obj:
            obj.score = payload.score
            obj.recommendation = payload.recommendation
            obj.metric_scores = payload.metric_scores
            obj.raw_data = payload.raw_data
        else:
            obj = AnalysisResultORM(
                job_id=payload.job_id,
                config_id=payload.config_id,
                score=payload.score,
                recommendation=payload.recommendation,
                metric_scores=payload.metric_scores,
                raw_data=payload.raw_data,
            )
            session.add(obj)
        await session.commit()
        await session.refresh(obj)
        return obj


@app.get("/results", response_model=List[ResultResponse])
async def list_results(
    config_id: Optional[uuid.UUID] = None,
    recommendation: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    async with SessionLocal() as session:
        q = sa.select(AnalysisResultORM).order_by(AnalysisResultORM.created_at.desc())
        if config_id:
            q = q.where(AnalysisResultORM.config_id == config_id)
        if recommendation:
            q = q.where(AnalysisResultORM.recommendation == recommendation)
        q = q.offset(skip).limit(limit)
        result = await session.execute(q)
        return list(result.scalars())


@app.get("/results/job/{job_id}", response_model=ResultResponse)
async def get_result_by_job(job_id: uuid.UUID):
    async with SessionLocal() as session:
        result = await session.execute(
            sa.select(AnalysisResultORM).where(AnalysisResultORM.job_id == job_id)
        )
        obj = result.scalar_one_or_none()
        if not obj:
            raise HTTPException(status_code=404, detail="Result not found")
        return obj


@app.get("/results/{result_id}", response_model=ResultResponse)
async def get_result(result_id: uuid.UUID):
    async with SessionLocal() as session:
        obj = await session.get(AnalysisResultORM, result_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Result not found")
        return obj


# ── Snapshot endpoints ─────────────────────────────────────────────────────

@app.post("/snapshots", response_model=SnapshotResponse, status_code=201)
async def create_snapshot(payload: SnapshotCreate):
    async with SessionLocal() as session:
        obj = AnalysisSnapshotORM(
            job_id=payload.job_id,
            score=payload.score,
            metric_scores=payload.metric_scores,
            progress=payload.progress,
        )
        session.add(obj)
        await session.commit()
        await session.refresh(obj)
        return obj


@app.get("/snapshots/{job_id}", response_model=List[SnapshotResponse])
async def list_snapshots(job_id: uuid.UUID, limit: int = Query(100, ge=1, le=500)):
    async with SessionLocal() as session:
        result = await session.execute(
            sa.select(AnalysisSnapshotORM)
            .where(AnalysisSnapshotORM.job_id == job_id)
            .order_by(AnalysisSnapshotORM.snapshot_at.asc())
            .limit(limit)
        )
        return list(result.scalars())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.service_port, reload=False)
