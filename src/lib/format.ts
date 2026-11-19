export function formatCents(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
