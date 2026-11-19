import { useState } from "react";
import { cToF } from "../lib/formatting";
import { CUSTOM_TEMP_MAX, CUSTOM_TEMP_MIN, CUSTOM_TEXTURES, type CustomTexture } from "../lib/serving";

interface CustomServingProps {
  readonly value: { tempC: number; texture: CustomTexture };
  readonly onChange: (tempC: number, texture: CustomTexture) => void;
}

const fToC = (f: number) => ((f - 32) * 5) / 9;

/** Eating temperature (°C or °F) and texture for a custom serving. */
export function CustomServing({ value, onChange }: CustomServingProps) {
  const [unit, setUnit] = useState<"C" | "F">("C");
  const shown = unit === "C" ? value.tempC : cToF(value.tempC);
  // Typed text, kept while editing so "-" or "-1" aren't rejected mid-number.
  const [draft, setDraft] = useState<string | null>(null);

  function commit(text: string) {
    setDraft(null);
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return;
    const c = unit === "C" ? n : fToC(n);
    onChange(Math.min(Math.max(c, CUSTOM_TEMP_MIN), CUSTOM_TEMP_MAX), value.texture);
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step={0.5}
        className="input input-sm w-20 text-right tabular-nums"
        value={draft ?? String(Number(shown.toFixed(1)))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && commit(e.currentTarget.value)}
        aria-label={`Eating temperature in °${unit}`}
        title="The temperature it's eaten at"
      />
      <select
        className="select select-sm w-16"
        value={unit}
        onChange={(e) => setUnit(e.target.value as "C" | "F")}
        aria-label="Temperature unit"
      >
        <option value="C">°C</option>
        <option value="F">°F</option>
      </select>
      <select
        className="select select-sm"
        value={value.texture}
        onChange={(e) => onChange(value.tempC, e.target.value as CustomTexture)}
        aria-label="Texture when eaten"
        title="How frozen it should be at that temperature"
      >
        {(Object.keys(CUSTOM_TEXTURES) as CustomTexture[]).map((t) => (
          <option key={t} value={t}>
            {CUSTOM_TEXTURES[t].label} ({CUSTOM_TEXTURES[t].min}–{CUSTOM_TEXTURES[t].max}% frozen)
          </option>
        ))}
      </select>
    </div>
  );
}
