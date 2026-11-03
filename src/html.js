/** Escape text for HTML. Every value that comes from a person or the database goes through this. */
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Tagged template: interpolations are escaped unless wrapped in raw(). */
export function html(strings, ...values) {
    return strings.reduce((out, s, i) => {
        if (i === 0) return s;
        const v = values[i - 1];
        const piece = Array.isArray(v) ? v.map((x) => (x?.__raw ? x.value : esc(x))).join('') : v?.__raw ? v.value : esc(v);
        return out + piece + s;
    }, '');
}
export const raw = (value) => ({ __raw: true, value });

const CSS = `
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f5f7f6;color:#1d2b25}
header{display:flex;align-items:center;gap:16px;padding:12px 24px;background:#1cc29f;color:#fff}
header a{color:#fff;text-decoration:none;font-weight:600}header .brand{font-size:20px;margin-right:auto}
header form{margin:0}header button{background:transparent;border:1px solid #fff;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer}
main{max-width:860px;margin:24px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 16px}h2{font-size:18px;margin:24px 0 8px}
.card{background:#fff;border:1px solid #dde5e1;border-radius:10px;padding:16px;margin-bottom:12px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.btn,button.btn{display:inline-block;background:#1cc29f;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;text-decoration:none;cursor:pointer}
.btn.secondary{background:#fff;color:#1d2b25;border:1px solid #c7d3cd}
label{display:block;font-weight:600;margin:12px 0 4px}input,select{width:100%;padding:8px;border:1px solid #c7d3cd;border-radius:6px;font-size:14px}
.field-error,.error{color:#c0392b;font-size:14px;margin-top:4px}.notice{background:#e8f8f3;border:1px solid #1cc29f;padding:10px;border-radius:6px}
.alert{background:#fdecea;border:1px solid #c0392b;color:#c0392b;padding:10px;border-radius:6px}
table{width:100%;border-collapse:collapse;background:#fff}th,td{text-align:left;padding:8px;border-bottom:1px solid #e3eae6}
.owes{color:#c0392b}.owed{color:#1a9c7f}.muted{color:#6b7c74;font-size:14px}fieldset{border:1px solid #dde5e1;border-radius:8px;margin-top:12px}
`;

/** The page shell. `user` null = signed out. */
export function page({ title, user, body, flash }) {
    return html`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · Splitwise</title><style>${raw(CSS)}</style></head>
<body>
<header>
  <a class="brand" href="/">Splitwise</a>
  ${user ? raw(html`<nav aria-label="Main"><a href="/">Dashboard</a> &nbsp; <a href="/activity">Activity</a></nav>
  <span data-testid="current-user">${user.name}</span>
  <form method="post" action="/logout"><button type="submit">Sign out</button></form>`) : ''}
</header>
<main>
  ${flash ? raw(html`<p class="notice" role="status">${flash}</p>`) : ''}
  ${raw(body)}
</main>
</body>
</html>`;
}
