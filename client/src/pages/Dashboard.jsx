import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import CategoryPieChart from "../components/CategoryPieChart.jsx";
import TrendBarChart from "../components/TrendBarChart.jsx";
import Avatar from "../components/Avatar.jsx";
import Icon from "../components/Icon.jsx";
import Select from "../components/Select.jsx";
import { formatAmount, formatDate, formatDateShort } from "../utils/format.js";
import { getPeriodRange } from "../utils/period.js";

export default function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);
  const [payments, setPayments] = useState([]);
  const [payerFilter, setPayerFilter] = useState("all");

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

  useEffect(() => {
    let cancelled = false;
    const { from, to } = getPeriodRange(period, anchor);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() });
    if (payerFilter !== "all") params.set("userId", payerFilter);
    api.get(`/dashboard/payments?${params.toString()}`).then((res) => {
      if (!cancelled) setPayments(res.payments);
    });
    return () => {
      cancelled = true;
    };
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
    } finally {
      setConfirmingId(null);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Tableau de bord</h1>
          <div className="topbar__subtitle">Vue d'ensemble des dépenses du foyer</div>
        </div>
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
      </div>

      {loading || !summary ? (
        <div className="center-screen" style={{ minHeight: 240 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="card-grid">
            <div className="stat-card">
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
                    <th>Payé par</th>
                    <th>Part de</th>
                    <th>Montant</th>
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
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Avatar user={p.paidBy} size="sm" />
                          {p.paidBy.name}
                        </div>
                      </td>
                      <td>
                        {p.isForSelf ? (
                          <span className="text-muted">Sa propre part</span>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <Avatar user={p.forUser} size="sm" />
                            {p.forUser.name}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 700 }}>{formatAmount(p.amount)}</td>
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
