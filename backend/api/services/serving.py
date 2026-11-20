"""Serving methods: how a recipe is eaten, which sets its freezing target.

Each method is an eating temperature plus how much of the water should be
frozen then. Scoopable is about 75% frozen; a popsicle firmer; a Creami spin
or soft serve much softer. PAC and the 75%-frozen temperature targets are
derived from this for each recipe's own water and MSNF.

Creami figures: a -18 C pint warms about 8-10 C on an ice cream or gelato
spin and about 11 C on a lite spin, and each re-spin adds 3-4 C (Dream
Scoops' measurements). Creami targets are calibrated on recipes that came out
well straight off the spin, about 55-65% frozen (recalibrated after milk
salts were counted once, by sodium, which reads protein recipes ~3 points firmer).
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
        "Creami · ice cream / gelato spin (-9 °C)",
        "Eat right away",
        "A -18 °C pint warms to about -9 °C on an ice cream or gelato spin and is "
        "eaten soft: 53-67% frozen.",
        ServingTarget(-9.0, 53.0, 67.0),
    ),
    ServingMethod(
        "creami_lite",
        "Creami · lite spin (-7 °C)",
        "Eat right away",
        "A -18 °C pint warms to about -7 °C on a lite spin and is eaten soft: "
        "53-67% frozen. Suits lean, low-solids bases that would be rock-hard at "
        "-18 °C.",
        ServingTarget(-7.0, 53.0, 67.0),
    ),
    ServingMethod(
        "churn",
        "Fresh from the churn (-7 °C)",
        "Eat right away",
        "Straight out of a batch freezer at about -7 °C: 50-65% frozen.",
        ServingTarget(-7.0, 50.0, 65.0),
    ),
    ServingMethod(
        "soft_serve",
        "Soft serve (-7 °C)",
        "Eat right away",
        "Drawn from a soft-serve machine at about -7 °C (makers specify "
        "17-20 °F, -8 to -6.5 °C), much softer than scooped: 45-60% frozen.",
        ServingTarget(-7.0, 45.0, 60.0),
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

# Custom serving: "custom:<eating temp °C>:<texture>", e.g. "custom:-12:scoop".
# The textures are the frozen-% windows the presets use.
CUSTOM_PREFIX = "custom:"
CUSTOM_TEXTURES: dict[str, tuple[str, float, float]] = {
    "soft": ("soft, as off a spin or churn", 53.0, 67.0),
    "scoop": ("scoopable", 70.0, 78.0),
    "firm": ("firm, as a popsicle", 83.0, 90.0),
}
CUSTOM_TEMP_RANGE = (-40.0, 0.0)


def custom_serving_id(eating_temp_c: float, texture: str) -> str:
    return f"{CUSTOM_PREFIX}{eating_temp_c:g}:{texture}"


def _custom_method(method_id: str) -> ServingMethod | None:
    try:
        temp_text, texture = method_id.removeprefix(CUSTOM_PREFIX).split(":")
        temp = float(temp_text)
    except ValueError:
        return None
    if texture not in CUSTOM_TEXTURES or not (
        CUSTOM_TEMP_RANGE[0] <= temp <= CUSTOM_TEMP_RANGE[1]
    ):
        return None
    label, lo, hi = CUSTOM_TEXTURES[texture]
    return ServingMethod(
        custom_serving_id(temp, texture),
        f"Custom · {temp:g} °C, {label.split(',')[0]}",
        "Custom",
        f"Eaten at {temp:g} °C, {label}: {lo:g}-{hi:g}% frozen.",
        ServingTarget(temp, lo, hi),
    )


def serving_method(method_id: str | None) -> ServingMethod | None:
    """Look up a serving method by id; None for unknown or missing ids."""
    if not method_id:
        return None
    if method_id.startswith(CUSTOM_PREFIX):
        return _custom_method(method_id)
    return _BY_ID.get(_LEGACY.get(method_id, method_id))
