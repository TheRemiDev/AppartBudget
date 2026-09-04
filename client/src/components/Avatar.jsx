import { initials } from "../utils/format.js";

export default function Avatar({ user, size = "md" }) {
  if (!user) return null;
  return (
    <div
      className={`avatar ${size === "sm" ? "avatar--sm" : ""}`}
      style={{ background: user.color }}
      title={user.name}
    >
      {initials(user.name)}
    </div>
  );
}
