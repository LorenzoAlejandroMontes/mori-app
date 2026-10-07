# Mori — il design

Scritto il 4 ottobre 2026, prima di toccare la UI, partendo da 11 schermate
(chiaro e scuro, a 820, 1040 e 1440 px). È il contratto per le viste: chi
cambia la UI la confronta con questo documento, e se serve aggiorna prima questo.

## 1. Principi

Sei regole corte. Servono a decidere quando due soluzioni sembrano buone tutte e due.

1. **Un posto per ogni cosa.** Un solo modo di vedere che sto registrando, un solo
   elenco di tutte le call, una sola azione principale per schermata. Se una cosa
   compare in due posti, uno dei due è di troppo.
2. **Prima il contenuto, poi il contorno.** La pagina di una call si apre sulla
   sintesi, non su tre righe di bottoni. Le informazioni stanno in una riga, le
   azioni in una barra o in un menu.
3. **La tastiera arriva dappertutto.** Ogni azione ha una scorciatoia o passa da ⌘K.
   Le liste si scorrono con le frecce. Il focus si vede sempre.
4. **Calma finché non serve.** Il colore dice qualcosa. Teal sei tu (e l'azione
   principale), violetto è l'altro (e la privacy), corallo è registrazione o
   ritardo. Tutto il resto è neutro.
5. **Si può tornare indietro.** Eliminare una call, una cosa da fare o ripartire
   da una chat nuova non chiede "Sei sicuro?": lo fa e offre **Annulla** per
   qualche secondo.
6. **Dove vanno i dati si vede.** Il lucchetto di una call privata, il fatto che
   un modello sia sul PC o in cloud, sono sempre a un'occhiata.

## 2. Architettura dell'informazione

### Le sezioni

| Sezione | Cosa ci trovi | Scorciatoia |
|---|---|---|
| **Oggi** | cosa tocca a te, cosa aspetti, cosa va sistemato, domande pronte | `Ctrl 1` |
| **Chiedi a Mori** | la conversazione, con le citazioni che aprono la call al minuto giusto | `Ctrl 2` |
| **Da fare** | tutte le cose da fare di tutte le call, tue e degli altri | `Ctrl 3` |
| **Persone e progetti** | le schede, con il brief prima di rientrare in call | `Ctrl 4` |
| **Tutte le call** | l'archivio: cerca, filtra per categoria, apri | `Ctrl 5` |
| Impostazioni | una pagina con le sezioni a sinistra | `Ctrl ,` |

"Storico e categorie" diventa **Tutte le call**: è il nome di quello che c'è
dentro. Le categorie sono un filtro dell'archivio, non una sezione.

### La barra laterale

Idea presa da **Arc**: la barra laterale è un posto calmo con due livelli, le
destinazioni fisse sopra e le cose su cui stai lavorando sotto. Niente bordi
tratteggiati: una voce di navigazione ha l'aspetto di una voce di navigazione.
Dal 5 ottobre la barra sta sulla *carta* della finestra, senza bordo: è il
foglio del contenuto, accanto, ad avere i margini (§9).

```
┌──────────────────────────┐
│ m Mori               ⌕ ⇤ │  marchio (→ Oggi) · cerca o chiedi (⌘K) · comprimi (Ctrl \)
│ ┏━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ● Registra la call   ┃ │  IL controllo della registrazione, la capsula scura (vedi §4)
│ ┗━━━━━━━━━━━━━━━━━━━━━━┛ │
│  ☀ Oggi                  │
│  ◌ Chiedi a Mori         │  voci: icona + nome, attiva = fondo pieno
│  ☑ Da fare             5 │  conteggio neutro, non una pillola colorata
│  ☺ Persone e progetti    │
│  ≡ Tutte le call         │
│                          │
│  RECENTI                 │  le ultime 5, una riga ciascuna, con lo stato
│  Sync settimanale prod…  │  (· trascrivo, ! da riprovare, 🔒 privata)
│  Pricing del piano an…   │
│  …                       │
│                          │
│  ⚙ Impostazioni      ?   │  in fondo, come in Linear · ? = scorciatoie
└──────────────────────────┘
```

- **Il campo "Cerca o chiedi" non c'è più** (5 ottobre): era una terza via per
  la stessa cosa (⌘K, il campo di Oggi, Chiedi a Mori). Resta l'icona nel
  marchio, e Ctrl K.
- **Recenti al posto dell'elenco intero.** L'archivio serve a *trovare*
  (cerca, filtra); Recenti serve a *tornare* alle cinque call che hai appena
  toccato. Se Recenti diventa un secondo archivio, ha sbagliato.
- **"Aggiungi call" esce dalla navigazione.** Diventa "Incolla un trascritto"
  nell'intestazione di Tutte le call, in ⌘K e nel benvenuto di Oggi.
- **"Chiedi a Mori" non è più sempre colorato.** È una voce come le altre;
  diventa evidente quando ci sei.
- Compressa (Ctrl \\), la barra diventa una rail di icone con gli stessi
  elementi nello stesso ordine e i nomi nel tooltip.

### Come ci si muove

- Da una lista a un dettaglio: clic o Invio. Indietro: il link "← Tutte le call"
  in alto, oppure Esc.
- Nella pagina di una call, `J` / `K` portano alla call successiva o precedente
  della lista da cui sei arrivato (idea di **Linear**).
- ⌘K raggiunge tutto: call, frasi dette, persone, sezioni, impostazioni, azioni.
- Le impostazioni si aprono sulla sezione giusta: "Imposta il modello" da Oggi
  porta a *Modello*, "Come ti chiamano" porta a *Tu e i nomi*.

## 3. Il sistema di design

Tutto in `App.css`, come token CSS su `:root`, ridefiniti per il tema scuro. Gli
stessi nomi di prima, più quelli che mancavano. Niente libreria UI nuova: React e
CSS bastano, e la pillola resta leggera.

### Colore

I token di prima restano, con valori corretti per il contrasto AA (misurato con
la formula WCAG 2.x, script in `app/scripts/contrast.mjs`). I nuovi `-fill`
servono perché nel tema scuro lo stesso teal non può essere insieme testo chiaro
su fondo scuro *e* fondo di un bottone con testo bianco. Dal 5 ottobre i neutri
sono **caldi** (carta e inchiostro, non bianco e grigio freddo): la tabella
riporta i valori in vigore.

| Token | Uso | Chiaro | Scuro |
|---|---|---|---|
| `--chrome` | la finestra: barra laterale, lo spazio attorno al foglio | `#f5f4f0` | `#0f1012` |
| `--bg` | il foglio dove sta il contenuto | `#fbfaf7` | `#16171a` |
| `--panel` | una card o un campo sul foglio | `#ffffff` | `#1d1e22` |
| `--text` | testo principale | `#1b1a17` · 16,8:1 | `#ecebe6` · 15,1:1 |
| `--ink-soft` | testo di lettura | `#3f3d37` · 9,8:1 | `#c8c6bf` · 10,6:1 |
| `--muted` | testo secondario, placeholder | `#666259` · **5,3:1** | `#9b998f` · 6,2:1 |
| `--accent` | teal come testo e icone | `#0a7369` · **5,7:1** (era 3,7) | `#22b8a7` · 7,4:1 |
| `--accent-fill` | fondo dei bottoni teal (testo bianco) | `#0b7b71` · 5,1:1 | `#0c8378` · 4,6:1 |
| `--accent-bright` | solo grafica: punti, onda, spunte | `#0d9488` | `#14b8a6` |
| `--accent-2` | violetto: l'altro, privata | `#7c3aed` · 5,7:1 | `#a78bfa` · 6,7:1 |
| `--record` | corallo come testo: ritardo, errore | `#ba2e35` · 5,9:1 | `#f26b6f` · 6,2:1 |
| `--record-fill` | fondo del bottone Ferma (testo bianco) | `#ba2e35` · 5,9:1 | `#c5343a` · 5,4:1 |
| `--amber` | in scadenza, in trascrizione | `#85601a` · 5,7:1 | `#e0a43a` · 8,3:1 |
| `--line` | bordi e separatori decorativi | `#e6e2da` | `#2b2c32` |
| `--line-strong` | bordi che identificano un controllo (checkbox) | `#85806f` · 3,9:1 | `#6f717a` · 3,4:1 |
| `--focus` | anello del focus | = `--accent` | = `--accent` |
| `--selected` | fondo della voce dove sei | `#e8efec` | `#1e2927` |
| `--live-bg` / `--live-fg` | la capsula scura: registrazione in corso, barra Salva | `#16181d` / `#f4f3ef` | `#26282e` / `#f4f3ef` |
| `--*-soft` | tinte (ritardo, privata, attivo) | il colore al 8–10% | al 12–14% |

Rapporti calcolati contro la superficie più chiara (o più scura) su cui il
colore compare davvero: `--muted` regge 4,6:1 anche sul grigio dei campi e
dell'hover, e ogni colore regge 4,5:1 anche sulla propria tinta (il "2 in
ritardo" corallo sul fondo corallo chiaro). `scripts/contrast.mjs` lo
ricontrolla a ogni modifica, in CI. La regola: **testo ≥ 4,5:1, bordi di controlli e focus ≥ 3:1,
in tutti e due i temi.** I colori fissi sparsi nel CSS (`#727a86`, `#d13b40`,
`#ccd2dc`…) diventano token.

### Spazi

Scala su base 4: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 ·
`--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48. Margini di pagina:
40 px sopra i 1100 px di area utile, 28 sotto, 20 sotto i 700 (container query
sull'area principale, non sulla finestra: la barra laterale cambia la larghezza
utile).

Colonne di lettura: **720** per il testo (sintesi, trascritto, chat), **880**
per le liste (Da fare, Tutte le call, Persone), **960** per Oggi.

### Raggi

`--r-sm` 6 (kbd, conteggi) · `--r-md` 8 (bottoni, campi, voci) · `--r-lg` 12
(card, menu, popover) · `--r-xl` 16 (il foglio, il campo di Oggi) · `--r-2xl` 22
(dialoghi, ⌘K) · `--r-full` (pillole, tag).

### Tipografia

Tre famiglie, in locale. Il serif è la voce di Mori quando dice una cosa sola
e grande (il saluto, un titolo); il grotesk è l'interfaccia; il mono sono i dati.

| Ruolo | Famiglia | Misura / interlinea | Peso |
|---|---|---|---|
| Saluto di Oggi | Instrument Serif | 44 / 48, −0,02em (34 sotto i 700 px); il nome in corsivo viola | 400 |
| Titolo di pagina | Instrument Serif | 34 / 38, −0,015em (28 sotto i 700 px); 38 sulla call | 400 |
| Titolo di sezione, di dialogo | Instrument Serif | 22 / 28 (26 nei dialoghi e in Impostazioni) | 400 |
| Corpo dell'interfaccia | Hanken Grotesk | 14 / 20 | 400–500 |
| Lettura (sintesi, trascritto) | Hanken Grotesk | 15 / 26 | 400 |
| Secondario | Hanken Grotesk | 13 / 18 | 400 |
| Meta, didascalie | Hanken Grotesk | 12 / 16 | 500 |
| Etichetta di gruppo | Hanken Grotesk | 11 / 14, maiuscolo, +0,08em | 650 |
| Dati: date, durate, timer | JetBrains Mono | 12 / 16, cifre tabulari | 400–500 |

Niente testo sotto gli 11 px. I timer usano cifre tabulari, così non ballano.
Il serif non scende mai sotto i 20 px e non fa mai da testo corrente.

### Elevazioni

| Livello | Cosa | Come |
|---|---|---|
| 0 | la carta: barra laterale, lo spazio attorno al foglio | niente |
| 1 | il foglio, card, campi, la voce di navigazione dove sei | bordo `--line` + `--shadow-1` (quasi niente) |
| 2 | menu, popover, toast | bordo + `--shadow-2` |
| 3 | dialoghi, ⌘K, pannello chat sopra il contenuto | bordo + `--shadow-3` + velo `--scrim` |

Livelli dello z-index: 10 intestazioni fisse · 20 pannello · 30 menu · 40 toast ·
50 dialoghi · 60 ⌘K.

### Movimento

`--dur-1` 120 ms (hover, pressione) · `--dur-2` 180 ms (comparse piccole) ·
`--dur-3` 280 ms (pannelli) · `--dur-4` 420 ms (una vista che entra). Curva
d'entrata `--ease-out` `cubic-bezier(.16,1,.3,1)`; `--ease-spring`
`cubic-bezier(.34,1.4,.64,1)` solo per ciò che si tocca (la spunta, un
interruttore, un menu che si apre). Si animano solo `opacity` e `transform`.
Con `prefers-reduced-motion: reduce` le animazioni si fermano e il punto rosso
della registrazione resta acceso fisso.

Ogni vista entra nel foglio con un passo di 6 px (`view-in`); in Oggi e
nell'elenco delle persone le sezioni arrivano una dopo l'altra (60 ms). Per il
resto, un solo momento animato per vista: l'onda della registrazione, la spunta
che *scatta* in Da fare, la riga dei tab che scorre, il pannello che entra.

### Stati

Ogni elemento interattivo li ha tutti, uguali in tutta l'app:

| Stato | Aspetto |
|---|---|
| riposo | testo `--ink-soft`, niente fondo |
| hover | fondo `--hover` |
| premuto | fondo `--hover-strong` (bottoni pieni: −4% di luminosità) |
| selezionato | nella barra: una linguetta `--panel` con bordo `--line` e `--shadow-1`, testo 600, icona `--accent`; nelle liste fondo `--selected` |
| focus da tastiera | anello 2 px `--focus` a 2 px di distanza (`:focus-visible`) |
| disabilitato | opacità 0,45, cursore normale, attributo `disabled` |
| in caricamento | skeleton della forma del contenuto, mai uno spinner a pagina vuota |
| errore | testo `--record` con icona e la via d'uscita ("Riprova", "Apri le impostazioni") |
| vuoto | una frase che insegna cosa fare e il bottone per farlo |

### Componenti

Bottone (primario pieno, secondario con bordo, fantasma, pericolo; alto 32, 28
il piccolo), bottone icona (32×32 con `aria-label` e tooltip), voce di
navigazione, campo, kbd, tag di categoria, conteggio, checkbox, tab
(`role="tablist"`, frecce), menu ⋯, toast (avviso, errore, con Annulla, con conto
alla rovescia), skeleton, dialogo, pannello laterale.

### Il segno distintivo: le due voci

Mori ascolta due canali: tu dal microfono, l'altro dall'audio del PC. È la cosa
più vera del prodotto e diventa il segno che lo distingue:

- **Mentre registra**, nel controllo in cima alla barra laterale scorre una linea
  sottile che va dal teal al violetto: le due voci. È l'unica cosa che si muove
  da sola nell'app.
- **Nel trascritto** ogni battuta ha un filo verticale del colore di chi parla e
  l'ora a sinistra: la conversazione si legge come un dialogo, non come un muro.
  Sopra, la **linea del tempo delle due voci**: due corsie, teal sopra e viola
  sotto, un blocco per ogni tratto di parlato. Dice a colpo d'occhio chi ha
  tenuto la parola e quando; un clic porta a quel momento. Accanto, la quota di
  ciascuna voce ("Tu 53% · Giulia 47%").
- **Il marchio** è una "m" di due archi, teal che diventa viola: le due voci,
  un tratto solo. Nella barra accanto a "Mori" in serif; come icona dell'app su
  una tessera scura (`app/scripts/make-icon.mjs`).
- **In Da fare e nelle schede** teal è tuo, violetto è dell'altro.

Tutto il resto resta in silenzio.

## 4. La registrazione: un solo concetto

Oggi ci sono quattro interfacce: il bottone rosso, la pillola in basso, il
pannello a tutto schermo con l'onda, la finestrella sempre in primo piano. Dopo:

- **Con Mori davanti**, la registrazione vive nel controllo in cima alla barra
  laterale. Lo stesso elemento attraversa tutti gli stati:

```
 riposo         avvio            registra                 sembra finita            salvo
┌───────────┐  ┌───────────┐   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────┐
│● Registra │  │◌ Avvio…   │   │● Registro      12:04 │  │● Registro      48:10 │  │◌ Salvo…      │
│      ⌃⇧R  │  │           │   │~~~~~~~~~~~ [■ Ferma] │  │Sembra finita: fermo  │  │              │
└───────────┘  └───────────┘   └──────────────────────┘  │tra 37 s              │  └──────────────┘
                                                         │[Continua]  [Ferma ora]│
                                                         └──────────────────────┘
```

  Il controllo è una **capsula scura** (`--live-bg`) in ogni stato e in tutti
  e due i temi: a riposo con il punto rosso e la scorciatoia, mentre registra
  con l'onda delle due voci e il timer in cifre tabulari. È l'unica cosa scura
  su chiaro, e si vede dall'altra parte della stanza. Lo
  stesso vale per la finestrella sempre in primo piano e per la barra "Modifiche
  non salvate" delle impostazioni: scuro = chiede una risposta.
  Quando si ferma, la call si apre sullo stato "Sto trascrivendo".
- **Con la barra compressa**, il punto della rail diventa rosso pieno con il
  timer sotto; il conto alla rovescia del silenzio arriva come toast con i due
  bottoni.
- **Con Mori dietro un'altra app o ridotto**, la stessa informazione la dà la
  finestrella sempre in primo piano (`#pill`): punto, timer, Ferma. Le conferme
  "avviata / fermata" compaiono lì solo quando la finestra principale non è
  davanti. Se c'è già il controllo nella barra, non si duplica.
- **Via** la pillola fluttuante in basso e il pannello a tutto schermo. L'onda
  animata del pannello diventa la linea delle due voci nel controllo.

## 5. La mappa delle schermate

Per ognuna: il riferimento, l'idea presa (non lo stile), cosa cambia.

### Oggi — riferimento: la stessa Oggi di adesso
Funziona e resta. Cambia solo per coerenza: token AA, card con lo stesso bordo
delle altre, spunta uguale a quella di Da fare, skeleton al primo caricamento
invece del vuoto, scorciatoia `/` per scrivere a Mori.

### Pagina della call — riferimento: Granola
Idea: **il documento è l'eroe**, il resto si chiama quando serve.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← Tutte le call                          🔒   ✉ Follow-up   ◌ Chiedi ⌃J  ⋯ │  barra fissa
├───────────────────────────────────────────────────────────────────────────┤
│   Sync settimanale prodotto                                               │
│   sab 4 ott 2026 · Giulia Ferri, Sara Conti · Prodotto · + categoria      │  UNA riga meta
│                                                                           │
│   Sintesi   Trascritto   Da fare 3                                        │
│   ─────────                                                               │
│   Di cosa si è parlato …                                    (720 px max)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- Le tre righe di chip diventano **una riga**: data, partecipanti (link alla
  scheda), categorie come tag piccoli con "+".
- Le azioni vanno nella barra: lucchetto (sempre visibile, è la privacy),
  Follow-up, Chiedi; nel menu ⋯ Copia come Markdown, Elimina.
- **La chat non è più una colonna fissa.** Si apre con "Chiedi" o `Ctrl J` come
  pannello a destra; sotto gli 900 px di area utile si apre *sopra* il contenuto
  invece di stringerlo. Ricorda se l'avevi lasciata aperta.
- Elimina: la call sparisce subito, toast "Call eliminata · Annulla" per 6
  secondi, poi si elimina davvero (audio compreso). Se Mori si chiude prima,
  non si elimina niente.
- Tab con `role="tablist"` e frecce; `1` `2` `3` da tastiera; `J` / `K` call
  successiva e precedente.
- Trascritto: ora nella colonna di sinistra, filo del colore di chi parla, ogni
  battuta è un bottone (Invio = ascolta da lì). "Chi è l'interlocutore?" resta
  una riga sopra, più sobria.

### Chiedi a Mori — riferimento: Linear (cura), ChatGPT (forma)
Una colonna da 720 px, il campo in basso che cresce con il testo (Invio manda,
Maiusc+Invio va a capo). Stato vuoto che insegna: tre domande vere e una riga su
come funzionano le citazioni. "Nuova chat" non chiede conferma: riparte, e il
toast offre Annulla. Le citazioni restano come sono (funzionano).

### Da fare — riferimento: Things
Idea: **una lista che respira e un gesto che dà soddisfazione.** La spunta si
chiude con un piccolo movimento e la riga resta al suo posto un secondo prima di
scendere tra le fatte. Eliminare offre Annulla. Tastiera: frecce o `J`/`K`,
Spazio fatta, `E` modifica, `N` nuova, Canc elimina, `/` cerca. Al primo
caricamento skeleton invece di "Sto guardando…".

### Persone e progetti — riferimento: Attio
Un campo per filtrare quando le schede crescono, la griglia si percorre con le
frecce. Nella scheda: skeleton mentre carica e mentre si scrive il brief, il
resto com'è (la struttura è buona).

### Tutte le call — riferimento: Linear (liste)
Righe invece di card: titolo, persone, categorie, data a destra. Raggruppate per
tempo, filtro per categoria in una riga, ricerca con `/`. Frecce e Invio.
"Riorganizza", "Indicizza tutto" e "Gestisci categorie" in un menu ⋯ accanto a
"Incolla un trascritto".

### Impostazioni — riferimento: Linear / Raycast
Da modale di 1500 px a **pagina** con le sezioni a sinistra (si evidenzia quella
che stai guardando):

```
┌─────────────────────────────────────────────────────────────────┐
│ Impostazioni                                                    │
│ ┌──────────────┐  Modello                                       │
│ │ Modello      │  Il cervello di Mori …                         │
│ │ Registrazione│  [Groq] [OpenAI] [OpenRouter] [Ollama] [LM St] │
│ │ Trascrizione │  …                                             │
│ │ Tu e i nomi  │  Call private …                                │
│ │ Aspetto      │                                                │
│ │ Spazio e copie│ Registrazione …                               │
│ └──────────────┘                                                │
├─────────────────────────────────────────────────────────────────┤
│ Modifiche non salvate                      [Annulla]  [Salva]   │  solo se c'è da salvare
└─────────────────────────────────────────────────────────────────┘
```

Le sezioni nuove raggruppano per cosa controlli, non per come è fatto Mori:
**Modello** (cervello + call private), **Registrazione** (scorciatoia, stop dopo
il silenzio, suggerimento quando rilevo una call, resta nella barra),
**Trascrizione** (qualità, di cosa parli, richiamo semantico), **Tu e i nomi**
(come ti chiamano, dizionario dei nomi), **Aspetto**, **Spazio e copie**. Il
tema si applica subito, come oggi; il resto con un solo Salva.

### ⌘K — riferimento: Raycast
Un campo, risultati a gruppi, **frecce per scegliere** (oggi si può solo
cliccare), Invio esegue la riga evidenziata, la prima riga è evidenziata da sola.
Comandi nuovi: vai a una sezione, apri una sezione delle impostazioni, tema
chiaro/scuro, scorciatoie da tastiera. Piede: "↑↓ scegli · ↵ apri · esc chiudi".

### Scorciatoie — pannello nuovo
`?` (o la voce in fondo alla barra, o ⌘K) apre un pannello con tutte le
scorciatoie, a gruppi: Ovunque, Liste, Pagina della call, Da fare.

| Ovunque | |
|---|---|
| `Ctrl K` | cerca o chiedi |
| `Ctrl 1`…`5` | sezioni |
| `Ctrl ,` | impostazioni |
| `Ctrl \` | barra laterale |
| `Ctrl Maiusc R` | registra / ferma (anche con Mori in background) |
| `?` | questo pannello |

Le scorciatoie di una lettera non scattano mentre scrivi in un campo.

### La pillola — finestra a parte
Resta leggera (nessun import nuovo). Prende i token AA e la stessa forma del
controllo nella barra: punto, timer a cifre tabulari, Ferma.

## 6. Misure di finestra

Ogni schermata va provata a **820×560** (il minimo di `tauri.conf.json`),
**1040×720** (quella di partenza) e **1440×900**. Il foglio toglie 8 px sopra,
sotto e a destra: a 1040 Oggi sta ancora su due colonne (soglia a 720 px di
area utile), a 820 va su una. A 820 la barra laterale
parte a 240 px e l'area utile è 580: la chat della call si apre sopra il
contenuto, le azioni della barra della call mostrano solo l'icona, Oggi va su
una colonna. Lo script `app/preview/shoot.mjs` fotografa le tre misure.

## 7. Cosa non cambia

La logica e i dati (coda, registrazione, richiamo, privacy), i testi e il tono,
la pagina Oggi, le citazioni cliccabili, la pillola come finestra separata,
nessuna risorsa da internet. Le funzioni restano raggiungibili tutte: se una
sparisce da un posto, è perché ne ha uno migliore, scritto qui sopra.

## 8. Stato (4 ottobre 2026)

Implementato tutto quanto sopra, una vista per commit. Verifiche: axe-core (WCAG 2.1 AA) su ogni
schermata in chiaro e in scuro, 0 problemi (erano 419); 22 flussi in un
browser vero (`app/preview/flows.mjs`). Due scelte non scritte sopra: gli
avvisi stanno in alto al centro, uno sopra l'altro (in basso coprirebbero il
campo della chat); in ⌘K una domanda va prima a Mori, una parola prima a
quello che nomina.

## 9. Carta e inchiostro (5 ottobre 2026)

La seconda passata, a un giorno dalla prima. La prima aveva messo ordine; questa
dà a Mori una faccia. Il punto di partenza, ragionando da zero: Mori ascolta
**due voci** e **ricorda**; è privato, locale, calmo. Quindi niente bianco da
dashboard: carta, inchiostro, un serif quando parla, e colore solo per le due
voci. Cosa è cambiato, e perché:

- **Il marchio.** La spirale non reggeva sotto i 24 px. La "m" di due archi è
  il nome, le due voci e un tratto solo; a 14 px nella rail resta una "m".
  Wordmark in Instrument Serif. Icona dell'app rigenerata con `tauri icon`.
- **Carta e foglio.** La finestra è carta calda (`--chrome`); il contenuto sta
  su un foglio con 8 px di margine, angoli da 16 e un'ombra appena percettibile.
  La barra laterale perde il bordo: è sulla carta. La voce dove sei è una
  linguetta bianca, non un fondo grigio. Meno bordi dappertutto: le sezioni di
  Oggi non sono più card, le separa una riga sottile accanto all'etichetta.
- **Un serif.** Instrument Serif per il saluto ("Buongiorno, *Luca*." — il
  nome, se l'hai dato in *Tu e i nomi*, in corsivo viola), i titoli di pagina e
  di call, i titoli delle sezioni della sintesi, i dialoghi, gli stati vuoti.
  Mai sotto i 20 px, mai come testo corrente. Space Grotesk esce.
- **Oggi è una colonna sola** (760 px), come una pagina: Tocca a te, Aspetti da
  altri, Da sistemare, Prima della prossima call, con titoli in serif e nessuna
  card. "Ultime call" è sparita: le Recenti nella barra sono la stessa lista.
  Il campo per Mori è una riga sola e larga, con il marchio a sinistra e il
  bottone a destra; tre domande suggerite, non quattro.
- **La capsula scura.** Registrazione in corso, finestrella in primo piano e
  barra Salva sono scure anche sul tema chiaro: una sola convenzione per "sta
  succedendo qualcosa che chiede una risposta".
- **La linea del tempo delle due voci**, sopra ogni trascritto (§3, "Il segno
  distintivo"). È fatta dai segmenti già su disco: zero modello, zero rete.
- **Tab che scorrono.** La riga sotto il tab scelto si sposta (`useTabInk`),
  nella call e in Da fare.
- **Movimento.** Le viste entrano nel foglio; le sezioni di Oggi e le schede
  delle persone arrivano a passi di 60 ms; la spunta scatta con una molla; i
  bottoni si abbassano di 1 px quando premi; i menu e i dialoghi si aprono con
  `--ease-spring`. Tutto si ferma con `prefers-reduced-motion`.
- **Le spunte sono tonde**, come in Things; i filtri attivi sono inchiostro
  pieno; i menu, ⌘K e i dialoghi stanno su un velo sfocato.
- **Via il doppio.** Il campo "Cerca o chiedi" della barra (c'è ⌘K); le tre
  scatole della scorciatoia (una riga in mono dentro la capsula); il chip "Tu"
  su ogni riga di "Mie" in Da fare (lì sono tutte tue). Aggiunta la durata
  della call nella riga dei metadati.
- **Carta più scura, foglio più chiaro**: il foglio si vede come foglio.

Non è cambiato: l'architettura (§2), le scorciatoie, i testi, la logica, le
verifiche. `node scripts/contrast.mjs` passa su ogni coppia; l'audit axe è a 0
problemi su ogni schermata; i 22 flussi passano. Gli screenshot
del README sono di questa versione (`docs/screenshots/`).
