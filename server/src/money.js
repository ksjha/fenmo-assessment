// All monetary amounts are stored and transported as integer MINOR units
// (paise for INR, cents for USD). We accept a decimal string from the client
// to avoid any float precision loss in JSON (e.g. 0.1 + 0.2). Strings are
// parsed with a strict regex, never with parseFloat.

const AMOUNT_RE = /^\d{1,12}(\.\d{1,2})?$/;

// Convert a decimal string like "199.50" to an integer number of minor units.
// Returns null if the input is not a valid non-negative money string with at
// most 2 decimal places.
export function parseAmountToMinor(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!AMOUNT_RE.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const paddedFrac = (frac + '00').slice(0, 2);
  const minor = Number(whole) * 100 + Number(paddedFrac);
  if (!Number.isSafeInteger(minor)) return null;
  return minor;
}

// Format integer minor units back to a fixed-2-decimal string for responses.
export function formatMinorToString(minor) {
  if (!Number.isInteger(minor) || minor < 0) {
    throw new Error('formatMinorToString expects a non-negative integer');
  }
  const whole = Math.floor(minor / 100);
  const frac = minor % 100;
  return `${whole}.${frac.toString().padStart(2, '0')}`;
}
