import { formatPeriodLabel, shiftAnchor } from "../utils/period.js";

const OPTIONS = [
  { value: "week", label: "Semaine" },
  { value: "month", label: "Mois" },
  { value: "year", label: "Année" },
];

export default function PeriodSelector({ period, onPeriodChange, anchor, onAnchorChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <div className="period-selector">
        {OPTIONS.map((opt) => (
          <button
            key={opt.value}
            className={period === opt.value ? "active" : ""}
            onClick={() => onPeriodChange(opt.value)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="period-nav">
        <button className="icon-btn" onClick={() => onAnchorChange(shiftAnchor(period, anchor, -1))} type="button">
          ‹
        </button>
        <div className="period-nav__label">{formatPeriodLabel(period, anchor)}</div>
        <button className="icon-btn" onClick={() => onAnchorChange(shiftAnchor(period, anchor, 1))} type="button">
          ›
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onAnchorChange(new Date())} type="button">
          Aujourd'hui
        </button>
      </div>
    </div>
  );
}
