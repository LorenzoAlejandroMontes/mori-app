// Settings: model, recording, transcription, names, appearance, storage and backups.
// The section labels ("Modello", "Registrazione"…) live in shell.ts, shared with ⌘K.
export default {
  // Messages
  "Corretti 1 nomi ({entities} nelle persone e progetti, {participants} tra i partecipanti, {assignees} tra i responsabili).":
    "Fixed 1 name ({entities} in people & projects, {participants} among participants, {assignees} among assignees).",
  "Corretti {n} nomi ({entities} nelle persone e progetti, {participants} tra i partecipanti, {assignees} tra i responsabili).":
    "Fixed {n} names ({entities} in people & projects, {participants} among participants, {assignees} among assignees).",
  "Comprimo… {done}/{total}": "Compressing… {done}/{total}",
  "Nessun audio da comprimere.": "No audio to compress.",
  "Compressi 1 audio, {failed} non riusciti. Spazio liberato: {size}.": "Compressed 1 recording, {failed} failed. Space freed: {size}.",
  "Compressi {n} audio, {failed} non riusciti. Spazio liberato: {size}.": "Compressed {n} recordings, {failed} failed. Space freed: {size}.",
  "Compressi 1 audio. Spazio liberato: {size}.": "Compressed 1 recording. Space freed: {size}.",
  "Compressi {n} audio. Spazio liberato: {size}.": "Compressed {n} recordings. Space freed: {size}.",
  "Nessun audio da eliminare: quelli rimasti servono a call non ancora trascritte.":
    "No audio to delete: what's left belongs to calls that aren't transcribed yet.",
  "Eliminato l'audio di 1 call. Spazio liberato: {size}.": "Deleted the audio of 1 call. Space freed: {size}.",
  "Eliminato l'audio di {n} call. Spazio liberato: {size}.": "Deleted the audio of {n} calls. Space freed: {size}.",
  "Copia salvata (1 call) e copiata nella cartella scelta.": "Backup saved (1 call) and copied to the folder you chose.",
  "Copia salvata ({n} call) e copiata nella cartella scelta.": "Backup saved ({n} calls) and copied to the folder you chose.",
  "Copia salvata (1 call).": "Backup saved (1 call).",
  "Copia salvata ({n} call).": "Backup saved ({n} calls).",
  "Provo…": "Testing…",
  "Esporto… {done}/{total}": "Exporting… {done}/{total}",
  "Esportate 1 call in Markdown.": "Exported 1 call to Markdown.",
  "Esportate {n} call in Markdown.": "Exported {n} calls to Markdown.",
  "Export non riuscito: {error}": "Export failed: {error}",

  // Page
  "Tutto resta su questo PC. Il tema si applica subito, il resto quando premi Salva.":
    "Everything stays on this PC. The theme applies right away, the rest when you press Save.",
  "Avevi lasciato delle modifiche senza salvarle: sono qui sotto. Salva per tenerle, Annulla per tornare a com'era.":
    "You left some changes unsaved: they're below. Save to keep them, Cancel to go back to how it was.",
  "Sezioni delle impostazioni": "Settings sections",
  "Modifiche non salvate": "Unsaved changes",
  "Salva (Ctrl S)": "Save (Ctrl S)",
  "Verifica": "Test",

  // Model
  "Il cervello di Mori: qualsiasi modello compatibile OpenAI. In cloud escono solo i pezzi utili alla risposta, mai l'audio né l'archivio; in locale non esce niente.":
    "Mori's brain: any OpenAI-compatible model. With a cloud model, only the pieces needed for the answer leave your PC, never the audio or the archive; with a local one, nothing leaves.",
  "Scelte pronte": "Presets",
  "locale": "local",
  "gratis": "free",
  "Veloce, piano gratuito, non allena sui tuoi dati. Chiave su console.groq.com":
    "Fast, free tier, doesn't train on your data. Key at console.groq.com",
  "Chiave su platform.openai.com": "Key at platform.openai.com",
  "Centinaia di modelli con una chiave sola. Chiave su openrouter.ai": "Hundreds of models with a single key. Key at openrouter.ai",
  "Gratis e sul tuo PC: ollama.com, poi `ollama pull qwen2.5:7b`": "Free and on your PC: ollama.com, then `ollama pull qwen2.5:7b`",
  "Gratis e sul tuo PC: lmstudio.ai, avvia il server locale con un modello caricato":
    "Free and on your PC: lmstudio.ai, then start the local server with a model loaded",
  "Sul tuo PC ({host}): non esce niente.": "On your PC ({host}): nothing leaves it.",
  "In cloud ({host}): escono solo i pezzi utili alla risposta.": "In the cloud ({host}): only the pieces needed for the answer leave your PC.",
  "Indirizzo (base URL)": "Address (base URL)",
  "Chiave API": "API key",
  "Non serve per un modello sul tuo PC.": "Not needed for a model on your PC.",
  "Resta solo su questo PC.": "It stays on this PC only.",
  "non serve": "not needed",
  "incolla la tua chiave": "paste your key",
  "Call private": "Private calls",
  "Il cervello di Mori è già sul tuo PC: anche le call private usano quello, e nulla esce.":
    "Mori's brain is already on your PC: private calls use it too, and nothing leaves.",
  "Una call segnata “privata” non va mai al cloud. Per farla capire comunque a Mori indica un modello locale (Ollama o LM Studio, gratuiti). Senza, resta trascritta ma non organizzata, e il richiamo non la usa.":
    "A call marked “private” never goes to the cloud. For Mori to understand it anyway, point it at a local model (Ollama or LM Studio, both free). Without one, it stays transcribed but not organized, and recall doesn't use it.",
  "Indirizzo del modello locale": "Local model address",
  "Questo indirizzo non è sul tuo PC: per le call private serve localhost.": "This address isn't on your PC: private calls need localhost.",
  "Modello locale": "Local model",
  "es. qwen2.5:7b": "e.g. qwen2.5:7b",

  // Recording
  "Tu dal microfono, l'altro dall'audio del PC. Si registra dal controllo in alto a sinistra o con la scorciatoia, anche con Mori dietro altre finestre.":
    "You from the microphone, the other side from your PC's audio. Record from the control at the top left or with the shortcut, even with Mori behind other windows.",
  "Scorciatoia per registrare e fermare": "Shortcut to record and stop",
  "Proponi lo stop dopo un silenzio di": "Suggest stopping after a silence of",
  "Minuti senza una parola da nessuno dei due lati. 0 = mai.": "Minutes without a word from either side. 0 = never.",
  "minuti": "minutes",
  "Suggerisci di registrare quando rilevo una call": "Suggest recording when I spot a call",
  "Meet, Zoom, Teams o Webex davanti: Mori lo propone, non registra mai da solo.":
    "Meet, Zoom, Teams or Webex in front: Mori suggests it, and never records on its own.",
  "Chiudendo la finestra, Mori resta nella barra": "When you close the window, Mori stays in the tray",
  "Registrazione e trascrizioni vanno avanti; lo riapri dall'icona.": "Recording and transcriptions keep going; reopen it from the icon.",
  "L'icona nella barra non è partita: la scorciatoia e la chiusura in background non sono attive in questa sessione.":
    "The tray icon didn't start: the shortcut and closing to the background aren't active in this session.",

  // Transcription
  "Whisper trasforma la voce in testo: sul tuo PC, in background, o in cloud quando conta la velocità.":
    "Whisper turns speech into text: on your PC, in the background, or in the cloud when speed matters.",
  "Dove trascrivere": "Where to transcribe",
  "Sul tuo PC": "On your PC",
  "Privato e gratis, ma lento: su un portatile un'ora di call richiede 10–30 minuti.":
    "Private and free, but slow: on a laptop, an hour of call takes 10–30 minutes.",
  "Veloce, con Groq": "Fast, with Groq",
  "Un'ora di call in meno di un minuto. Esce solo il parlato (i silenzi restano qui) e Groq non lo usa per addestrare. Mai per le call private; se qualcosa non va, trascrivo sul PC.":
    "An hour of call in under a minute. Only the speech leaves your PC (silences stay here) and Groq doesn't train on it. Never for private calls; if something goes wrong, I transcribe on your PC.",
  "Chiave Groq": "Groq key",
  "Uso quella del modello, che è già Groq. Scrivine una qui solo per usarne un'altra.":
    "I'm using the model's key, which is already Groq. Enter one here only to use a different one.",
  "Gratis su console.groq.com → API Keys. Resta sul tuo PC.": "Free at console.groq.com → API Keys. It stays on your PC.",
  "Senza una chiave trascrivo sul PC.": "Without a key, I transcribe on your PC.",
  "Qualità": "Quality",
  "Più grande = più fedele ma più lento.": "Bigger = more accurate but slower.",
  "Massima (turbo), consigliata": "Best (turbo), recommended",
  "Media, più leggera": "Medium, lighter",
  "Di cosa parli di solito": "What you usually talk about",
  "Una frase che Whisper legge prima di ogni call: il gergo del tuo lavoro esce scritto giusto. Resta sul tuo PC.":
    "A sentence Whisper reads before every call, so your work jargon comes out spelled right. It stays on your PC.",
  "es. Lavoro in una startup di prodotto: roadmap, onboarding, SEO, Notion, Figma.":
    "e.g. I work at a product startup: roadmap, onboarding, SEO, Notion, Figma.",
  "Richiamo per significato (modello locale)": "Recall by meaning (local model)",
  "Pronto": "Ready",
  "Verifica in corso…": "Checking…",
  "Non disponibile": "Not available",
  "Da verificare": "Not checked yet",
  "Verifica di nuovo": "Check again",
  "Scarica e verifica": "Download and check",
  "Serve a capire domande diverse dalle parole esatte. Gira offline; al primo uso scarica circa 120 MB in ~/.mori/models.":
    "It lets Mori understand questions that don't use the exact words. It runs offline; the first time, it downloads about 120 MB to ~/.mori/models.",

  // You and your names
  "Come ti chiamano nelle call": "What people call you in calls",
  "Serve a dividere le cose da fare tue da quelle degli altri. Se una call ti ha capito male (es. “Alenso”), aggiungilo qui, separato da virgole.":
    "So your to-dos can be told apart from everyone else's. If a call got your name wrong (e.g. “Alenso”), add it here, separated by commas.",
  "Tu, te, e il tuo nome": "You, and your name",
  "Dizionario dei nomi": "Name dictionary",
  "Come si scrivono le persone e i progetti di cui parli: Mori li suggerisce a Whisper mentre trascrive e li corregge dopo. Si salvano subito.":
    "How to spell the people and projects you talk about: Mori suggests them to Whisper while it transcribes and fixes them afterwards. Saved right away.",
  "Ancora nessun nome.": "No names yet.",
  "Togli {name}": "Remove {name}",
  "Come lo scrive male (facoltativo)": "How it gets misspelled (optional)",
  "come lo scrive male (facoltativo)": "how it gets misspelled (optional)",
  "Come si scrive": "Correct spelling",
  "come si scrive": "correct spelling",
  "Nelle call esistenti non c'è niente da correggere.": "There's nothing to fix in your existing calls.",
  "Cambierà 1 nomi nelle call esistenti. I trascritti restano com'erano.":
    "This will change 1 name in your existing calls. Transcripts stay as they were.",
  "Cambierà {n} nomi nelle call esistenti. I trascritti restano com'erano.":
    "This will change {n} names in your existing calls. Transcripts stay as they were.",
  "Correggi": "Fix",
  "Applica alle call esistenti": "Apply to existing calls",

  // Appearance
  "Tema": "Theme",
  "Come Windows": "Like Windows",
  "Chiaro": "Light",
  "Scuro": "Dark",
  "Si applica subito, anche alla finestrella sempre in primo piano.": "Applies right away, to the small always-on-top window too.",
  "Lingua": "Language",
  "Come il sistema": "Like the system",
  "Interfaccia, sintesi e cose da fare delle prossime call. Mori si ricarica un attimo.":
    "The interface, plus the summaries and to-dos of your next calls. Mori reloads for a moment.",

  // Storage & backups
  "L'audio delle call, dopo la trascrizione": "Call audio, after transcription",
  "Non tenerlo": "Don't keep it",
  "consigliato": "recommended",
  "Resta il trascritto, con chi ha detto cosa e quando. Niente spazio occupato; le righe non si riascoltano.":
    "The transcript stays, with who said what and when. No space used; lines can't be played back.",
  "In una cartella che scegli": "In a folder you choose",
  "Per esempio una cartella di OneDrive o Google Drive con «file su richiesta»: non pesa sul PC e lo riascolti quando serve.":
    "For example a OneDrive or Google Drive folder with “files on demand”: it takes no space on your PC and you can play it back when you need to.",
  "Compresso senza perdita, circa 30–60 MB per ora di call.": "Losslessly compressed, about 30–60 MB per hour of call.",
  "Cartella per l'audio": "Audio folder",
  "Senza cartella l'audio resta sul PC.": "Without a folder, the audio stays on your PC.",
  "es. C:\\Users\\…\\OneDrive\\Mori\\Audio": "e.g. C:\\Users\\…\\OneDrive\\Mori\\Audio",
  "Audio sul PC": "Audio on your PC",
  "Nessun audio: non occupa spazio.": "No audio: it takes up no space.",
  "{size} in 1 file": "{size} in 1 file",
  "{size} in {n} file": "{size} in {n} files",
  "Conferma": "Confirm",
  "Elimino l'audio delle call già trascritte? Non si può annullare.": "Delete the audio of calls already transcribed? This can't be undone.",
  "Elimina l'audio": "Delete the audio",
  "Comprimo…": "Compressing…",
  "Comprimi gli audio": "Compress the audio",
  "Libero spazio…": "Freeing up space…",
  "Libera spazio": "Free up space",
  "Copie": "Backups",
  "Ultima: {date}": "Last one: {date}",
  "Ancora nessuna copia.": "No backups yet.",
  "Mori ne fa una al giorno e tiene le ultime 7.": "Mori makes one a day and keeps the last 7.",
  "Copio…": "Backing up…",
  "Fai una copia adesso": "Back up now",
  "Seconda cartella per le copie": "Second folder for backups",
  "Se la indichi, Mori ci mette anche l'ultima copia (es. una cartella di OneDrive).":
    "If you set one, Mori also puts the latest backup there (e.g. a OneDrive folder).",
  "es. C:\\Users\\...\\OneDrive\\Mori": "e.g. C:\\Users\\...\\OneDrive\\Mori",
  "Esporta in Markdown": "Export to Markdown",
  "Tutte le call come file leggibili ovunque (Obsidian, Notion, un editor): i tuoi dati non restano chiusi dentro Mori.":
    "Every call as files you can read anywhere (Obsidian, Notion, any editor): your data never gets locked inside Mori.",
  "Esporto…": "Exporting…",
  "Esporta tutto": "Export all",
  "Apri la cartella": "Open the folder",
} as Record<string, string>;
