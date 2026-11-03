import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { all, one, pool, tx } from './db.js';
import { groupBalances } from './balances.js';
import { formatINR, plain, splitEqually, toPaise } from './money.js';
import { esc, html, page, raw } from './html.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const GROUP_TYPES = [['TRIP', 'Trip'], ['HOME', 'Home'], ['COUPLE', 'Couple'], ['OTHER', 'Other']];
const IS_DEV = process.env.NODE_ENV !== 'production';

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'dev-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax' },
}));

// ---------------------------------------------------------------------------------------------- helpers
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const render = (req, res, title, body, status = 200) => {
    const flash = req.session.flash;
    delete req.session.flash;
    res.status(status).send(page({ title, user: req.user ?? null, body, flash }));
};

app.use(wrap(async (req, _res, next) => {
    if (req.session.userId) req.user = await one('SELECT id, name, email FROM users WHERE id = ?', [req.session.userId]);
    next();
}));
const signedIn = (req, res, next) => (req.user ? next() : res.redirect('/login'));

/** The group, when the signed-in user belongs to it. */
async function memberGroup(req, res) {
    const group = await one(
        `SELECT g.*, gm.role AS my_role FROM expense_groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
         WHERE g.id = ?`, [req.user.id, Number(req.params.id)]);
    if (!group) render(req, res, 'Not found', html`<h1>Group not found</h1><p>You are not a member of this group.</p>`, 404);
    return group;
}
const typeLabel = (t) => GROUP_TYPES.find(([v]) => v === t)?.[1] ?? 'Other';
const balanceText = (net) => (net > 0 ? `is owed ${formatINR(net)}` : net < 0 ? `owes ${formatINR(-net)}` : `settled up (${formatINR(0)})`);
const balanceClass = (net) => (net > 0 ? 'owed' : net < 0 ? 'owes' : 'muted');

// ---------------------------------------------------------------------------------------------- sign in
function loginForm(email = '', error = '') {
    return html`<h1>Sign in</h1>
<div class="card">
  ${error ? raw(html`<p class="alert" role="alert" data-testid="login-error">${error}</p>`) : ''}
  <form method="post" action="/login">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username" value="${email}" required>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <div class="actions"><button class="btn" type="submit">Sign in</button></div>
  </form>
</div>`;
}

app.get('/login', (req, res) => (req.user ? res.redirect('/') : render(req, res, 'Sign in', loginForm())));

app.post('/login', wrap(async (req, res) => {
    const email = String(req.body.email ?? '').trim().toLowerCase();
    const password = String(req.body.password ?? '');
    // The database decides whether the lock is still on, so its clock and ours never disagree.
    const user = await one('SELECT *, (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked FROM users WHERE email = ?', [email]);
    const fail = (message) => render(req, res, 'Sign in', loginForm(email, message), 401);
    if (!user || !user.password_hash) return fail('Email or password is incorrect');

    if (Number(user.is_locked) === 1) {
        return fail(`Your account is locked for ${LOCK_MINUTES} minutes`);
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
        const attempts = user.failed_attempts + 1;
        if (attempts >= MAX_FAILED) {
            await pool.query('UPDATE users SET failed_attempts = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?', [LOCK_MINUTES, user.id]);
            return fail(`Your account is locked for ${LOCK_MINUTES} minutes`);
        }
        await pool.query('UPDATE users SET failed_attempts = ? WHERE id = ?', [attempts, user.id]);
        return fail('Email or password is incorrect');
    }
    await pool.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [user.id]);
    req.session.regenerate((err) => {
        if (err) throw err;
        req.session.userId = user.id;
        res.redirect('/');
    });
}));

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/login')));

// ---------------------------------------------------------------------------------------------- dashboard
app.get('/', signedIn, wrap(async (req, res) => {
    const groups = await all(
        `SELECT g.id, g.name, g.group_type FROM expense_groups g JOIN group_members gm ON gm.group_id = g.id
         WHERE gm.user_id = ? ORDER BY g.created_at DESC, g.id DESC`, [req.user.id]);
    const cards = [];
    for (const g of groups) {
        const mine = (await groupBalances(g.id)).find((m) => m.id === req.user.id);
        cards.push(html`<a class="card" data-testid="group-card" href="/groups/${g.id}" style="text-decoration:none;color:inherit">
  <strong>${g.name}</strong><div class="muted">${typeLabel(g.group_type)}</div>
  <div class="${balanceClass(mine?.net ?? 0)}">You ${balanceText(mine?.net ?? 0)}</div></a>`);
    }
    render(req, res, 'Dashboard', html`<h1>Welcome, ${req.user.name}</h1>
<div class="actions"><a class="btn" href="/groups/new">New group</a></div>
<h2>Your groups</h2>
${groups.length ? raw(`<div class="cards">${cards.join('')}</div>`) : raw(html`<p class="muted">You are not in any group yet.</p>`)}`);
}));

// ---------------------------------------------------------------------------------------------- groups
function groupForm(values = {}, errors = {}) {
    return html`<h1>New group</h1>
<div class="card"><form method="post" action="/groups" novalidate>
  <label for="name">Name</label>
  <input id="name" name="name" value="${values.name ?? ''}" aria-describedby="name-error" ${errors.name ? raw('aria-invalid="true"') : ''}>
  ${errors.name ? raw(html`<p class="field-error" id="name-error" role="alert">${errors.name}</p>`) : ''}
  <label for="group_type">Type</label>
  <select id="group_type" name="group_type">${raw(GROUP_TYPES.map(([v, l]) => html`<option value="${v}" ${values.group_type === v ? raw('selected') : ''}>${l}</option>`).join(''))}</select>
  <div class="actions"><button class="btn" type="submit">Save</button><a class="btn secondary" href="/">Cancel</a></div>
</form></div>`;
}

app.get('/groups/new', signedIn, (req, res) => render(req, res, 'New group', groupForm()));

app.post('/groups', signedIn, wrap(async (req, res) => {
    const name = String(req.body.name ?? '').trim();
    const type = GROUP_TYPES.some(([v]) => v === req.body.group_type) ? req.body.group_type : 'OTHER';
    if (!name) return render(req, res, 'New group', groupForm({ name, group_type: type }, { name: 'Name is required' }), 422);
    const id = await tx(async (c) => {
        const [r] = await c.query('INSERT INTO expense_groups (name, group_type, created_by) VALUES (?, ?, ?)', [name.slice(0, 120), type, req.user.id]);
        await c.query("INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, 'ADMIN')", [r.insertId, req.user.id]);
        return r.insertId;
    });
    req.session.flash = `Group "${name}" created`;
    res.redirect(`/groups/${id}`);
}));

app.get('/groups/:id', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const members = await all(
        'SELECT u.name, u.email, gm.role FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.id', [group.id]);
    const expenses = await all(
        `SELECT e.id, e.description, e.amount, e.expense_date, u.name AS paid_by_name FROM expenses e JOIN users u ON u.id = e.paid_by
         WHERE e.group_id = ? ORDER BY e.expense_date DESC, e.id DESC`, [group.id]);
    render(req, res, group.name, html`<h1>${group.name}</h1>
<p class="muted">${typeLabel(group.group_type)} group</p>
<div class="actions">
  <a class="btn" href="/groups/${group.id}/expenses/new">Add expense</a>
  <a class="btn secondary" href="/groups/${group.id}/settle">Settle up</a>
  <a class="btn secondary" href="/groups/${group.id}/balances">Balances</a>
  ${group.my_role === 'ADMIN' ? raw(html`<a class="btn secondary" href="/groups/${group.id}/members/new">Add member</a>`) : ''}
</div>
<h2>Members</h2>
<ul data-testid="member-list">${raw(members.map((m) => html`<li data-testid="member">${m.name} (${m.email})${m.role === 'ADMIN' ? ' — Admin' : ''}</li>`).join(''))}</ul>
<h2>Expenses</h2>
${expenses.length ? raw(html`<table><thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Paid by</th><th scope="col">Amount</th></tr></thead><tbody>
${raw(expenses.map((e) => html`<tr data-testid="expense-row"><td>${e.expense_date}</td><td>${e.description}</td><td>${e.paid_by_name}</td><td>${formatINR(toPaise(e.amount))}</td></tr>`).join(''))}
</tbody></table>`) : raw(html`<p class="muted">No expenses yet.</p>`)}`);
}));

// ---------------------------------------------------------------------------------------------- members
app.get('/groups/:id/members/new', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    if (group.my_role !== 'ADMIN') return render(req, res, 'Not allowed', html`<h1>Only a group admin can add members</h1>`, 403);
    const friends = await all(
        `SELECT u.email, u.name FROM friendships f JOIN users u ON u.id = f.friend_id
         WHERE f.user_id = ? AND u.id NOT IN (SELECT user_id FROM group_members WHERE group_id = ?) ORDER BY u.name`, [req.user.id, group.id]);
    render(req, res, 'Add member', html`<h1>Add a member to ${group.name}</h1>
<div class="card">${friends.length ? raw(html`<form method="post" action="/groups/${group.id}/members">
  <label for="email">Friend</label>
  <select id="email" name="email">${raw(friends.map((f) => html`<option value="${f.email}">${f.name} (${f.email})</option>`).join(''))}</select>
  <div class="actions"><button class="btn" type="submit">Add</button><a class="btn secondary" href="/groups/${group.id}">Cancel</a></div>
</form>`) : raw(html`<p class="muted">All your friends are already in this group.</p>`)}</div>`);
}));

app.post('/groups/:id/members', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    if (group.my_role !== 'ADMIN') return render(req, res, 'Not allowed', html`<h1>Only a group admin can add members</h1>`, 403);
    const friend = await one(
        'SELECT u.id, u.name FROM friendships f JOIN users u ON u.id = f.friend_id WHERE f.user_id = ? AND u.email = ?',
        [req.user.id, String(req.body.email ?? '').trim().toLowerCase()]);
    if (!friend) return render(req, res, 'Add member', html`<p class="alert" role="alert">You can only add your friends.</p>`, 422);
    await pool.query("INSERT IGNORE INTO group_members (group_id, user_id, role) VALUES (?, ?, 'MEMBER')", [group.id, friend.id]);
    req.session.flash = `${friend.name} added to ${group.name}`;
    res.redirect(`/groups/${group.id}`);
}));

// ---------------------------------------------------------------------------------------------- expenses
async function expenseForm(group, members, values = {}, error = '') {
    const split = values.split ?? 'EQUAL';
    return html`<h1>Add an expense to ${group.name}</h1>
<div class="card"><form method="post" action="/groups/${group.id}/expenses" novalidate>
  ${error ? raw(html`<p class="alert" role="alert" data-testid="expense-error">${error}</p>`) : ''}
  <label for="description">Description</label>
  <input id="description" name="description" value="${values.description ?? ''}">
  <label for="amount">Amount (₹)</label>
  <input id="amount" name="amount" inputmode="decimal" value="${values.amount ?? ''}">
  <label for="paid_by">Paid by</label>
  <select id="paid_by" name="paid_by">${raw(members.map((m) => html`<option value="${m.id}" ${String(values.paid_by ?? group.me) === String(m.id) ? raw('selected') : ''}>${m.name}</option>`).join(''))}</select>
  <fieldset><legend>Split</legend>
    <label><input type="radio" name="split" value="EQUAL" style="width:auto" ${split === 'EQUAL' ? raw('checked') : ''}> Split equally</label>
    <label><input type="radio" name="split" value="UNEQUAL" style="width:auto" ${split === 'UNEQUAL' ? raw('checked') : ''}> Split unequally</label>
    <p class="muted">For an unequal split, give each person's share:</p>
    ${raw(members.map((m) => html`<label for="share_${m.id}">Share for ${m.name}</label>
    <input id="share_${m.id}" name="share_${m.id}" inputmode="decimal" value="${values[`share_${m.id}`] ?? ''}">`).join(''))}
  </fieldset>
  <div class="actions"><button class="btn" type="submit">Save</button><a class="btn secondary" href="/groups/${group.id}">Cancel</a></div>
</form></div>`;
}
const groupMembers = (groupId) => all('SELECT u.id, u.name FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.id', [groupId]);

app.get('/groups/:id/expenses/new', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    render(req, res, 'Add expense', await expenseForm({ ...group, me: req.user.id }, await groupMembers(group.id)));
}));

app.post('/groups/:id/expenses', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const members = await groupMembers(group.id);
    const b = req.body;
    const again = async (error) => render(req, res, 'Add expense', await expenseForm({ ...group, me: req.user.id }, members, b, error), 422);
    const description = String(b.description ?? '').trim();
    const amount = toPaise(b.amount);
    const paidBy = members.find((m) => String(m.id) === String(b.paid_by));
    if (!description) return again('Description is required');
    if (amount === null || amount <= 0) return again('Amount must be more than 0.00');
    if (!paidBy) return again('Choose who paid');

    let shares;
    if (b.split === 'UNEQUAL') {
        shares = members.map((m) => ({ user: m, paise: toPaise(b[`share_${m.id}`] || '0') }));
        if (shares.some((s) => s.paise === null || s.paise < 0)) return again('Every share must be an amount of 0.00 or more');
        const sum = shares.reduce((n, s) => n + s.paise, 0);
        if (sum < amount) return again(`Shares are ${plain(amount - sum)} short of ${plain(amount)}`);
        if (sum > amount) return again(`Shares are ${plain(sum - amount)} over ${plain(amount)}`);
        shares = shares.filter((s) => s.paise > 0);
    } else {
        const parts = splitEqually(amount, members.length);
        shares = members.map((m, i) => ({ user: m, paise: parts[i] }));
    }

    await tx(async (c) => {
        const [r] = await c.query(
            'INSERT INTO expenses (group_id, paid_by, description, amount, expense_date, created_by) VALUES (?, ?, ?, ?, CURDATE(), ?)',
            [group.id, paidBy.id, description.slice(0, 200), plain(amount), req.user.id]);
        for (const s of shares) await c.query('INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES (?, ?, ?)', [r.insertId, s.user.id, plain(s.paise)]);
    });
    req.session.flash = `Expense "${description}" of ${formatINR(amount)} added`;
    res.redirect(`/groups/${group.id}`);
}));

// ---------------------------------------------------------------------------------------------- activity
app.get('/activity', signedIn, wrap(async (req, res) => {
    const rows = await all(
        `SELECT e.id, e.description, e.amount, e.created_at, e.paid_by, g.name AS group_name, u.name AS added_by,
                (SELECT share_amount FROM expense_splits s WHERE s.expense_id = e.id AND s.user_id = ?) AS my_share
         FROM expenses e JOIN expense_groups g ON g.id = e.group_id JOIN users u ON u.id = e.created_by
         WHERE e.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
         ORDER BY e.created_at DESC, e.id DESC LIMIT 100`, [req.user.id, req.user.id]);
    const line = (r) => {
        const share = toPaise(r.my_share ?? '0');
        const amount = toPaise(r.amount);
        if (r.paid_by === req.user.id) return `you are owed ${formatINR(amount - share)}`;
        return share > 0 ? `you owe ${formatINR(share)}` : 'not involved';
    };
    render(req, res, 'Activity', html`<h1>Activity</h1>
${rows.length ? raw(rows.map((r) => html`<div class="card" data-testid="activity-item">
  <strong>${r.description}</strong> ${formatINR(toPaise(r.amount))} added by ${r.added_by} in ${r.group_name}
  <div class="${r.paid_by === req.user.id ? 'owed' : 'owes'}">${line(r)}</div></div>`).join('')) : raw(html`<p class="muted">Nothing yet.</p>`)}`);
}));

// ---------------------------------------------------------------------------------------------- balances + settle up
app.get('/groups/:id/balances', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const balances = await groupBalances(group.id);
    render(req, res, `Balances · ${group.name}`, html`<h1>Balances in ${group.name}</h1>
<table><thead><tr><th scope="col">Member</th><th scope="col">Balance</th></tr></thead><tbody>
${raw(balances.map((m) => html`<tr data-testid="balance-row"><td>${m.name}</td><td class="${balanceClass(m.net)}">${m.name} ${balanceText(m.net)}</td></tr>`).join(''))}
</tbody></table>
<div class="actions"><a class="btn" href="/groups/${group.id}/settle">Settle up</a><a class="btn secondary" href="/groups/${group.id}">Back to group</a></div>`);
}));

function settleForm(group, members, me, values = {}, error = '') {
    const opts = (selected) => raw(members.map((m) => html`<option value="${m.id}" ${String(selected) === String(m.id) ? raw('selected') : ''}>${m.id === me ? `${m.name} (you)` : m.name}</option>`).join(''));
    return html`<h1>Settle up in ${group.name}</h1>
<div class="card"><form method="post" action="/groups/${group.id}/settle" novalidate>
  ${error ? raw(html`<p class="alert" role="alert">${error}</p>`) : ''}
  <label for="payer_id">Who paid</label><select id="payer_id" name="payer_id">${opts(values.payer_id ?? members.find((m) => m.id !== me)?.id)}</select>
  <label for="payee_id">Paid to</label><select id="payee_id" name="payee_id">${opts(values.payee_id ?? me)}</select>
  <label for="method">Method</label><select id="method" name="method"><option value="Cash">Cash</option><option value="UPI">UPI</option><option value="Bank transfer">Bank transfer</option></select>
  <label for="amount">Amount (₹)</label><input id="amount" name="amount" inputmode="decimal" value="${values.amount ?? ''}">
  <div class="actions"><button class="btn" type="submit">Save</button><a class="btn secondary" href="/groups/${group.id}">Cancel</a></div>
</form></div>`;
}

app.get('/groups/:id/settle', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    render(req, res, 'Settle up', settleForm(group, await groupMembers(group.id), req.user.id));
}));

app.post('/groups/:id/settle', signedIn, wrap(async (req, res) => {
    const group = await memberGroup(req, res);
    if (!group) return;
    const members = await groupMembers(group.id);
    const payer = members.find((m) => String(m.id) === String(req.body.payer_id));
    const payee = members.find((m) => String(m.id) === String(req.body.payee_id));
    const amount = toPaise(req.body.amount);
    const method = ['Cash', 'UPI', 'Bank transfer'].includes(req.body.method) ? req.body.method : 'Cash';
    const again = (error) => render(req, res, 'Settle up', settleForm(group, members, req.user.id, req.body, error), 422);
    if (!payer || !payee) return again('Choose who paid and who was paid');
    if (payer.id === payee.id) return again('Someone cannot pay themselves');
    if (amount === null || amount <= 0) return again('Amount must be more than 0.00');

    await tx(async (c) => {
        await c.query('INSERT INTO settlements (group_id, payer_id, payee_id, amount, note) VALUES (?, ?, ?, ?, ?)', [group.id, payer.id, payee.id, plain(amount), method]);
        const people = await c.query('SELECT id, email FROM users WHERE id IN (?, ?)', [payer.id, payee.id]);
        const body = `${payer.name} paid ${payee.name} ${formatINR(amount)} (${method}) in ${group.name}.`;
        for (const p of people[0]) {
            await c.query('INSERT INTO email_outbox (to_email, subject, body) VALUES (?, ?, ?)', [p.email, `You settled up in ${group.name}`, body]);
        }
    });
    req.session.flash = `Settlement of ${formatINR(amount)} recorded`;
    res.redirect(`/groups/${group.id}/balances`);
}));

// ---------------------------------------------------------------------------------------------- API
app.get('/api/groups/:id/balances', wrap(async (req, res) => {
    const token = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const auth = token ? await one('SELECT user_id FROM api_tokens WHERE token = ?', [token]) : null;
    if (!auth) return res.status(401).json({ error: 'A valid Bearer token is required.' });
    const group = await one(
        'SELECT g.id, g.name FROM expense_groups g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ? WHERE g.id = ?',
        [auth.user_id, Number(req.params.id)]);
    if (!group) return res.status(404).json({ error: 'Group not found.' });
    const balances = await groupBalances(group.id);
    res.json({
        group_id: group.id,
        group_name: group.name,
        currency: 'INR',
        members: balances.map((m) => ({ user_id: m.id, name: m.name, email: m.email, net: plain(m.net) })),
    });
}));

// ---------------------------------------------------------------------------------------------- dev mailbox
if (IS_DEV) {
    app.get('/dev/mailbox', wrap(async (req, res) => {
        const email = String(req.query.email ?? '').trim().toLowerCase();
        const mails = email ? await all('SELECT subject, body, created_at FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 50', [email]) : [];
        render(req, res, 'Mailbox', html`<h1>Mailbox (development)</h1>
<form method="get" action="/dev/mailbox" class="card"><label for="mb-email">Email address</label><input id="mb-email" name="email" value="${email}">
<div class="actions"><button class="btn" type="submit">Open</button></div></form>
${email ? raw(mails.length ? mails.map((m) => html`<div class="card" data-testid="mail"><strong>${m.subject}</strong><div>${m.body}</div><div class="muted">${m.created_at}</div></div>`).join('') : html`<p class="muted">No emails for ${email}.</p>`) : ''}`);
    }));
}

app.get('/health', wrap(async (_req, res) => { await one('SELECT 1 AS ok'); res.json({ ok: true }); }));

app.use((req, res) => render(req, res, 'Not found', html`<h1>Page not found</h1>`, 404));
app.use((err, req, res, _next) => {
    console.error(err);
    res.status(500).send(page({ title: 'Error', user: req.user ?? null, body: `<h1>Something went wrong</h1><p>${esc(err.message)}</p>` }));
});

const port = Number(process.env.PORT ?? 5173);
app.listen(port, () => console.log(`Splitwise on http://localhost:${port}`));
