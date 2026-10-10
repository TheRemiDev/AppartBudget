import { useState } from "react";
import { Link } from "react-router-dom";
import Modal from "./Modal.jsx";
import Select from "./Select.jsx";
import Icon from "./Icon.jsx";
import ChoiceCards from "./ChoiceCards.jsx";
import SplitEditor, { buildDefaultSplitValue, isSplitValid } from "./SplitEditor.jsx";
import { api } from "../api/client.js";
import { formatAmount, formatDate, toInputDate } from "../utils/format.js";
import { KIND_OPTIONS } from "../utils/kind.js";
import { nextOccurrenceDate } from "../utils/period.js";

const MODES = [
  { value: "once", label: "Une seule fois", hint: "Courses, facture, achat payé en une fois", icon: "receipt" },
  { value: "monthly", label: "Chaque mois", hint: "Loyer, internet, abonnement… sans date de fin", icon: "repeat" },
  { value: "installments", label: "En plusieurs fois", hint: "Achat financé sur un nombre de mois connu", icon: "creditCard" },
];

/**
 * Point d'entree unique pour ajouter une depense du foyer, quelle que soit
 * sa frequence (une fois, chaque mois, en plusieurs mensualites). Sert aussi
 * a modifier une depense existante (`expense`) ou une charge recurrente
 * (`template`). onSaved(message) recoit un message de confirmation adapte.
 */
export default function ExpenseFormModal({ categories, users, expense, template, initialMode = "once", onClose, onSaved }) {
  const isEdit = Boolean(expense || template);
  const [mode, setMode] = useState(template ? "monthly" : expense ? "once" : initialMode);

  const [label, setLabel] = useState(expense?.label || template?.label || "");
  const [categoryId, setCategoryId] = useState(expense?.categoryId || template?.categoryId || "");
  const [kind, setKind] = useState(expense?.kind || "occasional");
  const [kindTouched, setKindTouched] = useState(isEdit);
  const [amount, setAmount] = useState(expense?.amount ?? template?.amount ?? "");
  const [date, setDate] = useState(expense ? toInputDate(expense.date) : toInputDate(new Date()));
  const [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? Math.min(new Date().getDate(), 28));
  const [installmentCount, setInstallmentCount] = useState(4);
  const [sameAsFirst, setSameAsFirst] = useState(true);
  const [restAmount, setRestAmount] = useState("");
  const [notes, setNotes] = useState(expense?.notes || "");
  const [split, setSplit] = useState(() => {
    if (expense) {
      const amounts = expense.shares.map((s) => s.amount);
      const equal = amounts.every((a) => Math.abs(a - amounts[0]) < 0.02);
      return {
        splitType: equal ? "equal" : "custom",
        participantIds: expense.shares.map((s) => s.userId),
        splitConfig: equal ? [] : expense.shares.map((s) => ({ userId: s.userId, value: s.amount })),
      };
    }
    if (template) {
      return {
        splitType: template.splitType,
        participantIds: template.splitConfig.map((c) => c.userId),
        splitConfig: template.splitType === "equal" ? [] : template.splitConfig,
      };
    }
    return buildDefaultSplitValue(users);
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Une categorie archivee reste selectionnable pour la depense qui l'utilise deja.
  const categoryOptions = [...categories];
  const ownCategory = expense?.category || template?.category;
  if (ownCategory && !categoryOptions.some((c) => c.id === ownCategory.id)) categoryOptions.push(ownCategory);

  const numericAmount = Number(amount) || 0;
  const numericCount = Number(installmentCount) || 0;
  const numericRest = sameAsFirst ? numericAmount : Number(restAmount) || 0;
  const splitBase = mode === "installments" ? numericRest : numericAmount;
  const installmentsTotal = numericAmount + numericRest * Math.max(numericCount - 1, 0);

  const missing = [];
  if (!label.trim()) missing.push("un libellé");
  if (!categoryId) missing.push("une catégorie");
  if (numericAmount <= 0) missing.push("un montant");
  if (mode === "installments" && numericCount < 2) missing.push("au moins 2 mensualités");
  if (mode === "installments" && !sameAsFirst && numericRest <= 0) missing.push("le montant des mensualités suivantes");
  if (mode === "monthly" && !(Number(dayOfMonth) >= 1 && Number(dayOfMonth) <= 28)) missing.push("un jour entre 1 et 28");
  if (numericAmount > 0 && !isSplitValid(split, splitBase)) missing.push("une répartition complète");
  const canSubmit = missing.length === 0;

  function pickCategory(id) {
    const previous = categoryOptions.find((c) => c.id === categoryId);
    const next = categoryOptions.find((c) => c.id === id);
    setCategoryId(id);
    if (!next || isEdit) return;
    if (!kindTouched) setKind(next.kind);
    // Ne remplace que ce qui a ete pre-rempli automatiquement, jamais un
    // montant saisi a la main.
    const amountIsPreviousDefault = previous?.defaultAmount && numericAmount === previous.defaultAmount;
    if (amount === "" || amountIsPreviousDefault) setAmount(next.defaultAmount ? String(next.defaultAmount) : "");
  }

  const splitPayload = {
    splitType: split.splitType,
    participantIds: split.participantIds,
    splitConfig: split.splitType === "equal" ? [] : split.splitConfig,
  };

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      if (mode === "once") {
        const payload = {
          label: label.trim(),
          amount: numericAmount,
          date,
          kind,
          categoryId,
          notes: notes.trim() || null,
          ...splitPayload,
        };
        if (expense) {
          await api.put(`/expenses/${expense.id}`, payload);
          onSaved("Dépense modifiée.");
        } else {
          await api.post("/expenses", payload);
          onSaved(`« ${payload.label} » ajoutée aux dépenses.`);
        }
      } else if (mode === "monthly") {
        const payload = {
          label: label.trim(),
          amount: numericAmount,
          categoryId,
          dayOfMonth: Number(dayOfMonth),
          ...splitPayload,
          active: template?.active ?? true,
        };
        if (template) {
          const res = await api.put(`/recurring-templates/${template.id}`, payload);
          const { updated = 0, locked = 0 } = res.occurrences || {};
          onSaved(
            `Charge modifiée.${updated ? ` ${updated} échéance(s) à venir mise(s) à jour.` : ""}${
              locked ? ` ${locked} échéance(s) déjà en partie payée(s) laissée(s) telle(s) quelle(s).` : ""
            }`
          );
        } else {
          await api.post("/recurring-templates", payload);
          onSaved(`« ${payload.label} » ajoutée : les prochains mois apparaissent déjà dans les dépenses.`);
        }
      } else {
        await api.post("/installment-plans", {
          label: label.trim(),
          firstInstallmentAmount: numericAmount,
          restInstallmentAmount: numericRest,
          installmentCount: numericCount,
          startDate: date,
          categoryId,
          ...splitPayload,
        });
        onSaved(`« ${label.trim()} » créé : ${numericCount} mensualités ajoutées aux dépenses.`);
      }
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  const title = template ? "Modifier la charge récurrente" : expense ? "Modifier la dépense" : "Nouvelle dépense";
  const submitLabel = isEdit
    ? "Enregistrer"
    : mode === "monthly"
    ? "Créer la charge mensuelle"
    : mode === "installments"
    ? "Créer l'achat échelonné"
    : "Ajouter la dépense";
  const nextDate = mode === "monthly" ? nextOccurrenceDate(Number(dayOfMonth) || 1) : null;
  const hasPayments = expense?.shares.some((s) => s.payments?.length > 0);

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          {!canSubmit && (
            <span className="modal__footer-hint">Il manque {missing.join(", ")}.</span>
          )}
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="expense-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : submitLabel}
          </button>
        </>
      }
    >
      <form id="expense-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        {!isEdit && (
          <div className="field">
            <label>Comment se paie cette dépense ?</label>
            <ChoiceCards value={mode} onChange={setMode} options={MODES} />
          </div>
        )}

        {expense?.template && (
          <div className="notice">
            <Icon name="repeat" size={15} />
            <span>
              Créée automatiquement par la charge mensuelle <strong>« {expense.template.label} »</strong>. Vos
              modifications ne concernent que l'échéance du {formatDate(expense.date)}. Pour changer tous les mois
              à venir, modifiez la charge dans{" "}
              <Link to="/recurrentes" onClick={onClose}>
                Charges récurrentes
              </Link>
              .
            </span>
          </div>
        )}
        {expense?.installmentPlan && (
          <div className="notice">
            <Icon name="creditCard" size={15} />
            <span>
              Mensualité {expense.installmentIndex}/{expense.installmentPlan.installmentCount} de l'achat échelonné{" "}
              <strong>« {expense.installmentPlan.label} »</strong>. Vos modifications ne concernent que cette
              mensualité.
            </span>
          </div>
        )}
        {template && (
          <div className="notice">
            <Icon name="info" size={15} />
            <span>
              Les changements s'appliquent aussi aux échéances à venir déjà créées (sauf celles où un paiement a déjà
              été enregistré). Les mois passés ne bougent pas.
            </span>
          </div>
        )}

        <div className="field">
          <label htmlFor="exp-label">Libellé</label>
          <input
            id="exp-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={mode === "monthly" ? "Ex : Loyer, Box internet" : mode === "installments" ? "Ex : Lave-linge (4x sans frais)" : "Ex : Courses Carrefour"}
            autoFocus={!isEdit}
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="exp-category">Catégorie</label>
            <Select
              id="exp-category"
              value={categoryId}
              onChange={pickCategory}
              options={categoryOptions.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
              placeholder="Choisir une catégorie"
            />
          </div>
          {mode === "once" ? (
            <div className="field">
              <label htmlFor="exp-kind">Type de frais</label>
              <Select
                id="exp-kind"
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setKindTouched(true);
                }}
                options={KIND_OPTIONS}
              />
            </div>
          ) : (
            <div className="field">
              <label>Type de frais</label>
              <div className="field-static">Frais fixe</div>
            </div>
          )}
        </div>

        {mode === "once" && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="exp-amount">Montant total (€)</label>
              <input id="exp-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div className="field">
              <label htmlFor="exp-date">Date</label>
              <input id="exp-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>
        )}

        {mode === "monthly" && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="exp-amount">Montant chaque mois (€)</label>
                <input id="exp-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="exp-day">Prélevé le … du mois</label>
                <input id="exp-day" type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} required />
              </div>
            </div>
            {!template && nextDate && (
              <div className="field-help">
                <Icon name="calendar" size={13} /> Première échéance le {formatDate(nextDate)}. Les 3 prochains mois
                sont ajoutés tout de suite aux dépenses, puis un nouveau mois chaque mois, automatiquement.
              </div>
            )}
          </>
        )}

        {mode === "installments" && (
          <>
            <div className="field-row">
              <div className="field">
                <label htmlFor="exp-amount">Montant de la 1ʳᵉ mensualité (€)</label>
                <input id="exp-amount" type="number" inputMode="decimal" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div className="field">
                <label htmlFor="exp-count">Nombre de mensualités</label>
                <input id="exp-count" type="number" min="2" max="60" value={installmentCount} onChange={(e) => setInstallmentCount(e.target.value)} required />
              </div>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" checked={sameAsFirst} onChange={(e) => setSameAsFirst(e.target.checked)} />
              Toutes les mensualités ont le même montant
            </label>
            {!sameAsFirst && (
              <div className="field">
                <label htmlFor="exp-rest">Montant des mensualités suivantes (€)</label>
                <input id="exp-rest" type="number" inputMode="decimal" min="0.01" step="0.01" value={restAmount} onChange={(e) => setRestAmount(e.target.value)} required />
              </div>
            )}
            <div className="field">
              <label htmlFor="exp-start">Première mensualité le</label>
              <input id="exp-start" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            {numericCount >= 2 && numericAmount > 0 && numericRest > 0 && (
              <div className="field-help">
                <Icon name="info" size={13} />
                {sameAsFirst
                  ? `${numericCount} × ${formatAmount(numericAmount)}, soit ${formatAmount(installmentsTotal)} au total.`
                  : `${formatAmount(numericAmount)} puis ${numericCount - 1} × ${formatAmount(numericRest)}, soit ${formatAmount(installmentsTotal)} au total.`}{" "}
                Chaque mensualité apparaîtra dans les dépenses de son mois.
              </div>
            )}
          </>
        )}

        {mode === "once" && (
          <div className="field">
            <label htmlFor="exp-notes">Note (optionnel)</label>
            <textarea id="exp-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex : ticket dans le tiroir, magasin…" />
          </div>
        )}

        <div className="field" style={{ marginBottom: 0 }}>
          <label>
            Qui paie quoi ?{" "}
            {mode === "installments" && <span className="text-muted" style={{ fontWeight: 500 }}>(sur chaque mensualité)</span>}
            {mode === "monthly" && <span className="text-muted" style={{ fontWeight: 500 }}>(chaque mois)</span>}
          </label>
          <SplitEditor users={users} amount={splitBase} value={split} onChange={setSplit} />
          {hasPayments && (
            <div className="field-help">
              <Icon name="info" size={13} /> Des paiements sont déjà enregistrés sur cette dépense : la part d'une
              personne ne peut pas descendre sous ce qu'elle a déjà payé.
            </div>
          )}
        </div>
      </form>
    </Modal>
  );
}
