import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Avatar from "./Avatar.jsx";

const NAV_ITEMS = [
  { to: "/", label: "Tableau de bord", end: true, icon: "◆" },
  { to: "/depenses", label: "Dépenses", icon: "≡" },
  { to: "/recurrentes", label: "Charges récurrentes", icon: "↻" },
  { to: "/categories", label: "Catégories", icon: "▤" },
  { to: "/parametres", label: "Paramètres", icon: "⚙" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <div className="sidebar__brand-mark">AB</div>
          <span className="sidebar__brand-name">AppartBudget</span>
        </div>

        <nav className="sidebar__nav">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__footer">
          <Avatar user={user} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user?.name}
            </div>
          </div>
          <button className="icon-btn" title="Se deconnecter" onClick={handleLogout}>
            ⏻
          </button>
        </div>
      </aside>

      <div className="main-area">
        <Outlet />
      </div>
    </div>
  );
}
