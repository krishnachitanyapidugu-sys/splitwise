// Drop and re-create every table from db/schema.sql, then seed the baseline users. Development only.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import mysql from 'mysql2/promise';

if (process.env.NODE_ENV === 'production') throw new Error('db:reset refuses to run in production.');

const conn = await mysql.createConnection({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT ?? 3306), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, multipleStatements: true,
});
await conn.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
await conn.end();
console.log('Schema applied.');
await import('./seed.js');
