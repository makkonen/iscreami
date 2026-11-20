"""PAC (Potere AntiCongelante) calculator.

PAC measures the freezing point depression power of solutes relative to sucrose.
Factor = molecular_weight_of_sucrose / molecular_weight_of_solute × 100.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from api.models import sugar_contributions_per_100g

if TYPE_CHECKING:
    from api.models import Ingredient

# PAC factors (sucrose MW 342.3 / solute MW × 100)
PAC_FACTORS: dict[str, float] = {
    "sucrose": 100.0,
    "glucose": 190.0,
    "fructose": 190.0,
    "lactose": 100.0,
    "maltose": 100.0,
    "galactose": 190.0,
}

# Salt: NaCl MW 58.44 → factor 585
NACL_PAC_FACTOR = 585.0
# Sodium → NaCl conversion factor (NaCl MW / Na AW ≈ 58.44/22.99)
SODIUM_TO_NACL = 2.58
# mg → g conversion
MG_TO_G = 0.001

# Milk's own minerals depress the freezing point through the MSNF term in the
# freezing model, at the mineral share of ordinary milk solids. Milk carries
# about 4.6 mg sodium per g MSNF (whole milk: ~40 mg per 8.7 g), and sodium
# tracks the other milk salts closely enough to measure that share by:
# - sodium beyond 4.6 mg per g MSNF is added salt (cottage cheese, salted
#   butter) and counts here, as NaCl;
# - MSNF with less sodium than that (whey protein isolate, ~1.8 mg/g) has
#   fewer milk salts, so only part of it counts toward the freezing model.
MILK_SODIUM_MG_PER_G_MSNF = 4.6


def salt_sodium_mg(ingredient: Ingredient) -> float:
    """Sodium per 100 g beyond what the ingredient's milk solids carry."""
    sodium = float(ingredient.sodium_mg or 0)
    msnf = float(ingredient.msnf_pct or 0)
    return max(0.0, sodium - MILK_SODIUM_MG_PER_G_MSNF * msnf)


def msnf_for_freezing(ingredient: Ingredient) -> float:
    """MSNF per 100 g, scaled to the milk salts it actually carries.

    Ordinary milk solids count in full. Low-mineral milk solids (protein
    isolates) count in proportion to their sodium. With no sodium figure,
    or none at all, they're assumed to be ordinary.
    """
    msnf = float(ingredient.msnf_pct or 0)
    sodium = float(ingredient.sodium_mg or 0)
    if msnf <= 0 or sodium <= 0:
        return msnf
    return min(msnf, sodium / MILK_SODIUM_MG_PER_G_MSNF)


# Ethanol MW 46.07 → factor 743
ETHANOL_PAC_FACTOR = 743.0


# Chocolate eats firmer than its sugars predict: cocoa butter is solid at
# freezer temperatures and cocoa solids take up water. Gelato practice
# (Corvitto) counts each gram of cocoa butter as -0.9 g of sucrose's
# anti-freeze effect and each gram of non-fat cocoa solids as -1.8 g. At full
# strength that read both chocolate recipes here as clearly too firm
# (including one the Creami targets were calibrated on), so it's applied at
# half strength until real batches say otherwise.
COCOA_STRENGTH = 0.5
COCOA_BUTTER_PAC = -0.9 * 100.0 * COCOA_STRENGTH
COCOA_SOLIDS_PAC = -1.8 * 100.0 * COCOA_STRENGTH


def cocoa_pac(ingredient: Ingredient) -> float:
    """The (negative) hardening effect of an ingredient's cocoa, per 100 g."""
    butter = float(getattr(ingredient, "cocoa_butter_pct", None) or 0)
    solids = float(getattr(ingredient, "cocoa_solids_pct", None) or 0)
    return (butter * COCOA_BUTTER_PAC + solids * COCOA_SOLIDS_PAC) / 100.0


def ingredient_pac(ingredient: Ingredient) -> float:
    """Calculate PAC per 100 g of ingredient.

    If the ingredient has a manual override, use that.
    If sugar breakdown fields are present, use advanced mode.
    Otherwise fall back to total_sugar_pct treated as sucrose.
    Cocoa's hardening applies on top either way (overrides come from sugar
    tables, which leave it out).
    """
    if ingredient.pac_override is not None:
        return float(ingredient.pac_override) + cocoa_pac(ingredient)

    pac = cocoa_pac(ingredient)

    # Sugar contribution (per-sugar breakdown if present, else total_sugar as
    # sucrose) — shared with sweetness.py so the fallback can't drift between
    # the PAC and POD paths.
    for sugar_name, pct in sugar_contributions_per_100g(ingredient):
        pac += pct * PAC_FACTORS[sugar_name] / 100.0

    # Added salt (sodium beyond milk solids' own), converted to NaCl
    salt_sodium = salt_sodium_mg(ingredient)
    if salt_sodium > 0:
        sodium_g_per_100g = salt_sodium * MG_TO_G
        # sodium_g × NaCl/Na ratio × NaCl PAC factor / 100
        pac += sodium_g_per_100g * SODIUM_TO_NACL * NACL_PAC_FACTOR / 100.0

    # Alcohol contribution
    if ingredient.alcohol_pct is not None and ingredient.alcohol_pct > 0:
        pac += float(ingredient.alcohol_pct) * ETHANOL_PAC_FACTOR / 100.0

    return pac


def recipe_pac(
    items: list[tuple[Ingredient, float]],
) -> tuple[float, float | None]:
    """Calculate recipe-level PAC in both conventions.

    Args:
        items: List of (ingredient, weight_grams) pairs.

    Returns:
        (pac_mix, pac_water):
            pac_mix  — PAC per 100 g of total mix
            pac_water — PAC per 100 g of free water (None if no free water)
    """
    total_weight = sum(w for _, w in items)
    if total_weight == 0:
        return 0.0, None

    # Sum of absolute PAC contributions (grams of sucrose-equivalent FPD)
    pac_sum = 0.0
    free_water_g = 0.0

    for ingredient, weight_g in items:
        pac_per_100 = ingredient_pac(ingredient)
        pac_sum += weight_g * pac_per_100 / 100.0

        water_pct = float(ingredient.water_pct) if ingredient.water_pct else 0.0
        free_water_g += weight_g * water_pct / 100.0

    pac_mix = pac_sum / total_weight * 100.0
    pac_water = pac_sum / free_water_g * 100.0 if free_water_g > 0 else None

    return pac_mix, pac_water
