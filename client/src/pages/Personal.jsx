import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import PeriodSelector from "../components/PeriodSelector.jsx";
import Select from "../components/Select.jsx";
import Modal from "../components/Modal.jsx";
import Icon from "../components/Icon.jsx";
import Avatar from "../components/Avatar.jsx";
import { formatAmount, formatDate, toInputDate } from "../utils/format.js";
import { getPeriodRange } from "../utils/period.js";

export default function Personal() {
  const { user } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [users, setUsers] = useState([]);
  const [viewUserId, setViewUserId] = useState(user?.id || "");
  const [period, setPeriod] = useState("month");
  const [anchor, setAnchor] = useState(new Date());
  const [summary, setSummary] = useState(null);
  const [groups, setGroups] = useState([]);
  const [recurringTemplates, setRecurringTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { kind, transaction? }
  const [recurringModalState, setRecurringModalState] = useState(null); // null | { template? }
  const [generatingId, setGeneratingId] = useState(null);

  const isOwn = viewUserId === user?.id;

  useEffect(() => {
    api.get("/users").then((res) => {
      setUsers(res.users);
      if (!viewUserId && res.users[0]) setViewUserId(user?.id || res.users[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    if (!viewUserId) return;
    setLoading(true);
    const { from, to } = getPeriodRange(period, anchor);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), userId: viewUserId });
    const [s, g, r] = await Promise.all([
      api.get(`/personal?${params.toString()}`),
      api.get(`/personal/groups?userId=${viewUserId}`),
      api.get(`/personal-recurring?userId=${viewUserId}`),
    ]);
    setSummary(s);
    setGroups(g.groups);
    setRecurringTemplates(r.templates);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewUserId, period, anchor]);

  async function remove(tx) {
    const ok = await confirmAction({
      title: "Supprimer cette ligne",
      message: `Supprimer "${tx.label}" (${formatAmount(tx.amount)}) ?`,
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
      message: `Supprimer définitivement "${group.label}" et ses ${group.installmentCount} lignes réparties dans le temps ?`,
      confirmLabel: "Supprimer tout",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/personal/groups/${group.groupId}`);
    showToast(`"${group.label}" supprimé.`);
    load();
  }

  async function toggleRecurringActive(template) {
    await api.put(`/personal-recurring/${template.id}`, {
      label: template.label,
      amount: template.amount,
      kind: template.kind,
      dayOfMonth: template.dayOfMonth,
      active: !template.active,
    });
    load();
  }

  async function removeRecurring(template) {
    const ok = await confirmAction({
      title: "Supprimer cet abonnement récurrent",
      message: `Supprimer définitivement "${template.label}" ? Les lignes déjà générées ne seront pas supprimées.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/personal-recurring/${template.id}`);
    showToast(`"${template.label}" supprimé.`);
    load();
  }

  async function generateRecurringNow(template) {
    setGeneratingId(template.id);
    try {
      await api.post(`/personal-recurring/${template.id}/generate-now`);
      showToast(`"${template.label}" a été générée pour le mois en cours.`);
      load();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setGeneratingId(null);
    }
  }

  const viewedUser = users.find((u) => u.id === viewUserId);
  const remaining = summary?.remaining ?? 0;

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Budget personnel</h1>
          <div className="topbar__subtitle">Revenus et dépenses propres à chacun, séparés du foyer</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Select
            value={viewUserId}
            onChange={setViewUserId}
            style={{ minWidth: 190 }}
            options={users.map((u) => ({
              value: u.id,
              label: u.id === user?.id ? `${u.name} (moi)` : u.name,
            }))}
          />
          <PeriodSelector period={period} onPeriodChange={setPeriod} anchor={anchor} onAnchorChange={setAnchor} />
        </div>
      </div>

      {!isOwn && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12.5,
            color: "var(--color-text-muted)",
            background: "var(--color-surface-2)",
            border: "1px solid var(--color-border)",
            borderRadius: 9,
            padding: "8px 12px",
            marginBottom: 18,
          }}
        >
          <Avatar user={viewedUser} size="sm" />
          Vous consultez le budget de {viewedUser?.name} en lecture seule.
        </div>
      )}

      {loading || !summary ? (
        <div className="center-screen" style={{ minHeight: 240 }}>
          <div className="spinner" />
        </div>
      ) : (
        <>
          <div className="card-grid">
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Revenus</span>
                <span className="icon-badge icon-badge--success">
                  <Icon name="wallet" size={17} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalIncome)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Dépenses</span>
                <span className="icon-badge icon-badge--warning">
                  <Icon name="shoppingBag" size={16} />
                </span>
              </div>
              <div className="stat-card__value">{formatAmount(summary.totalExpense)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card__top">
                <span className="stat-card__label">Reste</span>
                <span className={`icon-badge ${remaining >= 0 ? "icon-badge--primary" : "icon-badge--danger"}`}>
                  <Icon name="coins" size={16} />
                </span>
              </div>
              <div className="stat-card__value" style={{ color: remaining < 0 ? "var(--color-danger)" : undefined }}>
                {formatAmount(remaining)}
              </div>
            </div>
          </div>

          {isOwn && (
            <div className="flex-between" style={{ marginBottom: 18, flexWrap: "wrap", gap: 10 }}>
              <div />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn--ghost" onClick={() => setRecurringModalState({})}>
                  <Icon name="repeat" size={15} /> Abonnement récurrent
                </button>
                <button className="btn btn--ghost" onClick={() => setModalState({ kind: "income" })}>
                  <Icon name="plus" size={15} /> Revenu
                </button>
                <button className="btn btn--primary" onClick={() => setModalState({ kind: "expense" })}>
                  <Icon name="plus" size={15} /> Dépense
                </button>
              </div>
            </div>
          )}

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <h3>Mouvements de la période</h3>
            </div>
            {summary.transactions.length === 0 ? (
              <div className="empty-state">
                <Icon name="inbox" size={26} />
                <span>Rien sur cette période.</span>
              </div>
            ) : (
              <table className="table">
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
                      <td className="text-muted">{formatDate(t.date)}</td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontWeight: 600 }}>{t.label}</span>
                          {t.recurringTemplateId && (
                            <span className="pill pill--neutral" title="Abonnement récurrent">
                              <Icon name="repeat" size={11} />
                            </span>
                          )}
                        </div>
                        {t.note && (
                          <div className="text-muted" style={{ fontSize: 12, marginTop: 3 }}>
                            {t.note}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: t.kind === "income" ? "var(--color-success)" : "var(--color-text)" }}>
                        {t.kind === "income" ? "+" : "-"}
                        {formatAmount(t.amount)}
                      </td>
                      {isOwn && (
                        <td style={{ textAlign: "right" }}>
                          <div className="row-actions">
                            <button className="icon-btn" title="Modifier" onClick={() => setModalState({ kind: t.kind, transaction: t })}>
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
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="card__header">
                <h3>Abonnements et revenus récurrents</h3>
              </div>
              {recurringTemplates.length === 0 ? (
                <div className="empty-state">
                  <Icon name="repeat" size={26} />
                  <span>Aucun abonnement récurrent. Ajoutez un forfait téléphonique, un salaire...</span>
                </div>
              ) : (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Libellé</th>
                      <th>Montant</th>
                      <th>Échéance</th>
                      <th>Statut</th>
                      {isOwn && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {recurringTemplates.map((rt) => (
                      <tr key={rt.id} style={{ opacity: rt.active ? 1 : 0.5 }}>
                        <td style={{ fontWeight: 600 }}>{rt.label}</td>
                        <td style={{ fontWeight: 700, color: rt.kind === "income" ? "var(--color-success)" : "var(--color-text)" }}>
                          {rt.kind === "income" ? "+" : "-"}
                          {formatAmount(rt.amount)}
                        </td>
                        <td className="text-muted">Le {rt.dayOfMonth} du mois</td>
                        <td>
                          {rt.active ? (
                            <span className="pill pill--paid">Actif</span>
                          ) : (
                            <span className="pill pill--neutral">En pause</span>
                          )}
                        </td>
                        {isOwn && (
                          <td style={{ textAlign: "right" }}>
                            <div className="row-actions">
                              <button
                                className="btn btn--ghost btn--sm"
                                onClick={() => generateRecurringNow(rt)}
                                disabled={generatingId === rt.id}
                              >
                                Générer ce mois
                              </button>
                              <button className="icon-btn" title="Modifier" onClick={() => setRecurringModalState({ template: rt })}>
                                <Icon name="pencil" size={14} />
                              </button>
                              <button
                                className="icon-btn"
                                title={rt.active ? "Mettre en pause" : "Réactiver"}
                                onClick={() => toggleRecurringActive(rt)}
                              >
                                <Icon name={rt.active ? "pause" : "play"} size={14} />
                              </button>
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
                <h3>Étalés dans le temps</h3>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Libellé</th>
                    <th>Montant total</th>
                    <th>Période</th>
                    {isOwn && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.groupId}>
                      <td style={{ fontWeight: 600 }}>
                        {g.label}
                        {g.note && (
                          <div className="text-muted" style={{ fontSize: 12, marginTop: 3, fontWeight: 400 }}>
                            {g.note}
                          </div>
                        )}
                      </td>
                      <td style={{ fontWeight: 700, color: g.kind === "income" ? "var(--color-success)" : "var(--color-text)" }}>
                        {formatAmount(g.totalAmount)}
                        <span className="text-muted" style={{ fontWeight: 500 }}> / {g.installmentCount} mois</span>
                      </td>
                      <td className="text-muted">
                        {formatDate(g.firstDate)} → {formatDate(g.lastDate)}
                      </td>
                      {isOwn && (
                        <td style={{ textAlign: "right" }}>
                          <button className="icon-btn icon-btn--danger" title="Supprimer la série" onClick={() => removeGroup(g)}>
                            <Icon name="trash" size={14} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modalState && (
        <PersonalTransactionModal
          kind={modalState.kind}
          transaction={modalState.transaction}
          onClose={() => setModalState(null)}
          onSaved={() => {
            setModalState(null);
            showToast("Enregistré.");
            load();
          }}
        />
      )}

      {recurringModalState && (
        <PersonalRecurringModal
          template={recurringModalState.template}
          onClose={() => setRecurringModalState(null)}
          onSaved={() => {
            setRecurringModalState(null);
            showToast("Abonnement enregistré.");
            load();
          }}
        />
      )}
    </div>
  );
}

function PersonalRecurringModal({ template, onClose, onSaved }) {
  const isEdit = Boolean(template);
  const [label, setLabel] = useState(template?.label || "");
  const [amount, setAmount] = useState(template?.amount ?? "");
  const [kind, setKind] = useState(template?.kind || "expense");
  const [dayOfMonth, setDayOfMonth] = useState(template?.dayOfMonth ?? 1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const canSubmit = label.trim() && numericAmount > 0 && dayOfMonth;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const payload = {
        label: label.trim(),
        amount: numericAmount,
        kind,
        dayOfMonth: Number(dayOfMonth),
        active: template?.active ?? true,
      };
      if (isEdit) {
        await api.put(`/personal-recurring/${template.id}`, payload);
      } else {
        await api.post("/personal-recurring", payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer cet abonnement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Modifier l'abonnement récurrent" : "Nouvel abonnement récurrent"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="personal-recurring-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="personal-recurring-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="pr-label">Libellé</label>
          <input
            id="pr-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ex: Forfait téléphonique"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="pr-kind">Type</label>
          <Select
            id="pr-kind"
            value={kind}
            onChange={setKind}
            options={[
              { value: "expense", label: "Dépense" },
              { value: "income", label: "Revenu" },
            ]}
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="pr-amount">Montant (€)</label>
            <input
              id="pr-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="pr-day">Jour d'échéance</label>
            <input
              id="pr-day"
              type="number"
              min="1"
              max="28"
              value={dayOfMonth}
              onChange={(e) => setDayOfMonth(e.target.value)}
              required
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}

function PersonalTransactionModal({ kind, transaction, onClose, onSaved }) {
  const isEdit = Boolean(transaction);
  const [label, setLabel] = useState(transaction?.label || "");
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [laterAmount, setLaterAmount] = useState("");
  const [sameAsFirst, setSameAsFirst] = useState(true);
  const [date, setDate] = useState(transaction ? toInputDate(transaction.date) : toInputDate(new Date()));
  const [note, setNote] = useState(transaction?.note || "");
  const [months, setMonths] = useState(1);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const numericAmount = Number(amount) || 0;
  const numericMonths = Number(months) || 1;
  const isInstallment = kind === "expense" && numericMonths > 1;
  const numericLaterAmount = sameAsFirst ? numericAmount : Number(laterAmount) || 0;
  const canSubmit =
    label.trim() && numericAmount > 0 && date && numericMonths >= 1 && (!isInstallment || numericLaterAmount > 0);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        await api.put(`/personal/${transaction.id}`, {
          label: label.trim(),
          amount: numericAmount,
          kind,
          date,
          note: note.trim() || null,
        });
      } else {
        await api.post("/personal", {
          label: label.trim(),
          amount: numericAmount,
          laterAmount: isInstallment ? numericLaterAmount : undefined,
          kind,
          date,
          note: note.trim() || null,
          months: numericMonths,
        });
      }
      onSaved();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={
        isEdit
          ? `Modifier ${kind === "income" ? "le revenu" : "la dépense"}`
          : kind === "income"
          ? "Nouveau revenu"
          : "Nouvelle dépense"
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="personal-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="personal-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="p-label">Libellé</label>
          <input
            id="p-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={kind === "income" ? "Ex: Salaire" : "Ex: Vêtements"}
            required
          />
        </div>

        <div className="field-row">
          <div className="field">
            <label htmlFor="p-amount">Montant {isInstallment ? "(1ère mensualité)" : ""} (€)</label>
            <input
              id="p-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="p-date">{isEdit ? "Date" : "À partir du"}</label>
            <input id="p-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
        </div>

        {!isEdit && (
          <div className="field">
            <label htmlFor="p-months">
              {kind === "income" ? "Répéter pendant combien de mois ?" : "Payer en combien de fois ?"}
            </label>
            <input
              id="p-months"
              type="number"
              min="1"
              max="36"
              value={months}
              onChange={(e) => setMonths(e.target.value)}
            />
            {numericMonths > 1 && kind === "income" && (
              <div className="text-muted" style={{ fontSize: 12.5, marginTop: 6 }}>
                {formatAmount(numericAmount)} par mois pendant {numericMonths} mois.
              </div>
            )}
          </div>
        )}

        {!isEdit && isInstallment && (
          <>
            <div className="field">
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={sameAsFirst}
                  onChange={(e) => setSameAsFirst(e.target.checked)}
                  style={{ width: "auto" }}
                />
                Les mensualités suivantes ont le même montant que la 1ère
              </label>
            </div>

            {!sameAsFirst && (
              <div className="field">
                <label htmlFor="p-later-amount">Montant des mensualités suivantes (€)</label>
                <input
                  id="p-later-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={laterAmount}
                  onChange={(e) => setLaterAmount(e.target.value)}
                  required
                />
              </div>
            )}

            {numericAmount > 0 && numericLaterAmount > 0 && (
              <div className="text-muted" style={{ fontSize: 12.5, marginTop: -10, marginBottom: 16 }}>
                {sameAsFirst
                  ? `Soit ${formatAmount(numericAmount)} par mois pendant ${numericMonths} mois.`
                  : `Soit ${formatAmount(numericAmount)} puis ${formatAmount(numericLaterAmount)} par mois pendant ${numericMonths - 1} mois.`}
              </div>
            )}
          </>
        )}

        <div className="field">
          <label htmlFor="p-note">Note (optionnel)</label>
          <textarea id="p-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </form>
    </Modal>
  );
}
