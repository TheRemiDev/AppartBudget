import { createContext, useCallback, useContext, useRef, useState } from "react";
import Modal from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";

const UIContext = createContext(null);

// Fournit des remplacements "maison" pour window.confirm / window.alert :
// des popups navigateur non stylables et bloquantes, remplacees par une
// boite de dialogue et des notifications integrees au design de l'app.
export function UIProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const toastId = useRef(0);

  const showToast = useCallback((message, type = "success") => {
    const id = ++toastId.current;
    setToasts((list) => [...list, { id, message, type }]);
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const confirmAction = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmState({
        title: options.title || "Confirmer",
        message: options.message || "",
        confirmLabel: options.confirmLabel || "Confirmer",
        cancelLabel: options.cancelLabel || "Annuler",
        danger: Boolean(options.danger),
        resolve,
      });
    });
  }, []);

  function settle(result) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }

  return (
    <UIContext.Provider value={{ showToast, confirmAction }}>
      {children}

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.type}`} onClick={() => dismissToast(t.id)}>
            <Icon name={t.type === "error" ? "x" : "checkCircle"} size={16} />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {confirmState && (
        <Modal
          title={confirmState.title}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn btn--ghost" type="button" onClick={() => settle(false)}>
                {confirmState.cancelLabel}
              </button>
              <button
                className={`btn ${confirmState.danger ? "btn--danger-solid" : "btn--primary"}`}
                type="button"
                onClick={() => settle(true)}
                autoFocus
              >
                {confirmState.confirmLabel}
              </button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: "var(--color-text-muted)", lineHeight: 1.55, margin: 0 }}>
            {confirmState.message}
          </p>
        </Modal>
      )}
    </UIContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useToast doit etre utilise dans UIProvider");
  return ctx.showToast;
}

export function useConfirm() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useConfirm doit etre utilise dans UIProvider");
  return ctx.confirmAction;
}
