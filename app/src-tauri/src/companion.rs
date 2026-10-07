//! Sessione 3 · Compagno — la parte di Mori che vive fuori dalla finestra.
//!
//! Quattro cose:
//!   1. un'icona nella barra di Windows, con menu e stato "sto registrando";
//!   2. una scorciatoia globale (default Ctrl+Shift+R) che avvia/ferma da ovunque;
//!   3. una pillola sempre in primo piano che conferma cosa è successo, così non
//!      serve aprire la finestra per fidarsi;
//!   4. la lettura del file `<wav>.silence` scritto da record.py, per proporre
//!      lo stop dopo un silenzio lungo.
//!
//! Regola di casa: i comandi che fanno più di una lettura banale sono `async` +
//! `spawn_blocking`. Un comando sincrono che blocca il thread principale ha già
//! congelato l'app una volta.
//!
//! ## L'exe di release e dove trova gli script
//!
//! `pnpm tauri build --no-bundle` produce `target/release/mori.exe`. Senza
//! finestra nera: `main.rs:1` ha `windows_subsystem = "windows"` fuori dal
//! debug (letto).
//!
//! Gli script Python e il venv NON vengono impacchettati. `app_dir()` in
//! lib.rs parte da `env!("CARGO_MANIFEST_DIR")`, che è un percorso **assoluto
//! inchiodato al momento della compilazione**: da lì `scripts_dir()` ricava
//! `<app>/scripts` e `python_cmd()` prova `<app>/.venv/Scripts/python.exe`.
//! Misurato sull'exe prodotto qui: contiene una sola stringa di quel tipo,
//! `...\app\src-tauri`, quindi cercherà gli script accanto ad essa.
//!
//! Conseguenza pratica: **l'exe funziona solo finché esiste la cartella da cui
//! è stato compilato**. Un exe costruito in un worktree smette di registrare
//! quando il worktree viene cancellato. Va ricompilato dal checkout definitivo.
//! (Qui si constata e basta: cambiare questo schema non è di questa sessione.)

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
    WindowEvent, Wry,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

/// Command on a Mac, Ctrl everywhere else. It must match `defaultHotkey()` in
/// src/ui/platform.ts.
pub const DEFAULT_HOTKEY: &str = if cfg!(target_os = "macos") { "Cmd+Shift+R" } else { "Ctrl+Shift+R" };
/// "Quit Mori" in the macOS menu bar (Cmd+Q).
const APP_QUIT_ID: &str = "app-quit";
const TRAY_ID: &str = "mori-tray";
const PILL_LABEL: &str = "pill";

/// Eventi verso il frontend. Il frontend è l'unico che sa come si registra
/// (e ha le sue guardie contro il doppio stop), quindi qui non si registra mai
/// direttamente: si chiede.
pub const EV_TOGGLE: &str = "companion://toggle-record";
pub const EV_QUIT_REQUEST: &str = "companion://quit-request";
pub const EV_PILL: &str = "companion://pill";
pub const EV_PILL_ACTION: &str = "companion://pill-action";

/// The words of the tray menu. They start in Italian, like every key of the
/// dictionary; the frontend sends them in the user's language as soon as it
/// is up (`companion_set_labels`).
#[derive(serde::Deserialize, Clone, Debug)]
pub struct Labels {
    record: String,
    stop: String,
    open: String,
    quit: String,
    quit_recording: String,
    tip_recording: String,
}

impl Default for Labels {
    fn default() -> Self {
        Labels {
            record: "Registra la call".into(),
            stop: "Ferma e trascrivi".into(),
            open: "Apri Mori".into(),
            quit: "Esci".into(),
            quit_recording: "Esci · fermo la registrazione".into(),
            tip_recording: "Mori · sto registrando".into(),
        }
    }
}

#[derive(Default)]
pub struct Companion {
    labels: Mutex<Labels>,
    /// La voce di menu che cambia testo tra "Registra la call" e "Ferma e trascrivi".
    toggle_item: Mutex<Option<MenuItem<Wry>>>,
    open_item: Mutex<Option<MenuItem<Wry>>>,
    /// La voce "Esci", che avvisa quando c'è una registrazione in corso.
    quit_item: Mutex<Option<MenuItem<Wry>>>,
    /// Icona a riposo e icona con il pallino corallo.
    icons: Mutex<Option<(Image<'static>, Image<'static>)>>,
    /// Scorciatoia attualmente registrata, per poterla togliere prima di cambiarla.
    hotkey: Mutex<Option<Shortcut>>,
    /// L'ultima pillola chiesta. La finestrella, appena nata, ci mette un attimo
    /// a registrare il suo listener: se glielo si manda subito lo perde e resta
    /// bianca. Quando è pronta lo richiede e glielo si rimanda da qui.
    last_pill: Mutex<Option<Pill>>,
    recording: AtomicBool,
    /// C'è una registrazione non ancora al sicuro. `recording` lo alza il
    /// frontend quando lo stato React è già cambiato, quindi lascia scoperti
    /// l'avvio (record.py lanciato, si aspetta fino a 10 s che parta) e il
    /// salvataggio (fino a 180 s di scrittura del WAV, poi call e coda). Questo
    /// lo alza `start_recording` PRIMA di lanciare record.py e lo abbassa il
    /// frontend solo a call creata e trascrizione in coda.
    unsaved: AtomicBool,
    /// "Esci" è già stato chiesto e si sta aspettando il salvataggio.
    quitting: AtomicBool,
    /// Chiudere la finestra la nasconde invece di uscire.
    close_to_tray: AtomicBool,
    /// Falso se l'icona nella barra non è stata creata: senza icona, nascondere
    /// la finestra renderebbe Mori irraggiungibile, quindi si esce e basta.
    tray_ok: AtomicBool,
    /// Il riquadro di stato ("status") è nell'angolo in basso a destra finché
    /// l'utente non lo trascina altrove: da lì in poi torna dove l'ha lasciato.
    pill_user_pos: Mutex<Option<PhysicalPosition<i32>>>,
    /// Dove l'abbiamo messo noi: un `Moved` diverso da questo è un trascinamento.
    pill_placed: Mutex<Option<PhysicalPosition<i32>>>,
    pill_status_mode: AtomicBool,
}

// --- Icone -------------------------------------------------------------------

/// Le due icone della barra, ricavate dall'icona dell'app: nessun asset nuovo da
/// tenere allineato. La variante "sto registrando" è la stessa immagine con un
/// disco corallo in basso a destra, bordato di bianco perché si veda sia su
/// barra chiara sia su barra scura.
fn build_icons(app: &AppHandle) -> Option<(Image<'static>, Image<'static>)> {
    let base = app.default_window_icon()?.to_owned();
    let (w, h) = (base.width(), base.height());
    let idle = Image::new_owned(base.rgba().to_vec(), w, h);

    let mut rgba = base.rgba().to_vec();
    // Disco largo ~44% del lato, appoggiato all'angolo in basso a destra.
    let r = (w.min(h) as f32) * 0.22;
    let cx = w as f32 - r - 1.0;
    let cy = h as f32 - r - 1.0;
    let ring = r * 0.78; // dentro: corallo; tra ring e r: bianco
    for y in 0..h {
        for x in 0..w {
            let dx = x as f32 + 0.5 - cx;
            let dy = y as f32 + 0.5 - cy;
            let d = (dx * dx + dy * dy).sqrt();
            if d > r {
                continue;
            }
            let (cr, cg, cb) = if d <= ring { (224, 71, 77) } else { (255, 255, 255) };
            let o = ((y * w + x) * 4) as usize;
            if o + 3 >= rgba.len() {
                continue;
            }
            // Antialias di un pixel sul bordo esterno, così non fa i gradini.
            let a = if d > r - 1.0 { ((r - d).max(0.0) * 255.0) as u8 } else { 255 };
            let blend = |dst: u8, src: u8| -> u8 {
                (((src as u16) * (a as u16) + (dst as u16) * (255 - a as u16)) / 255) as u8
            };
            rgba[o] = blend(rgba[o], cr);
            rgba[o + 1] = blend(rgba[o + 1], cg);
            rgba[o + 2] = blend(rgba[o + 2], cb);
            rgba[o + 3] = rgba[o + 3].max(a);
        }
    }
    Some((idle, Image::new_owned(rgba, w, h)))
}

// --- Avvio -------------------------------------------------------------------

/// Costruisce icona + menu, registra la scorciatoia di default e fa in modo che
/// chiudere la finestra la nasconda. Non fallisce mai in modo fatale: se la barra
/// non accetta l'icona, Mori resta l'app di prima.
pub fn setup(app: &AppHandle) {
    let state = app.state::<Companion>();

    if let Some(pair) = build_icons(app) {
        *state.icons.lock().unwrap() = Some(pair);
    }

    let toggle = match MenuItem::with_id(app, "toggle", "Registra la call", true, Some(DEFAULT_HOTKEY)) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("companion: menu non creato: {e}");
            return;
        }
    };
    let open = match MenuItem::with_id(app, "open", "Apri Mori", true, None::<&str>) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("companion: menu non creato: {e}");
            return;
        }
    };
    let quit = match MenuItem::with_id(app, "quit", "Esci", true, None::<&str>) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("companion: menu non creato: {e}");
            return;
        }
    };
    let sep = match PredefinedMenuItem::separator(app) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("companion: menu non creato: {e}");
            return;
        }
    };
    let menu = match Menu::with_items(app, &[&toggle, &open, &sep, &quit]) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("companion: menu non creato: {e}");
            return;
        }
    };

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Mori")
        .menu(&menu)
        // Click sinistro = apri la finestra, non apri il menu (il menu sta sul destro).
        // On a Mac a click on a menu bar icon opens its menu, so there it does.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle" => {
                let _ = app.emit(EV_TOGGLE, ());
            }
            "open" => show_main(app),
            "quit" => request_quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if !cfg!(target_os = "macos") {
                    show_main(tray.app_handle());
                }
            }
        });
    if let Some((idle, _)) = state.icons.lock().unwrap().as_ref() {
        builder = builder.icon(idle.clone());
    }

    match builder.build(app) {
        Ok(_) => {
            state.tray_ok.store(true, Ordering::SeqCst);
            state.close_to_tray.store(true, Ordering::SeqCst);
        }
        Err(e) => {
            eprintln!("companion: icona nella barra non creata: {e}");
            return;
        }
    }
    *state.toggle_item.lock().unwrap() = Some(toggle);
    *state.open_item.lock().unwrap() = Some(open);
    *state.quit_item.lock().unwrap() = Some(quit);

    // Chiudere la finestra la nasconde: registrazione e trascrizioni in corso
    // vivono nel webview della finestra principale e devono continuare.
    if let Some(main) = app.get_webview_window("main") {
        let handle = app.clone();
        main.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let st = handle.state::<Companion>();
                if st.tray_ok.load(Ordering::SeqCst) && st.close_to_tray.load(Ordering::SeqCst) {
                    api.prevent_close();
                    if let Some(w) = handle.get_webview_window("main") {
                        let _ = w.hide();
                    }
                } else if must_hold_quit(&st) {
                    // Senza "chiudi nella barra" la X chiude l'app: stessa
                    // porta di "Esci", stessa protezione.
                    api.prevent_close();
                    request_quit(&handle);
                }
            }
        });
    }

    if let Err(e) = apply_hotkey(app, DEFAULT_HOTKEY) {
        eprintln!("companion: scorciatoia non registrata: {e}");
    }
}

/// The menu bar of a Mac app, with Mori's own "Quit": the stock one ends the
/// process on Cmd+Q without asking, and during a call that leaves record.py
/// running with nobody to stop it. This one goes through `request_quit`, the
/// same door as the tray. Edit is there because without it Cmd+C/V/X/A do
/// nothing in a text field. Only installed on macOS (see `setup_app_menu`).
fn app_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let quit = MenuItem::with_id(app, APP_QUIT_ID, "Quit Mori", true, Some("Cmd+Q"))?;
    let mori = Submenu::with_items(
        app,
        "Mori",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;
    Menu::with_items(app, &[&mori, &edit, &window])
}

/// Called once at startup. Windows and Linux keep having no menu bar.
pub fn setup_app_menu(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    match app_menu(app) {
        Ok(menu) => {
            if let Err(e) = app.set_menu(menu) {
                eprintln!("companion: menu bar not set: {e}");
            }
        }
        Err(e) => eprintln!("companion: menu bar not built: {e}"),
    }
    app.on_menu_event(|app, event| {
        if event.id.as_ref() == APP_QUIT_ID {
            request_quit(app);
        }
    });
}

/// The system is asking Mori to end without going through its own "Quit"
/// (the Dock's Quit, a logout). True means: not yet, a call is being stopped
/// and saved first; `request_quit` exits when the frontend is done.
pub fn hold_exit(app: &AppHandle) -> bool {
    if !must_hold_quit(&app.state::<Companion>()) {
        return false;
    }
    request_quit(app);
    true
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// "Esci" con una registrazione in corso non deve lasciare record.py orfano né
/// buttare via l'audio: si chiede al frontend di fermarla e si aspetta che
/// chiami `companion_quit`.
///
/// La rete di sicurezza è volutamente lunga: `stop_recording_impl` in lib.rs
/// aspetta fino a 180 s che il mix finale finisca di scriversi su una call
/// lunga. Uscire dopo 8 s ammazzava il processo mentre quel salvataggio era
/// ancora in corso — cioè proprio l'orfano che si voleva evitare, più la
/// registrazione persa. 210 s copre l'attesa massima con un margine.
const QUIT_GRACE_SECS: u64 = 210;

/// Chiamata da `start_recording` (lib.rs) attorno al lancio di record.py.
pub fn set_unsaved(app: &AppHandle, on: bool) {
    app.state::<Companion>().unsaved.store(on, Ordering::SeqCst);
}

/// Vero se uscire adesso lascerebbe record.py orfano o una call non salvata.
fn must_hold_quit(state: &Companion) -> bool {
    state.recording.load(Ordering::SeqCst) || state.unsaved.load(Ordering::SeqCst)
}

fn request_quit(app: &AppHandle) {
    let state = app.state::<Companion>();
    if !must_hold_quit(&state) {
        app.exit(0);
        return;
    }
    // Asked twice (Cmd+Q pressed again while saving): one stop, one timer.
    if state.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let _ = app.emit(EV_QUIT_REQUEST, ());
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(QUIT_GRACE_SECS));
        handle.exit(0);
    });
}

/// Registra la scorciatoia globale. Il gancio: solo alla pressione, altrimenti
/// il rilascio farebbe un secondo toggle e la registrazione partirebbe e si
/// fermerebbe subito.
fn register(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, _sc, event| {
            if event.state() == ShortcutState::Pressed {
                let _ = app.emit(EV_TOGGLE, ());
            }
        })
        .map_err(|e| e.to_string())
}

fn apply_hotkey(app: &AppHandle, accel: &str) -> Result<(), String> {
    let shortcut: Shortcut = accel
        .parse()
        .map_err(|_| format!("scorciatoia non valida: {accel}"))?;
    let state = app.state::<Companion>();
    let previous = *state.hotkey.lock().unwrap();
    if previous == Some(shortcut) {
        return Ok(());
    }
    if let Some(old) = previous {
        let _ = app.global_shortcut().unregister(old);
    }
    match register(app, shortcut) {
        Ok(()) => {
            *state.hotkey.lock().unwrap() = Some(shortcut);
            Ok(())
        }
        Err(e) => {
            // Combinazione già presa da un'altra app: rimettere quella di prima,
            // altrimenti si resta senza nessuna scorciatoia e senza accorgersene.
            if let Some(old) = previous {
                if register(app, old).is_ok() {
                    *state.hotkey.lock().unwrap() = Some(old);
                    return Err(format!("{accel} è già usata da un'altra app: resta quella di prima"));
                }
            }
            *state.hotkey.lock().unwrap() = None;
            Err(format!("{accel} non si può registrare: {e}"))
        }
    }
}

// --- La pillola --------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
pub struct Pill {
    /// "started" | "stopped" | "info" | "silence"
    pub kind: String,
    pub title: String,
    #[serde(default)]
    pub subtitle: String,
    #[serde(default)]
    pub hint: String,
    /// Secondi rimasti, solo per "silence".
    #[serde(default)]
    pub seconds: u32,
    /// Solo per "status": "recording" | "saving" | "transcribing" | "understanding".
    #[serde(default)]
    pub phase: String,
    /// Solo per "status" in registrazione: inizio in ms epoch, il timer lo
    /// tiene la finestrella da sola invece di ricevere un evento al secondo.
    #[serde(default)]
    pub since: f64,
    /// Solo per "status" in trascrizione: 0…1, -1 se non si sa ancora.
    #[serde(default = "no_progress")]
    pub progress: f64,
}

fn no_progress() -> f64 {
    -1.0
}

fn pill_size(kind: &str) -> (f64, f64) {
    match kind {
        "silence" => (430.0, 172.0),
        // Room for "Trascrivo la call · 42% · circa 4 min" and the line under it.
        "status" => (380.0, 64.0),
        _ => (430.0, 76.0),
    }
}

/// Mostra (creandola la prima volta) la finestrella sempre in primo piano e le
/// manda cosa scrivere. È una finestra del solito frontend, aperta su `#pill`.
fn show_pill(app: &AppHandle, pill: Pill) -> Result<(), String> {
    let (w, h) = pill_size(&pill.kind);
    *app.state::<Companion>().last_pill.lock().unwrap() = Some(pill.clone());
    let window = match app.get_webview_window(PILL_LABEL) {
        Some(win) => win,
        None => WebviewWindowBuilder::new(app, PILL_LABEL, WebviewUrl::App("index.html#pill".into()))
            .title("Mori")
            .inner_size(w, h)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .resizable(false)
            .shadow(false)
            .focused(false)
            .visible(false)
            .build()
            .map(|win| {
                // Un trascinamento del riquadro di stato si ricorda: le
                // posizioni messe da noi si riconoscono e si ignorano.
                let handle = app.clone();
                win.on_window_event(move |event| {
                    if let WindowEvent::Moved(p) = event {
                        let st = handle.state::<Companion>();
                        if st.pill_status_mode.load(Ordering::SeqCst)
                            && *st.pill_placed.lock().unwrap() != Some(*p)
                        {
                            *st.pill_user_pos.lock().unwrap() = Some(*p);
                        }
                    }
                });
                win
            })
            .map_err(|e| e.to_string())?,
    };

    let status = pill.kind == "status";
    let state = app.state::<Companion>();
    state.pill_status_mode.store(status, Ordering::SeqCst);
    let _ = window.set_size(LogicalSize::new(w, h));
    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale = monitor.scale_factor();
        let pw = (w * scale) as i32;
        let ph = (h * scale) as i32;
        let target = if status {
            // Angolo in basso a destra dell'area di lavoro, dove Windows tiene
            // già gli stati: lontano dai controlli delle call, che sono al centro.
            let user = *state.pill_user_pos.lock().unwrap();
            user.unwrap_or_else(|| {
                let wa = monitor.work_area();
                let m = (16.0 * scale) as i32;
                PhysicalPosition::new(
                    wa.position.x + wa.size.width as i32 - pw - m,
                    wa.position.y + wa.size.height as i32 - ph - m,
                )
            })
        } else {
            // In basso al centro dello schermo, sopra la barra delle applicazioni.
            let size = monitor.size();
            let pos = monitor.position();
            PhysicalPosition::new(
                pos.x + (size.width as i32 - pw) / 2,
                pos.y + size.height as i32 - ph - (120.0 * scale) as i32,
            )
        };
        *state.pill_placed.lock().unwrap() = Some(target);
        let _ = window.set_position(target);
    }
    let _ = window.emit(EV_PILL, pill);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_always_on_top(true);
    Ok(())
}

// --- Comandi -----------------------------------------------------------------

#[tauri::command]
pub async fn companion_pill(app: AppHandle, pill: Pill) -> Result<(), String> {
    show_pill(&app, pill)
}

/// La finestrella dice "ci sono": le si rimanda l'ultima pillola, che al primo
/// avvio si era persa perché il listener non era ancora registrato.
#[tauri::command]
pub async fn companion_pill_ready(app: AppHandle) -> Result<(), String> {
    let last = app.state::<Companion>().last_pill.lock().unwrap().clone();
    if let (Some(pill), Some(window)) = (last, app.get_webview_window(PILL_LABEL)) {
        let _ = window.emit(EV_PILL, pill);
    }
    Ok(())
}

#[tauri::command]
pub async fn companion_pill_hide(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PILL_LABEL) {
        w.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Rimanda al frontend principale il bottone premuto sulla pillola
/// ("keep" = continua a registrare, "stop" = ferma adesso, "toggle" = ferma
/// dal riquadro di stato). "open" riapre Mori e basta.
#[tauri::command]
pub async fn companion_pill_action(app: AppHandle, action: String) -> Result<(), String> {
    if action == "open" {
        show_main(&app);
        return Ok(());
    }
    // Il riquadro di stato resta: passa da "registro" a "salvo" da solo.
    if action != "toggle" {
        if let Some(w) = app.get_webview_window(PILL_LABEL) {
            let _ = w.hide();
        }
    }
    app.emit(EV_PILL_ACTION, action).map_err(|e| e.to_string())
}

/// Aggiorna icona e voce di menu quando si inizia o si smette di registrare.
#[tauri::command]
pub async fn companion_set_recording(app: AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<Companion>();
    state.recording.store(on, Ordering::SeqCst);
    apply_labels(&app);
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Some((idle, rec)) = state.icons.lock().unwrap().as_ref() {
            let _ = tray.set_icon(Some(if on { rec.clone() } else { idle.clone() }));
        }
    }
    Ok(())
}

/// Writes the tray menu and the tooltip for the current state and language.
fn apply_labels(app: &AppHandle) {
    let state = app.state::<Companion>();
    let l = state.labels.lock().unwrap().clone();
    let on = state.recording.load(Ordering::SeqCst);
    if let Some(item) = state.toggle_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if on { &l.stop } else { &l.record });
    }
    if let Some(item) = state.open_item.lock().unwrap().as_ref() {
        let _ = item.set_text(&l.open);
    }
    if let Some(item) = state.quit_item.lock().unwrap().as_ref() {
        let _ = item.set_text(if on { &l.quit_recording } else { &l.quit });
    }
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(if on { l.tip_recording.as_str() } else { "Mori" }));
    }
}

/// The tray menu in the language of the interface.
#[tauri::command]
pub async fn companion_set_labels(app: AppHandle, labels: Labels) -> Result<(), String> {
    *app.state::<Companion>().labels.lock().unwrap() = labels;
    apply_labels(&app);
    Ok(())
}

/// Il frontend ha finito con la registrazione fermata: call creata e
/// trascrizione in coda, oppure errore mostrato. Da qui "Esci" torna immediato.
#[tauri::command]
pub async fn companion_recording_settled(app: AppHandle) -> Result<(), String> {
    set_unsaved(&app, false);
    Ok(())
}

#[tauri::command]
pub async fn companion_set_hotkey(app: AppHandle, accel: String) -> Result<(), String> {
    let accel = if accel.trim().is_empty() { DEFAULT_HOTKEY.to_string() } else { accel };
    apply_hotkey(&app, &accel)
}

#[tauri::command]
pub async fn companion_set_close_to_tray(app: AppHandle, on: bool) -> Result<(), String> {
    let state = app.state::<Companion>();
    // Senza icona nella barra, nascondere la finestra vorrebbe dire perdere Mori.
    state
        .close_to_tray
        .store(on && state.tray_ok.load(Ordering::SeqCst), Ordering::SeqCst);
    Ok(())
}

/// Vero se l'icona nella barra esiste davvero: il frontend lo usa per non
/// promettere in Impostazioni qualcosa che non c'è.
#[tauri::command]
pub async fn companion_tray_ready(app: AppHandle) -> Result<bool, String> {
    Ok(app.state::<Companion>().tray_ok.load(Ordering::SeqCst))
}

#[tauri::command]
pub async fn companion_show_main(app: AppHandle) -> Result<(), String> {
    show_main(&app);
    Ok(())
}

#[tauri::command]
pub async fn companion_quit(app: AppHandle) -> Result<(), String> {
    app.exit(0);
    Ok(())
}

/// Secondi di silenzio continuo su entrambi i canali, letti dal file
/// `<wav>.silence` che record.py riscrive ogni ~5 s. 0 se il file non c'è
/// ancora (registrazione appena partita, o versione vecchia dello script).
#[tauri::command]
pub async fn recording_silence_secs(wav: String) -> Result<u64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = format!("{wav}.silence");
        match std::fs::read_to_string(&path) {
            Ok(s) => s.trim().parse::<u64>().unwrap_or(0),
            Err(_) => 0,
        }
    })
    .await
    .map_err(|e| format!("task fallita: {e}"))
}

/// How loud each channel is right now, how long each has been quiet, and any
/// capture that died: the JSON record.py rewrites ~twice a second in
/// `<wav>.levels`. None before the first write (or with an older script).
#[tauri::command]
pub async fn recording_levels(wav: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(format!("{wav}.levels")).ok())
        .await
        .map_err(|e| format!("task fallita: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A default nobody can register would leave Mori without a shortcut, and
    /// without the tray menu that shows it. Both spellings, on every machine.
    #[test]
    fn the_default_shortcut_is_one_the_system_accepts() {
        assert!(DEFAULT_HOTKEY.parse::<Shortcut>().is_ok(), "{DEFAULT_HOTKEY}");
        assert!("Cmd+Shift+R".parse::<Shortcut>().is_ok());
        assert!("Ctrl+Shift+R".parse::<Shortcut>().is_ok());
    }
}
