import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import Avatar from "../components/Avatar.jsx";
import { formatAmount, formatDate } from "../utils/format.js";
import { getPeriodRange } from "../utils/period.js";

export default function Expenses() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [kindFilter, setKindFilter] = useState("all");
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { expense? }

  async function loadExpenses() {
    setLoading(true);
    const { from, to } = getPeriodRange(period, anchor);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (kindFilter !== "all") params.set("kind", kindFilter);
    const { expenses } = await api.get(`/expenses?${params.toString()}`);
    setExpenses(expenses);
    setLoading(false);
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

  async function toggleMyShare(expense, paid) {
    await api.patch(`/expenses/${expense.id}/shares/mine`, { paid });
    loadExpenses();
  }

  async function deleteExpense(id) {
    if (!confirm("Supprimer definitivement cette depense ?")) return;
    await api.delete(`/expenses/${id}`);
    loadExpenses();
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
          + Nouvelle dépense
        </button>
      </div>

      <div className="flex-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 12 }}>
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} style={{ border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 12px", background: "var(--color-surface)" }}>
          <option value="all">Tous les types</option>
          <option value="fixed">Frais fixes</option>
          <option value="exceptional">Frais exceptionnels</option>
        </select>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : expenses.length === 0 ? (
          <div className="table-empty">Aucune dépense sur cette période.</div>
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
                    <div style={{ fontWeight: 600 }}>{e.label}</div>
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
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {e.shares.map((s) => (
                        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar user={s.user} size="sm" />
                          <span style={{ fontSize: 13 }}>{formatAmount(s.amount)}</span>
                          {s.paid ? (
                            <span className="pill pill--paid">Réglé</span>
                          ) : s.userId === user.id ? (
                            <button className="btn btn--sm btn--ghost" onClick={() => toggleMyShare(e, true)}>
                              Confirmer
                            </button>
                          ) : (
                            <span className="pill pill--pending">En attente</span>
                          )}
                          {s.paid && s.userId === user.id && (
                            <button className="btn btn--sm btn--ghost" onClick={() => toggleMyShare(e, false)} title="Annuler la confirmation">
                              Annuler
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="icon-btn" title="Modifier" onClick={() => setModalState({ expense: e })}>
                      ✎
                    </button>
                    <button className="icon-btn" title="Supprimer" onClick={() => deleteExpense(e.id)} style={{ marginLeft: 6 }}>
                      🗑
                    </button>
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
            loadExpenses();
          }}
        />
      )}
    </div>
  );
}
