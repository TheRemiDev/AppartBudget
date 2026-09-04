import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import Modal from "../components/Modal.jsx";
import Select from "../components/Select.jsx";
import SplitEditor, { buildDefaultSplitValue, isSplitValid } from "../components/SplitEditor.jsx";
import Icon from "../components/Icon.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount } from "../utils/format.js";

export default function Recurring() {
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null);
  const [generatingId, setGeneratingId] = useState(null);

  async function load() {
    setLoading(true);
    const [t, c, u] = await Promise.all([
      api.get("/recurring-templates"),
      api.get("/categories"),
      api.get("/users"),
    ]);
    setTemplates(t.templates);
    setCategories(c.categories);
    setUsers(u.users);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(template) {
    await api.put(`/recurring-templates/${template.id}`, {
      label: template.label,
      amount: template.amount,
      categoryId: template.categoryId,
      dayOfMonth: template.dayOfMonth,
      splitType: template.splitType,
      participantIds: template.splitConfig.map((c) => c.userId),
      splitConfig: template.splitConfig,
      active: !template.active,
    });
    load();
  }

  async function remove(template) {
    const ok = await confirmAction({
      title: "Supprimer la charge récurrente",
      message: `Supprimer définitivement "${template.label}" ? Les dépenses déjà générées ne seront pas supprimées.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/recurring-templates/${template.id}`);
    showToast(`"${template.label}" supprimée.`);
    load();
  }

  async function generateNow(template) {
    setGeneratingId(template.id);
    try {
      await api.post(`/recurring-templates/${template.id}/generate-now`);
      showToast(`"${template.label}" a été générée pour le mois en cours.`);
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setGeneratingId(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Charges récurrentes</h1>
          <div className="topbar__subtitle">
            Loyer, internet, électricité... générées automatiquement chaque mois
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalState({})}>
          <Icon name="plus" size={15} /> Nouvelle charge récurrente
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <Icon name="repeat" size={26} />
            <span>Aucune charge récurrente. Ajoutez le loyer, l'électricité, le gaz, l'internet...</span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Charge</th>
                <th>Catégorie</th>
                <th>Montant</th>
                <th>Échéance</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} style={{ opacity: t.active ? 1 : 0.5 }}>
                  <td style={{ fontWeight: 600 }}>{t.label}</td>
                  <td>
                    <span className="pill" style={{ background: `${t.category.color}22`, color: t.category.color }}>
                      {t.category.icon} {t.category.name}
                    </span>
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatAmount(t.amount)}</td>
                  <td className="text-muted">Le {t.dayOfMonth} du mois</td>
                  <td>
                    {t.active ? (
                      <span className="pill pill--paid">Active</span>
                    ) : (
                      <span className="pill pill--neutral">En pause</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row-actions">
                      <button className="btn btn--ghost btn--sm" onClick={() => generateNow(t)} disabled={generatingId === t.id}>
                        Générer ce mois
                      </button>
                      <button className="icon-btn" title="Modifier" onClick={() => setModalState({ template: t })}>
                        <Icon name="pencil" size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        title={t.active ? "Mettre en pause" : "Réactiver"}
                        onClick={() => toggleActive(t)}
                      >
                        <Icon name={t.active ? "pause" : "play"} size={14} />
                      </button>
                      <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => remove(t)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalState && (
        <RecurringFormModal
          categories={categories}
          users={users}
          template={modalState.template}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            showToast("Charge récurrente enregistrée.");
            load();
          }}
        />
      )}
    </div>
  );
}

function RecurringFormModal({ categories, users, template, onClose, onSaved }) {
  const isEdit = Boolean(template);
  const [label, setLabel] = useState(template?.label || "");
  const [amount, setAmount] = useState(template?.amount ?? "");
  const [categoryId, setCategoryId] = useState(template?.categoryId || categories[0]?.id || "");
  const [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? 1);
  const [split, setSplit] = useState(
    template
      ? {
          splitType: template.splitType,
          participantIds: template.splitConfig.map((c) => c.userId),
          splitConfig: template.splitConfig,
        }
      : buildDefaultSplitValue(users)
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const canSubmit = label.trim() && numericAmount > 0 && categoryId && isSplitValid(split, numericAmount);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        label: label.trim(),
        amount: numericAmount,
        categoryId,
        dayOfMonth: Number(dayOfMonth),
        splitType: split.splitType,
        participantIds: split.participantIds,
        splitConfig: split.splitType === "equal" ? [] : split.splitConfig,
        active: template?.active ?? true,
      };
      if (isEdit) {
        await api.put(`/recurring-templates/${template.id}`, payload);
      } else {
        await api.post("/recurring-templates", payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer cette charge.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Modifier la charge récurrente" : "Nouvelle charge récurrente"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="recurring-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="recurring-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="r-label">Libellé</label>
          <input id="r-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Ex: Loyer" required />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="r-amount">Montant (€)</label>
            <input id="r-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="r-day">Jour d'échéance</label>
            <input id="r-day" type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} required />
          </div>
        </div>

        <div className="field">
          <label htmlFor="r-category">Catégorie</label>
          <Select
            id="r-category"
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon }))}
            placeholder="Choisir une catégorie"
          />
        </div>

        <div className="field">
          <label>Répartition entre le foyer</label>
          <SplitEditor users={users} amount={numericAmount} value={split} onChange={setSplit} />
        </div>
      </form>
    </Modal>
  );
}
