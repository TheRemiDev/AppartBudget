export const KIND_OPTIONS = [
  { value: "fixed", label: "Frais fixe" },
  { value: "occasional", label: "Frais ponctuel" },
  { value: "exceptional", label: "Frais exceptionnel" },
];

const LABELS = {
  fixed: "Fixe",
  occasional: "Ponctuel",
  exceptional: "Exceptionnel",
};

export function kindLabel(kind) {
  return LABELS[kind] || kind;
}
