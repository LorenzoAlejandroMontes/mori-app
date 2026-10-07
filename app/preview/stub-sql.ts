// Preview bench: @tauri-apps/plugin-sql backed by a REAL SQLite running in the
// browser (sql.js), built from the real migrations plus invented data
// (fixtures.ts). Every query the app makes runs for real against the real
// schema — a wrong column shows up here, not on the user's PC.
//
//   ?fresh=1  → only the migrations: a brand new install (welcome card, demo calls).
import initSqlJs, { type Database as SqlDb } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { fixtureSql } from "./fixtures";

const migrations = import.meta.glob("../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

let _db: Promise<SqlDb> | null = null;

function open(): Promise<SqlDb> {
  _db ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const db = new SQL.Database();
    db.exec("PRAGMA foreign_keys = ON;");
    for (const k of Object.keys(migrations).sort()) db.exec(migrations[k]);
    if (new URLSearchParams(location.search).get("fresh") !== "1") db.exec(fixtureSql());
    return db;
  })();
  return _db;
}

// tauri-plugin-sql speaks $1/$2 (repeatable); sql.js binds `?` positionally.
function positional(sql: string, params: unknown[] = []): [string, unknown[]] {
  const out: unknown[] = [];
  const text = sql.replace(/\$(\d+)/g, (_m, n: string) => {
    out.push(params[Number(n) - 1]);
    return "?";
  });
  return [text, out.map((v) => (v === undefined ? null : v))];
}

export default class Database {
  path = "sqlite:preview";
  static async load(_url: string): Promise<Database> {
    await open();
    return new Database();
  }
  async select<T>(sql: string, params?: unknown[]): Promise<T> {
    const db = await open();
    const [text, args] = positional(sql, params);
    const stmt = db.prepare(text);
    try {
      stmt.bind(args as never);
      const rows: Record<string, unknown>[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows as unknown as T;
    } finally {
      stmt.free();
    }
  }
  async execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId: number }> {
    const db = await open();
    const [text, args] = positional(sql, params);
    db.run(text, args as never);
    return { rowsAffected: db.getRowsModified(), lastInsertId: 0 };
  }
  async close(_db?: string): Promise<boolean> {
    return true;
  }
}
