import { useNavigate } from "react-router-dom";
import { ClearButton } from "./ClearButton";
import { useQuery } from "@tanstack/react-query";
import { Plus, Download, Upload } from "lucide-react";
import { fetchRecipes, exportAllRecipes, importRecipes } from "../api";
import { useState, useEffect } from "react";
import { FileUploadModal } from "./FileUploadModal";
import { useToast } from "../hooks/useToast";
import { downloadJson } from "../lib/download";
import { errorMessage } from "../lib/errors";
import { RecipeCard } from "./RecipeCard";
import { childTags, hasTag, isRetired, RETIRED_TAG, tagCounts, tagLeaf, tagWithin } from "../lib/tags";

export function RecipesView() {
  const navigate = useNavigate();
  useEffect(() => {
    document.title = "Recipes - iscreami";
  }, []);
  const { addToast } = useToast();
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [exportAllLoading, setExportAllLoading] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(0);

  const { data: recipesData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["recipes"],
    queryFn: fetchRecipes,
  });

  const recipes = recipesData?.items ?? [];
  const [search, setSearch] = useState("");
  // The chosen tag, e.g. "Base" or "Base/Chocolate"; recipes at or under it show.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const counts = tagCounts(recipes.map((r) => r.tags));
  // Retired recipes stay out of the way unless that tag is picked.
  const showRetired = tagFilter != null && tagWithin(RETIRED_TAG, tagFilter);
  const retiredCount = recipes.filter((r) => isRetired(r.tags)).length;
  // Match every word against the name, notes, tags and ingredient names.
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = recipes.filter((r) => {
    if (!showRetired && isRetired(r.tags)) return false;
    if (tagFilter && !hasTag(r.tags, tagFilter)) return false;
    if (!words.length) return true;
    const text = [r.name, r.description ?? "", ...(r.tags ?? []), ...r.ingredients.map((i) => i.ingredient.name)]
      .join(" ")
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const filtering = words.length > 0 || tagFilter != null;
  // The list comes newest-first from the server.
  const [sort, setSort] = useState<"updated" | "rating" | "name">("updated");
  if (sort === "rating") shown.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
  else if (sort === "name") shown.sort((a, b) => a.name.localeCompare(b.name));
  // The tag levels to offer: the top level, then each chosen level's children.
  const tagRows: { parent: string | null; tags: string[] }[] = [];
  if (counts.size > 0) {
    const chain = tagFilter ? tagFilter.split("/").map((_, i, a) => a.slice(0, i + 1).join("/")) : [];
    for (const parent of [null, ...chain]) {
      const tags = childTags(counts, parent);
      if (tags.length) tagRows.push({ parent, tags });
    }
  }

  async function handleExportAll() {
    setExportAllLoading(true);
    try {
      const data = await exportAllRecipes();
      downloadJson(data, "recipes-export.json");
      addToast(`Exported ${data.length} recipes`, "success");
    } catch (err) {
      addToast(errorMessage(err, "Failed to export recipes"), "error");
    } finally {
      setExportAllLoading(false);
    }
  }

  async function handleImportFile(file: File) {
    setImportLoading(true);
    setImportError(null);
    setImportSuccess(0);
    try {
      const results = await importRecipes(file);
      setImportSuccess(results.length);
      await refetch();
      setTimeout(() => {
        setImportModalOpen(false);
        setImportSuccess(0);
      }, 2000);
      addToast(`Imported ${results.length} recipe${results.length === 1 ? "" : "s"}`, "success");
    } catch (err) {
      const errMsg = errorMessage(err, "Failed to import recipes");
      setImportError(errMsg);
      addToast(errMsg, "error");
    } finally {
      setImportLoading(false);
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-base-content">Recipes</h1>
          <p className="mt-1 text-sm text-base-content/60">
            Browse and manage your saved ice cream recipes
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:justify-end">
          <button
            type="button"
            className="btn btn-primary btn-sm gap-1 col-span-2 sm:col-span-1"
            onClick={() => navigate("/calculator")}
          >
            <Plus size={15} />
            New Recipe
          </button>
          <button
            type="button"
            className={`btn btn-outline btn-sm gap-1${recipes.length === 0 ? " col-span-2" : ""}`}
            onClick={() => setImportModalOpen(true)}
          >
            <Upload size={15} />
            Import
          </button>
          {recipes.length > 0 && (
            <button
              type="button"
              className="btn btn-outline btn-sm gap-1"
              onClick={() => void handleExportAll()}
              disabled={exportAllLoading}
            >
              {exportAllLoading ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <Download size={15} />
              )}
              Export All
            </button>
          )}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <span className="loading loading-spinner loading-lg"></span>
        </div>
      )}

      {isError && (
        <div className="bg-base-100 rounded-xl border border-error/30 p-12 text-center">
          <p className="text-base-content/60 mb-2">Could not load recipes</p>
          <p className="text-sm text-base-content/40 mb-4">{error?.message ?? "An unexpected error occurred"}</p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </div>
      )}

      {!isLoading && !isError && recipes.length === 0 && (
        <div className="bg-base-100 rounded-xl border border-base-200 p-12 text-center">
          <p className="text-base-content/60 mb-4">No recipes yet</p>
          <button
            type="button"
            className="btn btn-primary gap-2"
            onClick={() => navigate("/calculator")}
          >
            <Plus size={18} />
            Create your first recipe
          </button>
        </div>
      )}

      {!isLoading && !isError && recipes.length > 0 && (
        <>
          <div className="mb-4 flex items-center gap-3">
            <div className="relative w-full sm:max-w-sm">
              <input
                type="text"
                className="input input-bordered input-sm w-full pr-8"
                placeholder="Search recipes, notes or ingredients…"
                aria-label="Search recipes"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <ClearButton visible={search.length > 0} onClear={() => setSearch("")} />
            </div>
            <select
              className="select select-sm w-auto shrink-0"
              value={sort}
              onChange={(e) => setSort(e.target.value as typeof sort)}
              aria-label="Sort recipes"
            >
              <option value="updated">Recently updated</option>
              <option value="rating">Highest rated</option>
              <option value="name">Name</option>
            </select>
            {filtering && (
              <span className="text-xs text-base-content/55 shrink-0">
                {shown.length} of {recipes.length}
              </span>
            )}
          </div>
          {tagRows.length > 0 && (
            <div className="mb-4 space-y-1.5" aria-label="Filter by tag">
              {tagRows.map(({ parent, tags }) => (
                <div key={parent ?? ""} className="flex flex-wrap items-center gap-1.5">
                  {parent ? (
                    <span className="text-xs text-base-content/45 mr-1">{tagLeaf(parent)} ›</span>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-xs ${tagFilter == null ? "btn-primary" : "btn-ghost"}`}
                      aria-pressed={tagFilter == null}
                      onClick={() => setTagFilter(null)}
                    >
                      All
                    </button>
                  )}
                  {tags.map((tag) => {
                    const active = tagFilter != null && tagWithin(tagFilter, tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className={`btn btn-xs ${active ? "btn-primary" : "btn-ghost border-base-300"}`}
                        aria-pressed={active}
                        // Clicking the chosen tag again steps back to its parent.
                        onClick={() => setTagFilter(tagFilter === tag ? parent : tag)}
                      >
                        {tagLeaf(tag)}
                        <span className="opacity-60 tabular-nums">{counts.get(tag)}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
          {!showRetired && retiredCount > 0 && (
            <p className="mb-3 text-xs text-base-content/45">
              {retiredCount} retired recipe{retiredCount === 1 ? "" : "s"} hidden;{" "}
              <button type="button" className="link" onClick={() => setTagFilter(RETIRED_TAG)}>
                show
              </button>
            </p>
          )}
          {shown.length === 0 ? (
            <p className="py-8 text-center text-sm text-base-content/55">
              {words.length ? `No recipes match “${search}”.` : "No recipes with this tag."}
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {shown.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </div>
          )}
        </>
      )}

      {/* File upload modal */}
      <FileUploadModal
        open={importModalOpen}
        onClose={() => {
          setImportModalOpen(false);
          setImportError(null);
          setImportSuccess(0);
        }}
        onFileSelect={handleImportFile}
        isLoading={importLoading}
        error={importError}
        successCount={importSuccess}
      />
    </main>
  );
}
