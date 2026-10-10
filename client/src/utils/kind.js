// Nature d'une depense du foyer. "occasional" est affiche "courant" : le mot
// "ponctuel" se confondait avec "exceptionnel" (les deux evoquent une
// depense isolee), alors qu'il designe les depenses du quotidien.
export const KIND_INFO = {
  fixed: { short: "Fixe", label: "Frais fixe", plural: "Frais fixes", hint: "Loyer, factures, abonnements" },
  occasional: { short: "Courant", label: "Frais courant", plural: "Frais courants", hint: "Courses, sorties, quotidien" },
  exceptional: {
    short: "Exceptionnel",
    label: "Frais exceptionnel",
    plural: "Frais exceptionnels",
    hint: "Réparation, gros achat, imprévu",
  },
};

export const KIND_OPTIONS = Object.entries(KIND_INFO).map(([value, info]) => ({
  value,
  label: info.label,
  hint: info.hint,
}));

export function kindLabel(kind) {
  return KIND_INFO[kind]?.short || kind;
}
