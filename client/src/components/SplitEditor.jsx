import { formatAmount } from "../utils/format.js";
import Avatar from "./Avatar.jsx";

const TYPES = [
  { value: "equal", label: "À parts égales" },
  { value: "percentage", label: "En pourcentage" },
  { value: "custom", label: "En montants" },
];

function round2(n) {
  return Math.round(n * 100) / 100;
}

// Point de depart a parts egales pour le mode choisi : sans ce
// pre-remplissage, passer en "pourcentage" ou "montants" laissait tous les
// champs vides et le bouton Enregistrer grise sans explication.
function equalConfig(type, participantIds, amount) {
  const n = participantIds.length;
  if (!n) return [];
  const total = type === "percentage" ? 100 : amount || 0;
  const step = type === "percentage" ? 10 : 100;
  const base = Math.floor((total / n) * step) / step;
  return participantIds.map((userId, i) => ({
    userId,
    value: i === n - 1 ? round2(total - base * (n - 1)) : base,
  }));
}

export default function SplitEditor({ users, amount, value, onChange }) {
  const { splitType, participantIds, splitConfig } = value;

  function setSplitType(newType) {
    if (newType === splitType) return;
    onChange({
      ...value,
      splitType: newType,
      splitConfig: newType === "equal" ? [] : equalConfig(newType, participantIds, amount),
    });
  }

  function toggleParticipant(userId) {
    const isIn = participantIds.includes(userId);
    let nextParticipants = isIn ? participantIds.filter((id) => id !== userId) : [...participantIds, userId];
    if (nextParticipants.length === 0) nextParticipants = [userId];
    onChange({
      ...value,
      participantIds: nextParticipants,
      splitConfig: splitType === "equal" ? [] : equalConfig(splitType, nextParticipants, amount),
    });
  }

  function setConfigValue(userId, rawValue) {
    const numeric = rawValue === "" ? 0 : Number(rawValue);
    const existing = splitConfig.find((c) => c.userId === userId);
    const nextConfig = existing
      ? splitConfig.map((c) => (c.userId === userId ? { ...c, value: numeric } : c))
      : [...splitConfig, { userId, value: numeric }];
    onChange({ ...value, splitConfig: nextConfig });
  }

  function configValue(userId) {
    return splitConfig.find((c) => c.userId === userId)?.value ?? "";
  }

  const equalShare = amount && participantIds.length ? amount / participantIds.length : 0;
  const configTotal = splitConfig
    .filter((c) => participantIds.includes(c.userId))
    .reduce((s, c) => s + (Number(c.value) || 0), 0);
  const expectedTotal = splitType === "percentage" ? 100 : amount || 0;
  const gap = round2(expectedTotal - configTotal);
  const mismatch = splitType !== "equal" && Math.abs(gap) > 0.01;

  function amountFor(userId) {
    if (splitType === "equal") return equalShare;
    const v = Number(configValue(userId)) || 0;
    return splitType === "percentage" ? ((amount || 0) * v) / 100 : v;
  }

  if (users.length < 2) {
    return <div className="text-muted" style={{ fontSize: 13 }}>Seul membre du foyer : la dépense vous est entièrement attribuée.</div>;
  }

  return (
    <div>
      <div className="split-type-toggle">
        {TYPES.map((t) => (
          <button
            key={t.value}
            type="button"
            className={splitType === t.value ? "active" : ""}
            onClick={() => setSplitType(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="split-editor">
        {users.map((u) => {
          const included = participantIds.includes(u.id);
          return (
            <div className="split-editor__row" key={u.id} style={{ opacity: included ? 1 : 0.5 }}>
              <label className="split-editor__user" style={{ cursor: "pointer" }} title={included ? "Exclure de cette dépense" : "Inclure dans cette dépense"}>
                <input type="checkbox" checked={included} onChange={() => toggleParticipant(u.id)} style={{ marginRight: 2 }} />
                <Avatar user={u} size="sm" />
                {u.name}
              </label>

              {!included && <span className="text-muted" style={{ fontSize: 12.5 }}>Ne paie rien</span>}

              {included && splitType === "equal" && (
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>{formatAmount(equalShare)}</span>
              )}

              {included && splitType !== "equal" && (
                <div className="split-editor__input">
                  {splitType === "percentage" && amount > 0 && (
                    <span className="text-muted" style={{ fontSize: 12 }}>{formatAmount(amountFor(u.id))}</span>
                  )}
                  <input
                    type="number"
                    min="0"
                    max={splitType === "percentage" ? 100 : undefined}
                    step={splitType === "percentage" ? "0.1" : "0.01"}
                    value={configValue(u.id)}
                    onChange={(e) => setConfigValue(u.id, e.target.value)}
                    aria-label={`Part de ${u.name}`}
                  />
                  <span className="text-muted">{splitType === "percentage" ? "%" : "€"}</span>
                </div>
              )}
            </div>
          );
        })}

        {splitType !== "equal" && (
          <div className={`split-editor__total${mismatch ? " mismatch" : ""}`}>
            <span>
              {!mismatch
                ? "Tout est réparti"
                : gap > 0
                ? `Il reste ${splitType === "percentage" ? `${gap.toFixed(1)} %` : formatAmount(gap)} à répartir`
                : `${splitType === "percentage" ? `${(-gap).toFixed(1)} %` : formatAmount(-gap)} de trop`}
            </span>
            <span>
              {splitType === "percentage" ? `${configTotal.toFixed(1)} %` : formatAmount(configTotal)}
              {" / "}
              {splitType === "percentage" ? "100 %" : formatAmount(amount || 0)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export function buildDefaultSplitValue(users) {
  return {
    splitType: "equal",
    participantIds: users.map((u) => u.id),
    splitConfig: [],
  };
}

export function isSplitValid(value, amount) {
  if (value.splitType === "equal") return value.participantIds.length > 0;
  const total = value.splitConfig
    .filter((c) => value.participantIds.includes(c.userId))
    .reduce((s, c) => s + (Number(c.value) || 0), 0);
  const expected = value.splitType === "percentage" ? 100 : amount;
  return Math.abs(total - expected) <= 0.01;
}

// Resume court d'une repartition enregistree (charge recurrente, achat
// echelonne...) : "Moitié-moitié", "Rémi 60 % · Lucas 40 %"...
export function describeSplit(splitType, splitConfig, users) {
  const entries = splitConfig
    .map((c) => ({ user: users.find((u) => u.id === c.userId), value: c.value }))
    .filter((e) => e.user);
  if (entries.length === 0) return "—";
  if (entries.length === 1) return `${entries[0].user.name} seul·e`;
  if (splitType === "equal") return entries.length === 2 ? "Moitié-moitié" : "Parts égales";
  if (splitType === "percentage") return entries.map((e) => `${e.user.name} ${round2(e.value)} %`).join(" · ");
  return entries.map((e) => `${e.user.name} ${formatAmount(e.value)}`).join(" · ");
}
