// The core modules: the job queue, the model client (errors and the "Verifica"
// verdict), organize, brief, follow-up, backup and the Markdown export.
export default {
  // Job queue (jobs.ts)
  "tipo di lavoro sconosciuto: {kind}": "unknown job type: {kind}",
  "nessun file audio da trascrivere per questa call": "no audio file to transcribe for this call",
  "La trascrizione": "Transcription",
  "La sintesi": "The summary",
  "La compressione dell'audio": "Audio compression",
  "L'indicizzazione": "Indexing",
  "{what} non è riuscita dopo {n} tentativi.": "{what} failed after {n} attempts.",
  "{what} è in corso…": "{what} is in progress…",
  "{what} è in coda.": "{what} is queued.",

  // Model client (llm.ts)
  "LLM: nessuna risposta dopo {s} s": "LLM: no answer after {s} s",
  "LLM locale non raggiungibile su {url}. È acceso? ({error})": "Local LLM not reachable at {url}. Is it running? ({error})",
  "(nessuna risposta)": "(no answer)",
  "risposta interrotta": "answer cut off",
  "Manca l'indirizzo del provider.": "The provider's address is missing.",
  "Manca il nome del modello.": "The model name is missing.",
  "Manca la chiave API (serve per i provider in cloud).": "The API key is missing (cloud providers need one).",
  "Risponde ({s} s): “{answer}”": "It answers ({s} s): “{answer}”",
  "Chiave non valida o senza permessi.": "Invalid key, or it doesn't have the permissions.",
  "Modello o indirizzo non trovato: controlla il nome del modello.": "Model or address not found: check the model name.",
  "Il provider risponde ma ti sta limitando (troppe richieste). Riprova tra un minuto.":
    "The provider answers but is rate-limiting you (too many requests). Try again in a minute.",

  // Organize (organize.ts)
  "Risposta non in formato JSON": "The answer isn't in JSON format",
  "Call privata: serve un modello locale (Impostazioni → Modello).": "Private call: it needs a local model (Settings → Model).",
  "Imposta il modello (Impostazioni → Modello) prima di far organizzare Mori.":
    "Set up the model (Settings → Model) before Mori can organize calls.",
  "Call privata: non la mando a un modello in cloud.": "Private call: I won't send it to a cloud model.",
  "Imposta il modello (Impostazioni → Modello) prima di riorganizzare.": "Set up the model (Settings → Model) before reorganizing.",

  // Brief and follow-up
  "il modello non ha scritto niente": "the model didn't write anything",
  "call non trovata": "call not found",

  // Backup
  "copia non valida ({verdict}, {copied}/{total} call)": "invalid backup ({verdict}, {copied}/{total} calls)",
  "illeggibile": "unreadable",

  // Markdown export (export-logic.ts)
  "Call senza titolo": "Untitled call",
  "Call privata: letta solo da un modello locale.": "Private call: read only by a local model.",
  "Decisioni": "Decisions",
  "entro {due}": "by {due}",
  "senza-data": "no-date",
  "Call privata: la capisco solo con un modello locale. Impostalo in Impostazioni → Modello.": "Private call: only a model on your PC may read it. Set one up in Settings → Model.",
  "In attesa: configura il provider nelle impostazioni.": "Waiting: set up the model in Settings.",
} as Record<string, string>;
