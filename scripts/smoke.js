// End-to-end smoke test over HTTP against a running app (npm start): walks every acceptance criterion that a
// browser-free check can prove. Creates its own group and expenses, then removes them. Development only.
import 'dotenv/config';
import { pool } from '../src/db.js';

const BASE = process.env.SMOKE_BASE_URL ?? `http://localhost:${process.env.PORT ?? 5173}`;
const PW = process.env.SEED_PASSWORD;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  — ${detail}`}`); };

/** A tiny browser: keeps the session cookie, does not follow redirects. */
function client() {
    let cookie = '';
    const go = async (path, { method = 'GET', form, headers = {} } = {}) => {
        const res = await fetch(BASE + path, {
            method, redirect: 'manual',
            headers: { ...(cookie ? { cookie } : {}), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers },
            body: form ? new URLSearchParams(form).toString() : undefined,
        });
        const set = res.headers.get('set-cookie');
        if (set) cookie = set.split(';')[0];
        return { status: res.status, location: res.headers.get('location'), text: await res.text() };
    };
    return { go, follow: async (r) => (r.location ? go(r.location) : r) };
}
const signIn = async (c, email, password = PW) => c.go('/login', { method: 'POST', form: { email, password } });

const created = { groups: [] };
try {
    const alice = client();
    // 01.1
    const ok = await signIn(alice, 'alice@splitwise.test');
    const dash = await alice.follow(ok);
    check('01.1 right password opens the dashboard with the name', ok.status === 302 && /Welcome, Alice Sharma/.test(dash.text));
    // 01.2
    const bad = await signIn(client(), 'bob@splitwise.test', 'not-the-password');
    check('01.2 wrong password shows the error and stays on sign-in', bad.status === 401 && /Email or password is incorrect/.test(bad.text));
    // 01.3 (dave is the lockout account)
    const dave = client();
    for (let i = 0; i < 5; i++) await signIn(dave, 'dave@splitwise.test', 'wrong');
    const sixth = await signIn(dave, 'dave@splitwise.test');
    check('01.3 five wrong passwords lock the account for 15 minutes', sixth.status === 401 && /locked for 15 minutes/.test(sixth.text));
    await pool.query("UPDATE users SET locked_until = NULL, failed_attempts = 0 WHERE email = 'dave@splitwise.test'");

    // 02.2
    const noName = await alice.go('/groups', { method: 'POST', form: { name: '', group_type: 'TRIP' } });
    check('02.2 a group without a name shows "Name is required"', noName.status === 422 && /Name is required/.test(noName.text));
    // 02.1
    const made = await alice.go('/groups', { method: 'POST', form: { name: 'Smoke Goa Trip', group_type: 'TRIP' } });
    const groupId = Number(/\/groups\/(\d+)/.exec(made.location ?? '')?.[1]);
    created.groups.push(groupId);
    const groupPage = await alice.go(`/groups/${groupId}`);
    check('02.1 the group opens with the creator as admin', /Smoke Goa Trip/.test(groupPage.text) && /Alice Sharma \(alice@splitwise.test\) — Admin/.test(groupPage.text));
    // 02.3
    await alice.go(`/groups/${groupId}/members`, { method: 'POST', form: { email: 'bob@splitwise.test' } });
    check('02.3 a friend added is listed as a member', /Bob Iyer \(bob@splitwise.test\)/.test((await alice.go(`/groups/${groupId}`)).text));

    const [[{ id: aliceId }]] = await pool.query("SELECT id FROM users WHERE email = 'alice@splitwise.test'");
    const [[{ id: bobId }]] = await pool.query("SELECT id FROM users WHERE email = 'bob@splitwise.test'");
    // 03.2
    const short = await alice.go(`/groups/${groupId}/expenses`, { method: 'POST', form: { description: 'Hotel', amount: '1000.00', paid_by: aliceId, split: 'UNEQUAL', [`share_${aliceId}`]: '400.00', [`share_${bobId}`]: '500.00' } });
    check('03.2 shares that do not add up are refused with the difference', short.status === 422 && /Shares are 100.00 short of 1000.00/.test(short.text));
    // 03.1
    await alice.go(`/groups/${groupId}/expenses`, { method: 'POST', form: { description: 'Beach dinner', amount: '1200', paid_by: aliceId, split: 'EQUAL' } });
    const bal = await alice.go(`/groups/${groupId}/balances`);
    check('03.1 / 04.1 equal split: Alice is owed ₹600.00 and Bob owes ₹600.00', /Alice Sharma is owed ₹600.00/.test(bal.text) && /Bob Iyer owes ₹600.00/.test(bal.text));
    // 03.3
    const bob = client();
    await signIn(bob, 'bob@splitwise.test');
    const act = await bob.go('/activity');
    check('03.3 the other member sees the expense in Activity', /Beach dinner<\/strong> ₹1,200.00 added by Alice Sharma/.test(act.text) && /you owe ₹600.00/.test(act.text));
    // 04.4
    const [[tok]] = await pool.query('SELECT token FROM api_tokens WHERE user_id = ? LIMIT 1', [aliceId]);
    const api = await fetch(`${BASE}/api/groups/${groupId}/balances`, { headers: { authorization: `Bearer ${tok?.token}` } });
    const body = await api.json();
    check('04.4 the balances API returns each net amount', api.status === 200 && body.members.find((m) => m.user_id === aliceId)?.net === '600.00' && body.members.find((m) => m.user_id === bobId)?.net === '-600.00', JSON.stringify(body));
    check('04.4 the API refuses a missing token', (await fetch(`${BASE}/api/groups/${groupId}/balances`)).status === 401);
    // 04.2
    await alice.go(`/groups/${groupId}/settle`, { method: 'POST', form: { payer_id: bobId, payee_id: aliceId, method: 'Cash', amount: '600.00' } });
    const after = await alice.go(`/groups/${groupId}/balances`);
    check('04.2 a cash settlement of 600.00 brings both to 0.00', (after.text.match(/settled up \(₹0.00\)/g) ?? []).length === 2);
    // 04.3
    const mail = await alice.go('/dev/mailbox?email=bob%40splitwise.test');
    check('04.3 the people involved get an email', /You settled up in Smoke Goa Trip/.test(mail.text) && /₹600.00/.test(mail.text));
    // 05.3
    await alice.go(`/groups/${groupId}/expenses`, { method: 'POST', form: { description: 'Flights', amount: '120000', paid_by: aliceId, split: 'EQUAL' } });
    check('05.3 amounts use ₹ and Indian grouping', /₹1,20,000.00/.test((await alice.go(`/groups/${groupId}`)).text));
    // 05.2
    const form = (await alice.go(`/groups/${groupId}/expenses/new`)).text;
    const ids = [...form.matchAll(/<input id="([^"]+)"/g)].map((m) => m[1]).concat([...form.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]));
    check('05.2 every field of the expense form has a label', ids.length > 0 && ids.every((id) => form.includes(`for="${id}"`)), ids.join(','));
    // 05.1
    const t0 = Date.now();
    await alice.go('/');
    check('05.1 the dashboard answers within 2 seconds', Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
} finally {
    // Remove what the smoke test made (children first).
    for (const g of created.groups.filter(Boolean)) {
        await pool.query('DELETE s FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?', [g]);
        await pool.query('DELETE FROM expenses WHERE group_id = ?', [g]);
        await pool.query('DELETE FROM settlements WHERE group_id = ?', [g]);
        await pool.query('DELETE FROM group_members WHERE group_id = ?', [g]);
        await pool.query('DELETE FROM expense_groups WHERE id = ?', [g]);
    }
    await pool.query("DELETE FROM email_outbox WHERE subject = 'You settled up in Smoke Goa Trip'");
    await pool.end();
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed.`);
process.exitCode = failed ? 1 : 0;
