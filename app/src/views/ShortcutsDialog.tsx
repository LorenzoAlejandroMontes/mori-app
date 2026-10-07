// "?" — every keyboard shortcut, in groups. Only what really works is listed:
// a view that adds shortcuts adds them here.
import Dialog from "../ui/Dialog";
import { hotkeyParts } from "../ui/keys";
import { modKey } from "../ui/platform";
import { t } from "../i18n";

/** Key combos, and what separates them: "…" a range, "/" alternatives. */
type Row = [keys: string[][], what: string, sep?: "…" | "/"];

export default function ShortcutsDialog({ hotkey, onClose }: { hotkey: string; onClose: () => void }) {
  const mod = modKey();
  const groups: [string, Row[]][] = [
    [
      t("Ovunque"),
      [
        [[[mod, "K"]], t("Cerca o chiedi")],
        [[[mod, "1"], [mod, "5"]], t("Oggi, Chiedi a Mori, Da fare, Persone, Tutte le call"), "…"],
        [[[mod, ","]], t("Impostazioni")],
        [[[mod, "\\"]], t("Mostra o nascondi la barra laterale")],
        [[hotkeyParts(hotkey)], t("Registra o ferma, anche con Mori dietro altre finestre")],
        [[["?"]], t("Questo pannello")],
        [[["Esc"]], t("Chiudi")],
      ],
    ],
    [
      t("Pagina della call"),
      [
        [[["J"], ["K"]], t("Call successiva, precedente")],
        [[["1"], ["2"], ["3"]], t("Sintesi, Trascritto, Da fare")],
        [[[mod, "J"]], t("Apri o chiudi la chat accanto")],
        [[["Esc"]], t("Chiudi la chat, poi torna indietro")],
        [[[mod, "Z"]], t("Annulla l'ultima eliminazione, finché c'è l'avviso")],
      ],
    ],
    [
      t("Liste (Tutte le call, Da fare, Persone)"),
      [
        [[["/"]], t("Cerca o filtra")],
        [[["↑"], ["↓"], ["J"], ["K"]], t("Passa da una riga all'altra")],
        [[[t("Invio")]], t("Apri")],
      ],
    ],
    [
      t("Da fare"),
      [
        [[[t("Spazio")], ["X"]], t("Segna fatta, o di nuovo da fare")],
        [[["E"]], t("Modifica il testo")],
        [[[t("Canc")]], t("Elimina (con Annulla)")],
        [[["N"]], t("Aggiungi una cosa da fare")],
      ],
    ],
  ];

  return (
    <Dialog title={t("Scorciatoie da tastiera")} onClose={onClose} className="shortcuts">
      <p className="dialog-hint">{t("Le scorciatoie di una lettera non scattano mentre scrivi in un campo.")}</p>
      {groups.map(([name, rows]) => (
        <section key={name} className="sc-group">
          <h3 className="sc-head">{name}</h3>
          <dl className="sc-list">
            {rows.map(([keys, what, sep = "/"]) => (
              <div key={what} className="sc-row">
                <dt>
                  {keys.map((combo, i) => (
                    <span key={i} className="sc-combo">
                      {i > 0 && <span className="sc-sep">{sep}</span>}
                      {combo.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  ))}
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </Dialog>
  );
}
