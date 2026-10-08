# Mori: the design

Written on October 4, 2026, before touching the UI, starting from 11 screens
(light and dark, at 820, 1040 and 1440 px). It is the contract for the views: whoever
changes the UI compares it with this document, and updates this first if needed.

## 1. Principles

Six short rules. They help decide when two solutions both look good.

1. **One place for each thing.** One way to see that I am recording, one
   list of all the calls, one main action per screen. If something
   appears in two places, one of the two is one too many.
2. **Content first, then the frame.** The page of a call opens on the
   summary, not on three rows of buttons. Information sits in one row,
   actions in a bar or in a menu.
3. **The keyboard reaches everywhere.** Every action has a shortcut or goes through ⌘K.
   Lists are walked with the arrows. Focus is always visible.
4. **Calm until it is needed.** Color says something. Teal is you (and the main
   action), violet is the other person (and privacy), coral is recording or
   overdue. Everything else is neutral.
5. **You can go back.** Deleting a call, a to-do, or starting over
   with a new chat does not ask "Are you sure?": it does it and offers **Undo** for
   a few seconds.
6. **Where the data goes is visible.** The lock of a private call, the fact that
   a model is on the PC or in the cloud, are always one glance away.

## 2. Information architecture

### The sections

| Section | What you find there | Shortcut |
|---|---|---|
| **Today** | what is your move, what you are waiting on, what needs fixing, ready-made questions | `Ctrl 1` |
| **Ask Mori** | the conversation, with citations that open the call at the right minute | `Ctrl 2` |
| **To-dos** | all the to-dos of all the calls, yours and other people's | `Ctrl 3` |
| **People & projects** | the pages, with the brief before you go back into a call | `Ctrl 4` |
| **All calls** | the archive: search, filter by category, open | `Ctrl 5` |
| Settings | one page with the sections on the left | `Ctrl ,` |

"History and categories" becomes **All calls**: it is the name of what is
inside. Categories are a filter of the archive, not a section.

### The sidebar

Idea taken from **Arc**: the sidebar is a calm place with two levels, the
fixed destinations on top and the things you are working on below. No dashed
borders: a navigation item looks like a navigation item.
Since October 5 the sidebar sits on the *paper* of the window, with no border: it is the
sheet of the content, next to it, that has the margins (§9).

```
┌──────────────────────────┐
│ m Mori               ⌕ ⇤ │  mark (→ Today) · search or ask (⌘K) · collapse (Ctrl \)
│ ┏━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃ ● Record the call    ┃ │  THE recording control, the dark capsule (see §4)
│ ┗━━━━━━━━━━━━━━━━━━━━━━┛ │
│  ☀ Today                 │
│  ◌ Ask Mori              │  items: icon + name, active = solid background
│  ☑ To-dos              5 │  neutral count, not a colored pill
│  ☺ People & projects     │
│  ≡ All calls             │
│                          │
│  RECENT                  │  the last 5, one row each, with the status
│  Weekly product sync     │  (· transcribing, ! needs a retry, 🔒 private)
│  Annual plan pricing     │
│  …                       │
│                          │
│  ⚙ Settings          ?   │  at the bottom, as in Linear · ? = shortcuts
└──────────────────────────┘
```

- **The "Search or ask" field is gone** (October 5): it was a third way to do
  the same thing (⌘K, the field in Today, Ask Mori). The icon in the
  mark stays, and Ctrl K.
- **Recent instead of the full list.** The archive is for *finding*
  (search, filter); Recent is for *going back* to the five calls you have just
  touched. If Recent becomes a second archive, it has gone wrong.
- **"Add call" leaves the navigation.** It becomes "Paste a transcript"
  in the header of All calls, in ⌘K and in the welcome of Today.
- **"Ask Mori" is no longer always colored.** It is an item like the others;
  it stands out when you are there.
- Collapsed (Ctrl \\), the sidebar becomes a rail of icons with the same
  elements in the same order and the names in the tooltip.

### How you move around

- From a list to a detail: click or Enter. Back: the "← All calls" link
  at the top, or Esc.
- On the page of a call, `J` / `K` go to the next or previous call
  of the list you came from (idea from **Linear**).
- ⌘K reaches everything: calls, things that were said, people, sections, settings, actions.
- Settings open on the right section: "Set up the model" from Today
  goes to *Model*, "What people call you" goes to *You and your names*.

## 3. The design system

Everything in `App.css`, as CSS tokens on `:root`, redefined for the dark theme. The
same names as before, plus the ones that were missing. No new UI library: React and
CSS are enough, and the pill stays light.

### Color

The previous tokens stay, with values corrected for AA contrast (measured with
the WCAG 2.x formula, script in `app/scripts/contrast.mjs`). The new `-fill` tokens
are needed because in the dark theme the same teal cannot be both light text
on a dark background *and* the background of a button with white text. Since October 5 the neutrals
are **warm** (paper and ink, not white and cold gray): the table
shows the values in force.

| Token | Use | Light | Dark |
|---|---|---|---|
| `--chrome` | the window: sidebar, the space around the sheet | `#f5f4f0` | `#0f1012` |
| `--bg` | the sheet where the content sits | `#fbfaf7` | `#16171a` |
| `--panel` | a card or a field on the sheet | `#ffffff` | `#1d1e22` |
| `--text` | main text | `#1b1a17` · 16.8:1 | `#ecebe6` · 15.1:1 |
| `--ink-soft` | reading text | `#3f3d37` · 9.8:1 | `#c8c6bf` · 10.6:1 |
| `--muted` | secondary text, placeholder | `#666259` · **5.3:1** | `#9b998f` · 6.2:1 |
| `--accent` | teal as text and icons | `#0a7369` · **5.7:1** (was 3.7) | `#22b8a7` · 7.4:1 |
| `--accent-fill` | background of teal buttons (white text) | `#0b7b71` · 5.1:1 | `#0c8378` · 4.6:1 |
| `--accent-bright` | graphics only: dots, wave, checkmarks | `#0d9488` | `#14b8a6` |
| `--accent-2` | violet: the other person, private | `#7c3aed` · 5.7:1 | `#a78bfa` · 6.7:1 |
| `--record` | coral as text: overdue, error | `#ba2e35` · 5.9:1 | `#f26b6f` · 6.2:1 |
| `--record-fill` | background of the Stop button (white text) | `#ba2e35` · 5.9:1 | `#c5343a` · 5.4:1 |
| `--amber` | due soon, transcribing | `#85601a` · 5.7:1 | `#e0a43a` · 8.3:1 |
| `--line` | decorative borders and separators | `#e6e2da` | `#2b2c32` |
| `--line-strong` | borders that identify a control (checkbox) | `#85806f` · 3.9:1 | `#6f717a` · 3.4:1 |
| `--focus` | focus ring | = `--accent` | = `--accent` |
| `--selected` | background of the item where you are | `#e8efec` | `#1e2927` |
| `--live-bg` / `--live-fg` | the dark capsule: recording in progress, Save bar | `#16181d` / `#f4f3ef` | `#26282e` / `#f4f3ef` |
| `--*-soft` | tints (overdue, private, active) | the color at 8–10% | at 12–14% |

Ratios computed against the lightest (or darkest) surface on which the
color really appears: `--muted` holds 4.6:1 even on the gray of fields and
of hover, and every color holds 4.5:1 even on its own tint (the coral "2
overdue" on the light coral background). `scripts/contrast.mjs` checks it
again at every change, in CI. The rule: **text ≥ 4.5:1, control borders and focus ≥ 3:1,
in both themes.** The fixed colors scattered in the CSS (`#727a86`, `#d13b40`,
`#ccd2dc`…) become tokens.

### Spacing

Scale on a base of 4: `--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 ·
`--s-6` 24 · `--s-8` 32 · `--s-10` 40 · `--s-12` 48. Page margins:
40 px above 1100 px of usable area, 28 below, 20 below 700 (container query
on the main area, not on the window: the sidebar changes the usable
width).

Reading columns: **720** for text (summary, transcript, chat), **880**
for lists (To-dos, All calls, People), **960** for Today.

### Radii

`--r-sm` 6 (kbd, counts) · `--r-md` 8 (buttons, fields, items) · `--r-lg` 12
(cards, menus, popovers) · `--r-xl` 16 (the sheet, the field in Today) · `--r-2xl` 22
(dialogs, ⌘K) · `--r-full` (pills, tags).

### Typography

Three families, stored locally. The serif is Mori's voice when it says one single
big thing (the greeting, a title); the grotesk is the interface; the mono is the data.

| Role | Family | Size / line height | Weight |
|---|---|---|---|
| Greeting in Today | Instrument Serif | 44 / 48, −0.02em (34 below 700 px); the name in violet italic | 400 |
| Page title | Instrument Serif | 34 / 38, −0.015em (28 below 700 px); 38 on the call | 400 |
| Section title, dialog title | Instrument Serif | 22 / 28 (26 in dialogs and in Settings) | 400 |
| Interface body | Hanken Grotesk | 14 / 20 | 400–500 |
| Reading (summary, transcript) | Hanken Grotesk | 15 / 26 | 400 |
| Secondary | Hanken Grotesk | 13 / 18 | 400 |
| Meta, captions | Hanken Grotesk | 12 / 16 | 500 |
| Group label | Hanken Grotesk | 11 / 14, uppercase, +0.08em | 650 |
| Data: dates, durations, timers | JetBrains Mono | 12 / 16, tabular figures | 400–500 |

No text below 11 px. Timers use tabular figures, so they do not jump around.
The serif never goes below 20 px and is never used as running text.

### Elevations

| Level | What | How |
|---|---|---|
| 0 | the paper: sidebar, the space around the sheet | nothing |
| 1 | the sheet, cards, fields, the navigation item where you are | `--line` border + `--shadow-1` (almost nothing) |
| 2 | menus, popovers, toasts | border + `--shadow-2` |
| 3 | dialogs, ⌘K, chat panel above the content | border + `--shadow-3` + `--scrim` veil |

z-index levels: 10 fixed headers · 20 panel · 30 menus · 40 toasts ·
50 dialogs · 60 ⌘K.

### Motion

`--dur-1` 120 ms (hover, press) · `--dur-2` 180 ms (small appearances) ·
`--dur-3` 280 ms (panels) · `--dur-4` 420 ms (a view coming in). Entrance
curve `--ease-out` `cubic-bezier(.16,1,.3,1)`; `--ease-spring`
`cubic-bezier(.34,1.4,.64,1)` only for what you touch (the checkmark, a
switch, a menu opening). Only `opacity` and `transform` are animated.
With `prefers-reduced-motion: reduce` the animations stop and the red dot
of the recording stays on, steady.

Every view enters the sheet with a 6 px step (`view-in`); in Today and
in the list of people the sections arrive one after the other (60 ms). For the
rest, one animated moment per view: the wave of the recording, the checkmark
that *snaps* in To-dos, the tab line that slides, the panel that comes in.

### States

Every interactive element has all of them, the same across the whole app:

| State | Look |
|---|---|
| rest | `--ink-soft` text, no background |
| hover | `--hover` background |
| pressed | `--hover-strong` background (solid buttons: −4% lightness) |
| selected | in the sidebar: a `--panel` tab with `--line` border and `--shadow-1`, text 600, `--accent` icon; in lists `--selected` background |
| keyboard focus | 2 px `--focus` ring at 2 px distance (`:focus-visible`) |
| disabled | opacity 0.45, normal cursor, `disabled` attribute |
| loading | skeleton in the shape of the content, never a spinner on an empty page |
| error | `--record` text with an icon and the way out ("Try again", "Open settings") |
| empty | a sentence that teaches what to do and the button to do it |

### Components

Button (solid primary, secondary with border, ghost, danger; 32 high, 28
the small one), icon button (32×32 with `aria-label` and tooltip), navigation
item, field, kbd, category tag, count, checkbox, tabs
(`role="tablist"`, arrows), ⋯ menu, toast (notice, error, with Undo, with
countdown), skeleton, dialog, side panel.

### The signature: the two voices

Mori listens to two channels: you from the microphone, the other person from the PC audio. It is the
truest thing about the product and it becomes the sign that sets it apart:

- **While it records**, in the control at the top of the sidebar runs a thin
  line that goes from teal to violet: the two voices. It is the only thing that moves
  by itself in the app.
- **In the transcript** every line has a vertical thread in the color of the speaker and
  the time on the left: the conversation reads like a dialogue, not like a wall.
  Above it, the **timeline of the two voices**: two lanes, teal on top and violet
  below, one block for each stretch of speech. It says at a glance who
  held the floor and when; a click takes you to that moment. Next to it, the share of
  each voice ("You 53% · Julia 47%").
- **The mark** is an "m" made of two arches, teal turning violet: the two voices,
  a single stroke. In the sidebar next to "Mori" in serif; as the app icon on
  a dark tile (`app/scripts/make-icon.mjs`).
- **In To-dos and on the pages** teal is yours, violet is the other person's.

Everything else stays silent.

## 4. Recording: a single concept

Today there are four interfaces: the red button, the pill at the bottom, the
full-screen panel with the wave, the small always-on-top window. After:

- **With Mori in front**, the recording lives in the control at the top of the
  sidebar. The same element goes through all the states:

```
 idle           starting         recording                seems over               saving
┌───────────┐  ┌───────────┐   ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────┐
│● Record   │  │◌ Starting…│   │● Recording     12:04 │  │● Recording     48:10 │  │◌ Saving…     │
│      ⌃⇧R  │  │           │   │~~~~~~~~~~~~ [■ Stop] │  │Seems over: stopping  │  │              │
└───────────┘  └───────────┘   └──────────────────────┘  │in 37 s               │  └──────────────┘
                                                         │[Keep going] [Stop now]│
                                                         └──────────────────────┘
```

  The control is a **dark capsule** (`--live-bg`) in every state and in
  both themes: at rest with the red dot and the shortcut, while recording
  with the wave of the two voices and the timer in tabular figures. It is the only dark thing
  on light, and you can see it from the other side of the room. The
  same goes for the small always-on-top window and for the "Unsaved
  changes" bar in settings: dark = it asks for an answer.
  When it stops, the call opens on the "Transcribing" state.
- **With the sidebar collapsed**, the dot in the rail becomes solid red with the
  timer below; the silence countdown arrives as a toast with the two
  buttons.
- **With Mori behind another app or minimized**, the same information comes from the
  small always-on-top window (`#pill`): dot, timer, Stop. The "started /
  stopped" confirmations appear there only when the main window is not
  in front. If the control in the sidebar is already there, it is not duplicated.
- **Gone** are the floating pill at the bottom and the full-screen panel. The animated
  wave of the panel becomes the line of the two voices in the control.

## 5. The map of the screens

For each one: the reference, the idea taken (not the style), what changes.

### Today, reference: the same Today as now
It works and it stays. It changes only for consistency: AA tokens, cards with the same border
as the others, a checkmark equal to the one in To-dos, skeleton on first load
instead of the empty state, `/` shortcut to write to Mori.

### Call page, reference: Granola
Idea: **the document is the hero**, the rest is called up when needed.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ ← All calls                                 🔒   ✉ Follow-up   ◌ Ask ⌃J  ⋯ │  fixed bar
├───────────────────────────────────────────────────────────────────────────┤
│   Weekly product sync                                                     │
│   Sat, Oct 4, 2026 · Julia Ferris, Sarah Collins · Product · + category   │  ONE meta row
│                                                                           │
│   Summary   Transcript   To-dos 3                                         │
│   ─────────                                                               │
│   What was discussed …                                      (720 px max)  │
└───────────────────────────────────────────────────────────────────────────┘
```

- The three rows of chips become **one row**: date, participants (link to the
  page), categories as small tags with "+".
- The actions go in the bar: lock (always visible, it is the privacy),
  Follow-up, Ask; in the ⋯ menu Copy as Markdown, Delete.
- **The chat is no longer a fixed column.** It opens with "Ask" or `Ctrl J` as
  a panel on the right; below 900 px of usable area it opens *above* the content
  instead of squeezing it. It remembers whether you had left it open.
- Delete: the call disappears right away, toast "Call deleted · Undo" for 6
  seconds, then it is really deleted (audio included). If Mori closes before that,
  nothing is deleted.
- Tabs with `role="tablist"` and arrows; `1` `2` `3` from the keyboard; `J` / `K` next
  and previous call.
- Transcript: time in the left column, thread in the color of the speaker, every
  line is a button (Enter = listen from there). "Who is the other speaker?" stays
  as a row above, more sober.

### Ask Mori, reference: Linear (care), ChatGPT (shape)
One 720 px column, the field at the bottom that grows with the text (Enter sends,
Shift+Enter starts a new line). An empty state that teaches: three real questions and one line on
how citations work. "New chat" does not ask for confirmation: it starts over, and the
toast offers Undo. Citations stay as they are (they work).

### To-dos, reference: Things
Idea: **a list that breathes and a gesture that feels satisfying.** The checkmark
closes with a small movement and the row stays in place for a second before
moving down among the done ones. Deleting offers Undo. Keyboard: arrows or `J`/`K`,
Space done, `E` edit, `N` new, Del delete, `/` search. On first
load a skeleton instead of "Looking…".

### People & projects, reference: Attio
A field to filter when the pages grow in number, the grid is walked with the
arrows. On the page: skeleton while it loads and while the brief is being written, the
rest as it is (the structure is good).

### All calls, reference: Linear (lists)
Rows instead of cards: title, people, categories, date on the right. Grouped by
time, category filter in one row, search with `/`. Arrows and Enter.
"Reorganize", "Index everything" and "Manage categories" in a ⋯ menu next to
"Paste a transcript".

### Settings, reference: Linear / Raycast
From a 1500 px modal to a **page** with the sections on the left (the one
you are looking at is highlighted):

```
┌───────────────────────────────────────────────────────────────────────┐
│ Settings                                                              │
│ ┌────────────────────┐  Model                                         │
│ │ Model              │  Mori's brain …                                │
│ │ Recording          │  [Groq] [OpenAI] [OpenRouter] [Ollama] [LM St] │
│ │ Transcription      │  …                                             │
│ │ You and your names │  Private calls …                               │
│ │ Appearance         │                                                │
│ │ Storage & backups  │  Recording …                                   │
│ └────────────────────┘                                                │
├───────────────────────────────────────────────────────────────────────┤
│ Unsaved changes                                    [Cancel]  [Save]   │  only if there is something to save
└───────────────────────────────────────────────────────────────────────┘
```

The new sections group by what you control, not by how Mori is built:
**Model** (brain + private calls), **Recording** (shortcut, stop after
silence, suggestion when I detect a call, stays in the tray),
**Transcription** (quality, what you talk about, semantic recall), **You and your names**
(what people call you, dictionary of names), **Appearance**, **Storage & backups**. The
theme applies right away, as today; the rest with a single Save.

### ⌘K, reference: Raycast
One field, results in groups, **arrows to choose** (today you can only
click), Enter runs the highlighted row, the first row is highlighted by itself.
New commands: go to a section, open a section of settings, light/dark
theme, keyboard shortcuts. Footer: "↑↓ choose · ↵ open · esc close".

### Shortcuts, new panel
`?` (or the item at the bottom of the sidebar, or ⌘K) opens a panel with all the
shortcuts, in groups: Everywhere, Lists, Call page, To-dos.

| Everywhere | |
|---|---|
| `Ctrl K` | search or ask |
| `Ctrl 1`…`5` | sections |
| `Ctrl ,` | settings |
| `Ctrl \` | sidebar |
| `Ctrl Shift R` | record / stop (even with Mori in the background) |
| `?` | this panel |

Single-letter shortcuts do not fire while you are typing in a field.

### The pill, a separate window
It stays light (no new imports). It takes the AA tokens and the same shape as the
control in the sidebar: dot, timer in tabular figures, Stop.

## 6. Window sizes

Every screen must be tried at **820×560** (the minimum in `tauri.conf.json`),
**1040×720** (the starting one) and **1440×900**. The sheet takes away 8 px above,
below and on the right: at 1040 Today still sits on two columns (threshold at 720 px of
usable area), at 820 it goes to one. At 820 the sidebar
starts at 240 px and the usable area is 580: the chat of the call opens above the
content, the actions in the bar of the call show only the icon, Today goes to
one column. The script `app/preview/shoot.mjs` photographs the three sizes.

## 7. What does not change

The logic and the data (queue, recording, recall, privacy), the texts and the tone,
the Today page, the clickable citations, the pill as a separate window,
no resources from the internet. All the functions stay reachable: if one
disappears from a place, it is because it has a better one, written above.

## 8. Status (October 4, 2026)

Everything above is implemented, one view per commit. Checks: axe-core (WCAG 2.1 AA) on every
screen in light and in dark, 0 problems (there were 419); 22 flows in a
real browser (`app/preview/flows.mjs`). Two choices not written above:
notices sit at the top center, one above the other (at the bottom they would cover the
chat field); in ⌘K a question goes to Mori first, a word goes first to
what it names.

## 9. Paper and ink (October 5, 2026)

The second pass, one day after the first. The first had put things in order; this one
gives Mori a face. The starting point, reasoning from scratch: Mori listens to
**two voices** and **remembers**; it is private, local, calm. So no dashboard
white: paper, ink, a serif when it speaks, and color only for the two
voices. What changed, and why:

- **The mark.** The spiral did not hold below 24 px. The "m" made of two arches is
  the name, the two voices and a single stroke; at 14 px in the rail it is still an "m".
  Wordmark in Instrument Serif. App icon regenerated with `tauri icon`.
- **Paper and sheet.** The window is warm paper (`--chrome`); the content sits
  on a sheet with 8 px of margin, 16 px corners and a barely perceptible shadow.
  The sidebar loses its border: it is on the paper. The item where you are is a
  white tab, not a gray background. Fewer borders everywhere: the sections of
  Today are no longer cards, a thin line next to the label separates them.
- **A serif.** Instrument Serif for the greeting ("Good morning, *Alex*.": the
  name, if you gave it in *You and your names*, in violet italic), the page and
  call titles, the titles of the summary sections, the dialogs, the empty states.
  Never below 20 px, never as running text. Space Grotesk is out.
- **Today is a single column** (760 px), like a page: Your move, Waiting on
  others, Needs fixing, Before your next call, with serif titles and no
  cards. "Latest calls" is gone: Recent in the sidebar is the same list.
  The field for Mori is a single wide row, with the mark on the left and the
  button on the right; three suggested questions, not four.
- **The dark capsule.** Recording in progress, the always-on-top window and
  the Save bar are dark on the light theme too: a single convention for "something
  is happening that asks for an answer".
- **The timeline of the two voices**, above every transcript (§3, "The
  signature"). It is made from the segments already on disk: zero model, zero network.
- **Tabs that slide.** The line under the chosen tab moves (`useTabInk`),
  in the call and in To-dos.
- **Motion.** Views enter the sheet; the sections of Today and the pages
  of people arrive in 60 ms steps; the checkmark snaps with a spring; the
  buttons go down by 1 px when you press; menus and dialogs open with
  `--ease-spring`. Everything stops with `prefers-reduced-motion`.
- **Checkmarks are round**, as in Things; active filters are solid
  ink; menus, ⌘K and dialogs sit on a blurred veil.
- **Gone are the doubles.** The "Search or ask" field of the sidebar (there is ⌘K); the three
  boxes of the shortcut (one row in mono inside the capsule); the "You" chip
  on every row of "Mine" in To-dos (there they are all yours). Added the duration
  of the call in the metadata row.
- **Darker paper, lighter sheet**: the sheet reads as a sheet.

Unchanged: the architecture (§2), the shortcuts, the texts, the logic, the
checks. `node scripts/contrast.mjs` passes on every pair; the axe audit is at 0
problems on every screen; the 22 flows pass. The screenshots
in the README are of this version (`docs/screenshots/`).
