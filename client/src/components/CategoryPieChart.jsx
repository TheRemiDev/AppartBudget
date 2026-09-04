import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatAmount } from "../utils/format.js";

export default function CategoryPieChart({ data }) {
  if (!data.length) {
    return <div className="empty-state">Aucune dépense sur cette période.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie
          data={data}
          dataKey="total"
          nameKey="name"
          innerRadius={62}
          outerRadius={94}
          paddingAngle={2}
        >
          {data.map((entry) => (
            <Cell key={entry.categoryId} fill={entry.color} stroke="none" />
          ))}
        </Pie>
        <Tooltip
          formatter={(value) => formatAmount(value)}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)" }}
        />
        <Legend
          layout="vertical"
          verticalAlign="middle"
          align="right"
          formatter={(value) => <span style={{ fontSize: 12.5 }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
