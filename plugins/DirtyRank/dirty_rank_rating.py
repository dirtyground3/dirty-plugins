"""Rating types and Glicko-2 period calculations for DirtyRank."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterable

GLICKO_SCALE = 173.7178
GLICKO_ORIGIN = 1500.0

class PluginError(RuntimeError):
    """An error that should be displayed cleanly in Stash."""


@dataclass(frozen=True)
class Rating:
    rating: float
    deviation: float
    volatility: float
    matches: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    last_rated_at: str | None = None


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def _expected(mu: float, opponent_mu: float, opponent_phi: float) -> float:
    exponent = -_g(opponent_phi) * (mu - opponent_mu)
    exponent = min(max(exponent, -700.0), 700.0)
    return 1.0 / (1.0 + math.exp(exponent))


def glicko2_update(
    rating: Rating,
    results: Iterable[tuple[Rating, float]],
    settings: dict[str, Any],
) -> Rating:
    """Apply one evidence-weighted Glicko-2 rating period."""

    result_list = list(results)
    if not result_list:
        return rating

    mu = (rating.rating - GLICKO_ORIGIN) / GLICKO_SCALE
    phi = rating.deviation / GLICKO_SCALE
    converted = []
    for opponent, score in result_list:
        opponent_mu = (opponent.rating - GLICKO_ORIGIN) / GLICKO_SCALE
        opponent_phi = opponent.deviation / GLICKO_SCALE
        expected = _expected(mu, opponent_mu, opponent_phi)
        converted.append((opponent_mu, opponent_phi, float(score), expected))

    evidence_weight = settings["evidenceWeight"]
    variance_inverse = evidence_weight * sum(
        _g(opponent_phi) ** 2 * expected * (1.0 - expected)
        for _opponent_mu, opponent_phi, _score, expected in converted
    )
    if variance_inverse <= 0 or not math.isfinite(variance_inverse):
        raise PluginError("Glicko-2 could not calculate a finite variance")
    variance = 1.0 / variance_inverse
    delta = variance * evidence_weight * sum(
        _g(opponent_phi) * (score - expected)
        for _opponent_mu, opponent_phi, score, expected in converted
    )

    sigma = rating.volatility
    tau = settings["tau"]
    alpha = math.log(sigma * sigma)

    def objective(value: float) -> float:
        exp_value = math.exp(value)
        numerator = exp_value * (delta * delta - phi * phi - variance - exp_value)
        denominator = 2.0 * (phi * phi + variance + exp_value) ** 2
        return numerator / denominator - (value - alpha) / (tau * tau)

    a_value = alpha
    if delta * delta > phi * phi + variance:
        b_value = math.log(delta * delta - phi * phi - variance)
    else:
        k_value = 1
        b_value = alpha - k_value * tau
        while objective(b_value) < 0:
            k_value += 1
            if k_value > 1000:
                raise PluginError("Glicko-2 volatility iteration did not converge")
            b_value = alpha - k_value * tau

    f_a = objective(a_value)
    f_b = objective(b_value)
    while abs(b_value - a_value) > 1e-6:
        denominator = f_b - f_a
        if denominator == 0:
            break
        c_value = a_value + (a_value - b_value) * f_a / denominator
        f_c = objective(c_value)
        if f_c * f_b <= 0:
            a_value = b_value
            f_a = f_b
        else:
            f_a /= 2.0
        b_value = c_value
        f_b = f_c

    new_volatility = math.exp(a_value / 2.0)
    pre_deviation = math.sqrt(phi * phi + new_volatility * new_volatility)
    new_phi = 1.0 / math.sqrt(1.0 / (pre_deviation * pre_deviation) + 1.0 / variance)
    new_mu = mu + new_phi * new_phi * evidence_weight * sum(
        _g(opponent_phi) * (score - expected)
        for _opponent_mu, opponent_phi, score, expected in converted
    )
    new_deviation = min(
        settings["initialDeviation"],
        max(settings["deviationFloor"], new_phi * GLICKO_SCALE),
    )
    return Rating(
        rating=GLICKO_ORIGIN + GLICKO_SCALE * new_mu,
        deviation=new_deviation,
        volatility=new_volatility,
        matches=rating.matches,
        wins=rating.wins,
        losses=rating.losses,
        draws=rating.draws,
        last_rated_at=rating.last_rated_at,
    )
