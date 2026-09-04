import { formatPeriodLabel, shiftAnchor } from "../utils/period.js";
import Icon from "./Icon.jsx";

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
        <button className="icon-btn" onClick={() => onAnchorChange(shiftAnchor(period, anchor, -1))} type="button" aria-label="Periode precedente">
          <Icon name="chevronLeft" size={16} />
        </button>
        <div className="period-nav__label">{formatPeriodLabel(period, anchor)}</div>
        <button className="icon-btn" onClick={() => onAnchorChange(shiftAnchor(period, anchor, 1))} type="button" aria-label="Periode suivante">
          <Icon name="chevronRight" size={16} />
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => onAnchorChange(new Date())} type="button">
          Aujourd'hui
        </button>
      </div>
    </div>
  );
}
