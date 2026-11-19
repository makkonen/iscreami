import { useState } from "react";
import { Pencil } from "lucide-react";
import type { RecipeDetails } from "../hooks/useRecipeCalculator";

interface RecipeTextProps {
  readonly notes: string | null;
  readonly instructions: string | null;
  /** Saves the changed field; resolves to whether it saved. */
  readonly onSave: (patch: RecipeDetails) => Promise<boolean>;
}

/** The recipe's notes and method, each shown as text with an Edit button. */
export function RecipeText({ notes, instructions, onSave }: RecipeTextProps) {
  return (
    <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4 space-y-4">
      <TextBlock
        title="Method"
        empty="No method. Add steps if it needs more than mixing and freezing (steeping, cooking a custard, ripples)."
        placeholder={"One step per line, e.g.\nHeat the milk to 70 °C and steep the pistachios for an hour.\nBlend, strain and chill overnight."}
        value={instructions}
        numbered
        onSave={(v) => onSave({ instructions: v })}
      />
      <TextBlock
        title="Notes"
        empty="No notes."
        placeholder="Sources, ideas, anything worth remembering. Results of each batch go in the batch log."
        value={notes}
        onSave={(v) => onSave({ description: v })}
      />
    </div>
  );
}

interface TextBlockProps {
  readonly title: string;
  readonly empty: string;
  readonly placeholder: string;
  readonly value: string | null;
  /** Show each line as a numbered step. */
  readonly numbered?: boolean;
  readonly onSave: (value: string | null) => Promise<boolean>;
}

function TextBlock({ title, empty, placeholder, value, numbered = false, onSave }: TextBlockProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const steps = (value ?? "").split("\n").filter((s) => s.trim());

  async function save() {
    setSaving(true);
    const text = draft?.trim() || null;
    if (await onSave(text)) setDraft(null);
    setSaving(false);
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">{title}</h2>
        {draft == null && (
          <button type="button" className="btn btn-ghost btn-xs gap-1" onClick={() => setDraft(value ?? "")}>
            <Pencil size={12} /> {value ? "Edit" : "Add"}
          </button>
        )}
      </div>
      {draft != null ? (
        <div>
          <textarea
            className="textarea textarea-bordered w-full min-h-32 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void save();
            }}
            placeholder={placeholder}
            aria-label={title}
            autoFocus
          />
          <div className="mt-2 flex justify-end gap-2">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)} disabled={saving}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? <span className="loading loading-spinner loading-xs" /> : "Save"}
            </button>
          </div>
        </div>
      ) : steps.length === 0 ? (
        <p className="text-sm italic text-base-content/45">{empty}</p>
      ) : numbered && steps.length > 1 ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-base-content/85">
          {steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-base-content/85">{value}</p>
      )}
    </section>
  );
}
