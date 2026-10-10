import { useState } from "react";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import Icon from "./Icon.jsx";
import { api } from "../api/client.js";
import { formatAmount, toInputDate } from "../utils/format.js";

// Remboursement direct entre deux membres (virement, especes...), qui vient
// reduire ce que l'un doit a l'autre sans etre rattache a une depense.
export default function SettlementModal({ users, initial, onClose, onSaved }) {
  const [fromUserId, setFromUserId] = useState(initial?.fromUserId || users[0]?.id || "");
  const [toUserId, setToUserId] = useState(initial?.toUserId || users[1]?.id || "");
  const [amount, setAmount] = useState(initial?.amount ? String(initial.amount) : "");
  const [date, setDate] = useState(toInputDate(new Date()));
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const numeric = Number(amount) || 0;
  const canSubmit = fromUserId && toUserId && fromUserId !== toUserId && numeric > 0;
  const options = users.map((u) => ({ value: u.id, label: u.name }));
  const fromName = users.find((u) => u.id === fromUserId)?.name;
  const toName = users.find((u) => u.id === toUserId)?.name;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/settlements", { fromUserId, toUserId, amount: numeric, date, note: note.trim() || null });
      onSaved(`Remboursement de ${formatAmount(numeric)} de ${fromName} à ${toName} enregistré.`);
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ce remboursement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Enregistrer un remboursement"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="settlement-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="settlement-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}
        <div className="notice">
          <Icon name="info" size={15} />
          <span>
            Un virement, des espèces… donnés directement à l'autre pour régler ce qu'on lui doit. Ce n'est rattaché à
            aucune dépense : ça vient simplement réduire le solde entre vous.
          </span>
        </div>
        <div className="field-row">
          <div className="field">
            <label>Qui rembourse ?</label>
            <Select value={fromUserId} onChange={setFromUserId} options={options} />
          </div>
          <div className="field">
            <label>À qui ?</label>
            <Select value={toUserId} onChange={setToUserId} options={options} />
          </div>
        </div>
        {fromUserId && fromUserId === toUserId && (
          <div className="form-error">Choisissez deux personnes différentes.</div>
        )}
        <div className="field-row">
          <div className="field">
            <label htmlFor="st-amount">Montant (€)</label>
            <input id="st-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="st-date">Date</label>
            <input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="st-note">Note (optionnel)</label>
          <input id="st-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ex : virement Lydia" />
        </div>
      </form>
    </Modal>
  );
}
