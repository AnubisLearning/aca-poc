"""
Config Service – manages canary analysis configurations.
"""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic_settings import BaseSettings
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, Text, Integer, Float, JSON, DateTime
import sqlalchemy as sa

from models import (
    CanaryConfigCreate,
    CanaryConfigUpdate,
    CanaryConfigResponse,
)


# ── Settings ───────────────────────────────────────────────────────────────

class Settings(BaseSettings):
    database_url: str = "postgresql://aca:aca_secret@localhost:5432/aca"
    service_port: int = 8001

    class Config:
        env_file = ".env"


settings = Settings()

# SQLAlchemy async engine
_db_url = settings.database_url.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(_db_url, echo=False, pool_pre_ping=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# ── ORM Model ─────────────────────────────────────────────────────────────

class Base(DeclarativeBase):
    pass


class CanaryConfigORM(Base):
    __tablename__ = "canary_configs"

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    metrics: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    canary_selector: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    baseline_selector: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    analysis_duration: Mapped[int] = mapped_column(Integer, nullable=False, default=300)
    step_interval: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    pass_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=75.0)
    marginal_threshold: Mapped[float] = mapped_column(Float, nullable=False, default=50.0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )


# ── App lifecycle ──────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(title="Config Service", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Helpers ────────────────────────────────────────────────────────────────

def orm_to_response(obj: CanaryConfigORM) -> CanaryConfigResponse:
    return CanaryConfigResponse(
        id=obj.id,
        name=obj.name,
        description=obj.description,
        metrics=obj.metrics,
        canary_selector=obj.canary_selector,
        baseline_selector=obj.baseline_selector,
        analysis_duration=obj.analysis_duration,
        step_interval=obj.step_interval,
        pass_threshold=obj.pass_threshold,
        marginal_threshold=obj.marginal_threshold,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
    )


# ── Routes ─────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "service": "config-service"}


@app.post("/configs", response_model=CanaryConfigResponse, status_code=201)
async def create_config(payload: CanaryConfigCreate):
    async with SessionLocal() as session:
        obj = CanaryConfigORM(
            name=payload.name,
            description=payload.description,
            metrics=[m.model_dump() for m in payload.metrics],
            canary_selector=payload.canary_selector,
            baseline_selector=payload.baseline_selector,
            analysis_duration=payload.analysis_duration,
            step_interval=payload.step_interval,
            pass_threshold=payload.pass_threshold,
            marginal_threshold=payload.marginal_threshold,
        )
        session.add(obj)
        await session.commit()
        await session.refresh(obj)
        return orm_to_response(obj)


@app.get("/configs", response_model=List[CanaryConfigResponse])
async def list_configs(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
):
    async with SessionLocal() as session:
        result = await session.execute(
            sa.select(CanaryConfigORM)
            .order_by(CanaryConfigORM.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        return [orm_to_response(r) for r in result.scalars()]


@app.get("/configs/{config_id}", response_model=CanaryConfigResponse)
async def get_config(config_id: uuid.UUID):
    async with SessionLocal() as session:
        obj = await session.get(CanaryConfigORM, config_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Config not found")
        return orm_to_response(obj)


@app.patch("/configs/{config_id}", response_model=CanaryConfigResponse)
async def update_config(config_id: uuid.UUID, payload: CanaryConfigUpdate):
    async with SessionLocal() as session:
        obj = await session.get(CanaryConfigORM, config_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Config not found")

        updates = payload.model_dump(exclude_unset=True)
        if "metrics" in updates:
            updates["metrics"] = [
                m.model_dump() if hasattr(m, "model_dump") else m
                for m in updates["metrics"]
            ]
        for field, value in updates.items():
            setattr(obj, field, value)
        obj.updated_at = datetime.utcnow()

        await session.commit()
        await session.refresh(obj)
        return orm_to_response(obj)


@app.delete("/configs/{config_id}", status_code=204)
async def delete_config(config_id: uuid.UUID):
    async with SessionLocal() as session:
        obj = await session.get(CanaryConfigORM, config_id)
        if not obj:
            raise HTTPException(status_code=404, detail="Config not found")
        await session.delete(obj)
        await session.commit()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=settings.service_port, reload=False)
