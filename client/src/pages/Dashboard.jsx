import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import CategoryPieChart from "../components/CategoryPieChart.jsx";
import TrendBarChart from "../components/TrendBarChart.jsx";
import Avatar from "../components/Avatar.jsx";
import { formatAmount, formatDateShort } from "../utils/format.js";
import { getPeriodRange } from "../utils/period.js";

export default function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingId, setConfirmingId] = useState(null);

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

  async function confirmShare(expenseId) {
    setConfirmingId(expenseId);
    try {
      await api.patch(`/expenses/${expenseId}/shares/mine`, { paid: true });
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
              <div className="stat-card__label">Total sur la période</div>
              <div className="stat-card__value">{formatAmount(summary.totalAmount)}</div>
              <div className="stat-card__hint">{summary.expenseCount} dépense(s)</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">
                <span className="pill pill--kind-fixed">Fixes</span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalFixed)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__label">
                <span className="pill pill--kind-exceptional">Exceptionnelles</span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalExceptional)}</div>
            </div>
            {summary.byUser.map((u) => (
              <div className="stat-card" key={u.userId}>
                <div className="stat-card__label">
                  <Avatar user={u} size="sm" /> {u.name}
                </div>
                <div className="stat-card__value">{formatAmount(u.assigned)}</div>
                <div className="stat-card__hint">
                  {u.pending > 0 ? (
                    <span style={{ color: "var(--color-danger)" }}>
                      {formatAmount(u.pending)} restant à confirmer
                    </span>
                  ) : (
                    <span style={{ color: "var(--color-success)" }}>Tout est réglé ✓</span>
                  )}
                </div>
              </div>
            ))}
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
              <div className="empty-state">Rien en attente de votre côté, bien joué {user?.name} 🎉</div>
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
                      <td style={{ fontWeight: 600 }}>{formatAmount(p.amount)}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          className="btn btn--primary btn--sm"
                          disabled={confirmingId === p.expenseId}
                          onClick={() => confirmShare(p.expenseId)}
                        >
                          {confirmingId === p.expenseId ? "..." : "Confirmer le paiement"}
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
