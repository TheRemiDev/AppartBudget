import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatAmount } from "../utils/format.js";
import Icon from "./Icon.jsx";

export default function CategoryPieChart({ data }) {
  if (!data.length) {
    return (
      <div className="empty-state">
        <Icon name="inbox" size={26} />
        <span>Aucune dépense sur cette période.</span>
      </div>
    );
  }

  const total = data.reduce((s, c) => s + c.total, 0);

  return (
    <div className="category-breakdown">
      <div className="category-breakdown__chart">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="total"
              nameKey="name"
              innerRadius="68%"
              outerRadius="100%"
              paddingAngle={data.length > 1 ? 2.5 : 0}
              stroke="none"
            >
              {data.map((entry) => (
                <Cell key={entry.categoryId} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value) => formatAmount(value)}
              contentStyle={{
                borderRadius: 10,
                border: "1px solid var(--color-border)",
                background: "var(--color-surface)",
                fontSize: 13,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="category-breakdown__total">
          <span className="category-breakdown__total-value">{formatAmount(total)}</span>
          <span className="category-breakdown__total-label">Total</span>
        </div>
      </div>

      <div className="category-list">
        {data.map((c) => {
          const pct = total > 0 ? Math.round((c.total / total) * 100) : 0;
          return (
            <div className="category-list__row" key={c.categoryId}>
              <span className="category-list__icon">{c.icon}</span>
              <div className="category-list__main">
                <div className="category-list__top">
                  <span className="category-list__name">{c.name}</span>
                  <span className="category-list__amount">{formatAmount(c.total)}</span>
                </div>
                <div className="progress-bar">
                  <div
                    className="progress-bar__fill"
                    style={{ width: `${pct}%`, background: c.color }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
