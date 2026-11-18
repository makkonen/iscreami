"""Serving methods: how a recipe is eaten, which sets its freezing target.

Each method is an eating temperature plus how much of the water should be
frozen then. Scoopable is about 75% frozen; a popsicle firmer; a Creami spin
or soft serve much softer. PAC and the 75%-frozen temperature targets are
derived from this for each recipe's own water and MSNF.

Creami figures: a -18 C pint warms about 8-10 C on an ice cream or gelato
spin and about 11 C on a lite spin, and each re-spin adds 3-4 C (Dream
Scoops' measurements). Creami targets are calibrated on recipes that came out
well straight off the spin, about 52-62% frozen.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ServingTarget:
    """Eaten at eating_temp_c with frozen_pct_min-max % of the water frozen."""

    eating_temp_c: float
    frozen_pct_min: float
    frozen_pct_max: float


@dataclass(frozen=True)
class ServingMethod:
    id: str
    label: str
    group: str
    description: str
    target: ServingTarget


SERVING_METHODS: tuple[ServingMethod, ...] = (
    ServingMethod(
        "creami_ice_cream",
        "Creami · ice cream / gelato spin",
        "Eat right away",
        "A -18 °C pint warms to about -9 °C on an ice cream or gelato spin and is "
        "eaten soft: 50-64% frozen.",
        ServingTarget(-9.0, 50.0, 64.0),
    ),
    ServingMethod(
        "creami_lite",
        "Creami · lite spin",
        "Eat right away",
        "A -18 °C pint warms to about -7 °C on a lite spin and is eaten soft: "
        "50-64% frozen. Suits lean, low-solids bases that would be rock-hard at "
        "-18 °C.",
        ServingTarget(-7.0, 50.0, 64.0),
    ),
    ServingMethod(
        "churn",
        "Fresh from the churn",
        "Eat right away",
        "Straight out of a batch freezer at about -7 °C: 50-65% frozen.",
        ServingTarget(-7.0, 50.0, 65.0),
    ),
    ServingMethod(
        "soft_serve",
        "Soft serve",
        "Eat right away",
        "Drawn at about -6 °C, much softer than scooped: 45-60% frozen.",
        ServingTarget(-6.0, 45.0, 60.0),
    ),
    ServingMethod(
        "gelato_case",
        "Gelato case (-12 °C)",
        "Scooped",
        "Scooped from a display case at about -12 °C: 70-78% frozen, the "
        "scoopable range.",
        ServingTarget(-12.0, 70.0, 78.0),
    ),
    ServingMethod(
        "tempered",
        "Tempered (-14 °C)",
        "Scooped",
        "Hardened at -18 °C, then left to soften to about -14 °C before "
        "scooping: 70-78% frozen.",
        ServingTarget(-14.0, 70.0, 78.0),
    ),
    ServingMethod(
        "freezer",
        "Straight from -18 °C freezer",
        "Scooped",
        "Scooped straight from a home freezer: 70-78% frozen at -18 °C. Needs "
        "the most PAC.",
        ServingTarget(-18.0, 70.0, 78.0),
    ),
    ServingMethod(
        "popsicle",
        "Popsicle from -18 °C freezer",
        "Frozen hard",
        "Eaten straight from the freezer, firmer than scoopable so it holds on "
        "the stick: 83-90% frozen at -18 °C.",
        ServingTarget(-18.0, 83.0, 90.0),
    ),
)

_BY_ID = {m.id: m for m in SERVING_METHODS}
# Ids used by earlier versions.
_LEGACY = {"eat_now": "creami_ice_cream", "scoop_later": "freezer"}


def serving_method(method_id: str | None) -> ServingMethod | None:
    """Look up a serving method by id; None for unknown or missing ids."""
    if not method_id:
        return None
    return _BY_ID.get(_LEGACY.get(method_id, method_id))
