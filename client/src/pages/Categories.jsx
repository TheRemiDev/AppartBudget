import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import Modal from "../components/Modal.jsx";

const EMPTY_FORM = { name: "", icon: "💶", color: "#6366f1", kind: "exceptional", defaultAmount: "" };

export default function Categories() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { category? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { categories } = await api.get("/categories?includeArchived=true");
    setCategories(categories);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  function openCreate() {
    setForm(EMPTY_FORM);
    setError("");
    setModalState({});
  }

  function openEdit(category) {
    setForm({
      name: category.name,
      icon: category.icon,
      color: category.color,
      kind: category.kind,
      defaultAmount: category.defaultAmount ?? "",
    });
    setError("");
    setModalState({ category });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: form.name.trim(),
        icon: form.icon.trim() || "💶",
        color: form.color,
        kind: form.kind,
        defaultAmount: form.defaultAmount === "" ? null : Number(form.defaultAmount),
      };
      if (modalState.category) {
        await api.put(`/categories/${modalState.category.id}`, payload);
      } else {
        await api.post("/categories", payload);
      }
      setModalState(null);
      load();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer la catégorie.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(category) {
    await api.patch(`/categories/${category.id}/archive`, { archived: !category.archived });
    load();
  }

  async function remove(category) {
    if (!confirm(`Supprimer la catégorie "${category.name}" ?`)) return;
    await api.delete(`/categories/${category.id}`);
    load();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Catégories de dépenses</h1>
          <div className="topbar__subtitle">Personnalisez les types de dépenses du foyer</div>
        </div>
        <button className="btn btn--primary" onClick={openCreate}>
          + Nouvelle catégorie
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th>Type</th>
                <th>Montant habituel</th>
                <th>Statut</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} style={{ opacity: c.archived ? 0.5 : 1 }}>
                  <td>
                    <span className="pill" style={{ background: `${c.color}22`, color: c.color }}>
                      {c.icon} {c.name}
                    </span>
                  </td>
                  <td>
                    <span className={`pill pill--kind-${c.kind}`}>{c.kind === "fixed" ? "Fixe" : "Exceptionnel"}</span>
                  </td>
                  <td className="text-muted">{c.defaultAmount ? `${c.defaultAmount.toFixed(2)} €` : "—"}</td>
                  <td>
                    {c.archived ? (
                      <span className="pill" style={{ background: "var(--color-surface-2)" }}>Archivée</span>
                    ) : (
                      <span className="pill pill--paid">Active</span>
                    )}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="icon-btn" title="Modifier" onClick={() => openEdit(c)}>✎</button>
                    <button
                      className="icon-btn"
                      title={c.archived ? "Réactiver" : "Archiver"}
                      onClick={() => toggleArchive(c)}
                      style={{ marginLeft: 6 }}
                    >
                      {c.archived ? "↺" : "⏸"}
                    </button>
                    <button className="icon-btn" title="Supprimer" onClick={() => remove(c)} style={{ marginLeft: 6 }}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalState && (
        <Modal
          title={modalState.category ? "Modifier la catégorie" : "Nouvelle catégorie"}
          onClose={() => setModalState(null)}
          footer={
            <>
              <button className="btn btn--ghost" type="button" onClick={() => setModalState(null)}>
                Annuler
              </button>
              <button className="btn btn--primary" type="submit" form="category-form" disabled={saving || !form.name.trim()}>
                {saving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </>
          }
        >
          <form id="category-form" onSubmit={handleSubmit}>
            {error && <div className="form-error">{error}</div>}
            <div className="field-row">
              <div className="field">
                <label htmlFor="cat-icon">Icône (emoji)</label>
                <input id="cat-icon" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={4} />
              </div>
              <div className="field">
                <label htmlFor="cat-color">Couleur</label>
                <input id="cat-color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} style={{ padding: 4, height: 40 }} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="cat-name">Nom</label>
              <input id="cat-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="field-row">
              <div className="field">
                <label htmlFor="cat-kind">Type par défaut</label>
                <select id="cat-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                  <option value="fixed">Frais fixe</option>
                  <option value="exceptional">Frais exceptionnel</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="cat-amount">Montant habituel (optionnel)</label>
                <input
                  id="cat-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.defaultAmount}
                  onChange={(e) => setForm({ ...form, defaultAmount: e.target.value })}
                />
              </div>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
