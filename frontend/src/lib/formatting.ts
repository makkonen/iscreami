/** Format a nullable number as a fixed-decimal string, returning "—" for null/undefined. */
export function fmt(value: number | null | undefined, decimals = 1): string {
    if (value === null || value === undefined) return "—";
    return value.toFixed(decimals);
}

/** Format a nullable kJ/100g energy value as a string with unit, returning "—" for null. */
export function fmtKj(value: number | null | undefined): string {
    if (value === null || value === undefined) return "—";
    return `${Math.round(value)} kJ`;
}

export function cToF(c: number): number {
    return c * 9 / 5 + 32;
}

/** A temperature in both scales, e.g. "−13.0°C / 8.6°F". */
export function fmtTemp(c: number): string {
    return `${c.toFixed(1)}°C / ${cToF(c).toFixed(1)}°F`;
}
