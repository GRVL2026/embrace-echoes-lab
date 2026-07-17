import { useState, ReactNode } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

export type DonutDatum = {
  name: string;
  value: number;
  color: string;
};

type Props = {
  data: DonutDatum[];
  /** Total displayed by default at the center. */
  total: number | string;
  /** Sub-label under the default total (e.g. "MACHINES"). */
  totalLabel?: string;
  /** Formatter for the hovered segment value (e.g. eur, `${v} · ${pct}%`). */
  formatValue?: (value: number, datum: DonutDatum) => string;
  /** Optional formatter for the total when nothing is hovered. */
  formatTotal?: (total: number | string) => string;
  outerRadius?: number;
  innerRadius?: number;
  paddingAngle?: number;
  stroke?: string;
  strokeWidth?: number;
  onSegmentClick?: (datum: DonutDatum) => void;
  className?: string;
  /** Optional custom slice labels rendered inside the ring. */
  sliceLabel?: (args: { percent: number; cx: number; cy: number; midAngle: number; innerRadius: number; outerRadius: number }) => ReactNode;
};

/**
 * Donut Recharts partagé : au survol d'un segment, le centre du donut
 * bascule vers "<nom> — <valeur> (<pct> %)" dans la couleur du segment,
 * puis revient au total quand la souris quitte. Pas de tooltip flottant :
 * le centre creux fait office d'affichage.
 */
export function DonutHoverCenter({
  data,
  total,
  totalLabel,
  formatValue,
  formatTotal,
  outerRadius = 90,
  innerRadius = 55,
  paddingAngle = 2,
  stroke = "none",
  strokeWidth,
  onSegmentClick,
  className,
  sliceLabel,
}: Props) {
  const [active, setActive] = useState<number | null>(null);
  const sum = data.reduce((n, d) => n + Number(d.value || 0), 0);
  const hovered = active !== null ? data[active] : null;
  const pct = hovered && sum > 0 ? (Number(hovered.value) / sum) * 100 : 0;
  const hoveredValueStr = hovered
    ? (formatValue ? formatValue(Number(hovered.value), hovered) : `${hovered.value} · ${pct.toFixed(0)}%`)
    : "";

  return (
    <div className={`relative h-full w-full ${className ?? ""}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            paddingAngle={paddingAngle}
            stroke={stroke}
            strokeWidth={strokeWidth}
            labelLine={false}
            label={sliceLabel as any}
            onMouseLeave={() => setActive(null)}
            onClick={(d: any) => onSegmentClick && d && onSegmentClick(d as DonutDatum)}
            className={onSegmentClick ? "cursor-pointer outline-none" : "outline-none"}
            isAnimationActive={false}
          >
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={d.color}
                onMouseEnter={() => setActive(i)}
                style={{
                  transition: "opacity 120ms ease",
                  opacity: active === null || active === i ? 1 : 0.45,
                }}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
        {hovered ? (
          <>
            <div
              className="max-w-full truncate text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: hovered.color }}
              title={hovered.name}
            >
              {hovered.name}
            </div>
            <div
              className="font-display text-base font-bold tabular-nums leading-tight"
              style={{ color: hovered.color }}
            >
              {hoveredValueStr}
            </div>
          </>
        ) : (
          <>
            <div className="font-display text-lg font-bold tabular-nums leading-none">
              {formatTotal ? formatTotal(total) : total}
            </div>
            {totalLabel && (
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {totalLabel}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
