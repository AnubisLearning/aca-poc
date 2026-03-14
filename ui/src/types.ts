export interface MetricConfig {
  name: string;
  query_template: string;
  weight: number;
  pass_threshold: number;
  direction: "lower_is_better" | "higher_is_better" | "no_direction";
}

export interface CanaryConfig {
  id: string;
  name: string;
  description?: string;
  metrics: MetricConfig[];
  canary_selector: Record<string, string>;
  baseline_selector: Record<string, string>;
  analysis_duration: number;
  step_interval: number;
  pass_threshold: number;
  marginal_threshold: number;
  created_at: string;
  updated_at: string;
}

export type JobStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface AnalysisJob {
  id: string;
  config_id: string;
  status: JobStatus;
  start_time?: string;
  end_time?: string;
  duration: number;
  progress: number;
  error_msg?: string;
  created_at: string;
  updated_at: string;
}

export type Recommendation = "rollout" | "rollback" | "inconclusive";

export interface MetricResult {
  metric_name: string;
  score: number;
  sax_score: number;
  hmm_score: number;
  weight: number;
  pass_threshold: number;
  status: "pass" | "fail" | "nodata";
  canary_mean?: number;
  baseline_mean?: number;
  direction: string;
}

export interface AnalysisResult {
  id: string;
  job_id: string;
  config_id: string;
  score: number;
  recommendation: Recommendation;
  metric_scores: MetricResult[];
  raw_data?: Record<string, unknown>;
  created_at: string;
}

export interface AnalysisSnapshot {
  id: string;
  job_id: string;
  snapshot_at: string;
  score?: number;
  metric_scores: MetricResult[];
  progress: number;
}

export interface Suite {
  id: string;
  config_id: string;
  run_count: number;
  interval_minutes: number;
  duration_per_run?: number;
  job_ids: string[];
  scheduled_ats: string[];
  created_at: string;
  jobs?: AnalysisJob[];
}

export interface JobEvent {
  job_id: string;
  event: "snapshot" | "job_status" | "analysis_error";
  data: {
    score?: number;
    recommendation?: Recommendation;
    metric_results?: MetricResult[];
    progress?: number;
    status?: JobStatus;
    error?: string;
  };
}
