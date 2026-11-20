import { useState } from "react";
import { Star, StarHalf } from "lucide-react";

interface StarRatingProps {
  /** 1-5 in half stars; null when unrated. */
  readonly value: number | null | undefined;
  /** Leave out to show the rating read-only. */
  readonly onChange?: (value: number | null) => void;
  readonly size?: number;
  readonly label?: string;
}

const clamp = (v: number) => Math.min(5, Math.max(1, Math.round(v * 2) / 2));

/**
 * Five stars, rated in half stars: the left half of a star is a half. Clicking
 * the current rating clears it; arrow keys step by half a star.
 */
export function StarRating({ value, onChange, size = 16, label = "Rating" }: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value ?? 0;
  const text = value ? `${value} out of 5 stars` : "Not rated";

  const stars = [1, 2, 3, 4, 5].map((n) => {
    const fill = shown >= n ? "full" : shown >= n - 0.5 ? "half" : "none";
    return (
      <span key={n} className="relative inline-block" style={{ width: size, height: size }}>
        <Star size={size} className="absolute inset-0 text-base-content/25" aria-hidden="true" />
        {fill === "full" && <Star size={size} className="absolute inset-0 text-warning" fill="currentColor" aria-hidden="true" />}
        {fill === "half" && (
          <StarHalf size={size} className="absolute inset-0 text-warning" fill="currentColor" aria-hidden="true" />
        )}
        {onChange && (
          <>
            {/* Two hit areas per star: the left half rates n - 0.5, the right half n. */}
            {[n - 0.5, n].map((v, i) => (
              <button
                key={v}
                type="button"
                tabIndex={-1}
                className={`absolute inset-y-0 ${i === 0 ? "left-0" : "right-0"} w-1/2 cursor-pointer`}
                onMouseEnter={() => setHover(v)}
                onClick={() => onChange(value === v ? null : v)}
                aria-hidden="true"
              />
            ))}
          </>
        )}
      </span>
    );
  });

  if (!onChange) {
    return (
      <span className="inline-flex items-center gap-0.5" role="img" aria-label={text} title={text}>
        {stars}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={1}
      aria-valuemax={5}
      aria-valuenow={value ?? undefined}
      aria-valuetext={text}
      title={value ? `${text} (click it again to clear)` : "Rate it"}
      onMouseLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") {
          e.preventDefault();
          onChange(clamp((value ?? 0.5) + 0.5));
        } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
          e.preventDefault();
          onChange(value && value > 1 ? clamp(value - 0.5) : null);
        } else if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          onChange(null);
        }
      }}
    >
      {stars}
    </span>
  );
}
