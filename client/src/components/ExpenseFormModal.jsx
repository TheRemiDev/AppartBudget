import { useState } from "react";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import SplitEditor, { buildDefaultSplitValue, isSplitValid } from "./SplitEditor.jsx";
import { api } from "../api/client.js";
import { toInputDate } from "../utils/format.js";

const KIND_OPTIONS = [
  { value: "fixed", label: "Frais fixe" },
  { value: "exceptional", label: "Frais exceptionnel" },
];

export default function ExpenseFormModal({ categories, users, expense, onClose, onSaved }) {
  const isEdit = Boolean(expense);
  const [label, setLabel] = useState(expense?.label || "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [date, setDate] = useState(expense ? toInputDate(expense.date) : toInputDate(new Date()));
  const [kind, setKind] = useState(expense?.kind || "exceptional");
  const [categoryId, setCategoryId] = useState(expense?.categoryId || categories[0]?.id || "");
  const [notes, setNotes] = useState(expense?.notes || "");
  const [split, setSplit] = useState(
    expense
      ? {
          splitType: guessSplitType(expense.shares),
          participantIds: expense.shares.map((s) => s.userId),
          splitConfig: expense.shares.map((s) => ({ userId: s.userId, value: s.amount })),
        }
      : buildDefaultSplitValue(users)
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const canSubmit =
    label.trim() && numericAmount > 0 && categoryId && date && isSplitValid(split, numericAmount);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        label: label.trim(),
        amount: numericAmount,
        date,
        kind,
        categoryId,
        notes: notes.trim() || null,
        splitType: split.splitType,
        participantIds: split.participantIds,
        splitConfig: split.splitType === "equal" ? [] : split.splitConfig,
      };
      if (isEdit) {
        await api.put(`/expenses/${expense.id}`, payload);
      } else {
        await api.post("/expenses", payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer la dépense.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Modifier la dépense" : "Nouvelle dépense"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="expense-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="label">Libellé</label>
          <input id="label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Courses Carrefour" required />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="amount">Montant (€)</label>
            <input
              id="amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="kind">Type</label>
            <Select id="kind" value={kind} onChange={setKind} options={KIND_OPTIONS} />
          </div>
          <div className="field">
            <label htmlFor="category">Catégorie</label>
            <Select
              id="category"
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
              placeholder="Choisir une catégorie"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes (optionnel)</label>
          <textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div className="field">
          <label>Répartition entre le foyer</label>
          <SplitEditor users={users} amount={numericAmount} value={split} onChange={setSplit} />
        </div>
      </form>
    </Modal>
  );
}

function guessSplitType(shares) {
  if (!shares?.length) return "equal";
  const amounts = shares.map((s) => s.amount);
  const equal = amounts.every((a) => Math.abs(a - amounts[0]) < 0.02);
  return equal ? "equal" : "custom";
}
