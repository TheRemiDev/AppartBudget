import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import CategoryPieChart from "../components/CategoryPieChart.jsx";
import TrendBarChart, { TrendLegend } from "../components/TrendBarChart.jsx";
import Avatar from "../components/Avatar.jsx";
import Icon from "../components/Icon.jsx";
import Select from "../components/Select.jsx";
import ExpenseFormModal from "../components/ExpenseFormModal.jsx";
import SharePaymentModal from "../components/SharePaymentModal.jsx";
import SettlementModal from "../components/SettlementModal.jsx";
import { formatAmount, formatDate, formatDateShort } from "../utils/format.js";
import { getPeriodRange, formatPeriodLabel } from "../utils/period.js";
import { KIND_INFO } from "../utils/kind.js";

export default function Dashboard() {
  const { user } = useAuth();
  const showToast = useToast();
  const confirmAction = useConfirm();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toPay, setToPay] = useState(null);
  const [balance, setBalance] = useState(null);
  const [history, setHistory] = useState([]);
  const [payerFilter, setPayerFilter] = useState("all");
  const [users, setUsers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [payingId, setPayingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [paymentModal, setPaymentModal] = useState(null);
  const [settlementModal, setSettlementModal] = useState(null);

  const periodLabel = formatPeriodLabel(period, anchor);

  function rangeParams() {
    const { from, to } = getPeriodRange(period, anchor);
    return { from: from.toISOString(), to: to.toISOString() };
  }

  async function loadSummary() {
    const { from, to } = rangeParams();
    const [summaryRes, trendRes] = await Promise.all([
      api.get(`/dashboard/summary?from=${from}&to=${to}`),
      api.get(`/dashboard/trend?months=6`),
    ]);
    setSummary(summaryRes);
    setTrend(trendRes.trend);
  }

  async function loadHistory() {
    const { from, to } = rangeParams();
    const [paymentsRes, settlementsRes] = await Promise.all([
      api.get(`/dashboard/payments?${new URLSearchParams({ from, to })}`),
      api.get(`/settlements?${new URLSearchParams({ from, to })}`),
    ]);
    const rows = [
      ...paymentsRes.payments.map((p) => ({ type: "payment", ...p })),
      ...settlementsRes.settlements.map((s) => ({ type: "settlement", ...s })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    setHistory(rows);
  }

  async function loadToPay() {
    setToPay(await api.get("/dashboard/to-pay"));
  }

  async function loadBalance() {
    setBalance(await api.get("/dashboard/balance"));
  }

  function refreshMoney() {
    loadSummary();
    loadHistory();
    loadToPay();
    loadBalance();
  }

  useEffect(() => {
    Promise.all([api.get("/users"), api.get("/categories")]).then(([u, c]) => {
      setUsers(u.users);
      setCategories(c.categories);
    });
    loadToPay();
    loadBalance();
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadSummary(), loadHistory()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, anchor]);

  async function quickPay(item) {
    setPayingId(item.shareId);
    try {
      await api.patch(`/expenses/${item.expenseId}/shares/${item.shareId}`, { paid: true });
      showToast(`« ${item.label} » : votre part est notée comme payée.`);
      refreshMoney();
    } finally {
      setPayingId(null);
    }
  }

  async function openPaymentDetails(item) {
    const { expense } = await api.get(`/expenses/${item.expenseId}`);
    const share = expense.shares.find((s) => s.id === item.shareId);
    if (share) setPaymentModal({ expense, share });
  }

  async function deleteHistoryRow(row) {
    const isSettlement = row.type === "settlement";
    const ok = await confirmAction({
      title: isSettlement ? "Annuler ce remboursement" : "Annuler ce paiement",
      message: isSettlement
        ? `Annuler le remboursement de ${formatAmount(row.amount)} de ${row.fromUser.name} à ${row.toUser.name} du ${formatDate(row.date)} ?`
        : `Annuler le paiement de ${formatAmount(row.amount)} fait par ${row.paidBy.name} le ${formatDate(row.date)} pour « ${row.expense.label} » ? Ce montant redeviendra « à payer ».`,
      confirmLabel: isSettlement ? "Annuler le remboursement" : "Annuler le paiement",
      cancelLabel: "Garder",
      danger: true,
    });
    if (!ok) return;
    setDeletingId(row.id);
    try {
      if (isSettlement) await api.delete(`/settlements/${row.id}`);
      else await api.delete(`/expenses/${row.expense.id}/shares/${row.shareId}/payments/${row.id}`);
      showToast(isSettlement ? "Remboursement annulé." : "Paiement annulé.");
      refreshMoney();
    } finally {
      setDeletingId(null);
    }
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      const { from, to } = rangeParams();
      const params = new URLSearchParams({ from, to, label: periodLabel });
      const res = await fetch(`/api/dashboard/export-pdf?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Impossible de générer le PDF.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `appartbudget-rapport-${periodLabel.replace(/\s+/g, "-").toLowerCase()}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message || "Impossible de générer le PDF.", "error");
    } finally {
      setExportingPdf(false);
    }
  }

  const filteredHistory = history.filter((row) => {
    if (payerFilter === "all") return true;
    return row.type === "settlement" ? row.fromUser.id === payerFilter : row.paidBy.id === payerFilter;
  });

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Tableau de bord</h1>
          <div className="topbar__subtitle">Bonjour {user?.name}, voici où en est le budget du foyer.</div>
        </div>
        <div className="topbar__actions">
          <button className="btn btn--ghost" onClick={exportPdf} disabled={exportingPdf} title={`Rapport PDF de ${periodLabel}`}>
            <Icon name="download" size={15} /> {exportingPdf ? "Génération..." : "Rapport PDF"}
          </button>
          <button className="btn btn--primary" onClick={() => setExpenseModalOpen(true)}>
            <Icon name="plus" size={15} /> Nouvelle dépense
          </button>
        </div>
      </div>

      <div className="dash-grid">
        <ToPayCard
          data={toPay}
          payingId={payingId}
          onQuickPay={quickPay}
          onDetails={openPaymentDetails}
        />
        <BetweenYouCard
          balance={balance}
          summary={summary}
          periodLabel={periodLabel}
          currentUserId={user.id}
          onSettle={(b) => setSettlementModal(b)}
        />
      </div>

      <div className="section-heading">
        <h2>Dépenses du foyer</h2>
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
      </div>

      {loading || !summary ? (
        <div className="center-screen" style={{ minHeight: 240 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="card-grid card-grid--kpi">
            <div className="stat-card stat-card--featured">
              <div className="stat-card__top">
                <span className="stat-card__label">Total · {periodLabel}</span>
                <span className="icon-badge icon-badge--primary">
                  <Icon name="wallet" size={17} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalAmount)}</div>
              <div className="stat-card__hint">
                {summary.expenseCount} dépense{summary.expenseCount > 1 ? "s" : ""} ·{" "}
                <Link to="/depenses" className="stat-card__link">
                  voir le détail
                </Link>
              </div>
            </div>
            <KindCard kind="fixed" value={summary.totalFixed} icon="repeat" badge="primary" />
            <KindCard kind="occasional" value={summary.totalOccasional} icon="shoppingBag" badge="info" />
            <KindCard kind="exceptional" value={summary.totalExceptional} icon="sparkles" badge="warning" />
          </div>

          <div className="chart-grid">
            <div className="card">
              <div className="card__header">
                <h3>Évolution sur 6 mois</h3>
                <TrendLegend />
              </div>
              <div className="card__body">
                <TrendBarChart data={trend} />
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <h3>Par catégorie · {periodLabel}</h3>
              </div>
              <div className="card__body">
                <CategoryPieChart data={summary.byCategory} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h3>Paiements et remboursements</h3>
                <div className="card__subtitle">{periodLabel}</div>
              </div>
              <Select
                value={payerFilter}
                onChange={setPayerFilter}
                style={{ minWidth: 180 }}
                options={[
                  { value: "all", label: "Payés par tout le monde" },
                  ...users.map((u) => ({ value: u.id, label: `Payés par ${u.name}` })),
                ]}
              />
            </div>
            {filteredHistory.length === 0 ? (
              <div className="empty-state">
                <Icon name="coins" size={26} />
                <span>Aucun paiement enregistré sur cette période.</span>
              </div>
            ) : (
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Pour</th>
                    <th>Qui a payé</th>
                    <th>Montant</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map((row) =>
                    row.type === "settlement" ? (
                      <tr key={`s-${row.id}`}>
                        <td className="text-muted" data-label="Date">{formatDate(row.date)}</td>
                        <td className="table__primary">
                          <div style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                            <Icon name="swap" size={14} /> Remboursement
                          </div>
                          {row.note && <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>{row.note}</div>}
                        </td>
                        <td data-label="Qui a payé" data-block>
                          <PersonFlow from={row.fromUser} to={row.toUser} />
                          <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                            a remboursé {row.toUser.name}
                          </div>
                        </td>
                        <td data-label="Montant" style={{ fontWeight: 700 }}>{formatAmount(row.amount)}</td>
                        <td className="table__actions">
                          <button className="icon-btn icon-btn--danger" title="Annuler ce remboursement" onClick={() => deleteHistoryRow(row)} disabled={deletingId === row.id}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    ) : (
                      <tr key={`p-${row.id}`}>
                        <td className="text-muted" data-label="Date">{formatDate(row.date)}</td>
                        <td className="table__primary">
                          <div style={{ fontWeight: 600, marginBottom: 4 }}>{row.expense.label}</div>
                          <span className="pill" style={{ background: `${row.expense.categoryColor}22`, color: row.expense.categoryColor }}>
                            {row.expense.categoryIcon} {row.expense.categoryName}
                          </span>
                          {row.note && <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>{row.note}</div>}
                        </td>
                        <td data-label="Qui a payé" data-block>
                          <PersonFlow from={row.paidBy} to={row.isForSelf ? null : row.forUser} />
                          <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                            {row.isForSelf ? "sa propre part" : `à la place de ${row.forUser.name}`}
                          </div>
                        </td>
                        <td data-label="Montant" style={{ fontWeight: 700 }}>{formatAmount(row.amount)}</td>
                        <td className="table__actions">
                          <button className="icon-btn icon-btn--danger" title="Annuler ce paiement" onClick={() => deleteHistoryRow(row)} disabled={deletingId === row.id}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {expenseModalOpen && (
        <ExpenseFormModal
          categories={categories}
          users={users}
          onClose={() => setExpenseModalOpen(false)}
          onSaved={(message) => {
            setExpenseModalOpen(false);
            showToast(message);
            refreshMoney();
          }}
        />
      )}

      {paymentModal && (
        <SharePaymentModal
          expense={paymentModal.expense}
          share={paymentModal.share}
          onClose={() => setPaymentModal(null)}
          onChanged={refreshMoney}
        />
      )}

      {settlementModal && (
        <SettlementModal
          users={users}
          initial={settlementModal}
          onClose={() => setSettlementModal(null)}
          onSaved={(message) => {
            setSettlementModal(null);
            showToast(message);
            refreshMoney();
          }}
        />
      )}
    </div>
  );
}

function KindCard({ kind, value, icon, badge }) {
  const info = KIND_INFO[kind];
  return (
    <div className="stat-card">
      <div className="stat-card__top">
        <span className="stat-card__label">{info.plural}</span>
        <span className={`icon-badge icon-badge--${badge}`}>
          <Icon name={icon} size={16} />
        </span>
      </div>
      <div className="stat-card__value">{formatAmount(value)}</div>
      <div className="stat-card__hint">{info.hint}</div>
    </div>
  );
}

function PersonFlow({ from, to }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
      <Avatar user={from} size="sm" />
      <span style={{ fontWeight: 600 }}>{from.name}</span>
      {to && (
        <>
          <Icon name="arrowRight" size={13} className="text-muted" />
          <Avatar user={to} size="sm" />
          <span style={{ fontWeight: 600 }}>{to.name}</span>
        </>
      )}
    </div>
  );
}

function ToPayCard({ data, payingId, onQuickPay, onDetails }) {
  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h3>À payer de mon côté</h3>
          <div className="card__subtitle">Mois en cours et retards éventuels</div>
        </div>
        {data && data.items.length > 0 && <span className="amount-badge amount-badge--danger">{formatAmount(data.total)}</span>}
      </div>
      {!data ? (
        <div className="center-screen" style={{ minHeight: 120 }}>
          <div className="spinner" />
        </div>
      ) : data.items.length === 0 ? (
        <div className="empty-state empty-state--compact">
          <Icon name="checkCircle" size={24} />
          <span>Rien à payer pour l'instant, tout est à jour.</span>
        </div>
      ) : (
        <div className="todo-list">
          {data.items.map((item) => (
            <div className="todo-item" key={item.shareId}>
              <div className="todo-item__main">
                <div className="todo-item__title">
                  <span>{item.categoryIcon}</span>
                  <span>{item.label}</span>
                  {item.overdue && <span className="pill pill--pending">En retard</span>}
                </div>
                <div className="todo-item__meta">
                  {formatDateShort(item.date)}
                  {item.paidAmount > 0 && ` · ${formatAmount(item.paidAmount)} déjà payés sur ${formatAmount(item.shareAmount)}`}
                </div>
              </div>
              <div className="todo-item__amount">{formatAmount(item.remaining)}</div>
              <div className="todo-item__actions">
                <button className="btn btn--primary btn--xs" onClick={() => onQuickPay(item)} disabled={payingId === item.shareId}>
                  {payingId === item.shareId ? "…" : "J'ai payé"}
                </button>
                <button className="icon-btn icon-btn--xs" title="Payer une partie, à une autre date…" onClick={() => onDetails(item)}>
                  <Icon name="dots" size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BetweenYouCard({ balance, summary, periodLabel, currentUserId, onSettle }) {
  if (!balance) {
    return (
      <div className="card">
        <div className="center-screen" style={{ minHeight: 160 }}>
          <div className="spinner" />
        </div>
      </div>
    );
  }
  const name = (id) => balance.users.find((u) => u.id === id);

  function sentence(b) {
    const from = name(b.fromUserId);
    const to = name(b.toUserId);
    if (b.fromUserId === currentUserId) return <>Vous devez <strong>{formatAmount(b.amount)}</strong> à {to?.name}</>;
    if (b.toUserId === currentUserId) return <>{from?.name} vous doit <strong>{formatAmount(b.amount)}</strong></>;
    return <>{from?.name} doit <strong>{formatAmount(b.amount)}</strong> à {to?.name}</>;
  }

  return (
    <div className="card">
      <div className="card__header">
        <div>
          <h3>Entre vous</h3>
          <div className="card__subtitle">Qui a avancé de l'argent pour l'autre</div>
        </div>
      </div>
      <div className="card__body">
        {balance.balances.length === 0 ? (
          <div className="balance-line balance-line--settled">
            <Icon name="checkCircle" size={18} />
            <span>Vous êtes quittes : personne ne doit rien à l'autre.</span>
          </div>
        ) : (
          balance.balances.map((b) => (
            <div className="balance-line" key={`${b.fromUserId}-${b.toUserId}`}>
              <div className="balance-line__who">
                <Avatar user={name(b.fromUserId)} size="sm" />
                <Icon name="arrowRight" size={13} className="text-muted" />
                <Avatar user={name(b.toUserId)} size="sm" />
                <span>{sentence(b)}</span>
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => onSettle(b)}>
                <Icon name="swap" size={14} /> Rembourser
              </button>
            </div>
          ))
        )}
        <p className="card__footnote">
          Calculé sur tout l'historique : ce que chacun a payé à la place de l'autre, moins les remboursements.
        </p>

        {summary && summary.byUser.length > 0 && (
          <div className="person-shares">
            <div className="section-label">Part de chacun · {periodLabel}</div>
            {summary.byUser.map((u) => {
              const ratio = u.assigned > 0 ? Math.min(100, Math.round((u.paid / u.assigned) * 100)) : 100;
              return (
                <div className="person-share" key={u.userId}>
                  <div className="person-share__top">
                    <span className="person-share__name">
                      <Avatar user={u} size="sm" /> {u.userId === currentUserId ? "Vous" : u.name}
                    </span>
                    <span className="person-share__amount">{formatAmount(u.assigned)}</span>
                  </div>
                  <div className="progress-bar">
                    <div className="progress-bar__fill" style={{ width: `${ratio}%`, background: u.color }} />
                  </div>
                  <div className="person-share__meta">
                    {u.assigned <= 0.005 ? (
                      <span className="text-muted">Aucune dépense sur la période</span>
                    ) : u.pending > 0.005 ? (
                      <span>
                        Payé {formatAmount(u.paid)} · <span style={{ color: "var(--color-danger)", fontWeight: 600 }}>reste {formatAmount(u.pending)}</span>
                      </span>
                    ) : (
                      <span style={{ color: "var(--color-success)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <Icon name="checkCircle" size={13} /> Tout est payé
                      </span>
                    )}
                    {u.advancedForOthers > 0.005 && (
                      <span className="text-muted"> · {formatAmount(u.advancedForOthers)} avancés pour l'autre</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
