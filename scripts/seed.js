// Baseline data every environment has: the people who sign in, their friendships and an API token.
// Groups and expenses are NOT seeded — a test (or ADIS test data) creates what it needs. Safe to re-run.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from '../src/db.js';

if (process.env.NODE_ENV === 'production') throw new Error('db:seed refuses to run in production.');
const password = process.env.SEED_PASSWORD;
if (!password) throw new Error('Set SEED_PASSWORD in .env first.');

const USERS = [
    ['alice@splitwise.test', 'Alice Sharma'],
    ['bob@splitwise.test', 'Bob Iyer'],
    ['carol@splitwise.test', 'Carol Mehta'],
    // Used by the account-lockout test, so locking it never blocks the others.
    ['dave@splitwise.test', 'Dave Lockout'],
];
const FRIENDS = [
    ['alice@splitwise.test', 'bob@splitwise.test'],
    ['alice@splitwise.test', 'carol@splitwise.test'],
    ['bob@splitwise.test', 'carol@splitwise.test'],
    ['alice@splitwise.test', 'dave@splitwise.test'],
];

const hash = await bcrypt.hash(password, 10);
for (const [email, name] of USERS) {
    await pool.query(
        `INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), password_hash = VALUES(password_hash), failed_attempts = 0, locked_until = NULL`,
        [email, name, hash]);
}
const [rows] = await pool.query('SELECT id, email FROM users');
const id = Object.fromEntries(rows.map((r) => [r.email, r.id]));
for (const [a, b] of FRIENDS) {
    await pool.query('INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?), (?, ?)', [id[a], id[b], id[b], id[a]]);
}
if (process.env.SEED_API_TOKEN) {
    await pool.query('INSERT IGNORE INTO api_tokens (user_id, token) VALUES (?, ?)', [id['alice@splitwise.test'], process.env.SEED_API_TOKEN]);
}
console.log(`Seeded ${USERS.length} users, ${FRIENDS.length} friendships${process.env.SEED_API_TOKEN ? ' and an API token for Alice' : ''}.`);
await pool.end();
