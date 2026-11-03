const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** ₹1,20,000.00 — the rupee sign and Indian digit grouping. */
export const formatINR = (paise) => inr.format(paise / 100);

/** 1200.00 — plain, two decimals, for messages and the API. */
export const plain = (paise) => (paise / 100).toFixed(2);

/** "1,200.5" / "1200.50" / 1200 → paise, or null when it is not an amount. */
export function toPaise(value) {
    if (value === null || value === undefined) return null;
    const s = String(value).replace(/[₹,\s]/g, '');
    if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
    const [whole, frac = ''] = s.replace('-', '').split('.');
    const paise = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
    return s.startsWith('-') ? -paise : paise;
}

/** Split `total` paise as evenly as possible; the first people absorb the leftover paise. */
export function splitEqually(total, count) {
    const base = Math.floor(total / count);
    const extra = total - base * count;
    return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}
