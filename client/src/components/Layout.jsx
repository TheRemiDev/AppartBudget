import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import Avatar from "./Avatar.jsx";
import Icon from "./Icon.jsx";

const NAV_GROUPS = [
  {
    label: "Foyer",
    items: [
      { to: "/", label: "Tableau de bord", end: true, icon: "dashboard" },
      { to: "/depenses", label: "Dépenses", icon: "receipt" },
      { to: "/recurrentes", label: "Charges récurrentes", icon: "repeat" },
      { to: "/echelonnes", label: "Achats échelonnés", icon: "creditCard" },
      { to: "/categories", label: "Catégories", icon: "tag" },
    ],
  },
  {
    label: "Personnel",
    items: [{ to: "/personnel", label: "Mon budget", icon: "wallet" }],
  },
];

const SETTINGS_ITEM = { to: "/parametres", label: "Paramètres", icon: "settings" };

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
          {NAV_GROUPS.map((group) => (
            <div className="sidebar__group" key={group.label}>
              <div className="sidebar__group-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}

          <div className="sidebar__group sidebar__group--settings">
            <NavLink
              to={SETTINGS_ITEM.to}
              className={({ isActive }) => `nav-link${isActive ? " active" : ""}`}
            >
              <Icon name={SETTINGS_ITEM.icon} size={17} />
              {SETTINGS_ITEM.label}
            </NavLink>
          </div>
        </nav>

        <div className="sidebar__footer">
          <Avatar user={user} size="sm" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {user?.name}
            </div>
          </div>
          <button className="icon-btn" title="Se deconnecter" onClick={handleLogout}>
            <Icon name="power" size={16} />
          </button>
        </div>
      </aside>

      <div className="main-area">
        <Outlet />
      </div>
    </div>
  );
}
