// Format an integer MINOR-unit amount (paise) as an INR string with grouping.
// Used for all display — NEVER parseFloat on a server-returned amount.
export function formatINR(amountMinor) {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) {
    return '₹0.00';
  }
  const whole = Math.floor(amountMinor / 100);
  const frac = Math.abs(amountMinor % 100).toString().padStart(2, '0');
  // Indian grouping: ₹12,34,567.89
  const grouped = whole.toLocaleString('en-IN');
  return `₹${grouped}.${frac}`;
}
