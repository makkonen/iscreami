import { useState } from "react";
import { Pencil } from "lucide-react";

interface RecipeNameProps {
  readonly name: string;
  /** Saves the new name; resolves to whether it saved. */
  readonly onRename: (name: string) => Promise<boolean>;
}

/** The recipe's name, with a pencil to rename it in place. */
export function RecipeName({ name, onRename }: RecipeNameProps) {
  const [draft, setDraft] = useState<string | null>(null);

  async function commit() {
    const next = draft?.trim();
    if (!next || next === name) {
      setDraft(null);
      return;
    }
    if (await onRename(next)) setDraft(null);
  }

  if (draft != null) {
    return (
      <input
        type="text"
        className="input input-bordered w-full max-w-xl text-2xl sm:text-3xl font-bold h-auto py-1"
        value={draft}
        maxLength={255}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          else if (e.key === "Escape") setDraft(null);
        }}
        onBlur={() => void commit()}
        aria-label="Recipe name"
        autoFocus
      />
    );
  }
  return (
    <span className="group/name inline-flex items-center gap-2">
      <span>{name}</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs text-base-content/35 hover:text-base-content/70"
        onClick={() => setDraft(name)}
        aria-label="Rename recipe"
        title="Rename"
      >
        <Pencil size={15} />
      </button>
    </span>
  );
}
