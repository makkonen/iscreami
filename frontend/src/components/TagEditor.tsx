import { useId, useState } from "react";
import { Tag, X } from "lucide-react";
import { cleanTag } from "../lib/tags";

interface TagEditorProps {
  readonly tags: readonly string[];
  /** Tags used anywhere, offered as suggestions. */
  readonly allTags: readonly string[];
  readonly onChange: (tags: string[]) => void;
  readonly disabled?: boolean;
}

/** Tag chips with an add box; Enter or comma adds, "/" nests (Status/Testing). */
export function TagEditor({ tags, allTags, onChange, disabled = false }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const listId = useId();

  function add(raw: string) {
    const tag = cleanTag(raw);
    setDraft("");
    if (!tag || tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return;
    onChange([...tags, tag]);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Tag size={14} className="shrink-0 text-base-content/45" aria-hidden="true" />
      {tags.map((tag) => (
        <span key={tag} className="badge badge-sm badge-outline gap-1 pr-1">
          {tag}
          <button
            type="button"
            className="text-base-content/45 hover:text-error"
            onClick={() => onChange(tags.filter((t) => t !== tag))}
            disabled={disabled}
            aria-label={`Remove tag ${tag}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        type="text"
        list={listId}
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          // Picking a suggestion or typing a comma finishes the tag.
          if (v.endsWith(",")) add(v.slice(0, -1));
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => draft && add(draft)}
        disabled={disabled}
        placeholder={tags.length ? "Add tag" : "Add tags, e.g. Status/Testing"}
        aria-label="Add a tag"
        className="input input-ghost input-xs w-40 px-1"
      />
      <datalist id={listId}>
        {allTags
          .filter((t) => !tags.includes(t))
          .map((t) => (
            <option key={t} value={t} />
          ))}
      </datalist>
    </div>
  );
}
