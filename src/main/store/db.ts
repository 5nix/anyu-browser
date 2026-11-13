// Opens, checks and migrates the local database.
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { existsSync, renameSync } from 'node:fs';
import { migrations } from './migrations.ts';

export type Store = { db: DatabaseSync; recovered: string | null; prepare(sql: string): StatementSync; close(): void };

function initialize(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  try {
    const check = db.prepare('PRAGMA quick_check').get();
    if (check?.quick_check !== 'ok') throw new Error('Database integrity check failed');
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > (migrations.at(-1)?.version ?? 0)) throw new Error('Unknown database version');
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON');
    for (const migration of migrations.filter(m => m.version > version)) {
      db.exec('BEGIN');
      try {
        db.exec(migration.up);
        db.exec(`PRAGMA user_version = ${migration.version}`);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return db;
  } catch (error) { db.close(); throw error; }
}

export function openStore(file: string): Store {
  let recovered: string | null = null;
  let db: DatabaseSync;
  try { db = initialize(file); } catch (error) {
    if (file === ':memory:' || !existsSync(file) || !(error instanceof Error) || !/integrity check failed|malformed|not a database|disk image is malformed/i.test(error.message)) throw error;
    recovered = `${file}.damaged-${Date.now()}`;
    while (existsSync(recovered)) recovered += '-1';
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(file + suffix)) renameSync(file + suffix, recovered + suffix);
    }
    db = initialize(file);
  }
  const statements = new Map<string, StatementSync>();
  return { db, recovered, prepare: (sql) => { let statement = statements.get(sql); if (!statement) { statement = db.prepare(sql); statements.set(sql, statement); } return statement; }, close: () => { statements.clear(); db.close(); } };
}
