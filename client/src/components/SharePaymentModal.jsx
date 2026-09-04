import { useState } from "react";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import Avatar from "./Avatar.jsx";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount, formatDate } from "../utils/format.js";

export default function SharePaymentModal({ expense, share: initialShare, onClose, onChanged }) {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [share, setShare] = useState(initialShare);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  const isOwnShare = share.userId === user.id;
  const paidAmount = share.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, Math.round((share.amount - paidAmount) * 100) / 100);
  const ratio = share.amount > 0 ? Math.min(100, Math.round((paidAmount / share.amount) * 100)) : 0;

  function applyUpdatedShare(updated) {
    setShare(updated);
    onChanged();
  }

  async function addPayment(e) {
    e.preventDefault();
    const numeric = Number(amount);
    if (!numeric || numeric <= 0) return;
    setSaving(true);
    setError("");
    try {
      const { share: updated } = await api.post(`/expenses/${expense.id}/shares/${share.id}/payments`, {
        amount: numeric,
        note: note.trim() || null,
      });
      applyUpdatedShare(updated);
      setAmount("");
      setNote("");
      showToast(
        updated.paid ? "Part entièrement réglée." : `Versement de ${formatAmount(numeric)} enregistré.`
      );
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ce versement.");
    } finally {
      setSaving(false);
    }
  }

  async function settleRemaining() {
    setSaving(true);
    setError("");
    try {
      const { share: updated } = await api.patch(`/expenses/${expense.id}/shares/${share.id}`, {
        paid: true,
      });
      applyUpdatedShare(updated);
      showToast("Part entièrement réglée.");
    } catch (err) {
      setError(err.message || "Impossible de solder cette part.");
    } finally {
      setSaving(false);
    }
  }

  async function cancelPayment(payment) {
    const ok = await confirmAction({
      title: "Annuler ce versement",
      message: `Annuler le versement de ${formatAmount(payment.amount)} du ${formatDate(payment.date)} ?`,
      confirmLabel: "Annuler le versement",
      danger: true,
    });
    if (!ok) return;
    setCancelingId(payment.id);
    try {
      const { share: updated } = await api.delete(
        `/expenses/${expense.id}/shares/${share.id}/payments/${payment.id}`
      );
      applyUpdatedShare(updated);
      showToast("Versement annulé.");
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <Modal
      title={isOwnShare ? `Paiement — ${expense.label}` : `Paiement — ${expense.label} (part de ${share.user.name})`}
      onClose={onClose}
      footer={<button className="btn btn--ghost" onClick={onClose}>Fermer</button>}
    >
      {!isOwnShare && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: "var(--color-text-muted)",
            background: "var(--color-primary-soft)",
            borderRadius: 9,
            padding: "8px 12px",
            marginBottom: 16,
          }}
        >
          <Avatar user={share.user} size="sm" />
          Vous réglez ici la part de <strong style={{ color: "var(--color-text)" }}>{share.user.name}</strong>.
          L'historique gardera la trace que c'est vous qui avez payé.
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div className="flex-between" style={{ marginBottom: 8, fontSize: 13.5 }}>
          <span className="text-muted">Réglé</span>
          <span style={{ fontWeight: 700 }}>
            {formatAmount(paidAmount)} <span className="text-muted" style={{ fontWeight: 500 }}>/ {formatAmount(share.amount)}</span>
          </span>
        </div>
        <div className="progress-bar">
          <div
            className="progress-bar__fill"
            style={{ width: `${ratio}%`, background: share.paid ? "var(--color-success)" : "var(--color-primary)" }}
          />
        </div>
        {remaining > 0 && (
          <div style={{ marginTop: 8, fontSize: 12.5 }} className="text-muted">
            Reste à payer : <strong style={{ color: "var(--color-text)" }}>{formatAmount(remaining)}</strong>
          </div>
        )}
      </div>

      {error && <div className="form-error">{error}</div>}

      {remaining > 0 && (
        <form onSubmit={addPayment} style={{ marginBottom: 22 }}>
          <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: 6 }}>
            Ajouter un versement
          </label>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="number"
              min="0.01"
              step="0.01"
              max={remaining}
              placeholder={`Ex: ${remaining.toFixed(2)}`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              style={{
                flex: 1,
                border: "1px solid var(--color-border-strong)",
                borderRadius: 9,
                padding: "9px 12px",
                fontSize: 14,
                background: "var(--color-surface)",
                color: "var(--color-text)",
              }}
            />
            <button className="btn btn--primary" type="submit" disabled={saving || !amount}>
              Ajouter
            </button>
          </div>
          <input
            type="text"
            placeholder="Note (optionnel)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{
              width: "100%",
              border: "1px solid var(--color-border-strong)",
              borderRadius: 9,
              padding: "8px 12px",
              fontSize: 13,
              background: "var(--color-surface)",
              color: "var(--color-text)",
              marginBottom: 10,
            }}
          />
          <button
            type="button"
            className="btn btn--ghost btn--sm btn--full"
            onClick={settleRemaining}
            disabled={saving}
          >
            Solder le reste en une fois ({formatAmount(remaining)})
          </button>
        </form>
      )}

      <div>
        <label style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-text-muted)", display: "block", marginBottom: 8 }}>
          Historique des versements
        </label>
        {share.payments.length === 0 ? (
          <div className="empty-state" style={{ padding: "20px 0" }}>
            <Icon name="coins" size={22} />
            <span>Aucun versement enregistré pour l'instant.</span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {share.payments.map((p) => {
              const paidForSomeoneElse = p.paidBy.id !== share.userId;
              return (
                <div
                  key={p.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "9px 12px",
                    border: "1px solid var(--color-border)",
                    borderRadius: 9,
                    background: "var(--color-surface-2)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                    <Avatar user={p.paidBy} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 13.5 }}>{formatAmount(p.amount)}</div>
                      <div className="text-muted" style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {formatDate(p.date)}
                        {paidForSomeoneElse ? ` · payé par ${p.paidBy.name}` : ""}
                        {p.note ? ` · ${p.note}` : ""}
                      </div>
                    </div>
                  </div>
                  <button
                    className="icon-btn icon-btn--danger"
                    title="Annuler ce versement"
                    onClick={() => cancelPayment(p)}
                    disabled={cancelingId === p.id}
                    style={{ flexShrink: 0 }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
