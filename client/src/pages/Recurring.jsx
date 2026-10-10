import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import { describeSplit } from "../components/SplitEditor.jsx";
import Icon from "../components/Icon.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount, formatDate } from "../utils/format.js";
import { nextOccurrenceDate } from "../utils/period.js";

function occurrenceNote(occurrences, verb) {
  if (!occurrences) return "";
  const parts = [];
  const count = occurrences.removed ?? occurrences.updated ?? 0;
  if (count) parts.push(`${count} échéance${count > 1 ? "s" : ""} à venir ${verb}${count > 1 ? "s" : ""}`);
  if (occurrences.locked) parts.push(`${occurrences.locked} déjà en partie payée${occurrences.locked > 1 ? "s" : ""}, conservée${occurrences.locked > 1 ? "s" : ""}`);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

export default function Recurring() {
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [templates, setTemplates] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { template? }
  const [busyId, setBusyId] = useState(null);

  async function load() {
    const [t, c, u] = await Promise.all([api.get("/recurring-templates"), api.get("/categories"), api.get("/users")]);
    setTemplates(t.templates);
    setCategories(c.categories);
    setUsers(u.users);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(template) {
    if (template.active) {
      const ok = await confirmAction({
        title: "Mettre en pause",
        message: `Mettre « ${template.label} » en pause ? Plus aucune échéance ne sera créée, et celles à venir pas encore payées seront retirées des dépenses. Les mois passés restent intacts. Vous pourrez la réactiver à tout moment.`,
        confirmLabel: "Mettre en pause",
      });
      if (!ok) return;
    }
    setBusyId(template.id);
    try {
      const res = await api.put(`/recurring-templates/${template.id}`, {
        label: template.label,
        amount: template.amount,
        categoryId: template.categoryId,
        dayOfMonth: template.dayOfMonth,
        splitType: template.splitType,
        participantIds: template.splitConfig.map((c) => c.userId),
        splitConfig: template.splitConfig,
        active: !template.active,
      });
      showToast(
        template.active
          ? `« ${template.label} » en pause${occurrenceNote(res.occurrences, "retirée")}.`
          : `« ${template.label} » réactivée : les prochains mois sont de nouveau dans les dépenses.`
      );
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function remove(template) {
    const ok = await confirmAction({
      title: "Supprimer la charge récurrente",
      message: `Supprimer définitivement « ${template.label} » ? Les échéances passées restent dans les dépenses ; celles à venir pas encore payées sont retirées.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const res = await api.delete(`/recurring-templates/${template.id}`);
    showToast(`« ${template.label} » supprimée${occurrenceNote(res.occurrences, "retirée")}.`);
    load();
  }

  async function restoreThisMonth(template) {
    setBusyId(template.id);
    try {
      const res = await api.post(`/recurring-templates/${template.id}/generate-now`);
      showToast(
        res.created
          ? `L'échéance de ce mois de « ${template.label} » a été recréée.`
          : `L'échéance de ce mois de « ${template.label} » existe déjà, rien à recréer.`
      );
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  const activeTotal = templates.filter((t) => t.active).reduce((s, t) => s + t.amount, 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Charges récurrentes</h1>
          <div className="topbar__subtitle">
            Ce qui revient chaque mois. Les échéances sont ajoutées toutes seules aux dépenses, 3 mois à l'avance.
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalState({})}>
          <Icon name="plus" size={15} /> Nouvelle charge
        </button>
      </div>

      {templates.length > 0 && (
        <div className="summary-strip">
          <span>
            <strong>{formatAmount(activeTotal)}</strong> de charges fixes par mois
          </span>
          <span className="text-muted">
            {templates.filter((t) => t.active).length} active{templates.filter((t) => t.active).length > 1 ? "s" : ""}
            {templates.some((t) => !t.active) && ` · ${templates.filter((t) => !t.active).length} en pause`}
          </span>
        </div>
      )}

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : templates.length === 0 ? (
          <div className="empty-state">
            <Icon name="repeat" size={26} />
            <span>Aucune charge récurrente. Ajoutez le loyer, l'électricité, internet, les abonnements…</span>
            <button className="btn btn--primary btn--sm" onClick={() => setModalState({})}>
              <Icon name="plus" size={14} /> Ajouter une charge
            </button>
          </div>
        ) : (
          <table className="table table--stack">
            <thead>
              <tr>
                <th>Charge</th>
                <th>Montant</th>
                <th>Répartition</th>
                <th>Prochaine échéance</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className={t.active ? "" : "row--muted"}>
                  <td className="table__primary">
                    <div style={{ fontWeight: 600, marginBottom: 5 }}>{t.label}</div>
                    <div className="pill-row">
                      <span className="pill" style={{ background: `${t.category.color}22`, color: t.category.color }}>
                        {t.category.icon} {t.category.name}
                      </span>
                      {!t.active && <span className="pill pill--neutral">En pause</span>}
                    </div>
                  </td>
                  <td data-label="Montant" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {formatAmount(t.amount)} <span className="text-muted" style={{ fontWeight: 500 }}>/ mois</span>
                  </td>
                  <td data-label="Répartition" className="text-muted">
                    {describeSplit(t.splitType, t.splitConfig, users)}
                  </td>
                  <td data-label="Prochaine échéance">
                    {t.active ? (
                      <>
                        {formatDate(nextOccurrenceDate(t.dayOfMonth))}
                        <div className="text-muted" style={{ fontSize: 12 }}>le {t.dayOfMonth} de chaque mois</div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="table__actions">
                    <div className="row-actions">
                      <button className="icon-btn" title="Modifier (s'applique aussi aux mois à venir)" onClick={() => setModalState({ template: t })}>
                        <Icon name="pencil" size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        title={t.active ? "Mettre en pause" : "Réactiver"}
                        onClick={() => toggleActive(t)}
                        disabled={busyId === t.id}
                      >
                        <Icon name={t.active ? "pause" : "play"} size={14} />
                      </button>
                      {t.active && (
                        <button
                          className="icon-btn"
                          title="Recréer l'échéance de ce mois (si elle a été supprimée par erreur)"
                          onClick={() => restoreThisMonth(t)}
                          disabled={busyId === t.id}
                        >
                          <Icon name="refresh" size={14} />
                        </button>
                      )}
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
        <ExpenseFormModal
          categories={categories}
          users={users}
          template={modalState.template}
          initialMode="monthly"
          onClose={() => setModalState(null)}
          onSaved={(message) => {
            setModalState(null);
            showToast(message);
            load();
          }}
        />
      )}
    </div>
  );
}
