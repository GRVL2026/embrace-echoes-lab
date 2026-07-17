import type { TooltipProps } from "recharts";

/**
 * Curseur partagé pour les BarChart : remplace la bande grise pleine
 * par un encadrement discret aux couleurs de la primaire.
 */
export const barTooltipCursor = {
  fill: "hsl(var(--primary) / 0.06)",
  stroke: "hsl(var(--primary) / 0.45)",
  strokeWidth: 1.5,
  radius: 6,
};

type Formatter = (
  value: any,
  name: any,
  item: any,
  index: number,
  payload: any,
) => any;

type Props = TooltipProps<any, any> & {
  formatter?: Formatter;
  labelFormatter?: (label: any, payload?: any[]) => any;
  /** Optionnel : masquer complètement le label (ex. graphes à une seule série). */
  hideLabel?: boolean;
};

/**
 * Contenu de Tooltip Recharts partagé : fond sombre, chaque valeur affichée
 * dans la couleur de sa série pour une lecture immédiate.
 */
export function ChartTooltipContent({
  active,
  payload,
  label,
  formatter,
  labelFormatter,
  hideLabel,
}: Props) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-[140px] rounded-md border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur">
      {!hideLabel && label !== undefined && label !== "" && (
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {labelFormatter ? labelFormatter(label, payload as any[]) : String(label)}
        </div>
      )}
      <ul className="space-y-0.5">
        {payload.map((item: any, i: number) => {
          const color =
            item.color || item.payload?.fill || item.fill || item.stroke || "hsl(var(--primary))";
          let display: any = item.value;
          let name: any = item.name;
          if (formatter) {
            const out = formatter(item.value, item.name, item, i, item.payload);
            if (Array.isArray(out)) {
              display = out[0];
              if (out[1] !== undefined) name = out[1];
            } else {
              display = out;
            }
          }
          return (
            <li key={i} className="flex items-baseline gap-2">
              <span
                className="mt-0.5 inline-block h-2 w-2 shrink-0 rounded-sm"
                style={{ background: color }}
              />
              {name !== undefined && name !== null && name !== "" && (
                <span className="text-muted-foreground">{name} :</span>
              )}
              <span className="font-semibold tabular-nums" style={{ color }}>
                {display}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
