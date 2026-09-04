import { useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import Avatar from "../components/Avatar.jsx";

export default function Settings() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState(user?.name || "");
  const [color, setColor] = useState(user?.color || "#6366f1");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  async function saveProfile(e) {
    e.preventDefault();
    setProfileSaving(true);
    setProfileMessage("");
    try {
      const { user: updated } = await api.patch("/auth/profile", { name: name.trim(), color });
      setUser(updated);
      setProfileMessage("Profil mis à jour.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordMessage("");
    setPasswordError("");
    try {
      await api.post("/auth/change-password", { currentPassword, newPassword });
      setPasswordMessage("Mot de passe modifié.");
      setCurrentPassword("");
      setNewPassword("");
    } catch (err) {
      setPasswordError(err.message);
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Paramètres</h1>
          <div className="topbar__subtitle">Votre profil et votre sécurité</div>
        </div>
      </div>

      <div className="chart-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="card__header">
            <h3>Profil</h3>
          </div>
          <div className="card__body">
            <form onSubmit={saveProfile}>
              {profileMessage && <div className="form-error" style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}>{profileMessage}</div>}

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
                <Avatar user={{ name, color }} />
                <span className="text-muted" style={{ fontSize: 13.5 }}>{user?.email}</span>
              </div>

              <div className="field">
                <label htmlFor="name">Nom affiché</label>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>

              <div className="field">
                <label htmlFor="color">Couleur</label>
                <input id="color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ padding: 4, height: 40, width: 100 }} />
              </div>

              <button className="btn btn--primary" type="submit" disabled={profileSaving}>
                {profileSaving ? "Enregistrement..." : "Enregistrer le profil"}
              </button>
            </form>
          </div>
        </div>

        <div className="card">
          <div className="card__header">
            <h3>Mot de passe</h3>
          </div>
          <div className="card__body">
            <form onSubmit={changePassword}>
              {passwordMessage && <div className="form-error" style={{ background: "var(--color-success-soft)", color: "var(--color-success)" }}>{passwordMessage}</div>}
              {passwordError && <div className="form-error">{passwordError}</div>}

              <div className="field">
                <label htmlFor="current-password">Mot de passe actuel</label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="new-password">Nouveau mot de passe</label>
                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>

              <button className="btn btn--primary" type="submit" disabled={passwordSaving}>
                {passwordSaving ? "Modification..." : "Changer le mot de passe"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
