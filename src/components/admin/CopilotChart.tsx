import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { ChartTooltipContent, barTooltipCursor } from "./chartTooltip";
import { DonutHoverCenter } from "./DonutHoverCenter";

export type ChartPayload = {
  type: "ligne" | "barres" | "donut";
  titre: string;
  donnees: Array<{ x: string; y: number }>;
  unite?: string;
};

const COLORS = [
  "hsl(var(--primary))",
  "hsl(var(--secondary))",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#6366f1",
  "#ec4899",
  "#14b8a6",
];

function formatValue(v: number, unite?: string) {
  const abs = Math.abs(v);
  let formatted: string;
  if (abs >= 1_000_000) formatted = `${(v / 1_000_000).toFixed(1)} M`;
  else if (abs >= 1_000) formatted = `${(v / 1_000).toFixed(0)} k`;
  else formatted = v.toLocaleString("fr-FR");
  return unite ? `${formatted} ${unite}` : formatted;
}

export function CopilotChart({ payload }: { payload: ChartPayload }) {
  const data = Array.isArray(payload.donnees) ? payload.donnees.slice(0, 30) : [];
  const unite = payload.unite;

  return (
    <div className="my-3 rounded-md border border-border/60 bg-background/60 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {payload.titre}
      </div>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer>
          {payload.type === "ligne" ? (
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                content={<ChartTooltipContent formatter={(v: any) => formatValue(Number(v), unite)} />}
              />
              <Line type="monotone" dataKey="y" stroke="hsl(var(--primary))" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          ) : payload.type === "barres" ? (
            <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="x" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => formatValue(Number(v))} />
              <Tooltip
                cursor={barTooltipCursor}
                content={<ChartTooltipContent formatter={(v: any) => formatValue(Number(v), unite)} />}
              />
              <Bar dataKey="y" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          ) : (
            <PieChart>
              <Pie data={data} dataKey="y" nameKey="x" outerRadius={90} innerRadius={50} paddingAngle={2}>
                {data.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                content={<ChartTooltipContent formatter={(v: any, n: any) => [formatValue(Number(v), unite), n]} />}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
