import 'dotenv/config';
import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME ?? 'splitwise_dev',
    connectionLimit: 10,
    // DECIMAL columns come back as strings; amounts are handled in paise to avoid float drift.
    decimalNumbers: false,
    dateStrings: true,
});

/** Rows of a query. */
export async function all(sql, params = []) {
    const [rows] = await pool.query(sql, params);
    return rows;
}

/** First row of a query, or null. */
export async function one(sql, params = []) {
    const rows = await all(sql, params);
    return rows[0] ?? null;
}

/** Run `fn(conn)` in one transaction. */
export async function tx(fn) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const out = await fn(conn);
        await conn.commit();
        return out;
    } catch (e) {
        await conn.rollback();
        throw e;
    } finally {
        conn.release();
    }
}
