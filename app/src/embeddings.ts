import { invoke } from "@tauri-apps/api/core";

// Local embeddings via the ONNX sidecar (embed.py). Vectors are 384-dim and
// stored as JSON in transcript_chunk.embedding_json (a few KB/chunk — fine for
// thousands of chunks kept in memory for cosine scoring).
export type EmbedMode = "passage" | "query";

export async function embed(texts: string[], mode: EmbedMode): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const raw = await invoke<string>("embed_texts", { texts, mode });
  const arr = JSON.parse(raw) as number[][];
  return arr.map((v) => Float32Array.from(v));
}

// Cosine similarity of two equal-length vectors. Returns 0 for a zero vector.
export function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
