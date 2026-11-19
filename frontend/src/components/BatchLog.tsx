import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { createBatch, deleteBatch, fetchBatches, updateBatch } from "../api";
import { keyFor, rowKey, type RecipeRow } from "../hooks/useRecipeCalculator";
import { useEscape } from "../hooks/useEscape";
import { useToast } from "../hooks/useToast";
import { errorMessage } from "../lib/errors";
import { KJ_PER_KCAL } from "../lib/formatting";
import type { BatchRatings, BatchSnapshot, CalculateResponse, RecipeBatch, ServingMethod } from "../types";

const HARDNESS = ["Much too soft", "A bit soft", "Right", "A bit hard", "Much too hard"];
const SWEETNESS = ["Far too little", "Not quite sweet", "Right", "A bit sweet", "Far too sweet"];
const ICINESS = ["Smooth", "Slightly icy", "Icy", "Very icy"];

/** The editor as it is now, to store with a new batch. */
function snapshotOf(rows: readonly RecipeRow[], result: CalculateResponse | null, profileName: string | null): BatchSnapshot {
  const metrics: Record<string, number | null> = {};
  for (const c of result?.target_comparison ?? []) metrics[c.metric] = c.value;
  if (result) {
    metrics.pac = result.pac.pac_mix;
    metrics.pod = result.sweetness.pod;
    const kj = result.nutrition.per_100g.energy_kj;
    if (kj != null) metrics.kcal_per_100g = kj / KJ_PER_KCAL;
  }
  return {
    ingredients: rows.map((r) => ({
      ingredient_id: r.ingredient.id,
      name: r.ingredient.name,
      weight_grams: r.weight_grams,
      is_addin: r.is_addin,
    })),
    metrics,
    profile_name: profileName,
  };
}

/** How the editor now differs from what went into a batch, briefly. */
function changesSince(batch: RecipeBatch, rows: readonly RecipeRow[]): string[] {
  const then = new Map(batch.snapshot.ingredients.map((i) => [keyFor(i.ingredient_id, i.is_addin), i]));
  const now = new Map(rows.map((r) => [rowKey(r), r]));
  const fmt = (g: number) => (g < 3 ? g.toFixed(2) : g.toFixed(g < 10 ? 1 : 0));
  const out: string[] = [];
  for (const r of rows) {
    const was = then.get(rowKey(r));
    if (!was) out.push(`+ ${r.ingredient.name}`);
    else if (Math.abs(was.weight_grams - r.weight_grams) > 0.005)
      out.push(`${r.ingredient.name} ${fmt(was.weight_grams)} → ${fmt(r.weight_grams)} g`);
  }
  for (const [key, i] of then) if (!now.has(key)) out.push(`− ${i.name}`);
  return out;
}

function fmtDate(iso: string): string {
  // made_on is a plain date; read it as local, not UTC midnight.
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface BatchLogProps {
  readonly recipeId: string;
  readonly rows: readonly RecipeRow[];
  readonly result: CalculateResponse | null;
  readonly profileName: string | null;
  /** The serving method in effect now, offered as the default. */
  readonly servingMethod: string | null;
  readonly servingMethods: readonly ServingMethod[];
  /** Put a batch's weights into the editor. */
  readonly onLoadWeights: (snapshot: BatchSnapshot) => void;
}

/** Each time the recipe was made: what went in, and how it turned out. */
export function BatchLog({ recipeId, rows, result, profileName, servingMethod, servingMethods, onLoadWeights }: BatchLogProps) {
  const qc = useQueryClient();
  const { addToast } = useToast();
  const { data: batches } = useQuery({ queryKey: ["batches", recipeId], queryFn: () => fetchBatches(recipeId) });
  // null: closed; "new": logging the editor as a new batch; else the batch being edited.
  const [editing, setEditing] = useState<"new" | RecipeBatch | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const labelOf = (id: string | null) => servingMethods.find((m) => m.id === id)?.label;

  async function save(ratings: BatchRatings) {
    try {
      if (editing === "new") await createBatch(recipeId, { ...ratings, snapshot: snapshotOf(rows, result, profileName) });
      else if (editing) await updateBatch(recipeId, editing.id, ratings);
      await qc.invalidateQueries({ queryKey: ["batches", recipeId] });
      addToast(editing === "new" ? "Batch logged." : "Batch updated.", "success");
      setEditing(null);
    } catch (err) {
      addToast(errorMessage(err, "Failed to save batch."), "error");
    }
  }

  async function remove(batch: RecipeBatch) {
    try {
      await deleteBatch(recipeId, batch.id);
      await qc.invalidateQueries({ queryKey: ["batches", recipeId] });
    } catch (err) {
      addToast(errorMessage(err, "Failed to delete batch."), "error");
    } finally {
      setConfirmDelete(null);
    }
  }

  return (
    <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-base-content/50">Batches</h2>
          <p className="mt-1 text-sm text-base-content/55">
            Log each time you make it: the weights as made, and how it came out.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline gap-1 shrink-0"
          onClick={() => setEditing("new")}
          disabled={rows.length === 0}
          title="Log the recipe as it is in the editor now (unsaved edits included)"
        >
          <Plus size={14} /> Log batch
        </button>
      </div>

      {batches && batches.length === 0 && (
        <p className="rounded-md border border-dashed border-base-300 px-3 py-3 text-sm italic text-base-content/45">
          <ClipboardList size={14} className="inline -mt-0.5 mr-1" />
          No batches yet.
        </p>
      )}

      <ul className="space-y-3">
        {batches?.map((b) => {
          const changes = changesSince(b, rows);
          const m = b.snapshot.metrics;
          const facts = [
            m.pac != null && `PAC ${m.pac.toFixed(1)}`,
            m.frozen_pct != null && `${m.frozen_pct.toFixed(0)}% frozen`,
            m.protein != null && `protein ${m.protein.toFixed(1)}%`,
            m.kcal_per_100g != null && `${Math.round(m.kcal_per_100g)} kcal/100 g`,
          ].filter(Boolean);
          return (
            <li key={b.id} className="rounded-lg border border-base-200 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{fmtDate(b.made_on)}</span>
                {b.overall != null && (
                  <span className="flex text-warning" aria-label={`${b.overall} out of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={13} fill={n <= b.overall! ? "currentColor" : "none"} aria-hidden="true" />
                    ))}
                  </span>
                )}
                {labelOf(b.serving_method) && (
                  <span className="text-xs text-base-content/55">{labelOf(b.serving_method)}</span>
                )}
                <div className="ml-auto flex items-center gap-0.5">
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs gap-1"
                    onClick={() => onLoadWeights(b.snapshot)}
                    disabled={changes.length === 0}
                    title={changes.length ? "Put this batch's weights in the editor (Revert undoes it)" : "The editor already matches this batch"}
                  >
                    <Download size={13} /> Load weights
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-xs"
                    onClick={() => setEditing(b)}
                    aria-label="Edit ratings and notes"
                  >
                    <Pencil size={13} />
                  </button>
                  {confirmDelete === b.id ? (
                    <button type="button" className="btn btn-error btn-xs" onClick={() => void remove(b)}>
                      Delete?
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs text-base-content/45 hover:text-error"
                      onClick={() => setConfirmDelete(b.id)}
                      aria-label="Delete batch"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {b.hardness != null && <span className="badge badge-sm badge-ghost">{HARDNESS[b.hardness + 2]}</span>}
                {b.sweetness != null && (
                  <span className="badge badge-sm badge-ghost">Sweetness: {SWEETNESS[b.sweetness + 2].toLowerCase()}</span>
                )}
                {b.iciness != null && <span className="badge badge-sm badge-ghost">{ICINESS[b.iciness]}</span>}
              </div>
              {b.notes && <p className="mt-1.5 whitespace-pre-wrap text-sm text-base-content/80">{b.notes}</p>}
              {facts.length > 0 && <p className="mt-1.5 text-xs text-base-content/50">{facts.join(" · ")}</p>}
              <p className="mt-1 text-xs text-base-content/50">
                {changes.length === 0 ? "Same as the editor now." : `Since then: ${changes.slice(0, 4).join("; ")}${changes.length > 4 ? `; +${changes.length - 4} more` : ""}`}
              </p>
            </li>
          );
        })}
      </ul>

      {editing && (
        <BatchModal
          batch={editing === "new" ? null : editing}
          defaultServing={servingMethod}
          servingMethods={servingMethods}
          onSave={(r) => void save(r)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface ScaleProps {
  readonly label: string;
  readonly options: readonly string[];
  /** Value of the first option; options count up from it. */
  readonly start: number;
  readonly value: number | null;
  readonly onChange: (v: number | null) => void;
}

/** One rating as a row of buttons; clicking the chosen one clears it. */
function Scale({ label, options, start, value, onChange }: ScaleProps) {
  return (
    <fieldset className="mb-3">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="join flex flex-wrap">
        {options.map((o, i) => (
          <button
            key={o}
            type="button"
            className={`join-item btn btn-xs ${value === start + i ? "btn-primary" : "btn-outline border-base-300"}`}
            aria-pressed={value === start + i}
            onClick={() => onChange(value === start + i ? null : start + i)}
          >
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

interface BatchModalProps {
  readonly batch: RecipeBatch | null;
  readonly defaultServing: string | null;
  readonly servingMethods: readonly ServingMethod[];
  readonly onSave: (ratings: BatchRatings) => void;
  readonly onClose: () => void;
}

function BatchModal({ batch, defaultServing, servingMethods, onSave, onClose }: BatchModalProps) {
  const [r, setR] = useState<BatchRatings>(
    batch ?? {
      made_on: today(),
      serving_method: defaultServing,
      hardness: null,
      sweetness: null,
      iciness: null,
      overall: null,
      notes: null,
    },
  );
  useEscape(onClose, true);
  const set = (patch: Partial<BatchRatings>) => setR((prev) => ({ ...prev, ...patch }));

  return (
    <div className="modal modal-open" role="dialog" aria-modal="true" aria-label={batch ? "Edit batch" : "Log batch"}>
      <div className="modal-box max-w-lg">
        <h3 className="mb-1 text-lg font-bold">{batch ? "Edit batch" : "Log batch"}</h3>
        {!batch && (
          <p className="mb-4 text-sm text-base-content/60">
            Saves the weights in the editor now. Rate it now or come back after tasting.
          </p>
        )}
        <div className="mb-3 flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Made on
            <input
              type="date"
              className="input input-sm input-bordered"
              value={r.made_on}
              onChange={(e) => e.target.value && set({ made_on: e.target.value })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Served as
            <select
              className="select select-sm"
              value={r.serving_method ?? ""}
              onChange={(e) => set({ serving_method: e.target.value || null })}
            >
              <option value="">—</option>
              {servingMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Scale label="Overall" options={["1", "2", "3", "4", "5"]} start={1} value={r.overall} onChange={(v) => set({ overall: v })} />
        <Scale label="Hardness" options={HARDNESS} start={-2} value={r.hardness} onChange={(v) => set({ hardness: v })} />
        <Scale label="Sweetness" options={SWEETNESS} start={-2} value={r.sweetness} onChange={(v) => set({ sweetness: v })} />
        <Scale label="Iciness" options={ICINESS} start={0} value={r.iciness} onChange={(v) => set({ iciness: v })} />
        <label className="flex flex-col gap-1 text-sm">
          Notes
          <textarea
            className="textarea textarea-bordered min-h-20"
            value={r.notes ?? ""}
            onChange={(e) => set({ notes: e.target.value || null })}
            placeholder="Texture, flavour, what to try next…"
          />
        </label>
        <div className="modal-action">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() =>
              onSave({
                made_on: r.made_on,
                serving_method: r.serving_method,
                hardness: r.hardness,
                sweetness: r.sweetness,
                iciness: r.iciness,
                overall: r.overall,
                notes: r.notes,
              })
            }
          >
            {batch ? "Save" : "Log batch"}
          </button>
        </div>
      </div>
      <button type="button" className="modal-backdrop" onClick={onClose} aria-label="Close" />
    </div>
  );
}
