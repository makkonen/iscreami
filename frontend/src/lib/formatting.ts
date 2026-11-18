/** Format a nullable number as a fixed-decimal string, returning "—" for null/undefined. */
export function fmt(value: number | null | undefined, decimals = 1): string {
    if (value === null || value === undefined) return "—";
    return value.toFixed(decimals);
}

export const KJ_PER_KCAL = 4.184;

/** Energy in both units, e.g. "211 kcal · 882 kJ"; "—" for null. */
export function fmtEnergy(kj: number | null | undefined): string {
    if (kj === null || kj === undefined) return "—";
    return `${Math.round(kj / KJ_PER_KCAL)} kcal · ${Math.round(kj)} kJ`;
}

export function cToF(c: number): number {
    return c * 9 / 5 + 32;
}

/** A temperature in both scales, e.g. "−13.0°C / 8.6°F". */
export function fmtTemp(c: number): string {
    return `${c.toFixed(1)}°C / ${cToF(c).toFixed(1)}°F`;
}
