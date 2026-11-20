import { useQuery } from "@tanstack/react-query";
import { fetchBatches } from "../api";

interface DeleteRecipeMessageProps {
  readonly recipeId: string;
  readonly name: string;
}

/** The delete confirmation's text, warning that the batch log goes too. */
export function DeleteRecipeMessage({ recipeId, name }: DeleteRecipeMessageProps) {
  const { data: batches } = useQuery({ queryKey: ["batches", recipeId], queryFn: () => fetchBatches(recipeId) });
  const count = batches?.length ?? 0;
  return (
    <>
      <p className="text-base-content/70">
        Delete <strong>{name}</strong>? This cannot be undone.
      </p>
      {count > 0 && (
        <p className="mt-2 text-sm text-warning">
          Its {count} logged batch{count === 1 ? "" : "es"} will be deleted too. To keep the history but hide the
          recipe, tag it Status/Retired instead.
        </p>
      )}
    </>
  );
}
