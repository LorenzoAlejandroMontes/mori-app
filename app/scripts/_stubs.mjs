// Test doubles for the Tauri APIs, so checks.mjs can run Mori's REAL frontend
// modules under plain node. `@tauri-apps/plugin-sql` is backed by node:sqlite, so
// every query in organize/recall/jobs runs against the real schema.
import { DatabaseSync } from "node:sqlite";

// --- @tauri-apps/plugin-sql --------------------------------------------------

// tauri-plugin-sql speaks $1/$2 placeholders; node:sqlite speaks `?` positionally
// and a $n may repeat, so we expand the parameter list in occurrence order.
function toNodeSql(sql, params) {
  const out = [];
  const text = sql.replace(/\$(\d+)/g, (_, n) => {
    out.push(params[Number(n) - 1]);
    return "?";
  });
  return [text, out.map((v) => (v === undefined ? null : v))];
}

export class FakeDatabase {
  constructor(path) {
    this.raw = new DatabaseSync(path);
  }
  static async load(url) {
    return new FakeDatabase(String(url).replace(/^sqlite:/, ""));
  }
  async select(sql, params = []) {
    const [text, args] = toNodeSql(sql, params);
    return this.raw.prepare(text).all(...args);
  }
  async execute(sql, params = []) {
    const [text, args] = toNodeSql(sql, params);
    const r = this.raw.prepare(text).run(...args);
    return { rowsAffected: Number(r.changes ?? 0), lastInsertId: Number(r.lastInsertRowid ?? 0) };
  }
  async close() {
    this.raw.close();
    return true;
  }
}

// --- @tauri-apps/api/core ----------------------------------------------------

// Every `invoke(cmd, args)` the app makes lands here. Tests install handlers.
export const invokeHandlers = new Map();
export const invokeCalls = [];

export async function invoke(cmd, args) {
  invokeCalls.push({ cmd, args });
  const h = invokeHandlers.get(cmd);
  if (!h) throw new Error(`comando non stubbato: ${cmd}`);
  return typeof h === "function" ? await h(args) : h;
}

export function convertFileSrc(p) {
  return `asset://${p}`;
}

// --- @tauri-apps/plugin-http -------------------------------------------------

// Queue of LLM replies; each fetch shifts one. A reply can be a string (becomes a
// 200 chat completion) or {status, body} to simulate a provider refusing.
export const httpReplies = [];
export const httpRequests = [];

export async function fetch(url, init) {
  const body = init?.body ? JSON.parse(init.body) : null;
  httpRequests.push({ url, body });
  const next = httpReplies.length ? httpReplies.shift() : "";
  if (next && typeof next === "object" && "status" in next) {
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => next.body ?? "",
      json: async () => JSON.parse(next.body ?? "{}"),
    };
  }
  const payload = { choices: [{ message: { content: String(next) } }] };
  return { ok: true, status: 200, text: async () => JSON.stringify(payload), json: async () => payload };
}

// --- minimal browser globals the modules touch -------------------------------

export function installGlobals() {
  if (!globalThis.crypto?.randomUUID) {
    globalThis.crypto = { ...(globalThis.crypto ?? {}), randomUUID: () => Math.random().toString(36).slice(2) };
  }
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  }
}
