"""Rating types and the ordinal verdict fit behind DirtyRank's ratings."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

# 400 / ln 10, rounded as the browser's scores use it: a 400-point gap means 10:1 odds.
RATING_SCALE = 173.7178
# Convergence on the log-odds scale, about 0.002 rating points.
FIT_TOLERANCE = 1e-5
MAX_SWEEPS = 5000
# One coordinate step never moves a value by more than 2 log-odds (about 350 points).
MAX_STEP = 2.0
# A verdict runs from -3 (the right performer is much better) to +3 (the left one is).
VERDICT_LIMIT = 3
# How firmly a pool's thresholds stay near the defaults until its verdicts say otherwise.
THRESHOLD_PRIOR_DEVIATION = 1.0
# The thresholds stay ordered by at least this much.
MINIMUM_THRESHOLD_GAP = 0.05


class PluginError(RuntimeError):
    """An error that should be displayed cleanly in Stash."""


@dataclass(frozen=True)
class Rating:
    rating: float
    deviation: float
    matches: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    last_rated_at: str | None = None


@dataclass(frozen=True)
class Verdict:
    left_id: str
    right_id: str
    # Positive favours the left performer: 1 slightly, 2 better, 3 much better; 0 is equal.
    score: int
    updated_at: str | None = None


@dataclass(frozen=True)
class Fit:
    ratings: dict[str, Rating]
    # Where "slightly", "better" and "much better" begin on the log-odds scale.
    thresholds: tuple[float, float, float]


def sigmoid(value: float) -> float:
    if value >= 0:
        return 1.0 / (1.0 + math.exp(-value))
    exponential = math.exp(value)
    return exponential / (1.0 + exponential)


def verdict_bounds(size: int, thresholds: Sequence[float]) -> tuple[float, float]:
    """The latent interval of a verdict of this size (0 to 3) for the favoured performer."""
    slightly, better, much = thresholds
    return ((-slightly, slightly), (slightly, better), (better, much), (much, math.inf))[size]


def verdict_probability(difference: float, score: int, thresholds: Sequence[float]) -> float:
    """Chance of this verdict when the left performer leads by `difference` log-odds.

    The verdict is where a logistic perception of the difference falls between the
    thresholds, which mirror around equal: an ordinal (cumulative logit) Bradley-Terry model.
    """
    if score < 0:
        difference, score = -difference, -score
    low, high = verdict_bounds(score, thresholds)
    return sigmoid(difference - low) - (0.0 if math.isinf(high) else sigmoid(difference - high))


def _difference_terms(difference: float, size: int, thresholds: Sequence[float]) -> tuple[float, float]:
    """Gradient and curvature of the verdict's log-likelihood in the favoured performer's lead."""
    low, high = verdict_bounds(size, thresholds)
    lower = sigmoid(difference - low)
    upper = 0.0 if math.isinf(high) else sigmoid(difference - high)
    return 1.0 - lower - upper, lower * (1.0 - lower) + upper * (1.0 - upper)


def _threshold_terms(difference: float, size: int, thresholds: Sequence[float]) -> list[tuple[int, float, float]]:
    """(threshold index, gradient, curvature) of the verdict's log-likelihood in each threshold it uses."""
    low, high = verdict_bounds(size, thresholds)
    lower = sigmoid(difference - low)
    upper = 0.0 if math.isinf(high) else sigmoid(difference - high)
    probability = max(lower - upper, 1e-300)
    lower_density, upper_density = lower * (1.0 - lower), upper * (1.0 - upper)
    by_low = -lower_density / probability
    by_high = upper_density / probability
    by_low_low = (lower_density * (1.0 - 2.0 * lower) * probability - lower_density**2) / probability**2
    by_high_high = (-upper_density * (1.0 - 2.0 * upper) * probability - upper_density**2) / probability**2
    by_low_high = lower_density * upper_density / probability**2
    if size == 0:
        # Equal spans -slightly to +slightly.
        return [(0, by_high - by_low, by_low_low + by_high_high - 2.0 * by_low_high)]
    terms = [(size - 1, by_low, by_low_low)]
    if size < VERDICT_LIMIT:
        terms.append((size, by_high, by_high_high))
    return terms


def fit_ratings(
    verdicts: Iterable[Verdict],
    settings: Mapping[str, Any],
    default_thresholds: Sequence[float],
) -> Fit:
    """Fit every performer of one pool, and the pool's thresholds, to all of its verdicts at once.

    Each performer starts from a normal prior at the initial rating and deviation. Each
    verdict counts `evidenceWeight` times. The result is the most likely rating given
    every verdict, with its deviation from the curvature at that point. The thresholds
    learn how this pool's verdicts use "slightly", "better" and "much better". The fit
    always starts from the priors, so the same verdicts always give the same ratings.
    """
    initial_rating = float(settings["initialRating"])
    initial_deviation = float(settings["initialDeviation"])
    floor = float(settings["deviationFloor"])
    weight = float(settings["evidenceWeight"])
    prior_precision = (RATING_SCALE / initial_deviation) ** 2
    threshold_precision = 1.0 / THRESHOLD_PRIOR_DEVIATION**2
    defaults = [float(value) for value in default_thresholds]

    # Each verdict from the favoured performer's side: (favoured, other, size).
    oriented: list[tuple[str, str, int]] = []
    games: dict[str, list[tuple[str, int, float]]] = {}
    counts: dict[str, list[int]] = {}
    latest: dict[str, str] = {}
    for verdict in verdicts:
        score = max(-VERDICT_LIMIT, min(VERDICT_LIMIT, int(verdict.score)))
        favoured, other = (verdict.left_id, verdict.right_id) if score >= 0 else (verdict.right_id, verdict.left_id)
        size = abs(score)
        oriented.append((favoured, other, size))
        games.setdefault(favoured, []).append((other, size, 1.0))
        games.setdefault(other, []).append((favoured, size, -1.0))
        for performer, direction in ((verdict.left_id, score), (verdict.right_id, -score)):
            tally = counts.setdefault(performer, [0, 0, 0, 0])
            tally[0] += 1
            tally[1 if direction > 0 else 2 if direction < 0 else 3] += 1
            if verdict.updated_at and verdict.updated_at > latest.get(performer, ""):
                latest[performer] = verdict.updated_at

    theta = {performer: 0.0 for performer in games}
    thresholds = list(defaults)

    def performer_terms(performer: str) -> tuple[float, float]:
        gradient = -theta[performer] * prior_precision
        curvature = prior_precision
        for opponent, size, side in games[performer]:
            # The favoured performer's lead; side turns it into this performer's gradient.
            lead = (theta[performer] - theta[opponent]) * side
            slope, bend = _difference_terms(lead, size, thresholds)
            gradient += weight * slope * side
            curvature += weight * bend
        return curvature, gradient

    # Coordinate Newton steps on a concave posterior: ratings, then thresholds.
    for _sweep in range(MAX_SWEEPS):
        largest = 0.0
        for performer in games:
            curvature, gradient = performer_terms(performer)
            step = max(-MAX_STEP, min(MAX_STEP, gradient / curvature))
            theta[performer] += step
            largest = max(largest, abs(step))
        if oriented:
            for index in range(len(thresholds)):
                gradient = (defaults[index] - thresholds[index]) * threshold_precision
                curvature = -threshold_precision
                for favoured, other, size in oriented:
                    for term_index, slope, bend in _threshold_terms(theta[favoured] - theta[other], size, thresholds):
                        if term_index == index:
                            gradient += weight * slope
                            curvature += weight * bend
                step = max(-MAX_STEP, min(MAX_STEP, -gradient / min(curvature, -threshold_precision)))
                lowest = (thresholds[index - 1] if index else 0.0) + MINIMUM_THRESHOLD_GAP
                highest = thresholds[index + 1] - MINIMUM_THRESHOLD_GAP if index + 1 < len(thresholds) else math.inf
                moved = max(lowest, min(highest, thresholds[index] + step)) - thresholds[index]
                thresholds[index] += moved
                largest = max(largest, abs(moved))
        if largest < FIT_TOLERANCE:
            break

    ratings: dict[str, Rating] = {}
    for performer in games:
        curvature, _gradient = performer_terms(performer)
        tally = counts[performer]
        ratings[performer] = Rating(
            rating=initial_rating + RATING_SCALE * theta[performer],
            deviation=min(initial_deviation, max(floor, RATING_SCALE / math.sqrt(curvature))),
            matches=tally[0],
            wins=tally[1],
            losses=tally[2],
            draws=tally[3],
            last_rated_at=latest.get(performer),
        )
    return Fit(ratings, (thresholds[0], thresholds[1], thresholds[2]))
