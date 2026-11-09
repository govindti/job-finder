// Score rounding uses banker's rounding (round-half-to-even), unlike JS's
// Math.round() which rounds half *up*. Keeping half-to-even here makes the
// scoring output stable and predictable.
export function pyRound(value: number): number {
    if (Number.isNaN(value) || !Number.isFinite(value)) return value;
    const floor = Math.floor(value);
    const diff = value - floor;
    // Exactly halfway -> choose the even neighbour.
    if (Math.abs(diff - 0.5) < Number.EPSILON) {
        return floor % 2 === 0 ? floor : floor + 1;
    }
    return Math.round(value);
}
