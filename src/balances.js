import { all } from './db.js';
import { toPaise } from './money.js';

/**
 * Net balance of every member of a group, in paise. Positive = the group owes them, negative = they owe.
 *   net = what they paid for expenses − their shares + settlements they paid − settlements they received
 */
export async function groupBalances(groupId) {
    const members = await all(
        `SELECT u.id, u.name, u.email, gm.role FROM group_members gm JOIN users u ON u.id = gm.user_id
         WHERE gm.group_id = ? ORDER BY gm.id`, [groupId]);
    const net = new Map(members.map((m) => [m.id, 0]));
    const add = (userId, paise) => { if (net.has(userId)) net.set(userId, net.get(userId) + paise); };

    for (const r of await all('SELECT paid_by, amount FROM expenses WHERE group_id = ?', [groupId])) add(r.paid_by, toPaise(r.amount));
    for (const r of await all(
        'SELECT s.user_id, s.share_amount FROM expense_splits s JOIN expenses e ON e.id = s.expense_id WHERE e.group_id = ?', [groupId],
    )) add(r.user_id, -toPaise(r.share_amount));
    for (const r of await all('SELECT payer_id, payee_id, amount FROM settlements WHERE group_id = ?', [groupId])) {
        add(r.payer_id, toPaise(r.amount));
        add(r.payee_id, -toPaise(r.amount));
    }
    return members.map((m) => ({ ...m, net: net.get(m.id) }));
}
