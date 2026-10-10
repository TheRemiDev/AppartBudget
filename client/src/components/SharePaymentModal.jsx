import { useState } from "react";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import Avatar from "./Avatar.jsx";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount, formatDate, toInputDate } from "../utils/format.js";

export default function SharePaymentModal({ expense, share: initialShare, onClose, onChanged }) {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [share, setShare] = useState(initialShare);
  const [showPartial, setShowPartial] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(toInputDate(new Date()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cancelingId, setCancelingId] = useState(null);

  const isOwnShare = share.userId === user.id;
  const ownerName = isOwnShare ? "votre part" : `la part de ${share.user.name}`;
  const paidAmount = share.payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, Math.round((share.amount - paidAmount) * 100) / 100);
  const ratio = share.amount > 0 ? Math.min(100, Math.round((paidAmount / share.amount) * 100)) : 0;

  function applyUpdatedShare(updated) {
    setShare(updated);
    onChanged();
  }

  async function recordPayment(value, { withDetails }) {
    setSaving(true);
    setError("");
    try {
      const { share: updated } = await api.post(`/expenses/${expense.id}/shares/${share.id}/payments`, {
        amount: value,
        note: withDetails ? note.trim() || null : null,
        date: withDetails ? date : undefined,
      });
      applyUpdatedShare(updated);
      setAmount("");
      setNote("");
      setShowPartial(false);
      showToast(
        updated.paid
          ? `${isOwnShare ? "Votre part" : `La part de ${share.user.name}`} de « ${expense.label} » est entièrement payée.`
          : `Paiement de ${formatAmount(value)} enregistré.`
      );
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ce paiement.");
    } finally {
      setSaving(false);
    }
  }

  function submitPartial(e) {
    e.preventDefault();
    const numeric = Number(amount);
    if (!numeric || numeric <= 0) return;
    recordPayment(numeric, { withDetails: true });
  }

  async function cancelPayment(payment) {
    const ok = await confirmAction({
      title: "Annuler ce paiement",
      message: `Annuler le paiement de ${formatAmount(payment.amount)} fait par ${payment.paidBy.name} le ${formatDate(payment.date)} ? Ce montant redeviendra « à payer ».`,
      confirmLabel: "Annuler le paiement",
      cancelLabel: "Garder",
      danger: true,
    });
    if (!ok) return;
    setCancelingId(payment.id);
    try {
      const { share: updated } = await api.delete(`/expenses/${expense.id}/shares/${share.id}/payments/${payment.id}`);
      applyUpdatedShare(updated);
      showToast("Paiement annulé.");
    } finally {
      setCancelingId(null);
    }
  }

  return (
    <Modal
      title={`${expense.label} — ${isOwnShare ? "votre part" : `part de ${share.user.name}`}`}
      onClose={onClose}
      footer={<button className="btn btn--ghost" onClick={onClose}>Fermer</button>}
    >
      {!isOwnShare && (
        <div className="notice">
          <Avatar user={share.user} size="sm" />
          <span>
            {remaining > 0 ? (
              <>
                Vous payez ici <strong>à la place de {share.user.name}</strong>. Le paiement sera noté à votre nom :{" "}
                {share.user.name} vous devra ce montant (visible dans « Entre vous » sur le tableau de bord).
              </>
            ) : (
              <>
                Ceci est la part de <strong>{share.user.name}</strong>. Vous pouvez corriger ou annuler ses
                paiements ci-dessous si besoin.
              </>
            )}
          </span>
        </div>
      )}

      <div className="payment-summary">
        <div className="payment-summary__row">
          <span className="text-muted">Montant de {ownerName}</span>
          <strong>{formatAmount(share.amount)}</strong>
        </div>
        <div className="progress-bar" style={{ margin: "10px 0 8px" }}>
          <div
            className="progress-bar__fill"
            style={{ width: `${ratio}%`, background: share.paid ? "var(--color-success)" : "var(--color-primary)" }}
          />
        </div>
        <div className="payment-summary__row" style={{ fontSize: 13 }}>
          <span className="text-muted">Déjà payé : {formatAmount(paidAmount)}</span>
          {remaining > 0 ? (
            <span style={{ fontWeight: 700, color: "var(--color-danger)" }}>Reste à payer : {formatAmount(remaining)}</span>
          ) : (
            <span style={{ fontWeight: 700, color: "var(--color-success)", display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="checkCircle" size={14} /> Entièrement payé
            </span>
          )}
        </div>
      </div>

      {error && <div className="form-error">{error}</div>}

      {remaining > 0 && (
        <div style={{ marginBottom: 22 }}>
          <button
            type="button"
            className="btn btn--primary btn--full"
            onClick={() => recordPayment(remaining, { withDetails: false })}
            disabled={saving}
          >
            <Icon name="check" size={15} />
            {isOwnShare ? `J'ai payé les ${formatAmount(remaining)}` : `Payer les ${formatAmount(remaining)} pour ${share.user.name}`}
          </button>

          {!showPartial ? (
            <button type="button" className="link-btn" style={{ marginTop: 10 }} onClick={() => setShowPartial(true)}>
              Payer seulement une partie, ou à une autre date…
            </button>
          ) : (
            <form onSubmit={submitPartial} className="partial-payment">
              <div className="field-row">
                <div className="field">
                  <label htmlFor="pay-amount">Montant payé (€)</label>
                  <input
                    id="pay-amount"
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="0.01"
                    max={remaining}
                    placeholder={`max ${remaining.toFixed(2)}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="field">
                  <label htmlFor="pay-date">Payé le</label>
                  <input id="pay-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="pay-note">Note (optionnel)</label>
                <input id="pay-note" type="text" placeholder="Ex : virement, espèces…" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowPartial(false)}>
                  Annuler
                </button>
                <button className="btn btn--primary btn--sm" type="submit" disabled={saving || !amount}>
                  Enregistrer ce paiement
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      <div>
        <div className="section-label">Paiements enregistrés</div>
        {share.payments.length === 0 ? (
          <div className="text-muted" style={{ fontSize: 13, padding: "6px 0 2px" }}>
            Aucun paiement enregistré pour l'instant.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {share.payments.map((p) => (
              <div key={p.id} className="payment-line">
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar user={p.paidBy} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{formatAmount(p.amount)}</div>
                    <div className="text-muted" style={{ fontSize: 12 }}>
                      {formatDate(p.date)} · payé par {p.paidBy.id === user.id ? "vous" : p.paidBy.name}
                      {p.note ? ` · ${p.note}` : ""}
                    </div>
                  </div>
                </div>
                <button
                  className="icon-btn icon-btn--danger"
                  title="Annuler ce paiement"
                  onClick={() => cancelPayment(p)}
                  disabled={cancelingId === p.id}
                  style={{ flexShrink: 0 }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
