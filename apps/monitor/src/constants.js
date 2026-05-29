const FUELS = ["a92", "a95", "a95_ultra", "a100", "diesel", "diesel_ultra", "lpg"];

const KNOWN_STATUSES = new Set([
  "FUEL_STATUS_IN_STOCK",
  "FUEL_STATUS_LIMITED",
  "FUEL_STATUS_OUT_OF_STOCK",
  "FUEL_STATUS_UNAVAILABLE"
]);

const STATUS_LABELS = {
  FUEL_STATUS_IN_STOCK: "Есть",
  FUEL_STATUS_LIMITED: "Талоны",
  FUEL_STATUS_OUT_OF_STOCK: "Нет",
  FUEL_STATUS_UNAVAILABLE: "Нет",
  "N/A": "нет данных"
};

const FUEL_LABELS = {
  a92: "A-92",
  a95: "A-95",
  a95_ultra: "A-95 Ultra",
  a100: "A-100",
  diesel: "ДТ",
  diesel_ultra: "ДТ Ultra",
  lpg: "Газ"
};

module.exports = {
  FUELS,
  KNOWN_STATUSES,
  STATUS_LABELS,
  FUEL_LABELS
};
