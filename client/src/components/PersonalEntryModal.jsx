import { useState } from "react";
import Modal from "./Modal.jsx";
import Icon from "./Icon.jsx";
import ChoiceCards from "./ChoiceCards.jsx";
import { api } from "../api/client.js";
import { formatAmount, formatDate, toInputDate } from "../utils/format.js";
import { nextOccurrenceDate } from "../utils/period.js";

const KINDS = [
  { value: "expense", label: "Une dépense", icon: "shoppingBag" },
  { value: "income", label: "Un revenu", icon: "wallet" },
];

function frequencyOptions(kind) {
  return [
    { value: "once", label: "Une seule fois", icon: "receipt", hint: kind === "income" ? "Prime, remboursement…" : "Vêtements, cadeau…" },
    { value: "monthly", label: "Chaque mois", icon: "repeat", hint: kind === "income" ? "Salaire, aide…" : "Forfait téléphone, abonnement…" },
    kind === "income"
      ? { value: "months", label: "Sur quelques mois", icon: "calendar", hint: "Revenu sur une durée connue" }
      : { value: "months", label: "En plusieurs fois", icon: "creditCard", hint: "Achat payé en mensualités" },
  ];
}

/**
 * Ajout/modification d'une ligne du budget personnel. Un seul formulaire
 * pour tous les cas : depense ou revenu, une fois / chaque mois (sans fin) /
 * sur un nombre de mois connu. `transaction` ou `template` pour modifier.
 */
export default function PersonalEntryModal({ transaction, template, onClose, onSaved }) {
  const isEdit = Boolean(transaction || template);
  const [kind, setKind] = useState(transaction?.kind || template?.kind || "expense");
  const [frequency, setFrequency] = useState(template ? "monthly" : "once");
  const [label, setLabel] = useState(transaction?.label || template?.label || "");
  const [amount, setAmount] = useState(transaction?.amount ?? template?.amount ?? "");
  const [date, setDate] = useState(transaction ? toInputDate(transaction.date) : toInputDate(new Date()));
  const [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? Math.min(new Date().getDate(), 28));
  const [months, setMonths] = useState(3);
  const [sameAsFirst, setSameAsFirst] = useState(true);
  const [laterAmount, setLaterAmount] = useState("");
  const [note, setNote] = useState(transaction?.note || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const numericMonths = Number(months) || 0;
  const isInstallmentExpense = frequency === "months" && kind === "expense";
  const numericLater = sameAsFirst ? numericAmount : Number(laterAmount) || 0;

  const missing = [];
  if (!label.trim()) missing.push("un libellé");
  if (numericAmount <= 0) missing.push("un montant");
  if (frequency === "months" && numericMonths < 2) missing.push("au moins 2 mois");
  if (isInstallmentExpense && !sameAsFirst && numericLater <= 0) missing.push("le montant des mensualités suivantes");
  if (frequency === "monthly" && !(Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 28)) missing.push("un jour entre 1 et 28");
  const canSubmit = missing.length === 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    const word = kind === "income" ? "Revenu" : "Dépense";
    try {
      if (transaction) {
        await api.put(`/personal/${transaction.id}`, { label: label.trim(), amount: numericAmount, kind, date, note: note.trim() || null });
        onSaved(`${word} modifié${kind === "income" ? "" : "e"}.`);
      } else if (frequency === "monthly") {
        const payload = { label: label.trim(), amount: numericAmount, kind, dayOfMonth: Number(dayOfMonth), active: template?.active ?? true };
        if (template) {
          const res = await api.put(`/personal-recurring/${template.id}`, payload);
          const updated = res.occurrences?.updated || 0;
          onSaved(`« ${payload.label} » modifié${updated ? `, ${updated} mois à venir mis à jour` : ""}.`);
        } else {
          await api.post("/personal-recurring", payload);
          onSaved(`« ${payload.label} » ajouté : il revient désormais chaque mois.`);
        }
      } else {
        const count = frequency === "months" ? numericMonths : 1;
        await api.post("/personal", {
          label: label.trim(),
          amount: numericAmount,
          laterAmount: isInstallmentExpense ? numericLater : undefined,
          kind,
          date,
          note: note.trim() || null,
          months: count,
        });
        onSaved(count > 1 ? `« ${label.trim()} » ajouté sur ${count} mois.` : `${word} ajouté${kind === "income" ? "" : "e"}.`);
      }
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  const title = template
    ? `Modifier ${kind === "income" ? "le revenu mensuel" : "l'abonnement"}`
    : transaction
    ? `Modifier ${kind === "income" ? "le revenu" : "la dépense"}`
    : "Ajouter à mon budget";

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {!canSubmit && <span className="modal__footer-hint">Il manque {missing.join(", ")}.</span>}
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="personal-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : isEdit ? "Enregistrer" : "Ajouter"}
          </button>
        </>
      }
    >
      <form id="personal-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label>C'est…</label>
          <ChoiceCards value={kind} onChange={setKind} options={KINDS} compact />
        </div>

        {!isEdit && (
          <div className="field">
            <label>À quelle fréquence ?</label>
            <ChoiceCards value={frequency} onChange={setFrequency} options={frequencyOptions(kind)} />
          </div>
        )}

        {template && (
          <div className="notice">
            <Icon name="info" size={15} />
            <span>Les changements s'appliquent aussi aux mois à venir déjà créés. Les mois passés ne bougent pas.</span>
          </div>
        )}
        {transaction?.recurringTemplateId && (
          <div className="notice">
            <Icon name="repeat" size={15} />
            <span>
              Cette ligne vient d'un élément « chaque mois ». La modifier ici ne change que ce mois-ci ; pour changer les
              mois suivants, modifiez-le dans la section « Chaque mois ».
            </span>
          </div>
        )}
        {transaction?.groupId && (
          <div className="notice">
            <Icon name="creditCard" size={15} />
            <span>
              Mensualité {transaction.installmentIndex}/{transaction.installmentCount} : la modifier ne change que celle-ci.
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="p-label">Libellé</label>
          <input
            id="p-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "income" ? "Ex : Salaire" : frequency === "monthly" ? "Ex : Forfait téléphone" : "Ex : Vêtements"}
            autoFocus={!isEdit}
            required
          />
        </div>

        {(frequency === "once" || transaction) && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="p-amount">Montant (€)</label>
              <input id="p-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="p-date">Date</label>
              <input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
        )}

        {frequency === "monthly" && !transaction && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="p-amount">Montant chaque mois (€)</label>
                <input id="p-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="p-day">{kind === "income" ? "Versé le … du mois" : "Prélevé le … du mois"}</label>
                <input id="p-day" type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} required />
              </div>
            </div>
            {!template && (
              <div className="field-help">
                <Icon name="calendar" size={13} /> Première fois le {formatDate(nextOccurrenceDate(Number(dayOfMonth) || 1))}, puis
                chaque mois sans date de fin (vous pourrez le mettre en pause).
              </div>
            )}
          </>
        )}

        {frequency === "months" && !isEdit && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="p-amount">{isInstallmentExpense ? "1ʳᵉ mensualité (€)" : "Montant par mois (€)"}</label>
                <input id="p-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="p-months">Nombre de mois</label>
                <input id="p-months" type="number" min="2" max="36" value={months} onChange={(e) => setMonths(e.target.value)} />
              </div>
            </div>
            {isInstallmentExpense && (
              <>
                <label className="checkbox-row">
                  <input type="checkbox" checked={sameAsFirst} onChange={(e) => setSameAsFirst(e.target.checked)} />
                  Toutes les mensualités ont le même montant
                </label>
                {!sameAsFirst && (
                  <div className="field">
                    <label htmlFor="p-later">Montant des mensualités suivantes (€)</label>
                    <input id="p-later" type="number" inputMode="decimal" min="0.01" step="0.01" value={laterAmount} onChange={(e) => setLaterAmount(e.target.value)} />
                  </div>
                )}
              </>
            )}
            <div className="field">
              <label htmlFor="p-date">{isInstallmentExpense ? "Première mensualité le" : "Premier versement le"}</label>
              <input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            {numericAmount > 0 && numericMonths >= 2 && (
              <div className="field-help">
                <Icon name="info" size={13} />
                {isInstallmentExpense && !sameAsFirst
                  ? `${formatAmount(numericAmount)} puis ${numericMonths - 1} × ${formatAmount(numericLater)}, soit ${formatAmount(numericAmount + numericLater * (numericMonths - 1))} au total.`
                  : `${numericMonths} × ${formatAmount(numericAmount)}, soit ${formatAmount(numericAmount * numericMonths)} au total.`}
              </div>
            )}
          </>
        )}

        {frequency !== "monthly" && (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="p-note">Note (optionnel)</label>
            <textarea id="p-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        )}
      </form>
    </Modal>
  );
}
