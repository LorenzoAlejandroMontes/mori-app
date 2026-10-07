# Banco di prova

Monta **l'app vera** (o una sua vista) con il CSS vero, fuori da Tauri, su un
SQLite vero che gira nel browser (sql.js): le migrazioni di
`src-tauri/migrations` più i dati **inventati** di `fixtures.ts`. Ogni query
dell'app gira davvero contro lo schema vero, quindi una colonna sbagliata si
vede qui e non sul PC di chi usa Mori. Non apre nessun database su disco.

```
pnpm exec vite build --config vite.preview.config.ts
pnpm exec vite preview --config vite.preview.config.ts --port 5199
```

| indirizzo | cosa mostra |
|---|---|
| `http://localhost:5199/` | l'app intera, su "Oggi" |
| `http://localhost:5199/?fresh=1` | una installazione nuova: benvenuto e call di esempio |
| `http://localhost:5199/?v=todos` | "Da fare" da sola |
| `http://localhost:5199/?v=people` | persone e progetti |
| `http://localhost:5199/?v=pill&pill=started` | la pillola (anche `stopped`, `silence`, `status`, `transcribing`) |
| `http://localhost:5199/?silence=1` | "Sembra finita" arriva subito dopo aver premuto Registra |
| `http://localhost:5199/?call=1` | una finestra di Meet davanti: compare "Sembra una call" |

Con il banco acceso e Playwright installato (`npm i -g playwright`):

```
node preview/shoot.mjs http://localhost:5199 ../shots   # ogni schermata, chiaro e scuro, a 820, 1040 e 1440 px
node preview/flows.mjs http://localhost:5199            # i flussi principali in un browser vero
node preview/audit.mjs http://localhost:5199            # axe-core, WCAG 2.1 AA, ogni schermata, chiaro e scuro
node preview/clip.mjs http://localhost:5199             # nessun testo tagliato (la gamba della "g" sotto una riga troppo bassa)
```

Il percorso tra le schermate è uno solo, in `screens.mjs`: chi cambia la UI lo
aggiorna lì e valgono sia gli screenshot sia l'audit. `flows.mjs` fa quello che
farebbe una persona (registra, chiede, segue una citazione, rende privata una
call, elimina e annulla, usa solo la tastiera…): se un flusso si rompe qui, si
romperebbe sul PC di chi usa Mori.

`stub-core.ts` sostituisce `@tauri-apps/api/core`, `/event`, `/window` e
`plugin-http`: il backend risponde come un Mori a riposo, che però sa
registrare (finto: niente audio), "trascrivere" (due righe dopo 2 secondi) e
rispondere alla chat e al follow-up con un modello finto. Tutto il resto delle
chiamate al modello fallisce come prima, così i dati inventati non cambiano. Gli embedding non ci sono, quindi il richiamo lavora solo sulle
parole, come fa l'app quando il modello locale manca.

**I dati di `fixtures.ts` sono inventati.** Non copiarci mai righe del database
vero: questa cartella è nel repository.

Serve a qualcosa: è così che è venuto fuori che la radice della scheda persona
si chiamava `.person` come la pillola dei partecipanti in `App.css`, che le
Impostazioni non scorrevano su una finestra da 720px, e che le checkbox dei
modali erano stirate a tutta larghezza.
