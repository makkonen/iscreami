import { useState } from "react";
import { Maximize2, X } from "lucide-react";
import type { FreezingResult, TargetProfile } from "../types";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
} from "recharts";
import { InfoIcon } from "./InfoIcon";
import { TOOLTIPS } from "../lib/tooltips";
import { fmtTemp } from "../lib/formatting";
import { useEscape } from "../hooks/useEscape";

interface FreezingSectionProps {
  readonly freezing: FreezingResult;
  readonly profile?: TargetProfile | null;
}

interface ChartProps {
  height: number;
}

interface TooltipPayload {
  value: number | null;
}

interface CustomTooltipProps {
  readonly active?: boolean;
  readonly payload?: TooltipPayload[];
  readonly label?: number;
}

function CustomFreezingTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload) return null;
  return (
    <div className="bg-black/70 border border-white/20 rounded p-2 text-xs text-white">
      <p className="mb-1">{label ? `${Number(label).toFixed(1)}% frozen` : ""}</p>
      <p>{payload[0].value == null ? "—" : fmtTemp(Number(payload[0].value))}</p>
    </div>
  );
}

function FreezingChart({
  freezing,
  profile,
  height,
}: ChartProps & {
  freezing: FreezingResult;
  profile?: TargetProfile | null;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart
        data={freezing.curve}
        margin={{ top: 10, right: 40, left: 0, bottom: 25 }}
      >
        <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
        <XAxis
          dataKey="frozen_water_pct"
          type="number"
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
          label={{ value: "Frozen Water (%)", position: "insideBottom", offset: -15, fontSize: 11 }}
          fontSize={11}
        />
        <YAxis
          domain={[-30, 0]}
          tickFormatter={(v: number) => `${v}°`}
          label={{ value: "Temperature (°C)", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }}
          fontSize={11}
        />
        <Tooltip content={<CustomFreezingTooltip />} />
        <Line
          type="monotone"
          dataKey="temperature_c"
          stroke="var(--color-primary, #ec4899)"
          strokeWidth={2}
          dot={false}
          name="Freezing curve"
          isAnimationActive={false}
        />
        {profile?.serving_temp_max != null && profile?.serving_temp_min != null && (
          <ReferenceArea
            y1={profile.serving_temp_min}
            y2={profile.serving_temp_max}
            stroke="none"
            fill="var(--color-info, #06b6d4)"
            fillOpacity={0.15}
          />
        )}
        {freezing.serving_temperature_c != null && (
          <ReferenceLine
            y={freezing.serving_temperature_c}
            stroke="var(--color-warning, #f59e0b)"
            strokeDasharray="4 4"
            strokeWidth={2}
          />
        )}
        <ReferenceLine
          y={freezing.freezing_point_c}
          stroke="var(--color-error, #ef4444)"
          strokeDasharray="4 4"
          strokeWidth={2}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FreezingSection({ freezing, profile }: FreezingSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  useEscape(() => setIsExpanded(false), isExpanded);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-base-200 p-3">
          <div className="flex items-center gap-1 mb-1">
            <div className="text-xs font-medium text-base-content/60">Starts Freezing</div>
            <InfoIcon label={TOOLTIPS.freezingPoint} position="bottom" />
          </div>
          <div className="text-xl font-bold tabular-nums">{fmtTemp(freezing.freezing_point_c)}</div>
          <div className="text-xs text-base-content/40 mt-0.5">freezing point</div>
        </div>

        <div className="rounded-lg bg-base-200 p-3">
          <div className="flex items-center gap-1 mb-1">
            <div className="text-xs font-medium text-base-content/60">75% Frozen At</div>
            <InfoIcon label={TOOLTIPS.servingTemp} position="bottom" />
          </div>
          <div className="text-xl font-bold tabular-nums">
            {freezing.serving_temperature_c == null
              ? "—"
              : fmtTemp(freezing.serving_temperature_c)}
          </div>
          <div className="text-xs text-base-content/40 mt-0.5">scooping benchmark</div>
        </div>
      </div>

      {/* Freezing curve chart */}
      {freezing.curve.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-base-content/50">
              Freezing Curve
            </h3>
            <button
              onClick={() => setIsExpanded(true)}
              className="btn btn-xs btn-ghost gap-1 text-base-content/50"
              title="Expand chart"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              Expand
            </button>
          </div>
          <div className="rounded-lg bg-base-100 border border-base-200 overflow-hidden">
            <div className="w-full h-52">
              <FreezingChart freezing={freezing} profile={profile} height={208} />
            </div>
            {/* Chart legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-3 py-2.5 bg-base-200/30 border-t border-base-200 text-xs text-base-content/60">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-pink-500 rounded" />
                <span>Freezing curve</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 border-t-2 border-dashed border-red-500" />
                <span>Freezing point ({fmtTemp(freezing.freezing_point_c)})</span>
              </div>
              {freezing.serving_temperature_c != null && (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 border-t-2 border-dashed border-amber-500" />
                  <span>75% frozen ({fmtTemp(freezing.serving_temperature_c)})</span>
                </div>
              )}
              {profile?.serving_temp_min != null && profile?.serving_temp_max != null && (
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-2.5 bg-cyan-500/30 rounded-sm" />
                  <span>Profile serving range</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Expanded modal */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Freezing curve"
          onClick={() => setIsExpanded(false)}
        >
          <div
            className="bg-base-100 rounded-lg shadow-2xl w-full h-full max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-base-200 p-4">
              <h2 className="text-lg font-semibold">Freezing Curve</h2>
              <button
                onClick={() => setIsExpanded(false)}
                className="btn btn-sm btn-circle btn-ghost"
                aria-label="Close expanded chart"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 flex flex-col overflow-hidden p-4 gap-6">
              <div className="h-105 shrink-0">
                <FreezingChart freezing={freezing} profile={profile} height={420} />
              </div>

              {/* Expanded legend / explanation */}
              <div className="shrink-0 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="text-sm font-semibold mb-3">Chart Elements</h3>
                  <div className="space-y-3 text-sm text-base-content/70">
                    <div className="flex gap-2.5">
                      <div className="w-4 h-0.5 bg-pink-500 mt-2 shrink-0 rounded" />
                      <div>
                        <p className="font-medium text-base-content">Freezing Curve</p>
                        <p>How the required temperature drops as more water turns to ice. The curve flattens as freezing becomes harder.</p>
                      </div>
                    </div>
                    <div className="flex gap-2.5">
                      <div className="w-4 border-t-2 border-dashed border-red-500 mt-2 shrink-0" />
                      <div>
                        <p className="font-medium text-base-content">Freezing Point — {fmtTemp(freezing.freezing_point_c)}</p>
                        <p>The temperature where ice crystals first begin to form. Above this, the mix stays fully liquid.</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-3">Serving Temperatures</h3>
                  <div className="space-y-3 text-sm text-base-content/70">
                    {freezing.serving_temperature_c != null && (
                      <div className="flex gap-2.5">
                        <div className="w-4 border-t-2 border-dashed border-amber-500 mt-2 shrink-0" />
                        <div>
                          <p className="font-medium text-base-content">75% Frozen — {fmtTemp(freezing.serving_temperature_c)}</p>
                          <p>Industry benchmark for scoopable consistency. At this temperature roughly three-quarters of the water is ice.</p>
                        </div>
                      </div>
                    )}
                    {profile?.serving_temp_min != null && profile?.serving_temp_max != null && (
                      <div className="flex gap-2.5">
                        <div className="w-4 h-3 bg-cyan-500/30 rounded-sm mt-1 shrink-0" />
                        <div>
                          <p className="font-medium text-base-content">Profile Target Range</p>
                          <p>{fmtTemp(profile.serving_temp_min)} to {fmtTemp(profile.serving_temp_max)} — the ideal serving window for this style.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
