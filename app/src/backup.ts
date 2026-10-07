import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { db } from "./db";
import { t } from "./i18n";

// Backups and disk, as decided on 2026-08-23 (DECISIONS.md): a local SQLite file
// is a single point of loss, and until today there was exactly one `mori.db` and
// no copy of it. `VACUUM INTO` writes a consistent snapshot without locking the
// app, the snapshot is opened and counted before anything is rotated away, and
// the newest one is never deleted.

const KEEP = 7;
const DAY_MS = 86_400_000;
const KEY_LAST = "backup_last_at";
const KEY_DIR2 = "backup_dir_2"; // optional second folder (e.g. a synced one)

async function getSetting(key: string): Promise<string | null> {
  const d = await db();
  const [row] = await d.select<{ value: string }[]>(`SELECT value FROM app_setting WHERE key = $1`, [key]);
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const d = await db();
  await d.execute(
    `INSERT INTO app_setting (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2`,
    [key, value],
  );
}

export const getSecondFolder = () => getSetting(KEY_DIR2);
export const setSecondFolder = (dir: string) => setSetting(KEY_DIR2, dir.trim());
export const getLastBackupAt = () => getSetting(KEY_LAST);

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export type BackupResult = { path: string; sessions: number; copiedTo: string | null; removed: string[] };

/** Snapshot → verify → rotate. Throws with a readable message if the snapshot
 *  cannot be opened or does not hold the same number of calls. */
export async function runBackup(): Promise<BackupResult> {
  const d = await db();
  const dir = await invoke<string>("backups_dir");
  const path = `${dir.replace(/[\\/]$/, "")}\\mori-${stamp()}.db`;

  // VACUUM INTO takes an expression, and the path is ours (not user input); the
  // quote doubling is belt and braces.
  await d.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);

  const [live] = await d.select<{ n: number }[]>(`SELECT COUNT(*) n FROM session`);
  let sessions = 0;
  const snap = await Database.load(`sqlite:${path}`);
  try {
    const check = await snap.select<Record<string, string>[]>(`PRAGMA integrity_check`);
    const verdict = check[0] ? Object.values(check[0])[0] : "";
    const [copy] = await snap.select<{ n: number }[]>(`SELECT COUNT(*) n FROM session`);
    sessions = copy?.n ?? 0;
    if (verdict !== "ok" || sessions !== (live?.n ?? -1)) {
      throw new Error(
        t("copia non valida ({verdict}, {copied}/{total} call)", {
          verdict: verdict || t("illeggibile"),
          copied: sessions,
          total: live?.n ?? "?",
        }),
      );
    }
  } catch (e) {
    await snap.close(snap.path).catch(() => {}); // no arg = the plugin closes EVERY pool, the live DB included
    await invoke("delete_file", { path }).catch(() => {});
    throw e;
  }
  await snap.close(snap.path).catch(() => {}); // no arg = the plugin closes EVERY pool, the live DB included

  await setSetting(KEY_LAST, new Date().toISOString());

  // Only now that we have a verified new snapshot do we thin the old ones out.
  const removed = await invoke<string[]>("rotate_backups", { keep: KEEP }).catch(() => [] as string[]);

  let copiedTo: string | null = null;
  const second = (await getSecondFolder())?.trim();
  if (second) {
    copiedTo = await invoke<string>("copy_into", { src: path, dir: second }).catch(() => null);
  }

  return { path, sessions, copiedTo, removed };
}

/** Called at startup: a snapshot a day, silently. Never throws. */
export async function maybeBackup(): Promise<BackupResult | null> {
  try {
    const last = await getLastBackupAt();
    if (last && Date.now() - Date.parse(last) < DAY_MS) return null;
    return await runBackup();
  } catch {
    return null; // a failed backup must never get in the way of using Mori
  }
}

// --- kept audio --------------------------------------------------------------

export type AudioStats = { wav_count: number; wav_bytes: number; flac_count: number; flac_bytes: number };

export const audioStats = () => invoke<AudioStats>("audio_stats");

/** Compress ONE session's kept WAV and point the session at the FLAC. The WAV is
 *  removed by the Rust side only after the FLAC has been decoded back and
 *  checked sample for sample. */
export async function compressSessionAudio(sessionId: string): Promise<string | null> {
  const d = await db();
  const [row] = await d.select<{ audio_path: string | null }[]>(
    `SELECT audio_path FROM session WHERE id = $1`,
    [sessionId],
  );
  const wav = row?.audio_path;
  if (!wav || !/\.wav$/i.test(wav)) return null;
  const flac = await invoke<string>("compress_audio", { wav });
  await d.execute(`UPDATE session SET audio_path = $1, updated_at = $2 WHERE id = $3`, [
    flac,
    new Date().toISOString(),
    sessionId,
  ]);
  return flac;
}

/** "Comprimi gli audio esistenti": every call whose kept audio is still a WAV. */
export async function compressAllAudio(
  onProgress?: (done: number, total: number) => void,
): Promise<{ done: number; failed: number; saved: number }> {
  const d = await db();
  const rows = await d.select<{ id: string; audio_path: string }[]>(
    `SELECT id, audio_path FROM session WHERE audio_path LIKE '%.wav'`,
  );
  const before = await audioStats().catch(() => null);
  let done = 0;
  let failed = 0;
  for (let i = 0; i < rows.length; i++) {
    try {
      await compressSessionAudio(rows[i].id);
      done++;
    } catch {
      failed++; // the WAV is untouched when compression fails
    }
    onProgress?.(i + 1, rows.length);
  }
  const after = await audioStats().catch(() => null);
  const saved =
    before && after ? Math.max(0, before.wav_bytes + before.flac_bytes - (after.wav_bytes + after.flac_bytes)) : 0;
  return { done, failed, saved };
}

export function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const mb = n / (1024 * 1024);
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
