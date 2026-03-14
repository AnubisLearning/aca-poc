# ACA – Automated Canary Analysis

End-to-end microservice system for automated statistical canary analysis in production.
Compares canary vs baseline Prometheus metrics using the **SAX + HMM** statistical model,
produces a **0–100 score**, and recommends **rollout / rollback / inconclusive**.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            Browser                                  │
│                         React + Socket.IO                           │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTP / WebSocket
┌────────────────────────────────▼────────────────────────────────────┐
│                         API Gateway  :3000                          │
│            Node.js + Express + Socket.IO + Redis sub                │
└──────────┬──────────────┬──────────────────────┬───────────────────┘
           │              │                      │
    ┌──────▼──────┐ ┌─────▼──────┐  ┌───────────▼───────┐
    │config-svc   │ │job-manager │  │ results-service   │
    │  :8001      │ │   :8004    │  │     :8005         │
    │FastAPI+PG   │ │FastAPI+PG  │  │ FastAPI+PG+Redis  │
    └─────────────┘ └─────┬──────┘  └───────────────────┘
                          │ calls
              ┌───────────▼──────────┐
              │  analysis-engine     │
              │     :8003            │
              │  FastAPI + numpy     │
              │  SAX + HMM (hmmlearn)│
              └───────────┬──────────┘
                          │ calls
              ┌───────────▼──────────┐
              │  metrics-fetcher     │
              │     :8002            │
              │  FastAPI + httpx     │
              │  Prometheus client   │
              └───────────┬──────────┘
                          │ scrapes
              ┌───────────▼──────────┐   ┌──────────────────────┐
              │    Prometheus :9090  │◄──│  mock-exporter :8000 │
              └──────────────────────┘   │  simulates canary +  │
                                         │  baseline metrics     │
                                         └──────────────────────┘

          PostgreSQL :5432      Redis :6379
```

### Services

| Service | Port | Technology | Responsibility |
|---------|------|------------|----------------|
| `config-service` | 8001 | Python/FastAPI + PostgreSQL | CRUD for canary analysis configs |
| `metrics-fetcher` | 8002 | Python/FastAPI + httpx | PromQL query client with synthetic fallback |
| `analysis-engine` | 8003 | Python/FastAPI + numpy/hmmlearn | SAX+HMM scoring, 0-100 metric evaluation |
| `job-manager` | 8004 | Python/FastAPI + Redis | Job lifecycle: start/pause/resume/stop/rerun |
| `results-service` | 8005 | Python/FastAPI + PostgreSQL | Persist results and real-time snapshots |
| `api-gateway` | 3000 | Node.js/Express + Socket.IO | REST proxy + WebSocket relay from Redis pub/sub |
| `ui` | 5173/80 | React + TypeScript + Tailwind | Interactive dashboard, controls, real-time charts |
| `mock-exporter` | 8000 | Python/prometheus-client | Simulates canary & baseline Prometheus metrics |
| `prometheus` | 9090 | Prometheus | Metrics store |
| `postgres` | 5432 | PostgreSQL 15 | Persistent storage |
| `redis` | 6379 | Redis 7 | Job state pub/sub + pause/stop events |

---

## Statistical Model: SAX + HMM

### SAX (Symbolic Aggregate approXimation)
1. **Z-score normalise** the time series
2. **PAA** (Piecewise Aggregate Approximation) – reduce to `w` segments
3. **Breakpoint mapping** – assign each segment a letter from alphabet size `a` using Gaussian quantiles
4. Compute **MINDIST** lower-bound distance between canary and baseline SAX strings

### HMM (Hidden Markov Model)
1. **Train** a Gaussian HMM on the baseline time series
2. **Score** the canary series log-likelihood under the baseline model
3. Compute a **log-likelihood ratio** (canary vs baseline self-score)
4. Map via sigmoid to a 0–1 similarity score

### Combined Score
```
metric_score = (sax_score × 0.5 + hmm_score × 0.5) × 100

weighted_aggregate = Σ(metric_score_i × weight_i) / Σ(weight_i)
```

### Recommendation
```
score ≥ pass_threshold   → ROLLOUT   ✅
score < marginal_threshold → ROLLBACK ❌
else                       → INCONCLUSIVE ⚠️
```

---

## Quick Start

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/) + Docker Compose v2

### Run
```bash
# Clone / navigate to project
cd aca-poc

# Start all services
docker compose up --build

# UI available at:
open http://localhost:5173

# API gateway at:
open http://localhost:3000/health
```

### Dev mode (without Docker)
```bash
# 1. Start infra
docker compose up postgres redis prometheus mock-exporter -d

# 2. Config Service
cd services/config-service && pip install -r requirements.txt && python main.py

# 3. Metrics Fetcher
cd services/metrics-fetcher && pip install -r requirements.txt && python main.py

# 4. Analysis Engine
cd services/analysis-engine && pip install -r requirements.txt && python main.py

# 5. Job Manager
cd services/job-manager && pip install -r requirements.txt && python main.py

# 6. Results Service
cd services/results-service && pip install -r requirements.txt && python main.py

# 7. API Gateway
cd api-gateway && npm install && npm run dev

# 8. UI
cd ui && npm install && npm run dev
```

---

## Canary Config Schema

```json
{
  "name": "payment-service-canary",
  "description": "Canary analysis for payment service v2.1.0",
  "metrics": [
    {
      "name": "http_latency_p99",
      "query_template": "latency_p99_seconds{deployment='{deployment}'}",
      "weight": 2.0,
      "pass_threshold": 75.0,
      "direction": "lower_is_better"
    },
    {
      "name": "error_rate",
      "query_template": "error_rate{deployment='{deployment}'}",
      "weight": 3.0,
      "pass_threshold": 80.0,
      "direction": "lower_is_better"
    },
    {
      "name": "cpu_usage",
      "query_template": "cpu_usage_percent{deployment='{deployment}'}",
      "weight": 1.0,
      "pass_threshold": 70.0,
      "direction": "lower_is_better"
    }
  ],
  "canary_selector": { "deployment": "canary" },
  "baseline_selector": { "deployment": "baseline" },
  "analysis_duration": 300,
  "step_interval": 30,
  "pass_threshold": 75,
  "marginal_threshold": 50
}
```

**`{deployment}`** in `query_template` is substituted with the label value from `canary_selector` or `baseline_selector` at analysis time.

---

## API Reference

### Config Service (`/api/configs`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/configs` | List all configs |
| POST | `/api/configs` | Create config |
| GET | `/api/configs/:id` | Get config |
| PATCH | `/api/configs/:id` | Update config |
| DELETE | `/api/configs/:id` | Delete config |

### Jobs (`/api/jobs`, `/api/runs`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/runs` | Create job AND start immediately |
| GET | `/api/runs/:jobId` | Job + result + snapshots |
| GET | `/api/jobs` | List jobs (filter by status, config_id) |
| GET | `/api/jobs/:id` | Get job |
| POST | `/api/jobs/:id/control` | `{ "action": "start" \| "pause" \| "resume" \| "stop" \| "cancel" \| "rerun" }` |

### Results (`/api/results`, `/api/snapshots`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/results` | List final results |
| GET | `/api/results/job/:jobId` | Final result for a job |
| GET | `/api/snapshots/:jobId` | Progress snapshots for a job |

### WebSocket Events (Socket.IO)
```js
// Connect
const socket = io('http://localhost:3000')

// Subscribe to a specific job
socket.emit('subscribe_job', '<job-id>')
socket.emit('subscribe_all')          // all jobs

// Receive events
socket.on('job_event', (event) => {
  // event.event: 'snapshot' | 'job_status' | 'analysis_error'
  // event.job_id: string
  // event.data.score: number (0-100)
  // event.data.recommendation: 'rollout'|'rollback'|'inconclusive'
  // event.data.metric_results: MetricResult[]
  // event.data.progress: number (0-1)
  // event.data.status: JobStatus
})
```

---

## UI Features

| Feature | Location |
|---------|----------|
| Dashboard with live job list | `/` |
| Quick-launch analysis from any config | `/` |
| Real-time score chart (area chart with threshold lines) | `/jobs/:id` |
| Score dial with recommendation | `/jobs/:id` |
| Per-metric cards with SAX/HMM breakdown | `/jobs/:id` |
| Pause / Resume / Stop / Re-run controls | `/jobs/:id`, `/jobs` |
| Config CRUD with metric editor | `/configs`, `/configs/new`, `/configs/:id/edit` |

---

## Project Structure

```
aca-poc/
├── docker-compose.yml
├── .env
├── services/
│   ├── config-service/        # FastAPI – config CRUD
│   ├── metrics-fetcher/       # FastAPI – Prometheus query client
│   ├── analysis-engine/       # FastAPI – SAX+HMM scoring
│   │   ├── sax.py             # SAX algorithm + MINDIST
│   │   └── hmm_model.py       # GaussianHMM training + scoring
│   ├── job-manager/           # FastAPI – job lifecycle + analysis loop
│   └── results-service/       # FastAPI – results + snapshots storage
├── api-gateway/               # Node.js/Express + Socket.IO
│   └── src/index.ts
├── ui/                        # React + TypeScript + Tailwind
│   └── src/
│       ├── pages/             # Dashboard, Jobs, Configs
│       └── components/        # ScoreDial, MetricCard, ScoreChart, …
└── infra/
    ├── postgres/init.sql      # DB schema
    ├── prometheus/            # Prometheus config
    └── mock-exporter/         # Synthetic metrics generator
```
