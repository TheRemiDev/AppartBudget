import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "../utils/format.js";
import { KIND_INFO } from "../utils/kind.js";

// Couleurs alignees sur les pastilles de type (fixe = violet de la marque,
// courant = bleu, exceptionnel = orange), lisibles en theme clair et sombre.
export const TREND_SERIES = [
  { key: "fixed", color: "#7457f0", label: KIND_INFO.fixed.plural },
  { key: "occasional", color: "#3b8fe0", label: KIND_INFO.occasional.plural },
  { key: "exceptional", color: "#ee9a3a", label: KIND_INFO.exceptional.plural },
];

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip__title">{label}</div>
      {payload
        .slice()
        .reverse()
        .map((p) => (
          <div className="chart-tooltip__row" key={p.dataKey}>
            <span className="legend-dot" style={{ background: p.color }} />
            <span>{p.name}</span>
            <strong>{formatAmount(p.value)}</strong>
          </div>
        ))}
      <div className="chart-tooltip__total">
        <span>Total</span>
        <strong>{formatAmount(total)}</strong>
      </div>
    </div>
  );
}

export function TrendLegend() {
  return (
    <div className="chart-legend">
      {TREND_SERIES.map((s) => (
        <span key={s.key} className="chart-legend__item">
          <span className="legend-dot" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

export default function TrendBarChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barSize={24} margin={{ left: -6, right: 4, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis
          tick={{ fontSize: 12, fill: "var(--color-text-muted)" }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v) =>
            v >= 1000 ? `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} k€` : `${Math.round(v)} €`
          }
        />
        <Tooltip content={<TrendTooltip />} cursor={{ fill: "rgba(127, 127, 160, 0.1)" }} />
        {TREND_SERIES.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="a"
            fill={s.color}
            name={s.label}
            radius={i === TREND_SERIES.length - 1 ? [5, 5, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
