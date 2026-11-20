import { useState } from "react";
import { ExternalLink, Link2, Pencil } from "lucide-react";

/** The site a link points at, e.g. "saveur.com". */
function sourceHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A link out to a recipe's source; opens in a new tab. */
export function SourceLink({ url, className = "" }: { readonly url: string; readonly className?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`link link-hover inline-flex items-center gap-1 ${className}`}
      title={url}
      onClick={(e) => e.stopPropagation()}
    >
      {sourceHost(url)}
      <ExternalLink size={12} aria-hidden="true" />
    </a>
  );
}

interface RecipeSourceProps {
  readonly url: string | null;
  /** Saves the link (null clears it); resolves to whether it saved. */
  readonly onSave: (url: string | null) => Promise<boolean>;
}

/** The recipe's source link, with a pencil to add or change it. */
export function RecipeSource({ url, onSave }: RecipeSourceProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState(false);

  async function commit() {
    const next = draft?.trim() || null;
    if (next === url) {
      setDraft(null);
      return;
    }
    if (next && !/^https?:\/\//i.test(next)) {
      setError(true);
      return;
    }
    if (await onSave(next)) setDraft(null);
  }

  if (draft != null) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <Link2 size={14} className="shrink-0 text-base-content/45" aria-hidden="true" />
        <input
          type="url"
          className={`input input-xs input-bordered w-72 max-w-full ${error ? "input-error" : ""}`}
          value={draft}
          placeholder="https://…"
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") void commit();
            else if (e.key === "Escape") setDraft(null);
          }}
          onBlur={() => void commit()}
          aria-label="Source link"
          autoFocus
        />
        {error && <span className="text-xs text-error">Start with http:// or https://</span>}
      </span>
    );
  }
  if (!url) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-base-content/45 hover:text-base-content/70" onClick={() => setDraft("")}>
        <Link2 size={14} aria-hidden="true" /> Add source link
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link2 size={14} className="shrink-0" aria-hidden="true" />
      Source: <SourceLink url={url} className="font-medium text-base-content/80" />
      <button
        type="button"
        className="text-base-content/35 hover:text-base-content/70"
        onClick={() => setDraft(url)}
        aria-label="Change source link"
        title="Change source link"
      >
        <Pencil size={12} />
      </button>
    </span>
  );
}
