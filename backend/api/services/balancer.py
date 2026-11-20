"""Recipe balancer: adjust ingredient weights to bring a mix into its targets.

At a fixed batch weight every judged metric is a weighted average of the
ingredients' per-100 g values, so it is linear in the weights. That makes
balancing a linear programme, solved exactly with HiGHS (scipy.optimize).

- Variables: the weights of the mix ingredients that aren't locked. Add-ins
  aren't part of the mix and are left alone. The batch may move by up to 15%
  (or be held fixed); each target is written as sum((a_i - b) * w_i) >= 0,
  which stays linear whatever the batch size.
- The solver aims a little inside each range (5% of its width), so rounding
  and the PAC target's drift don't leave results on the edge.
- Hard limits: each ingredient's typical-use range (% of mix), locked weights,
  and by default half to double each ingredient's starting weight, so the
  recipe keeps its character (an option lifts this).
- Soft limits: every target range from the profile and serving method, with a
  steep penalty per unit outside (scaled by the range's width), so an
  impossible brief still returns the nearest recipe, and the unmet targets
  are reported.
- Goal: change as little as possible, sit as centred as possible, fewest
  calories, or most protein. The other terms act as tie-breakers.

The PAC target depends a little on the mix's water and MSNF, so the solve is
repeated a few times with targets recomputed from the latest weights.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from scipy.optimize import linprog

from api.schemas import BalanceGoal
from api.services.calculator import calculate
from api.services.pac import ingredient_pac
from api.services.sweetness import ingredient_pod

if TYPE_CHECKING:
    from api.models import Ingredient, TargetProfile
    from api.schemas import CalculateResponse, MetricComparison

KCAL_PER_KJ = 1 / 4.184
VIOLATION_PENALTY = 1000.0
# Advisory targets (stabilizer, emulsifier) cost this fraction as much.
ADVISORY_PENALTY_FACTOR = 0.01
# Aim this share of each target range inside its edges.
TARGET_MARGIN = 0.05
# How far the batch may grow or shrink unless it's kept fixed.
BATCH_FLEX = 0.15
# Default movement range for each ingredient, relative to where it started.
MIN_FACTOR = 0.5
MAX_FACTOR = 2.0
PASSES = 4


def _f(v) -> float:
    return float(v) if v is not None else 0.0


# Per-100 g value of each balanced metric for an ingredient.
METRIC_VALUE: dict[str, Callable[[Ingredient], float]] = {
    "pac": ingredient_pac,
    "sweetness": ingredient_pod,
    # Database rows hold Decimals, so convert before arithmetic.
    "total_solids": lambda i: max(0.0, 100.0 - _f(i.water_pct) - _f(i.alcohol_pct)),
    "total_fat": lambda i: _f(i.total_fat_pct),
    "milk_fat": lambda i: _f(i.milk_fat_pct),
    "msnf": lambda i: _f(i.msnf_pct),
    "stabilizer": lambda i: _f(i.stabilizer_pct),
    "emulsifier": lambda i: _f(i.emulsifier_pct),
    "protein": lambda i: _f(i.protein_pct),
}


class BalanceError(ValueError):
    """The fixed limits alone (locks, typical-use ranges, batch size) conflict."""


@dataclass
class BalanceRow:
    ingredient: Ingredient
    weight_g: float
    locked: bool = False


@dataclass
class BalanceResult:
    weights: list[float]
    result: CalculateResponse
    unmet: list[MetricComparison]


def _width(c: MetricComparison) -> float:
    if c.target_min is not None and c.target_max is not None:
        return max(c.target_max - c.target_min, 1e-6)
    bound = c.target_min if c.target_min is not None else c.target_max
    return max(abs(bound or 0.0) * 0.25, 0.5)


def _aim(c: MetricComparison) -> tuple[float | None, float | None]:
    """The bounds the solver aims for: a little inside the target range, so
    rounding and the PAC target's drift don't leave a result on the edge."""
    margin = TARGET_MARGIN * _width(c)
    # A floor of zero (e.g. "emulsifier 0-0.4%") asks for nothing.
    lo = None if c.target_min is None or c.target_min <= 0 else c.target_min + margin
    hi = None if c.target_max is None else c.target_max - margin
    if lo is not None and hi is not None and lo > hi:
        return c.target_min, c.target_max
    return lo, hi


def _solve_once(
    rows: list[BalanceRow],
    weights: list[float],
    comparisons: list[MetricComparison],
    goal: BalanceGoal,
    start: list[float],
    allow_big_changes: bool,
    keep_total: bool,
) -> list[float]:
    total = sum(weights)
    free = [i for i, r in enumerate(rows) if not r.locked]
    locked = [i for i, r in enumerate(rows) if r.locked]
    n = len(free)
    if n == 0:
        return weights
    targets = [
        c
        for c in comparisons
        if c.metric in METRIC_VALUE
        and (c.target_min is not None or c.target_max is not None)
    ]
    k = len(targets)
    two_sided = [
        j
        for j, c in enumerate(targets)
        if c.target_min is not None and c.target_max is not None
    ]

    # Variable layout: x (n) | d (n, |x - x0|) | below (k) | above (k) | centre (len two_sided)
    nx, nd, nb, na = n, n, k, k
    nc = len(two_sided)
    size = nx + nd + nb + na + nc
    ix = lambda i: i  # noqa: E731
    idv = lambda i: nx + i  # noqa: E731
    ib = lambda j: nx + nd + j  # noqa: E731
    ia = lambda j: nx + nd + nb + j  # noqa: E731
    ic = lambda m: nx + nd + nb + na + m  # noqa: E731

    cost = [0.0] * size
    a_ub: list[list[float]] = []
    b_ub: list[float] = []

    def row() -> list[float]:
        return [0.0] * size

    # Change is always measured from the recipe as it started, so repeated
    # passes can't drift step by step.
    x0 = [start[i] for i in free]
    # Closeness: weight changes relative to each ingredient's own size, so a
    # gram of gum counts like a large share of cream.
    closeness = 1.0 if goal is BalanceGoal.closest else 0.01
    for p in range(n):
        scale = max(x0[p], 0.01 * total)
        cost[idv(p)] = closeness / scale
        for sign in (1.0, -1.0):
            r = row()
            r[ix(p)] = sign
            r[idv(p)] = -1.0
            a_ub.append(r)
            b_ub.append(sign * x0[p])

    # "metric >= b" is sum((a_i - b) x_i) >= 0, which holds whatever the batch
    # size; dividing by the starting total keeps the slack in metric units.
    def offsets(value, b: float) -> tuple[list[float], float]:
        coef = [(value(rows[i].ingredient) - b) / total for i in free]
        fixed = (
            sum((value(rows[i].ingredient) - b) * weights[i] for i in locked) / total
        )
        return coef, fixed

    for j, c in enumerate(targets):
        value = METRIC_VALUE[c.metric]
        aim_lo, aim_hi = _aim(c)
        # Skip limits no mix of these ingredients can meet (a floor above every
        # ingredient's value, or a ceiling below them all). They'd only distort
        # the answer, e.g. shrinking the batch to make an unfixable shortfall
        # look smaller; they're still reported as unmet.
        values = [value(r.ingredient) for r in rows]
        if aim_lo is not None and max(values) <= aim_lo:
            aim_lo = None
        if aim_hi is not None and min(values) >= aim_hi:
            aim_hi = None
        penalty = VIOLATION_PENALTY / _width(c)
        if c.advisory:
            # Nudged only when it's nearly free; never worth reshaping a recipe.
            penalty *= ADVISORY_PENALTY_FACTOR
        if aim_lo is not None:
            coef, fixed = offsets(value, aim_lo)
            r = row()
            for p in range(n):
                r[ix(p)] = -coef[p]
            r[ib(j)] = -1.0
            a_ub.append(r)
            b_ub.append(fixed)
            cost[ib(j)] = penalty
        if aim_hi is not None:
            coef, fixed = offsets(value, aim_hi)
            r = row()
            for p in range(n):
                r[ix(p)] = coef[p]
            r[ia(j)] = -1.0
            a_ub.append(r)
            b_ub.append(-fixed)
            cost[ia(j)] = penalty

    centring = 1.0 if goal is BalanceGoal.centred else 0.0
    for m, j in enumerate(two_sided):
        c = targets[j]
        centre = (c.target_min + c.target_max) / 2  # type: ignore[operator]
        coef, fixed = offsets(METRIC_VALUE[c.metric], centre)
        cost[ic(m)] = centring / _width(c)
        for sign in (1.0, -1.0):
            r = row()
            for p in range(n):
                r[ix(p)] = sign * coef[p]
            r[ic(m)] = -1.0
            a_ub.append(r)
            b_ub.append(-sign * fixed)

    if goal is BalanceGoal.min_kcal:
        for p, i in enumerate(free):
            kcal = _f(rows[i].ingredient.energy_kj_per_100g) * KCAL_PER_KJ
            cost[ix(p)] += kcal / total / 10.0
    elif goal is BalanceGoal.max_protein:
        for p, i in enumerate(free):
            cost[ix(p)] -= _f(rows[i].ingredient.protein_pct) / total

    # Batch size: fixed, or free to move a little (adding 10 g of allulose
    # shouldn't mean taking 10 g of something else out).
    locked_mass = sum(weights[i] for i in locked)
    sum_free = [1.0 if v < nx else 0.0 for v in range(size)]
    a_eq: list[list[float]] | None = None
    b_eq: list[float] | None = None
    if keep_total:
        a_eq, b_eq = [sum_free], [total - locked_mass]
    else:
        a_ub.append(sum_free)
        # Measured from the starting batch, so repeated passes can't compound.
        start_total = sum(start)
        b_ub.append(start_total * (1 + BATCH_FLEX) - locked_mass)
        a_ub.append([-v for v in sum_free])
        b_ub.append(-(start_total * (1 - BATCH_FLEX) - locked_mass))

    # Typical-use limits are a share of the whole batch, whatever its size:
    # w_i <= u * (sum of free weights + locked mass), which is linear. They stop
    # the balancer pushing an ingredient further out, but never force it back
    # past where the recipe already has it (that amount evidently works), so a
    # limit the recipe already breaks becomes "no further than now" instead.
    start_total = sum(start)
    bounds = []
    for p, i in enumerate(free):
        ing = rows[i].ingredient
        lo, hi = 0.0, None
        for pct, is_max in ((ing.usage_max_pct, True), (ing.usage_min_pct, False)):
            if pct is None or (not is_max and not pct):
                continue
            share = float(pct) / 100
            already_beyond = (
                start[i] > share * start_total + 1e-9
                if is_max
                else start[i] < share * start_total - 1e-9
            )
            if already_beyond:
                if is_max:
                    hi = start[i]
                else:
                    lo = start[i]
                continue
            r = row()
            for q in range(n):
                r[ix(q)] = -share if is_max else share
            r[ix(p)] += 1.0 if is_max else -1.0
            a_ub.append(r)
            b_ub.append(share * locked_mass if is_max else -share * locked_mass)
        # Unless big changes are allowed, keep each ingredient between half and
        # double where it started (the slider's range), so the recipe keeps its
        # character; an ingredient starting at zero is free to be added.
        if not allow_big_changes and start[i] > 0:
            lo = max(lo, start[i] * MIN_FACTOR)
            hi = start[i] * MAX_FACTOR if hi is None else min(hi, start[i] * MAX_FACTOR)
        bounds.append((lo, hi))
    bounds += [(0, None)] * (nd + nb + na + nc)

    res = linprog(
        cost, A_ub=a_ub, b_ub=b_ub, A_eq=a_eq, b_eq=b_eq, bounds=bounds, method="highs"
    )
    if res.status != 0:
        raise BalanceError(
            "The locked weights and typical-use limits leave no way to make up the "
            "batch. Unlock an ingredient or relax a limit."
        )

    out = list(weights)
    for p, i in enumerate(free):
        out[i] = max(0.0, float(res.x[ix(p)]))
    return out


def balance(
    rows: list[BalanceRow],
    profile: TargetProfile,
    serving_method_id: str | None = None,
    goal: BalanceGoal = BalanceGoal.closest,
    allow_big_changes: bool = False,
    keep_batch_size: bool = False,
) -> BalanceResult:
    """Balance the mix against the profile (and serving method).

    By default each unlocked ingredient moves only between half and double its
    starting weight; allow_big_changes lifts that (typical-use limits remain).
    The batch may grow or shrink by up to 15% unless keep_batch_size is set;
    per-100 g goals (fewest calories, most protein) always keep it.
    """
    keep_total = keep_batch_size or goal in (
        BalanceGoal.min_kcal,
        BalanceGoal.max_protein,
    )
    weights = [r.weight_g for r in rows]
    start = list(weights)

    def evaluate(ws: list[float]) -> CalculateResponse:
        items = [(r.ingredient, w) for r, w in zip(rows, ws, strict=True) if w > 0]
        return calculate(
            items, target_profile=profile, serving_method_id=serving_method_id
        )

    for _ in range(PASSES):
        comparisons = evaluate(weights).target_comparison or []
        weights = _solve_once(
            rows, weights, comparisons, goal, start, allow_big_changes, keep_total
        )

    weights = [round(w, 2) for w in weights]
    result = evaluate(weights)
    unmet = [
        c
        for c in result.target_comparison or []
        if c.status != "in_range"
        and not c.advisory
        and c.metric not in ("serving_temp", "frozen_pct")
    ]
    return BalanceResult(weights=weights, result=result, unmet=unmet)
