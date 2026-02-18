import mysql from 'mysql2/promise';

const host = process.env.MYSQL_HOST;
const port = parseInt(process.env.MYSQL_PORT ?? '3306', 10);
const user = process.env.MYSQL_USER;
const password = process.env.MYSQL_PASSWORD;
const database = process.env.MYSQL_DATABASE;

if (!host || !user || !password || !database) {
  throw new Error(
    'Missing MySQL config. Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE in .env (see .env.example).'
  );
}

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  ssl: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED === 'true'
    ? { rejectUnauthorized: true }
    : host.includes('aivencloud.com')
      ? { rejectUnauthorized: false }
      : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export async function getDb() {
  return pool;
}

export async function query<T = mysql.RowDataPacket[]>(
  sql: string,
  params?: unknown[]
): Promise<T> {
  const [rows] = await pool.execute(sql, params);
  return rows as T;
}
