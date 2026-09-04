import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import Modal from "../components/Modal.jsx";
import Select from "../components/Select.jsx";
import SplitEditor, { buildDefaultSplitValue, isSplitValid } from "../components/SplitEditor.jsx";
import Icon from "../components/Icon.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount, toInputDate } from "../utils/format.js";

export default function Installments() {
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [plans, setPlans] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  async function load() {
    setLoading(true);
    const [p, c, u] = await Promise.all([
      api.get("/installment-plans"),
      api.get("/categories"),
      api.get("/users"),
    ]);
    setPlans(p.plans);
    setCategories(c.categories);
    setUsers(u.users);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function remove(plan) {
    const ok = await confirmAction({
      title: "Supprimer cet achat échelonné",
      message: `Supprimer définitivement "${plan.label}" et ses ${plan.installmentCount} mensualités ? Cela supprime aussi l'historique des mensualités déjà réglées. Pour n'annuler que les mensualités à venir, supprimez-les individuellement depuis la page Dépenses.`,
      confirmLabel: "Supprimer tout",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/installment-plans/${plan.id}`);
    showToast(`"${plan.label}" supprimé.`);
    load();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Achats échelonnés</h1>
          <div className="topbar__subtitle">
            Un achat payé en plusieurs mensualités fixes (ex: financement sur 4 mois)
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={15} /> Nouvel achat échelonné
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : plans.length === 0 ? (
          <div className="empty-state">
            <Icon name="creditCard" size={26} />
            <span>Aucun achat échelonné. Ajoutez un financement, un achat en plusieurs fois...</span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Achat</th>
                <th>Catégorie</th>
                <th>Montant total</th>
                <th>Mensualité</th>
                <th>Progression</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const ratio = p.totalAmount > 0 ? Math.min(100, Math.round((p.paidAmount / p.totalAmount) * 100)) : 0;
                const monthly = p.totalAmount / p.installmentCount;
                return (
                  <tr key={p.id}>
                    <td style={{ fontWeight: 600 }}>{p.label}</td>
                    <td>
                      <span className="pill" style={{ background: `${p.category.color}22`, color: p.category.color }}>
                        {p.category.icon} {p.category.name}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{formatAmount(p.totalAmount)}</td>
                    <td className="text-muted">
                      {formatAmount(monthly)} × {p.installmentCount}
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <div className="progress-bar">
                        <div className="progress-bar__fill" style={{ width: `${ratio}%`, background: "var(--color-info)" }} />
                      </div>
                      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                        {p.paidInstallments} / {p.installmentCount} réglées · {formatAmount(p.remainingAmount)} restant
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <div className="row-actions">
                        <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => remove(p)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <InstallmentPlanModal
          categories={categories}
          users={users}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            showToast("Achat échelonné créé.");
            load();
          }}
        />
      )}
    </div>
  );
}

function InstallmentPlanModal({ categories, users, onClose, onSaved }) {
  const [label, setLabel] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [installmentCount, setInstallmentCount] = useState(4);
  const [startDate, setStartDate] = useState(toInputDate(new Date()));
  const [categoryId, setCategoryId] = useState(categories[0]?.id || "");
  const [split, setSplit] = useState(buildDefaultSplitValue(users));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericTotal = Number(totalAmount) || 0;
  const numericCount = Number(installmentCount) || 0;
  const monthlyAmount = numericCount > 0 ? numericTotal / numericCount : 0;
  const canSubmit =
    label.trim() &&
    numericTotal > 0 &&
    numericCount >= 2 &&
    categoryId &&
    startDate &&
    isSplitValid(split, monthlyAmount);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      await api.post("/installment-plans", {
        label: label.trim(),
        totalAmount: numericTotal,
        installmentCount: numericCount,
        startDate,
        categoryId,
        splitType: split.splitType,
        participantIds: split.participantIds,
        splitConfig: split.splitType === "equal" ? [] : split.splitConfig,
      });
      onSaved();
    } catch (err) {
      setError(err.message || "Impossible de créer cet achat échelonné.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title="Nouvel achat échelonné"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="installment-form" disabled={!canSubmit || saving}>
            {saving ? "Création..." : "Créer"}
          </button>
        </>
      }
    >
      <form id="installment-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="i-label">Libellé</label>
          <input
            id="i-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Lave-linge (Cofidis)"
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="i-total">Montant total (€)</label>
            <input
              id="i-total"
              type="number"
              min="0.01"
              step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="i-count">Nombre de mensualités</label>
            <input
              id="i-count"
              type="number"
              min="2"
              max="60"
              value={installmentCount}
              onChange={(e) => setInstallmentCount(e.target.value)}
              required
            />
          </div>
        </div>

        {numericCount >= 2 && numericTotal > 0 && (
          <div className="text-muted" style={{ fontSize: 12.5, marginTop: -10, marginBottom: 16 }}>
            Soit {formatAmount(monthlyAmount)} par mois pendant {numericCount} mois.
          </div>
        )}

        <div className="field-row">
          <div className="field">
            <label htmlFor="i-start">Première mensualité le</label>
            <input id="i-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="i-category">Catégorie</label>
            <Select
              id="i-category"
              value={categoryId}
              onChange={setCategoryId}
              options={categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
              placeholder="Choisir une catégorie"
            />
          </div>
        </div>

        <div className="field">
          <label>Répartition entre le foyer (par mensualité)</label>
          <SplitEditor users={users} amount={monthlyAmount} value={split} onChange={setSplit} />
        </div>
      </form>
    </Modal>
  );
}
