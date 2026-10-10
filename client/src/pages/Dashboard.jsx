import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import CategoryPieChart from "../components/CategoryPieChart.jsx";
import TrendBarChart from "../components/TrendBarChart.jsx";
import Avatar from "../components/Avatar.jsx";
import Icon from "../components/Icon.jsx";
import Select from "../components/Select.jsx";
import { formatAmount, formatDate, formatDateShort } from "../utils/format.js";
import { getPeriodRange, formatPeriodLabel } from "../utils/period.js";

export default function Dashboard() {
  const { user } = useAuth();
  const showToast = useToast();
  const confirmAction = useConfirm();
  const [cancelingPaymentId, setCancelingPaymentId] = useState(null);
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payerFilter, setPayerFilter] = useState("all");
  const [exportingPdf, setExportingPdf] = useState(false);
  const [balance, setBalance] = useState(null);

  function loadBalance() {
    api.get("/dashboard/balance").then((res) => setBalance(res));
  }

  useEffect(() => {
    loadBalance();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const { from, to } = getPeriodRange(period, anchor);
    Promise.all([
      api.get(`/dashboard/summary?from=${from.toISOString()}&to=${to.toISOString()}`),
      api.get(`/dashboard/trend?months=6`),
    ])
      .then(([summaryRes, trendRes]) => {
        if (cancelled) return;
        setSummary(summaryRes);
        setTrend(trendRes.trend);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period, anchor]);

  function loadPayments() {
    const { from, to } = getPeriodRange(period, anchor);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (payerFilter !== "all") params.set("userId", payerFilter);
    return api.get(`/dashboard/payments?${params.toString()}`).then((res) => setPayments(res.payments));
  }

  useEffect(() => {
    loadPayments().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, anchor, payerFilter]);

  async function confirmShare(expenseId, shareId) {
    setConfirmingId(expenseId);
    try {
      await api.patch(`/expenses/${expenseId}/shares/${shareId}`, { paid: true });
      const { from, to } = getPeriodRange(period, anchor);
      const summaryRes = await api.get(
        `/dashboard/summary?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      setSummary(summaryRes);
      loadBalance();
      loadPayments();
    } finally {
      setConfirmingId(null);
    }
  }

  async function cancelPayment(p) {
    const ok = await confirmAction({
      title: "Annuler ce versement",
      message: `Annuler le versement de ${formatAmount(p.amount)} enregistré par ${p.paidBy.name} le ${formatDate(p.date)} ? La part correspondante repassera en attente.`,
      confirmLabel: "Annuler le versement",
      danger: true,
    });
    if (!ok) return;
    setCancelingPaymentId(p.id);
    try {
      await api.delete(`/expenses/${p.expense.id}/shares/${p.shareId}/payments/${p.id}`);
      showToast("Versement annulé.");
      const { from, to } = getPeriodRange(period, anchor);
      const summaryRes = await api.get(
        `/dashboard/summary?from=${from.toISOString()}&to=${to.toISOString()}`
      );
      setSummary(summaryRes);
      loadBalance();
      loadPayments();
    } finally {
      setCancelingPaymentId(null);
    }
  }

  async function exportPdf() {
    setExportingPdf(true);
    try {
      const { from, to } = getPeriodRange(period, anchor);
      const label = formatPeriodLabel(period, anchor);
      const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), label });
      const res = await fetch(`/api/dashboard/export-pdf?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Impossible de générer le PDF.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `appartbudget-rapport-${label.replace(/\s+/g, "-").toLowerCase()}.pdf`;
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

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Tableau de bord</h1>
          <div className="topbar__subtitle">Vue d'ensemble des dépenses du foyer</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
          <button className="btn btn--ghost" onClick={exportPdf} disabled={exportingPdf}>
            <Icon name="download" size={15} /> {exportingPdf ? "Génération..." : "Exporter en PDF"}
          </button>
        </div>
      </div>

      {balance && balance.users.length > 1 && balance.balances.length === 0 && (
        <div className="balance-banner balance-banner--settled">
          <Icon name="checkCircle" size={16} />
          Vous êtes à égalité : aucun solde en attente entre vous.
        </div>
      )}

      {balance && balance.balances.length > 0 && (
        <div className="balance-banner">
          {balance.balances.map((b) => {
            const from = balance.users.find((u) => u.id === b.fromUserId);
            const to = balance.users.find((u) => u.id === b.toUserId);
            if (!from || !to) return null;
            return (
              <div className="balance-banner__row" key={`${b.fromUserId}-${b.toUserId}`}>
                <div className="balance-banner__who">
                  <Avatar user={from} size="sm" />
                  <strong>{from.name}</strong>
                  <span className="text-muted">doit</span>
                  <Icon name="arrowRight" size={14} className="text-muted" />
                  <Avatar user={to} size="sm" />
                  <strong>{to.name}</strong>
                </div>
                <div className="balance-banner__amount">{formatAmount(b.amount)}</div>
              </div>
            );
          })}
        </div>
      )}

      {loading || !summary ? (
        <div className="center-screen" style={{ minHeight: 240 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="card-grid">
            <div className="stat-card stat-card--featured">
              <div className="stat-card__top">
                <span className="stat-card__label">Total sur la période</span>
                <span className="icon-badge icon-badge--primary">
                  <Icon name="wallet" size={17} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalAmount)}</div>
              <div className="stat-card__hint">{summary.expenseCount} dépense(s)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Frais fixes</span>
                <span className="icon-badge icon-badge--primary">
                  <Icon name="repeat" size={16} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalFixed)}</div>
              <div className="stat-card__hint">Loyer, énergie, abonnements...</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Frais ponctuels</span>
                <span className="icon-badge icon-badge--info">
                  <Icon name="shoppingBag" size={16} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalOccasional)}</div>
              <div className="stat-card__hint">Courses, sorties, loisirs...</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Exceptionnelles</span>
                <span className="icon-badge icon-badge--warning">
                  <Icon name="sparkles" size={16} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalExceptional)}</div>
              <div className="stat-card__hint">Réparations, imprévus...</div>
            </div>
            {summary.byUser.map((u) => {
              const ratio = u.assigned > 0 ? Math.min(100, Math.round((u.paid / u.assigned) * 100)) : 100;
              return (
                <div className="stat-card" key={u.userId}>
                  <div className="stat-card__top">
                    <span className="stat-card__label" style={{ display: "flex", alignItems: "center", gap: 8, textTransform: "none" }}>
                      <Avatar user={u} size="sm" /> {u.name}
                    </span>
                  </div>
                  <div className="stat-card__value">{formatAmount(u.assigned)}</div>
                  <div className="progress-bar">
                    <div className="progress-bar__fill" style={{ width: `${ratio}%`, background: u.color }} />
                  </div>
                  <div className={`stat-card__hint${u.pending > 0 ? " stat-card__hint--danger" : " stat-card__hint--success"}`}>
                    {u.pending > 0 ? (
                      <>{formatAmount(u.pending)} restant à confirmer</>
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <Icon name="checkCircle" size={13} /> Tout est réglé
                      </span>
                    )}
                  </div>
                  {u.disbursed > 0 && (
                    <div className="stat-card__hint" style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <Icon name="coins" size={12} /> {formatAmount(u.disbursed)} versés au total
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="chart-grid">
            <div className="card">
              <div className="card__header">
                <h3>Évolution sur 6 mois</h3>
              </div>
              <div className="card__body">
                <TrendBarChart data={trend} />
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <h3>Répartition par catégorie</h3>
              </div>
              <div className="card__body">
                <CategoryPieChart data={summary.byCategory} />
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <h3>Mes paiements en attente</h3>
              {summary.myPending.length > 0 && (
                <span className="pill pill--pending">{summary.myPending.length} à confirmer</span>
              )}
            </div>
            {summary.myPending.length === 0 ? (
              <div className="empty-state">
                <Icon name="checkCircle" size={26} />
                <span>Rien en attente de votre côté, bien joué {user?.name} !</span>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Dépense</th>
                    <th>Catégorie</th>
                    <th>Ma part</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {summary.myPending.map((p) => (
                    <tr key={p.expenseId}>
                      <td className="text-muted">{formatDateShort(p.date)}</td>
                      <td>{p.label}</td>
                      <td>
                        <span className="pill" style={{ background: `${p.categoryColor}22`, color: p.categoryColor }}>
                          {p.categoryIcon} {p.categoryName}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{formatAmount(p.amount)}</div>
                        {p.paidAmount > 0 && (
                          <div className="text-muted" style={{ fontSize: 11.5 }}>
                            {formatAmount(p.paidAmount)} déjà versés / {formatAmount(p.totalAmount)}
                          </div>
                        )}
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={confirmingId === p.expenseId}
                          onClick={() => confirmShare(p.expenseId, p.shareId)}
                        >
                          {confirmingId === p.expenseId ? "..." : "Solder"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <div className="card__header">
              <h3>Historique des paiements</h3>
              <Select
                value={payerFilter}
                onChange={setPayerFilter}
                style={{ minWidth: 180 }}
                options={[
                  { value: "all", label: "Tout le monde" },
                  ...summary.byUser.map((u) => ({ value: u.userId, label: u.name })),
                ]}
              />
            </div>
            {payments.length === 0 ? (
              <div className="empty-state">
                <Icon name="coins" size={26} />
                <span>Aucun versement enregistré sur cette période.</span>
              </div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Dépense</th>
                    <th>Paiement</th>
                    <th>Montant</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td className="text-muted">{formatDate(p.date)}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.expense.label}</div>
                        <span
                          className="pill"
                          style={{ background: `${p.expense.categoryColor}22`, color: p.expense.categoryColor }}
                        >
                          {p.expense.categoryIcon} {p.expense.categoryName}
                        </span>
                        {p.note && (
                          <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                            {p.note}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <Avatar user={p.paidBy} size="sm" />
                          <span style={{ fontWeight: 600 }}>{p.paidBy.name}</span>
                          {!p.isForSelf && (
                            <>
                              <Icon name="arrowRight" size={13} className="text-muted" />
                              <Avatar user={p.forUser} size="sm" />
                              <span style={{ fontWeight: 600 }}>{p.forUser.name}</span>
                            </>
                          )}
                        </div>
                        <div className="text-muted" style={{ fontSize: 11.5, marginTop: 3 }}>
                          {p.isForSelf ? "Pour sa propre part" : `Pour la part de ${p.forUser.name}`}
                        </div>
                      </td>
                      <td style={{ fontWeight: 700 }}>{formatAmount(p.amount)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="icon-btn icon-btn--danger"
                          title="Annuler ce versement"
                          onClick={() => cancelPayment(p)}
                          disabled={cancelingPaymentId === p.id}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
