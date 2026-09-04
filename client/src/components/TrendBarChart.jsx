import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "../utils/format.js";

export default function TrendBarChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} barSize={22} margin={{ left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 12, fill: "var(--color-text-muted)" }} axisLine={false} tickLine={false} width={60} />
        <Tooltip
          formatter={(value) => formatAmount(value)}
          contentStyle={{ borderRadius: 10, border: "1px solid var(--color-border)" }}
        />
        <Bar dataKey="fixed" stackId="a" fill="#4f46e5" radius={[0, 0, 0, 0]} name="Frais fixes" />
        <Bar dataKey="exceptional" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} name="Frais exceptionnels" />
      </BarChart>
    </ResponsiveContainer>
  );
}
