import Icon from "./Icon.jsx";

// Choix exclusif presente en petites cartes (icone + titre + explication),
// pour les decisions qui meritent une phrase d'aide plutot qu'un simple
// libelle (ex: frequence d'une depense).
export default function ChoiceCards({ value, onChange, options, compact }) {
  return (
    <div className={`choice-cards${compact ? " choice-cards--compact" : ""}`} role="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`choice-card${active ? " choice-card--active" : ""}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && (
              <span className="choice-card__icon">
                <Icon name={opt.icon} size={16} />
              </span>
            )}
            <span className="choice-card__text">
              <span className="choice-card__label">{opt.label}</span>
              {opt.hint && !compact && <span className="choice-card__hint">{opt.hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
