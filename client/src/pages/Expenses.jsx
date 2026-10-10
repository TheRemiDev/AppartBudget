import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import SharePaymentModal from "../components/SharePaymentModal.jsx";
import ShareStatus from "../components/ShareStatus.jsx";
import Select from "../components/Select.jsx";
import Icon from "../components/Icon.jsx";
import { formatAmount, formatDate } from "../utils/format.js";
import { getPeriodRange, formatPeriodLabel } from "../utils/period.js";
import { KIND_INFO, kindLabel } from "../utils/kind.js";

const STATUS_OPTIONS = [
  { value: "all", label: "Tous les statuts" },
  { value: "mine", label: "Ma part reste à payer" },
  { value: "pending", label: "Pas encore tout payé" },
  { value: "paid", label: "Entièrement payées" },
];

const KIND_FILTER_OPTIONS = [
  { value: "all", label: "Tous les types" },
  ...Object.entries(KIND_INFO).map(([value, info]) => ({ value, label: info.plural })),
];

function normalize(text) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export default function Expenses() {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
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
  }, [period, anchor]);

  const filtered = useMemo(() => {
    const q = normalize(search.trim());
    return expenses.filter((e) => {
      if (q && !normalize(`${e.label} ${e.notes || ""} ${e.category.name}`).includes(q)) return false;
      if (categoryFilter !== "all" && e.categoryId !== categoryFilter) return false;
      if (kindFilter !== "all" && e.kind !== kindFilter) return false;
      if (statusFilter === "paid" && !e.shares.every((s) => s.paid)) return false;
      if (statusFilter === "pending" && e.shares.every((s) => s.paid)) return false;
      if (statusFilter === "mine" && !e.shares.some((s) => s.userId === user.id && !s.paid)) return false;
      return true;
    });
  }, [expenses, search, categoryFilter, kindFilter, statusFilter, user.id]);

  const filtersActive = search.trim() || categoryFilter !== "all" || statusFilter !== "all" || kindFilter !== "all";

  function resetFilters() {
    setSearch("");
    setCategoryFilter("all");
    setStatusFilter("all");
    setKindFilter("all");
  }

  async function quickPay(expense, share) {
    await api.patch(`/expenses/${expense.id}/shares/${share.id}`, { paid: true });
    showToast(`Votre part de « ${expense.label} » est notée comme payée.`);
    loadExpenses();
  }

  async function deleteExpense(expense) {
    const origin = expense.template
      ? ` Elle vient de la charge mensuelle « ${expense.template.label} » : elle ne sera pas recréée automatiquement (vous pourrez la recréer depuis Charges récurrentes).`
      : expense.installmentPlan
      ? ` C'est la mensualité ${expense.installmentIndex}/${expense.installmentPlan.installmentCount} de « ${expense.installmentPlan.label} » (vous pourrez la recréer depuis Achats échelonnés).`
      : "";
    const ok = await confirmAction({
      title: "Supprimer la dépense",
      message: `Supprimer « ${expense.label} » (${formatAmount(expense.amount)}) et tous les paiements enregistrés dessus ?${origin}`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/expenses/${expense.id}`);
    showToast(`« ${expense.label} » supprimée.`);
    loadExpenses();
  }

  async function refreshAfterPaymentChange() {
    const fresh = await loadExpenses();
    if (paymentModal) {
      const freshExpense = fresh.find((e) => e.id === paymentModal.expense.id);
      const freshShare = freshExpense?.shares.find((s) => s.id === paymentModal.share.id);
      if (freshExpense && freshShare) setPaymentModal({ expense: freshExpense, share: freshShare });
    }
  }

  const total = filtered.reduce((s, e) => s + e.amount, 0);
  const myRemaining = filtered.reduce((sum, e) => {
    const mine = e.shares.find((s) => s.userId === user.id && !s.paid);
    if (!mine) return sum;
    return sum + mine.amount - mine.payments.reduce((p, x) => p + x.amount, 0);
  }, 0);

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Dépenses du foyer</h1>
          <div className="topbar__subtitle">
            {formatPeriodLabel(period, anchor)} · {filtered.length} dépense{filtered.length > 1 ? "s" : ""} ·{" "}
            {formatAmount(total)}
            {myRemaining > 0.005 && (
              <>
                {" "}
                · <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>{formatAmount(myRemaining)} à payer de votre côté</span>
              </>
            )}
          </div>
        </div>
        <button className="btn btn--primary" onClick={() => setModalState({})}>
          <Icon name="plus" size={15} /> Nouvelle dépense
        </button>
      </div>

      <div className="toolbar">
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
        <div className="toolbar__filters">
          <div className="search-input">
            <Icon name="search" size={15} />
            <input
              type="search"
              placeholder="Rechercher…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Rechercher une dépense"
            />
          </div>
          <Select
            value={categoryFilter}
            onChange={setCategoryFilter}
            options={[
              { value: "all", label: "Toutes les catégories" },
              ...categories.map((c) => ({ value: c.id, label: c.name, icon: c.icon })),
            ]}
            style={{ minWidth: 190 }}
          />
          <Select value={kindFilter} onChange={setKindFilter} options={KIND_FILTER_OPTIONS} style={{ minWidth: 170 }} />
          <Select value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} style={{ minWidth: 200 }} />
          {filtersActive && (
            <button className="btn btn--ghost btn--sm" onClick={resetFilters}>
              <Icon name="x" size={13} /> Effacer
            </button>
          )}
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="empty-state">
            <Icon name="inbox" size={28} />
            <span>Aucune dépense pour {formatPeriodLabel(period, anchor)}.</span>
            <button className="btn btn--primary btn--sm" onClick={() => setModalState({})}>
              <Icon name="plus" size={14} /> Ajouter une dépense
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Icon name="search" size={26} />
            <span>Aucune dépense ne correspond à ces filtres.</span>
            <button className="btn btn--ghost btn--sm" onClick={resetFilters}>
              Effacer les filtres
            </button>
          </div>
        ) : (
          <table className="table table--stack">
            <thead>
              <tr>
                <th>Date</th>
                <th>Dépense</th>
                <th>Montant</th>
                <th>Qui paie quoi</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted" data-label="Date">
                    {formatDate(e.date)}
                  </td>
                  <td className="table__primary">
                    <div style={{ fontWeight: 600, marginBottom: 5 }}>{e.label}</div>
                    <div className="pill-row">
                      <span className="pill" style={{ background: `${e.category.color}22`, color: e.category.color }}>
                        {e.category.icon} {e.category.name}
                      </span>
                      <span className={`pill pill--kind-${e.kind}`}>{kindLabel(e.kind)}</span>
                      {e.template && (
                        <span className="pill pill--neutral" title={`Créée automatiquement par la charge mensuelle « ${e.template.label} »`}>
                          <Icon name="repeat" size={11} /> Mensuelle
                        </span>
                      )}
                      {e.installmentPlan && (
                        <span className="pill pill--neutral" title={`Mensualité de l'achat échelonné « ${e.installmentPlan.label} »`}>
                          <Icon name="creditCard" size={11} /> {e.installmentIndex}/{e.installmentPlan.installmentCount}
                        </span>
                      )}
                    </div>
                    {e.notes && (
                      <div className="text-muted" style={{ display: "flex", alignItems: "flex-start", gap: 5, fontSize: 12, marginTop: 6, maxWidth: 320 }}>
                        <Icon name="fileText" size={12} style={{ marginTop: 2 }} />
                        <span>{e.notes}</span>
                      </div>
                    )}
                  </td>
                  <td data-label="Montant" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                    {formatAmount(e.amount)}
                  </td>
                  <td data-label="Qui paie quoi" data-block>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {e.shares.map((s) => (
                        <ShareStatus
                          key={s.id}
                          share={s}
                          currentUserId={user.id}
                          onQuickPay={() => quickPay(e, s)}
                          onOpen={() => setPaymentModal({ expense: e, share: s })}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="table__actions">
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
          onSaved={(message) => {
            setModalState(null);
            showToast(message);
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
