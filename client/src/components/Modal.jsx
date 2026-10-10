import { useEffect, useRef } from "react";
import Icon from "./Icon.jsx";

// Pile des modales ouvertes : Echap ne ferme que celle du dessus (ex: la
// confirmation d'annulation, sans fermer la fenetre de paiement dessous).
const openStack = [];

export default function Modal({ title, onClose, children, footer, wide }) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const entry = () => closeRef.current();
    openStack.push(entry);
    function onKey(e) {
      if (e.key === "Escape" && openStack[openStack.length - 1] === entry) entry();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      openStack.splice(openStack.indexOf(entry), 1);
    };
  }, []);

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" style={wide ? { maxWidth: 600 } : undefined} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Fermer">
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}
