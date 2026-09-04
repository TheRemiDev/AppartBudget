import { useEffect, useRef, useState } from "react";
import Icon from "./Icon.jsx";

// Menu deroulant "maison", entierement stylable. Le <select> natif du
// navigateur rend sa liste d'options avec le theme du systeme d'exploitation
// (particulierement visible et disgracieux sous macOS en theme sombre), ce
// composant evite totalement ce probleme puisque tout le rendu est fait en
// HTML/CSS par l'application.
export default function Select({ id, value, onChange, options, placeholder = "Choisir...", disabled, style }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;

    function updatePosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    updatePosition();

    function handleClickOutside(e) {
      if (triggerRef.current?.contains(e.target) || panelRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    function handleKey(e) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  return (
    <div className="select" style={style}>
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={`select__trigger${open ? " select__trigger--open" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select__value">
          {selected ? (
            <>
              {selected.icon && <span className="select__icon">{selected.icon}</span>}
              {selected.label}
            </>
          ) : (
            <span className="text-muted">{placeholder}</span>
          )}
        </span>
        <Icon name="chevronDown" size={15} className="select__chevron" />
      </button>

      {open && coords && (
        <div
          ref={panelRef}
          className="select__panel"
          style={{ top: coords.top, left: coords.left, width: coords.width }}
        >
          {options.map((opt) => (
            <button
              type="button"
              key={opt.value}
              className={`select__option${opt.value === value ? " active" : ""}`}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
            >
              {opt.icon && <span className="select__icon">{opt.icon}</span>}
              <span style={{ flex: 1, textAlign: "left" }}>{opt.label}</span>
              {opt.value === value && <Icon name="check" size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
