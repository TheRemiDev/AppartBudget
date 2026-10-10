import { useEffect, useState } from "react";
import { api } from "../api/client.js";
import Modal from "../components/Modal.jsx";
import Select from "../components/Select.jsx";
import Icon from "../components/Icon.jsx";
import { useConfirm, useToast } from "../context/UIContext.jsx";
import { KIND_OPTIONS, kindLabel } from "../utils/kind.js";
import { formatAmount } from "../utils/format.js";

const EMPTY_FORM = { name: "", icon: "💶", color: "#6366f1", kind: "occasional", defaultAmount: "" };

export default function Categories() {
  const confirmAction = useConfirm();
  const showToast = useToast();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalState, setModalState] = useState(null); // null | { category? }
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const { categories } = await api.get("/categories?includeArchived=true");
    setCategories([...categories].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name)));
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
      showToast(`Catégorie « ${payload.name} » enregistrée.`);
      load();
    } catch (err) {
      setError(err.message || "Impossible d'enregistrer la catégorie.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive(category) {
    await api.patch(`/categories/${category.id}/archive`, { archived: !category.archived });
    showToast(
      category.archived
        ? `« ${category.name} » est de nouveau proposée.`
        : `« ${category.name} » archivée : elle n'est plus proposée, mais les dépenses existantes la gardent.`
    );
    load();
  }

  async function remove(category) {
    const ok = await confirmAction({
      title: "Supprimer la catégorie",
      message: `Supprimer « ${category.name} » ? Si des dépenses l'utilisent déjà, elle sera simplement archivée (masquée des choix) pour ne rien perdre.`,
      confirmLabel: "Supprimer",
      danger: true,
    });
    if (!ok) return;
    const res = await api.delete(`/categories/${category.id}`);
    showToast(
      res.archived
        ? `« ${category.name} » est utilisée par des dépenses : elle a été archivée plutôt que supprimée.`
        : `Catégorie « ${category.name} » supprimée.`
    );
    load();
  }

  return (
    <div>
      <div className="topbar">
        <div>
          <h1>Catégories</h1>
          <div className="topbar__subtitle">
            Pour classer les dépenses du foyer. Le type et le montant habituel sont pré-remplis quand vous choisissez la catégorie dans une nouvelle dépense.
          </div>
        </div>
        <button className="btn btn--primary" onClick={openCreate}>
          <Icon name="plus" size={15} /> Nouvelle catégorie
        </button>
      </div>

      <div className="card">
        {loading ? (
          <div className="center-screen" style={{ minHeight: 200 }}>
            <div className="spinner" />
          </div>
        ) : categories.length === 0 ? (
          <div className="empty-state">
            <Icon name="tag" size={26} />
            <span>Aucune catégorie pour l'instant.</span>
            <button className="btn btn--primary btn--sm" onClick={openCreate}>
              <Icon name="plus" size={14} /> Créer une catégorie
            </button>
          </div>
        ) : (
          <table className="table table--stack">
            <thead>
              <tr>
                <th>Catégorie</th>
                <th>Type par défaut</th>
                <th>Montant habituel</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.id} className={c.archived ? "row--muted" : ""}>
                  <td className="table__primary">
                    <span className="pill" style={{ background: `${c.color}22`, color: c.color }}>
                      {c.icon} {c.name}
                    </span>
                    {c.archived && (
                      <span className="pill pill--neutral" style={{ marginLeft: 6 }}>
                        Archivée
                      </span>
                    )}
                  </td>
                  <td data-label="Type par défaut">
                    <span className={`pill pill--kind-${c.kind}`}>{kindLabel(c.kind)}</span>
                  </td>
                  <td data-label="Montant habituel" className="text-muted">
                    {c.defaultAmount ? formatAmount(c.defaultAmount) : "—"}
                  </td>
                  <td className="table__actions">
                    <div className="row-actions">
                      <button className="icon-btn" title="Modifier" onClick={() => openEdit(c)}>
                        <Icon name="pencil" size={14} />
                      </button>
                      <button
                        className="icon-btn"
                        title={c.archived ? "Désarchiver (la proposer à nouveau)" : "Archiver (ne plus la proposer, sans toucher aux dépenses existantes)"}
                        onClick={() => toggleArchive(c)}
                      >
                        <Icon name={c.archived ? "unarchive" : "archive"} size={14} />
                      </button>
                      <button className="icon-btn icon-btn--danger" title="Supprimer" onClick={() => remove(c)}>
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
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
                <Select
                  id="cat-kind"
                  value={form.kind}
                  onChange={(kind) => setForm({ ...form, kind })}
                  options={KIND_OPTIONS}
                />
              </div>
              <div className="field">
                <label htmlFor="cat-amount">Montant habituel (optionnel)</label>
                <input
                  id="cat-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Ex : 950"
                  value={form.defaultAmount}
                  onChange={(e) => setForm({ ...form, defaultAmount: e.target.value })}
                />
              </div>
            </div>
            <div className="field-help" style={{ marginTop: -6 }}>
              <Icon name="info" size={13} /> Quand vous choisirez cette catégorie pour une nouvelle dépense, le type et le
              montant habituel seront pré-remplis (vous pourrez toujours les changer).
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
