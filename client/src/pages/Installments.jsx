import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import { describeSplit } from "../components/SplitEditor.jsx";
import Icon from "../components/Icon.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { formatAmount, formatDate } from "../utils/format.js";

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
      message: `Supprimer définitivement « ${plan.label} » et ses ${plan.installmentCount} mensualités, y compris celles déjà payées et leurs paiements ? Pour ne retirer qu'une mensualité, supprimez-la depuis la page Dépenses.`,
      confirmLabel: "Supprimer tout",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/installment-plans/${plan.id}`);
    showToast(`« ${plan.label} » supprimé.`);
    load();
  }

  async function regenerate(plan) {
    try {
      const { created } = await api.post(`/installment-plans/${plan.id}/regenerate`);
      showToast(
        created.length
          ? `${created.length} mensualité${created.length > 1 ? "s" : ""} recréée${created.length > 1 ? "s" : ""}.`
          : "Rien à recréer, toutes les mensualités sont là."
      );
      load();
    } catch (err) {
      showToast(err.message || "Impossible de recréer les mensualités manquantes.", "error");
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Achats échelonnés</h1>
          <div className="topbar__subtitle">
            Les achats payés en plusieurs mensualités (ex : 4x sans frais). Chaque mensualité apparaît dans les dépenses de son mois.
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalOpen(true)}>
          <Icon name="plus" size={15} /> Nouvel achat en plusieurs fois
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
            <span>Aucun achat en plusieurs fois pour l'instant.</span>
            <button className="btn btn--primary btn--sm" onClick={() => setModalOpen(true)}>
              <Icon name="plus" size={14} /> Ajouter un achat échelonné
            </button>
          </div>
        ) : (
          <table className="table table--stack">
            <thead>
              <tr>
                <th>Achat</th>
                <th>Montant</th>
                <th>Répartition</th>
                <th>Avancement</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const ratio = p.totalAmount > 0 ? Math.min(100, Math.round((p.paidAmount / p.totalAmount) * 100)) : 0;
                const sameAmounts = Math.abs(p.firstInstallmentAmount - p.restInstallmentAmount) < 0.005;
                const missing = p.installmentCount - p.expenses.length;
                const last = p.expenses[p.expenses.length - 1];
                return (
                  <tr key={p.id}>
                    <td className="table__primary">
                      <div style={{ fontWeight: 600, marginBottom: 5 }}>{p.label}</div>
                      <div className="pill-row">
                        <span className="pill" style={{ background: `${p.category.color}22`, color: p.category.color }}>
                          {p.category.icon} {p.category.name}
                        </span>
                        {missing > 0 && (
                          <span className="pill pill--pending" title="Supprimée(s) depuis la page Dépenses">
                            {missing} mensualité{missing > 1 ? "s" : ""} supprimée{missing > 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="Montant">
                      <div style={{ fontWeight: 700 }}>{formatAmount(p.totalAmount)}</div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {sameAmounts
                          ? `${p.installmentCount} × ${formatAmount(p.restInstallmentAmount)}`
                          : `${formatAmount(p.firstInstallmentAmount)} puis ${p.installmentCount - 1} × ${formatAmount(p.restInstallmentAmount)}`}
                      </div>
                    </td>
                    <td data-label="Répartition" className="text-muted">
                      {describeSplit(p.splitType, p.splitConfig, users)}
                    </td>
                    <td data-label="Avancement" style={{ minWidth: 170 }}>
                      <div className="progress-bar">
                        <div className="progress-bar__fill" style={{ width: `${ratio}%`, background: "var(--color-info)" }} />
                      </div>
                      <div className="text-muted" style={{ fontSize: 11.5, marginTop: 4 }}>
                        {p.paidInstallments}/{p.installmentCount} mensualités payées · reste {formatAmount(p.remainingAmount)}
                        {last && <> · fin {formatDate(last.date)}</>}
                      </div>
                    </td>
                    <td className="table__actions">
                      <div className="row-actions">
                        {missing > 0 && (
                          <button
                            className="icon-btn"
                            title="Recréer les mensualités supprimées"
                            onClick={() => regenerate(p)}
                          >
                            <Icon name="repeat" size={14} />
                          </button>
                        )}
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
        <ExpenseFormModal
          categories={categories}
          users={users}
          initialMode="installments"
          onClose={() => setModalOpen(false)}
          onSaved={(message) => {
            setModalOpen(false);
            showToast(message);
            load();
          }}
        />
      )}
    </div>
  );
}
