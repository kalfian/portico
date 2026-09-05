'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// DB path is env-configurable (Docker mounts a volume here later). Default: data/topology.db.
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, '..', 'data', 'topology.db');

// Ensure the parent directory exists before opening.
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL for concurrent reads + durable writes; enforce FKs on this connection.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Ordered migrations. Each entry is applied in a transaction when
// PRAGMA user_version < its version, then user_version is bumped.
const MIGRATIONS = [
  { version: 1, file: '001_init.sql' },
  { version: 2, file: '002_tokens.sql' },
];

function runMigrations() {
  const current = db.pragma('user_version', { simple: true });
  for (const { version, file } of MIGRATIONS) {
    if (current >= version) continue;
    const sql = fs.readFileSync(path.join(__dirname, 'migrations', file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    });
    apply();
    console.log(`[db] applied migration ${version} (${file})`);
  }
}

runMigrations();

module.exports = { db, DB_PATH };
