"""
HMM-based anomaly scorer
========================
Uses a Gaussian HMM trained on the baseline time-series to evaluate how
likely the canary time-series is under the learned baseline distribution.

Approach
--------
1. Train a Gaussian HMM on sliding windows of the baseline series.
2. Compute the log-likelihood of the canary series under this model.
3. Also compute the baseline's own self-likelihood for normalisation.
4. Return a 0–1 score:
     score = sigmoid( (canary_ll - baseline_ll) / scale )
   where score ≈ 1.0 means canary looks just like baseline.

References
----------
- Rabiner (1989) "A Tutorial on Hidden Markov Models"
- hmmlearn documentation: https://hmmlearn.readthedocs.io
"""

from __future__ import annotations

import warnings
from typing import Optional, Tuple

import numpy as np
from hmmlearn.hmm import GaussianHMM
from scipy.special import expit  # sigmoid


# ── Constants ──────────────────────────────────────────────────────────────

DEFAULT_N_COMPONENTS = 3   # hidden states
DEFAULT_N_ITER = 100
DEFAULT_COVARIANCE_TYPE = "diag"
MIN_SERIES_LEN = 10        # minimum points needed for reliable training


# ── Training ───────────────────────────────────────────────────────────────

def _prepare_sequences(
    ts: np.ndarray, window: int = 5, stride: int = 1
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Convert a 1-D time series into overlapping windows suitable for HMM.
    Returns (X, lengths) where X has shape (N * window, 1).
    """
    n = len(ts)
    windows = []
    for i in range(0, n - window + 1, stride):
        windows.append(ts[i : i + window])
    if not windows:
        windows = [ts]
    arr = np.array(windows)          # (N_windows, window)
    X = arr.reshape(-1, 1)           # flatten to (N_windows * window, 1)
    lengths = [window] * len(windows)
    return X, lengths


def train_baseline_hmm(
    baseline_ts: np.ndarray,
    n_components: int = DEFAULT_N_COMPONENTS,
    n_iter: int = DEFAULT_N_ITER,
    covariance_type: str = DEFAULT_COVARIANCE_TYPE,
    window: int = 5,
) -> Optional[GaussianHMM]:
    """
    Fit a Gaussian HMM on the baseline time series.
    Returns None if the series is too short.
    """
    ts = np.asarray(baseline_ts, dtype=float)
    if len(ts) < MIN_SERIES_LEN:
        return None

    # Z-normalise
    std = ts.std()
    if std < 1e-8:
        ts = np.zeros_like(ts)
    else:
        ts = (ts - ts.mean()) / std

    X, lengths = _prepare_sequences(ts, window=window)

    # Clamp n_components to be safe
    n_comp = min(n_components, len(lengths))
    if n_comp < 1:
        n_comp = 1

    model = GaussianHMM(
        n_components=n_comp,
        covariance_type=covariance_type,
        n_iter=n_iter,
        random_state=42,
        verbose=False,
    )
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            model.fit(X, lengths)
        except Exception:
            return None
    return model


# ── Scoring ────────────────────────────────────────────────────────────────

def _score_series(model: GaussianHMM, ts: np.ndarray, window: int = 5) -> float:
    """Return mean per-observation log-likelihood of ts under model."""
    ts = np.asarray(ts, dtype=float)
    if len(ts) == 0:
        return -np.inf

    std = ts.std()
    if std < 1e-8:
        ts_norm = np.zeros_like(ts)
    else:
        ts_norm = (ts - ts.mean()) / std

    X, lengths = _prepare_sequences(ts_norm, window=window)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            ll = model.score(X, lengths)
            return ll / len(X)           # per-observation LL
        except Exception:
            return -np.inf


def hmm_similarity_score(
    ts_canary: np.ndarray,
    ts_baseline: np.ndarray,
    n_components: int = DEFAULT_N_COMPONENTS,
) -> float:
    """
    Train an HMM on baseline, then score both canary and baseline.
    Returns a 0–1 similarity score.

    Score ≈ 1.0  → canary looks statistically identical to baseline
    Score ≈ 0.0  → canary is anomalous relative to baseline
    """
    ts_b = np.asarray(ts_baseline, dtype=float)
    ts_c = np.asarray(ts_canary, dtype=float)

    if len(ts_b) < MIN_SERIES_LEN or len(ts_c) < MIN_SERIES_LEN:
        return 0.5  # not enough data → inconclusive

    model = train_baseline_hmm(ts_b, n_components=n_components)
    if model is None:
        return 0.5

    window = min(5, len(ts_b) // 2, len(ts_c) // 2)
    window = max(window, 2)

    baseline_ll = _score_series(model, ts_b, window=window)
    canary_ll = _score_series(model, ts_c, window=window)

    if not np.isfinite(baseline_ll) or not np.isfinite(canary_ll):
        return 0.5

    # Log-likelihood ratio relative to baseline self-score
    # ll_ratio > 0  → canary as likely as baseline (or more)
    # ll_ratio < 0  → canary less likely (anomalous)
    ll_ratio = canary_ll - baseline_ll

    # Map to 0–1 via sigmoid: sigmoid(0) = 0.5, sigmoid(+∞) → 1
    # Scale factor controls sensitivity; 2.0 gives reasonable behaviour
    score = float(expit(ll_ratio * 2.0))
    return max(0.0, min(1.0, score))


# ── Combined score ─────────────────────────────────────────────────────────

def combined_metric_score(
    ts_canary: np.ndarray,
    ts_baseline: np.ndarray,
    sax_weight: float = 0.5,
    hmm_weight: float = 0.5,
    direction: str = "no_direction",
) -> Tuple[float, float, float]:
    """
    Combine SAX similarity and HMM likelihood scores.

    Returns
    -------
    (combined_0_to_100, sax_score_0_to_1, hmm_score_0_to_1)
    """
    from sax import sax_similarity_score

    sax_s = sax_similarity_score(ts_canary, ts_baseline)
    hmm_s = hmm_similarity_score(ts_canary, ts_baseline)

    # Directional adjustment: if direction is lower_is_better and canary mean
    # is actually lower than baseline, that is a good sign → boost score.
    if direction != "no_direction" and len(ts_canary) > 0 and len(ts_baseline) > 0:
        c_mean = np.mean(ts_canary)
        b_mean = np.mean(ts_baseline)
        ratio = c_mean / (b_mean + 1e-10)
        if direction == "lower_is_better":
            directional_bonus = max(0.0, min(0.2, (1.0 - ratio) * 0.5))
        else:  # higher_is_better
            directional_bonus = max(0.0, min(0.2, (ratio - 1.0) * 0.5))
        sax_s = min(1.0, sax_s + directional_bonus)
        hmm_s = min(1.0, hmm_s + directional_bonus)

    w_total = sax_weight + hmm_weight
    combined_01 = (sax_s * sax_weight + hmm_s * hmm_weight) / w_total
    return round(combined_01 * 100, 2), round(sax_s, 4), round(hmm_s, 4)
