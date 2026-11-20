import { X } from "lucide-react";

interface ClearButtonProps {
  /** Shown only while there's something to clear. */
  readonly visible: boolean;
  readonly onClear: () => void;
  readonly label?: string;
}

/**
 * An × inside the right edge of a text box (its wrapper must be `relative`,
 * and the input needs right padding, e.g. `pr-8`).
 */
export function ClearButton({ visible, onClear, label = "Clear search" }: ClearButtonProps) {
  if (!visible) return null;
  return (
    <button
      type="button"
      // Keep focus in the box: clearing shouldn't close a dropdown or the keyboard.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClear}
      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-base-content/45 hover:bg-base-200 hover:text-base-content"
      aria-label={label}
      title={label}
    >
      <X size={14} />
    </button>
  );
}
