import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import SharePaymentModal from "../components/SharePaymentModal.jsx";
import Select from "../components/Select.jsx";
import Avatar from "../components/Avatar.jsx";
import Icon from "../components/Icon.jsx";
import { formatAmount, formatDate } from "../utils/format.js";
import { getPeriodRange } from "../utils/period.js";

const KIND_FILTER_OPTIONS = [
  { value: "all", label: "Tous les types" },
  { value: "fixed", label: "Frais fixes" },
  { value: "exceptional", label: "Frais exceptionnels" },
];

export default function Expenses() {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [kindFilter, setKindFilter] = useState("all");
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { expense? }
  const [paymentModal, setPaymentModal] = useState(null); // null | { expense, share }

  async function loadExpenses() {
    setLoading(true);
    const { from, to } = getPeriodRange(period, anchor);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (kindFilter !== "all") params.set("kind", kindFilter);
    const { expenses } = await api.get(`/expenses?${params.toString()}`);
    setExpenses(expenses);
    setLoading(false);
    return expenses;
  }

  useEffect(() => {
    Promise.all([api.get("/categories"), api.get("/users")]).then(([c, u]) => {
      setCategories(c.categories);
      setUsers(u.users);
    });
  }, []);

  useEffect(() => {
    loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, anchor, kindFilter]);

  async function quickConfirm(expense, share) {
    await api.patch(`/expenses/${expense.id}/shares/${share.id}`, { paid: true });
    showToast("Part réglée.");
    loadExpenses();
  }

  async function deleteExpense(expense) {
    const ok = await confirmAction({
      title: "Supprimer la dépense",
      message: `Supprimer définitivement "${expense.label}" (${formatAmount(expense.amount)}) ? Cette action est irréversible et supprime aussi l'historique des versements liés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/expenses/${expense.id}`);
    showToast(`"${expense.label}" supprimée.`);
    loadExpenses();
  }

  function openPaymentModal(expense, share) {
    setPaymentModal({ expense, share });
  }

  async function refreshAfterPaymentChange() {
    const fresh = await loadExpenses();
    if (paymentModal) {
      const freshExpense = fresh.find((e) => e.id === paymentModal.expense.id);
      const freshShare = freshExpense?.shares.find((s) => s.id === paymentModal.share.id);
      if (freshExpense && freshShare) {
        setPaymentModal({ expense: freshExpense, share: freshShare });
      }
    }
  }

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Dépenses</h1>
          <div className="topbar__subtitle">
            {expenses.length} dépense(s) · {formatAmount(total)} au total
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalState({})}>
          <Icon name="plus" size={15} /> Nouvelle dépense
        </button>
      </div>

      <div className="flex-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
        <Select
          value={kindFilter}
          onChange={setKindFilter}
          options={KIND_FILTER_OPTIONS}
          style={{ minWidth: 190 }}
        />
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <Icon name="inbox" size={28} />
            <span>Aucune dépense sur cette période.</span>
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Dépense</th>
                <th>Catégorie</th>
                <th>Montant</th>
                <th>Répartition</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted">{formatDate(e.date)}</td>
                  <td>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{e.label}</div>
                    <span className={`pill pill--kind-${e.kind}`}>
                      {e.kind === "fixed" ? "Fixe" : "Exceptionnel"}
                    </span>
                  </td>
                  <td>
                    <span className="pill" style={{ background: `${e.category.color}22`, color: e.category.color }}>
                      {e.category.icon} {e.category.name}
                    </span>
                  </td>
                  <td style={{ fontWeight: 700 }}>{formatAmount(e.amount)}</td>
                  <td>
                    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                      {e.shares.map((s) => {
                        const paidAmount = s.payments.reduce((sum, p) => sum + p.amount, 0);
                        const partial = !s.paid && paidAmount > 0;
                        const isMine = s.userId === user.id;
                        return (
                          <div className="share-row" key={s.id}>
                            <Avatar user={s.user} size="sm" />
                            <span className="share-row__amount">{formatAmount(s.amount)}</span>
                            {s.paid ? (
                              <button
                                className="share-row__status share-row__status--paid"
                                style={{ background: "none", border: "none", cursor: isMine ? "pointer" : "default", padding: 0 }}
                                onClick={() => isMine && openPaymentModal(e, s)}
                                disabled={!isMine}
                              >
                                <Icon name="checkCircle" size={13} /> Réglé
                              </button>
                            ) : isMine ? (
                              <>
                                <button className="btn btn--primary btn--sm" onClick={() => quickConfirm(e, s)}>
                                  Confirmer
                                </button>
                                <button
                                  className="icon-btn"
                                  title="Paiement en plusieurs fois"
                                  onClick={() => openPaymentModal(e, s)}
                                >
                                  <Icon name="coins" size={13} />
                                </button>
                                {partial && (
                                  <span className="text-muted" style={{ fontSize: 11.5 }}>
                                    {formatAmount(paidAmount)} versés
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="share-row__status share-row__status--pending">
                                  <Icon name="clock" size={13} />
                                  En attente{partial ? ` (${formatAmount(paidAmount)} versés)` : ""}
                                </span>
                                <button
                                  className="btn btn--ghost btn--sm"
                                  title={`Payer la part de ${s.user.name}`}
                                  onClick={() => openPaymentModal(e, s)}
                                >
                                  Payer pour {s.user.name.split(" ")[0]}
                                </button>
                              </>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <div className="row-actions">
                      <button className="icon-btn" title="Modifier" onClick={() => setModalState({ expense: e })}>
                        <Icon name="pencil" size={14} />
                      </button>
                      <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => deleteExpense(e)}>
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
          expense={modalState.expense}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            showToast(modalState.expense ? "Dépense modifiée." : "Dépense ajoutée.");
            loadExpenses();
          }}
        />
      )}

      {paymentModal && (
        <SharePaymentModal
          expense={paymentModal.expense}
          share={paymentModal.share}
          onClose={() => setPaymentModal(null)}
          onChanged={refreshAfterPaymentChange}
        />
      )}
    </div>
  );
}
