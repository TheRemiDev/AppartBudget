import { formatAmount } from "../utils/format.js";
import Avatar from "./Avatar.jsx";

const TYPES = [
  { value: "equal", label: "Parts égales" },
  { value: "percentage", label: "Pourcentages" },
  { value: "custom", label: "Montants" },
];

export default function SplitEditor({ users, amount, value, onChange }) {
  const { splitType, participantIds, splitConfig } = value;

  function setSplitType(newType) {
    onChange({ ...value, splitType: newType });
  }

  function toggleParticipant(userId) {
    const isIn = participantIds.includes(userId);
    let nextParticipants = isIn
      ? participantIds.filter((id) => id !== userId)
      : [...participantIds, userId];
    if (nextParticipants.length === 0) nextParticipants = [userId]; // toujours au moins un participant
    const nextConfig = splitConfig.filter((c) => nextParticipants.includes(c.userId));
    onChange({ ...value, participantIds: nextParticipants, splitConfig: nextConfig });
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

  const expectedTotal = splitType === "percentage" ? 100 : amount;
  const mismatch =
    splitType !== "equal" && amount > 0 && Math.abs(configTotal - expectedTotal) > 0.01;

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
            <div className="split-editor__row" key={u.id} style={{ opacity: included ? 1 : 0.45 }}>
              <label className="split-editor__user" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={included}
                  onChange={() => toggleParticipant(u.id)}
                  style={{ marginRight: 2 }}
                />
                <Avatar user={u} size="sm" />
                {u.name}
              </label>

              {included && splitType === "equal" && (
                <div className="split-editor__input">
                  <span className="text-muted" style={{ fontSize: 13.5 }}>{formatAmount(equalShare)}</span>
                </div>
              )}

              {included && splitType === "percentage" && (
                <div className="split-editor__input">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={configValue(u.id)}
                    onChange={(e) => setConfigValue(u.id, e.target.value)}
                  />
                  <span className="text-muted">%</span>
                </div>
              )}

              {included && splitType === "custom" && (
                <div className="split-editor__input">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={configValue(u.id)}
                    onChange={(e) => setConfigValue(u.id, e.target.value)}
                  />
                  <span className="text-muted">€</span>
                </div>
              )}
            </div>
          );
        })}

        {splitType !== "equal" && (
          <div className={`split-editor__total${mismatch ? " mismatch" : ""}`}>
            <span>Total réparti</span>
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
