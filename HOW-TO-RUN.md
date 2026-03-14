# How to Run ACA – Automated Canary Analysis

This guide walks you through getting the full application stack running,
verifying each service is healthy, and using the UI end-to-end.

---

## Prerequisites

Before you start, ensure the following are installed on your machine:

| Tool | Minimum Version | Check |
|------|----------------|-------|
| Docker Desktop | 24+ | `docker --version` |
| Docker Compose | v2 (bundled with Docker Desktop) | `docker compose version` |
| Git | any | `git --version` |

> **Windows users:** Make sure Docker Desktop is running and WSL 2 integration
> is enabled (Settings → Resources → WSL Integration).

---

## Step 1 – Get the code

If you haven't already, navigate to the project folder in a terminal:

```bash
cd path/to/aca-project/aca-poc
```

Confirm the key files are present:

```bash
ls docker-compose.yml README.md .env
```

You should see all three files listed without errors.

---

## Step 2 – (Optional) Review environment variables

Open [.env](.env) to see the default configuration.
The defaults work out of the box — no changes are needed for a local run.

```
POSTGRES_USER=aca
POSTGRES_PASSWORD=aca_secret
POSTGRES_DB=aca
REDIS_URL=redis://redis:6379
...
```

Only edit this file if you need to change ports or connect to an external
Prometheus / PostgreSQL instance.

---

## Step 3 – Build and start all services

Run a single command from the project root:

```bash
docker compose up --build
```

This will:
1. Pull base images (postgres, redis, prometheus, nginx, node, python)
2. Build all 5 Python microservice images
3. Build the Node.js API gateway image
4. Build the React UI image
5. Start everything in dependency order

**First run takes 5–10 minutes** due to image pulls and Python package
installation (numpy, hmmlearn, scipy). Subsequent starts take ~30 seconds.

### What healthy startup looks like

Watch the log output. You should see lines like these (order varies):

```
postgres      | database system is ready to accept connections
redis         | Ready to accept connections
config-service| INFO:     Application startup complete.
metrics-fetcher| INFO:     Application startup complete.
analysis-engine| INFO:     Application startup complete.
job-manager   | INFO:     Application startup complete.
results-service| INFO:     Application startup complete.
api-gateway   | [Gateway] Listening on http://0.0.0.0:3000
mock-exporter | Starting mock exporter on :8000
```

Press `Ctrl+C` at any time to stop all services gracefully.

---

## Step 4 – Verify all services are healthy

Open a second terminal (leave the first running) and run:

```bash
docker compose ps
```

Every service should show **`running`** or **`healthy`** status.

You can also hit the health endpoint of the API gateway directly:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "ok",
  "service": "api-gateway",
  "upstream": {
    "config-service": "ok",
    "job-manager": "ok",
    "results-service": "ok"
  }
}
```

If any upstream shows `"unreachable"`, wait 10–15 seconds and retry —
services have a `restart: on-failure` policy and may still be warming up.

---

## Step 5 – Open the UI

Navigate to:

```
http://localhost:5173
```

You will see the **Dashboard** page with an empty job list and a Quick Launch panel.

---

## Step 6 – Create a Canary Config

A config defines which metrics to analyse and the acceptance thresholds.

1. Click **Configs** in the top navigation bar
2. Click **New Config**
3. Fill in the form:

   | Field | Example value |
   |-------|--------------|
   | Config name | `my-first-canary` |
   | Description | `Testing latency and error rate` |
   | Canary selector | `deployment=canary` |
   | Baseline selector | `deployment=baseline` |
   | Analysis duration | `120` (seconds — short for a quick test) |
   | Step interval | `15` |
   | Pass threshold | `75` |
   | Marginal threshold | `50` |

4. Under **Metrics**, add the following (click **Add Metric** for each):

   **Metric 1 – Latency**
   | Field | Value |
   |-------|-------|
   | Name | `http_latency_p99` |
   | PromQL template | `latency_p99_seconds{deployment='{deployment}'}` |
   | Weight | `2` |
   | Direction | `lower_is_better` |

   **Metric 2 – Error rate**
   | Field | Value |
   |-------|-------|
   | Name | `error_rate` |
   | PromQL template | `error_rate{deployment='{deployment}'}` |
   | Weight | `3` |
   | Direction | `lower_is_better` |

   **Metric 3 – CPU**
   | Field | Value |
   |-------|-------|
   | Name | `cpu_usage` |
   | PromQL template | `cpu_usage_percent{deployment='{deployment}'}` |
   | Weight | `1` |
   | Direction | `lower_is_better` |

5. Click **Create Config**

> The mock exporter automatically publishes metrics under the labels
> `deployment="canary"` and `deployment="baseline"` — your queries will
> match them immediately without any extra setup.

---

## Step 7 – Run an analysis

### Option A – Quick Launch on the Dashboard

1. Go to **Dashboard** (`/`)
2. Select your config from the **Canary Config** dropdown
3. Optionally override the duration in the **Duration** field
4. Click **Start Analysis**

### Option B – Run directly from the Configs page

1. Go to **Configs**
2. Click the green **Run** button next to your config

Both options create a job and start it immediately.

---

## Step 8 – Watch the analysis in real time

After launching, you are taken to (or can navigate to) the **Jobs** page.
Click **Details →** on your job to open the Job Detail page.

You will see:

- **Status badge** — updates live (running → completed)
- **Progress bar** — fills as analysis steps complete
- **Score dial** — animates toward the current weighted aggregate score
- **Score over time chart** — area chart updating every step interval,
  with green (pass) and amber (marginal) threshold lines
- **Metric breakdown cards** — one card per metric showing:
  - Individual score (0–100)
  - SAX similarity score
  - HMM log-likelihood score
  - Canary mean vs baseline mean
  - Pass / Fail / No-data status

---

## Step 9 – Control a running job

While a job is **running** you can:

| Button | Action |
|--------|--------|
| **Pause** | Suspends the analysis loop (metrics stop being fetched) |
| **Resume** | Continues from where it paused |
| **Stop** | Cancels the job immediately |

After a job is **completed**, **failed**, or **cancelled**:

| Button | Action |
|--------|--------|
| **Re-run** | Resets the job to `pending` so you can start it again |

You can also control jobs from the **Jobs** list page using the inline action buttons.

---

## Step 10 – Read the final result

When the job reaches 100% progress it moves to **completed** and a final
recommendation banner appears at the bottom of the Job Detail page:

| Score range | Recommendation |
|-------------|---------------|
| ≥ pass threshold (default 75) | **ROLL OUT** — canary is healthy |
| < marginal threshold (default 50) | **ROLL BACK** — canary is degraded |
| between the two | **INCONCLUSIVE** — needs more data |

The mock exporter injects periodic latency spikes into the canary every
~120 seconds, so you will see the score dip during anomaly windows — this
is intentional and demonstrates the SAX+HMM model detecting drift.

---

## Useful URLs

| Service | URL |
|---------|-----|
| UI | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| API Health | http://localhost:3000/health |
| Prometheus | http://localhost:9090 |
| Mock Exporter metrics | http://localhost:8000/metrics |
| Config Service (direct) | http://localhost:8001/docs |
| Metrics Fetcher (direct) | http://localhost:8002/docs |
| Analysis Engine (direct) | http://localhost:8003/docs |
| Job Manager (direct) | http://localhost:8004/docs |
| Results Service (direct) | http://localhost:8005/docs |

> Every FastAPI service ships with a built-in **Swagger UI** at `/docs` —
> useful for exploring or testing individual service APIs directly.

---

## Stopping the application

```bash
# Stop all containers (keeps data volumes)
docker compose down

# Stop AND wipe all data (fresh start next time)
docker compose down -v
```

---

## Troubleshooting

### Services restart repeatedly

Check the logs of the failing service:

```bash
docker compose logs config-service --tail 40
docker compose logs job-manager --tail 40
```

Most restarts on first boot are the Python services waiting for Postgres to
finish initialising. They will stabilise within 30 seconds.

### UI shows blank page or network errors

1. Confirm the API gateway is healthy: `curl http://localhost:3000/health`
2. Check the browser console for errors
3. Hard-refresh the page (`Ctrl+Shift+R`)

### Port already in use

If a port is occupied, edit [docker-compose.yml](docker-compose.yml) and
change the **host** port (the left side of `"HOST:CONTAINER"`), e.g.:

```yaml
ports:
  - "5174:80"   # change 5173 → 5174 for the UI
```

### Rebuilding a single service after a code change

```bash
docker compose up --build <service-name>

# Examples:
docker compose up --build analysis-engine
docker compose up --build ui
```

### Complete reset

```bash
docker compose down -v          # remove containers + volumes
docker system prune -f          # remove dangling images
docker compose up --build       # fresh build
```
