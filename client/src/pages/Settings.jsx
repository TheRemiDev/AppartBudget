import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import Avatar from "../components/Avatar.jsx";
import Icon from "../components/Icon.jsx";
import Modal from "../components/Modal.jsx";

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
          <div className="topbar__subtitle">Votre profil, votre sécurité et le foyer</div>
        </div>
      </div>

      <div className="chart-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <div className="card__header">
            <h3>Profil</h3>
          </div>
          <div className="card__body">
            <form onSubmit={saveProfile}>
              {profileMessage && <div className="form-success">{profileMessage}</div>}

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
              {passwordMessage && <div className="form-success">{passwordMessage}</div>}
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

      <MembersCard />
    </div>
  );
}

function MembersCard() {
  const { user: me, setUser } = useAuth();
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState(null);
  const [resettingMember, setResettingMember] = useState(null);

  async function load() {
    setLoading(true);
    const { users } = await api.get("/users");
    setMembers(users);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function removeMember(member) {
    const ok = await confirmAction({
      title: "Supprimer ce membre",
      message: `Supprimer définitivement "${member.name}" (${member.email}) du foyer ? Impossible s'il/elle a des dépenses ou versements associés.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.delete(`/users/${member.id}`);
      showToast(`"${member.name}" supprimé du foyer.`);
      load();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div className="card__header">
        <h3>Membres du foyer</h3>
        <button className="btn btn--primary btn--sm" onClick={() => setAddModalOpen(true)}>
          <Icon name="userPlus" size={14} /> Ajouter un membre
        </button>
      </div>

      {loading ? (
        <div className="center-screen" style={{ minHeight: 120 }}>
          <div className="spinner" />
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Membre</th>
              <th>Email</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar user={m} size="sm" />
                    <span style={{ fontWeight: 600 }}>{m.name}</span>
                    {m.id === me.id && <span className="pill pill--neutral">Vous</span>}
                  </div>
                </td>
                <td className="text-muted">{m.email}</td>
                <td style={{ textAlign: "right" }}>
                  <div className="row-actions">
                    <button className="icon-btn" title="Modifier" onClick={() => setEditingMember(m)}>
                      <Icon name="pencil" size={14} />
                    </button>
                    <button
                      className="icon-btn"
                      title="Réinitialiser le mot de passe"
                      onClick={() => setResettingMember(m)}
                    >
                      <Icon name="key" size={14} />
                    </button>
                    {m.id !== me.id && (
                      <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => removeMember(m)}>
                        <Icon name="trash" size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {addModalOpen && (
        <MemberFormModal
          onClose={() => setAddModalOpen(false)}
          onSaved={() => {
            setAddModalOpen(false);
            showToast("Membre ajouté.");
            load();
          }}
        />
      )}

      {editingMember && (
        <MemberFormModal
          member={editingMember}
          onClose={() => setEditingMember(null)}
          onSaved={(updated) => {
            setEditingMember(null);
            if (updated.id === me.id) setUser(updated);
            showToast("Membre mis à jour.");
            load();
          }}
        />
      )}

      {resettingMember && (
        <ResetPasswordModal member={resettingMember} onClose={() => setResettingMember(null)} onDone={() => setResettingMember(null)} />
      )}
    </div>
  );
}

function MemberFormModal({ member, onClose, onSaved }) {
  const isEdit = Boolean(member);
  const showToast = useToast();
  const [email, setEmail] = useState(member?.email || "");
  const [name, setName] = useState(member?.name || "");
  const [color, setColor] = useState(member?.color || "#4f46e5");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = name.trim() && (isEdit || (email.trim() && password.length >= 8));

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      if (isEdit) {
        const { user } = await api.patch(`/users/${member.id}`, { name: name.trim(), color });
        onSaved(user);
      } else {
        const { user } = await api.post("/users", { email: email.trim(), name: name.trim(), color, password });
        onSaved(user);
      }
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer ce membre.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={isEdit ? "Modifier le membre" : "Ajouter un membre"}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="member-form" disabled={!canSubmit || saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </>
      }
    >
      <form id="member-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}

        <div className="field">
          <label htmlFor="member-name">Nom affiché</label>
          <input id="member-name" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>

        {!isEdit && (
          <>
            <div className="field">
              <label htmlFor="member-email">Email</label>
              <input
                id="member-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="member-password">Mot de passe (8 caractères min)</label>
              <input
                id="member-password"
                type="password"
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
          </>
        )}

        <div className="field">
          <label htmlFor="member-color">Couleur</label>
          <input
            id="member-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ padding: 4, height: 40, width: 100 }}
          />
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ member, onClose, onDone }) {
  const showToast = useToast();
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 8) return;
    setSaving(true);
    setError("");
    try {
      await api.post(`/users/${member.id}/reset-password`, { password });
      showToast(`Mot de passe de ${member.name} réinitialisé.`);
      onDone();
    } catch (err) {
      setError(err.message || "Impossible de réinitialiser ce mot de passe.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={`Réinitialiser le mot de passe de ${member.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Annuler
          </button>
          <button className="btn btn--primary" type="submit" form="reset-password-form" disabled={password.length < 8 || saving}>
            {saving ? "Enregistrement..." : "Réinitialiser"}
          </button>
        </>
      }
    >
      <form id="reset-password-form" onSubmit={handleSubmit}>
        {error && <div className="form-error">{error}</div>}
        <div className="field">
          <label htmlFor="reset-password">Nouveau mot de passe (8 caractères min)</label>
          <input
            id="reset-password"
            type="password"
            minLength={8}
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
      </form>
    </Modal>
  );
}
