"""
SAX – Symbolic Aggregate approXimation
=======================================
Converts a numeric time series into a symbolic string representation using:

  1. Z-score normalisation
  2. PAA (Piecewise Aggregate Approximation)
  3. Gaussian breakpoints → alphabet mapping

Reference: Lin et al. (2003) "A Symbolic Representation of Time Series,
           with Implications for Streaming Algorithms"
"""

from __future__ import annotations

import math
import warnings
from typing import List, Tuple

import numpy as np
from scipy.stats import norm


# ── Breakpoint table (pre-computed Gaussian quantiles) ─────────────────────
# breakpoints[a] gives the a-1 cut-points that divide N(0,1) into a equal-
# probability regions.  We support alphabet sizes 2–20.

def _breakpoints(alphabet_size: int) -> np.ndarray:
    """Return the (alphabet_size - 1) Gaussian quantile breakpoints."""
    probs = np.arange(1, alphabet_size) / alphabet_size
    return norm.ppf(probs)


def _dist_matrix(alphabet_size: int) -> np.ndarray:
    """
    Build the (alphabet_size × alphabet_size) lookup table for the MINDIST
    distance between any two SAX symbols.
    """
    bp = _breakpoints(alphabet_size)
    a = alphabet_size
    dist = np.zeros((a, a))
    for r in range(a):
        for c in range(a):
            if abs(r - c) <= 1:
                dist[r, c] = 0.0
            else:
                lo, hi = min(r, c), max(r, c)
                dist[r, c] = bp[hi - 1] - bp[lo]
    return dist


# Cache at module level (alphabet sizes rarely change per run)
_DIST_CACHE: dict[int, np.ndarray] = {}


def dist_matrix(alphabet_size: int) -> np.ndarray:
    if alphabet_size not in _DIST_CACHE:
        _DIST_CACHE[alphabet_size] = _dist_matrix(alphabet_size)
    return _DIST_CACHE[alphabet_size]


# ── Core SAX functions ─────────────────────────────────────────────────────

def znorm(ts: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    """Z-score normalise a time series. Returns zeros if std ≈ 0."""
    std = ts.std()
    if std < eps:
        return np.zeros_like(ts, dtype=float)
    return (ts - ts.mean()) / std


def paa(ts: np.ndarray, word_size: int) -> np.ndarray:
    """
    Piecewise Aggregate Approximation.
    Divides the time series into `word_size` equal-length segments and
    returns the mean of each segment.
    """
    n = len(ts)
    if word_size >= n:
        return ts.astype(float)
    # Use reshape + mean over last axis for speed
    # If n is not divisible by word_size we use a weighted approach
    segment_len = n / word_size
    result = np.zeros(word_size)
    for i in range(word_size):
        start = i * segment_len
        end = start + segment_len
        lo, hi = int(math.floor(start)), int(math.ceil(end))
        lo = min(lo, n - 1)
        hi = min(hi, n)
        result[i] = ts[lo:hi].mean()
    return result


def to_symbols(paa_ts: np.ndarray, alphabet_size: int) -> np.ndarray:
    """Map PAA coefficients to integer symbol indices (0 … alphabet_size-1)."""
    bp = _breakpoints(alphabet_size)
    return np.searchsorted(bp, paa_ts, side="right")


def sax_transform(
    ts: np.ndarray,
    word_size: int = 10,
    alphabet_size: int = 4,
    normalise: bool = True,
) -> np.ndarray:
    """
    Full SAX pipeline: normalise → PAA → symbol indices.

    Returns an integer array of shape (word_size,).
    """
    if len(ts) == 0:
        return np.zeros(word_size, dtype=int)
    arr = np.asarray(ts, dtype=float)
    if normalise:
        arr = znorm(arr)
    reduced = paa(arr, word_size)
    return to_symbols(reduced, alphabet_size)


def mindist(
    s1: np.ndarray,
    s2: np.ndarray,
    alphabet_size: int,
    n: int,
    word_size: int,
) -> float:
    """
    MINDIST lower-bound distance between two SAX word arrays.

    Parameters
    ----------
    s1, s2      : integer symbol arrays of length word_size
    alphabet_size : size of the symbol alphabet
    n           : length of the original time series
    word_size   : SAX word length
    """
    dm = dist_matrix(alphabet_size)
    inner = np.sqrt(np.sum(dm[s1, s2] ** 2))
    return math.sqrt(n / word_size) * inner


def sax_similarity_score(
    ts_canary: np.ndarray,
    ts_baseline: np.ndarray,
    word_size: int = 10,
    alphabet_size: int = 4,
) -> float:
    """
    Compute a 0–1 similarity score between canary and baseline time series
    using MINDIST.

    Score = 1.0  → identical SAX representations (distance = 0)
    Score = 0.0  → maximally different
    """
    if len(ts_canary) == 0 or len(ts_baseline) == 0:
        return 0.5  # inconclusive

    n = max(len(ts_canary), len(ts_baseline))

    # Pad shorter series to equal length
    if len(ts_canary) < n:
        ts_canary = np.pad(ts_canary, (0, n - len(ts_canary)), mode="edge")
    if len(ts_baseline) < n:
        ts_baseline = np.pad(ts_baseline, (0, n - len(ts_baseline)), mode="edge")

    # Adapt word_size to series length
    w = min(word_size, n)
    a = alphabet_size

    s1 = sax_transform(ts_canary, w, a)
    s2 = sax_transform(ts_baseline, w, a)

    dist = mindist(s1, s2, a, n, w)

    # Normalise distance → similarity
    # Max possible distance for alphabet_size a over series of length n:
    max_bp_dist = dist_matrix(a).max()
    max_dist = math.sqrt(n) * max_bp_dist + 1e-10
    similarity = max(0.0, 1.0 - dist / max_dist)
    return similarity
