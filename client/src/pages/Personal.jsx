import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import Select from "../components/Select.jsx";
import Icon from "../components/Icon.jsx";
import Avatar from "../components/Avatar.jsx";
import PersonalEntryModal from "../components/PersonalEntryModal.jsx";
import { formatAmount, formatDate } from "../utils/format.js";
import { getPeriodRange, formatPeriodLabel, nextOccurrenceDate } from "../utils/period.js";

function SignedAmount({ kind, amount }) {
  return (
    <span style={{ fontWeight: 700, color: kind === "income" ? "var(--color-success)" : "var(--color-text)", whiteSpace: "nowrap" }}>
      {kind === "income" ? "+" : "−"}
      {formatAmount(amount)}
    </span>
  );
}

export default function Personal() {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [users, setUsers] = useState([]);
  const [viewUserId, setViewUserId] = useState(user?.id || "");
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [householdShare, setHouseholdShare] = useState(0);
  const [groups, setGroups] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { transaction? , template? }
  const [busyId, setBusyId] = useState(null);

  const isOwn = viewUserId === user?.id;
  const periodLabel = formatPeriodLabel(period, anchor);

  useEffect(() => {
    api.get("/users").then((res) => setUsers(res.users));
  }, []);

  async function load() {
    if (!viewUserId) return;
    setLoading(true);
    const { from, to } = getPeriodRange(period, anchor);
    const range = { from: from.toISOString(), to: to.toISOString() };
    const [s, g, r, household] = await Promise.all([
      api.get(`/personal?${new URLSearchParams({ ...range, userId: viewUserId })}`),
      api.get(`/personal/groups?userId=${viewUserId}`),
      api.get(`/personal-recurring?userId=${viewUserId}`),
      api.get(`/dashboard/summary?${new URLSearchParams(range)}`),
    ]);
    setSummary(s);
    setGroups(g.groups);
    setRecurringTemplates(r.templates);
    setHouseholdShare(household.byUser.find((u) => u.userId === viewUserId)?.assigned || 0);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewUserId, period, anchor]);

  async function remove(tx) {
    const ok = await confirmAction({
      title: "Supprimer cette ligne",
      message: `Supprimer « ${tx.label} » (${formatAmount(tx.amount)}) ?${
        tx.recurringTemplateId ? " Elle ne sera pas recréée automatiquement pour ce mois-ci." : ""
      }`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/personal/${tx.id}`);
    showToast("Ligne supprimée.");
    load();
  }

  async function removeGroup(group) {
    const ok = await confirmAction({
      title: "Supprimer cette série",
      message: `Supprimer définitivement « ${group.label} » et ses ${group.itemCount} mensualités ?`,
      confirmLabel: "Supprimer tout",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/personal/groups/${group.groupId}`);
    showToast(`« ${group.label} » supprimé.`);
    load();
  }

  async function regenerateGroup(group) {
    try {
      const { created } = await api.post(`/personal/groups/${group.groupId}/regenerate`);
      showToast(
        created.length
          ? `${created.length} mensualité${created.length > 1 ? "s" : ""} recréée${created.length > 1 ? "s" : ""}.`
          : "Rien à recréer, toutes les mensualités sont là."
      );
      load();
    } catch (err) {
      showToast(err.message || "Impossible de recréer les mensualités.", "error");
    }
  }

  async function toggleRecurringActive(template) {
    setBusyId(template.id);
    try {
      const res = await api.put(`/personal-recurring/${template.id}`, {
        label: template.label,
        amount: template.amount,
        kind: template.kind,
        dayOfMonth: template.dayOfMonth,
        active: !template.active,
      });
      const removed = res.occurrences?.removed || 0;
      showToast(
        template.active
          ? `« ${template.label} » en pause${removed ? ` (${removed} mois à venir retiré${removed > 1 ? "s" : ""})` : ""}.`
          : `« ${template.label} » réactivé.`
      );
      load();
    } finally {
      setBusyId(null);
    }
  }

  async function removeRecurring(template) {
    const ok = await confirmAction({
      title: "Supprimer",
      message: `Supprimer définitivement « ${template.label} » ? Les mois passés restent ; les mois à venir sont retirés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/personal-recurring/${template.id}`);
    showToast(`« ${template.label} » supprimé.`);
    load();
  }

  async function restoreRecurringThisMonth(template) {
    setBusyId(template.id);
    try {
      const res = await api.post(`/personal-recurring/${template.id}/generate-now`);
      showToast(res.created ? `« ${template.label} » recréé pour ce mois-ci.` : `« ${template.label} » est déjà présent ce mois-ci.`);
      load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setBusyId(null);
    }
  }

  const viewedUser = users.find((u) => u.id === viewUserId);
  const income = summary?.totalIncome ?? 0;
  const expense = summary?.totalExpense ?? 0;
  const leftover = Math.round((income - expense - householdShare) * 100) / 100;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>{isOwn ? "Mon budget" : `Budget de ${viewedUser?.name || "…"}`}</h1>
          <div className="topbar__subtitle">Revenus et dépenses personnels, en dehors des dépenses communes du foyer.</div>
        </div>
        <div className="topbar__actions">
          {users.length > 1 && (
            <Select
              value={viewUserId}
              onChange={setViewUserId}
              style={{ minWidth: 200 }}
              options={users.map((u) => ({
                value: u.id,
                label: u.id === user?.id ? "Mon budget" : `Budget de ${u.name}`,
              }))}
            />
          )}
          {isOwn && (
            <button className="btn btn--primary" onClick={() => setModalState({})}>
              <Icon name="plus" size={15} /> Ajouter
            </button>
          )}
        </div>
      </div>

      {!isOwn && (
        <div className="notice" style={{ marginBottom: 18 }}>
          <Avatar user={viewedUser} size="sm" />
          <span>Vous consultez le budget de {viewedUser?.name} en lecture seule : seul·e {viewedUser?.name} peut le modifier.</span>
        </div>
      )}

      <div className="toolbar">
        <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
      </div>

      {loading || !summary ? (
        <div className="center-screen" style={{ minHeight: 240 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="card-grid card-grid--kpi">
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Revenus</span>
                <span className="icon-badge icon-badge--success">
                  <Icon name="wallet" size={17} />
                </span>
              </div>
              <div className="stat-card__value" style={{ color: "var(--color-success)" }}>+{formatAmount(income)}</div>
              <div className="stat-card__hint">Salaire, aides, remboursements…</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Dépenses perso</span>
                <span className="icon-badge icon-badge--warning">
                  <Icon name="shoppingBag" size={16} />
                </span>
              </div>
              <div className="stat-card__value">−{formatAmount(expense)}</div>
              <div className="stat-card__hint">Ce qui ne concerne que {isOwn ? "vous" : viewedUser?.name}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Part du foyer</span>
                <span className="icon-badge icon-badge--primary">
                  <Icon name="dashboard" size={16} />
                </span>
              </div>
              <div className="stat-card__value">−{formatAmount(householdShare)}</div>
              <div className="stat-card__hint">
                {isOwn ? "Votre part" : "Sa part"} des{" "}
                <Link to="/depenses" className="stat-card__link">
                  dépenses communes
                </Link>
              </div>
            </div>
            <div className={`stat-card stat-card--featured${leftover < 0 ? " stat-card--negative" : ""}`}>
              <div className="stat-card__top">
                <span className="stat-card__label">Reste à vivre</span>
                <span className="icon-badge">
                  <Icon name="coins" size={16} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(leftover)}</div>
              <div className="stat-card__hint">Revenus − dépenses perso − part du foyer</div>
            </div>
          </div>

          <div className="card">
            <div className="card__header">
              <div>
                <h3>Mouvements</h3>
                <div className="card__subtitle">{periodLabel}</div>
              </div>
            </div>
            {summary.transactions.length === 0 ? (
              <div className="empty-state">
                <Icon name="inbox" size={26} />
                <span>Rien d'enregistré pour {periodLabel}.</span>
                {isOwn && (
                  <button className="btn btn--primary btn--sm" onClick={() => setModalState({})}>
                    <Icon name="plus" size={14} /> Ajouter une dépense ou un revenu
                  </button>
                )}
              </div>
            ) : (
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Libellé</th>
                    <th>Montant</th>
                    {isOwn && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {summary.transactions.map((t) => (
                    <tr key={t.id}>
                      <td className="text-muted" data-label="Date">{formatDate(t.date)}</td>
                      <td className="table__primary">
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 600 }}>{t.label}</span>
                          {t.recurringTemplateId && (
                            <span className="pill pill--neutral">
                              <Icon name="repeat" size={11} /> Chaque mois
                            </span>
                          )}
                        </div>
                        {t.note && <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>{t.note}</div>}
                      </td>
                      <td data-label="Montant">
                        <SignedAmount kind={t.kind} amount={t.amount} />
                      </td>
                      {isOwn && (
                        <td className="table__actions">
                          <div className="row-actions">
                            <button className="icon-btn" title="Modifier" onClick={() => setModalState({ transaction: t })}>
                              <Icon name="pencil" size={14} />
                            </button>
                            <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => remove(t)}>
                              <Icon name="trash" size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {(recurringTemplates.length > 0 || isOwn) && (
            <div className="card">
              <div className="card__header">
                <div>
                  <h3>Chaque mois</h3>
                  <div className="card__subtitle">Salaire, abonnements… ajoutés automatiquement chaque mois</div>
                </div>
              </div>
              {recurringTemplates.length === 0 ? (
                <div className="empty-state empty-state--compact">
                  <Icon name="repeat" size={22} />
                  <span>Rien pour l'instant. Choisissez « Chaque mois » en ajoutant un salaire ou un forfait.</span>
                </div>
              ) : (
                <table className="table table--stack">
                  <thead>
                    <tr>
                      <th>Libellé</th>
                      <th>Montant</th>
                      <th>Prochaine fois</th>
                      {isOwn && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {recurringTemplates.map((rt) => (
                      <tr key={rt.id} className={rt.active ? "" : "row--muted"}>
                        <td className="table__primary">
                          <span style={{ fontWeight: 600 }}>{rt.label}</span>
                          {!rt.active && (
                            <span className="pill pill--neutral" style={{ marginLeft: 6 }}>
                              En pause
                            </span>
                          )}
                        </td>
                        <td data-label="Montant">
                          <SignedAmount kind={rt.kind} amount={rt.amount} />
                          <span className="text-muted"> / mois</span>
                        </td>
                        <td data-label="Prochaine fois" className="text-muted">
                          {rt.active ? `${formatDate(nextOccurrenceDate(rt.dayOfMonth))} (le ${rt.dayOfMonth} du mois)` : "—"}
                        </td>
                        {isOwn && (
                          <td className="table__actions">
                            <div className="row-actions">
                              <button className="icon-btn" title="Modifier (s'applique aussi aux mois à venir)" onClick={() => setModalState({ template: rt })}>
                                <Icon name="pencil" size={14} />
                              </button>
                              <button className="icon-btn" title={rt.active ? "Mettre en pause" : "Réactiver"} onClick={() => toggleRecurringActive(rt)} disabled={busyId === rt.id}>
                                <Icon name={rt.active ? "pause" : "play"} size={14} />
                              </button>
                              {rt.active && (
                                <button className="icon-btn" title="Recréer la ligne de ce mois (si supprimée par erreur)" onClick={() => restoreRecurringThisMonth(rt)} disabled={busyId === rt.id}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => removeRecurring(rt)}>
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {groups.length > 0 && (
            <div className="card">
              <div className="card__header">
                <div>
                  <h3>En plusieurs fois</h3>
                  <div className="card__subtitle">Achats ou revenus étalés sur un nombre de mois connu</div>
                </div>
              </div>
              <table className="table table--stack">
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th>Total</th>
                    <th>Période</th>
                    {isOwn && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => {
                    const missing = g.installmentCount - g.itemCount;
                    return (
                      <tr key={g.groupId}>
                        <td className="table__primary">
                          <div style={{ fontWeight: 600 }}>{g.label}</div>
                          {g.note && <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>{g.note}</div>}
                          {missing > 0 && (
                            <span className="pill pill--pending" style={{ marginTop: 5 }}>
                              {missing} mensualité{missing > 1 ? "s" : ""} supprimée{missing > 1 ? "s" : ""}
                            </span>
                          )}
                        </td>
                        <td data-label="Total">
                          <SignedAmount kind={g.kind} amount={g.totalAmount} />
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            en {g.itemCount}
                            {missing > 0 ? ` (sur ${g.installmentCount})` : ""} mois
                          </div>
                        </td>
                        <td data-label="Période" className="text-muted">
                          {formatDate(g.firstDate)} → {formatDate(g.lastDate)}
                        </td>
                        {isOwn && (
                          <td className="table__actions">
                            <div className="row-actions">
                              {missing > 0 && (
                                <button className="icon-btn" title="Recréer les mensualités supprimées" onClick={() => regenerateGroup(g)}>
                                  <Icon name="refresh" size={14} />
                                </button>
                              )}
                              <button className="icon-btn icon-btn--danger" title="Supprimer toute la série" onClick={() => removeGroup(g)}>
                                <Icon name="trash" size={14} />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modalState && (
        <PersonalEntryModal
          transaction={modalState.transaction}
          template={modalState.template}
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
