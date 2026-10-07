// The conversation with Mori: the turns on screen, the thread they are saved
// in, and asking — recall on this PC, then the model, streamed into the last
// bubble. Shared by the chat page and the panel on a call.
import { useEffect, useState } from "react";
import { privateSessionIds } from "../../db";
import { retrieve } from "../../recall";
import {
  loadLastThread,
  newThread,
  appendMessage,
  recentHistory,
  withoutPrivateTurns,
  buildRetrievalQuery,
  lastUserQuestion,
} from "../../chatStore";
import { chatStream, providerReady, isLocalProvider, type ProviderConfig } from "../../llm";
import { todayLong } from "../../ui/format";
import type { ChatTurn } from "./AnswerBody";
import { answerLanguageNote, t } from "../../i18n";

const SYSTEM_PROMPT = `Sei Mori, un piccolo draghetto saggio, curioso e affettuoso che aiuta l'utente a ritrovare ciò che conta nelle sue note e conversazioni passate.
Regole:
- Rispondi in italiano, in modo conciso, caldo e diretto.
- Usa SOLO le informazioni presenti nelle NOTE qui sotto. Non inventare nulla.
- Cita sempre le fonti pertinenti tra parentesi quadre con il titolo ESATTO come compare nelle note, es. [Call con Marco · 19 ago 2026]: diventano link cliccabili.
- Quando aiuta a leggere usa elenchi puntati brevi e **grassetto** per scadenze, cifre e nomi. Niente tabelle.
- Se le note non contengono la risposta, dillo con onestà e semplicità.
- Se ti chiedono cosa sai fare: registri le call (tu dal microfono, gli altri dall'audio del PC) e le trascrivi sul PC; ne ricavi sintesi, decisioni e cose da fare con le scadenze; ricordi persone e progetti; prepari il brief prima di una call e la mail di follow-up dopo; rispondi citando le call. Si registra col bottone rosso o con la scorciatoia da tastiera; le call private le legge solo un modello sul PC.`;

export type Chat = {
  turns: ChatTurn[];
  asking: boolean;
  draft: string;
  setDraft: (s: string) => void;
  ask: (qOverride?: string) => Promise<void>;
  /** Start over in a fresh thread (the old one stays saved); returns how to go back. */
  newChat: () => () => void;
};

export function useChat(cfg: ProviderConfig, onNeedProvider: () => void): Chat {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  // The conversation lives in the DB now: reopening Mori reopens the last thread.
  const [threadId, setThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);

  // Reopen the last conversation where it was left.
  useEffect(() => {
    loadLastThread()
      .then(({ id, turns: saved }) => {
        setThreadId(id);
        if (saved.length) setTurns(saved);
      })
      .catch(() => {});
  }, []);

  async function ask(qOverride?: string) {
    const q = (typeof qOverride === "string" ? qOverride : draft).trim();
    if (!q || asking) return;
    if (!providerReady(cfg)) {
      const needModel = t(
        "Per rispondere mi serve un modello. Ti ho aperto le impostazioni: incolla una chiave Groq gratuita, oppure scegli un modello locale (Ollama, LM Studio) e nulla uscirà dal tuo PC.",
      );
      setTurns((t) => [
        ...t,
        { role: "user", content: q },
        {
          role: "assistant",
          content: needModel,
          error: true,
        },
      ]);
      setDraft("");
      onNeedProvider();
      return;
    }

    setDraft("");
    // The conversation BEFORE this question: it is what the model gets as history
    // and what a follow-up ("e poi?") borrows its searchable words from.
    const history = turns;
    const prevQuestion = lastUserQuestion(history);
    setTurns((t) => [...t, { role: "user", content: q }]);
    setAsking(true);
    const tid = threadId ?? (await newThread());
    if (!threadId) setThreadId(tid);
    try {
      await appendMessage(tid, "user", q, null);
      // Private calls are read only by a model on this machine (DECISIONS.md, rule 3).
      const local = isLocalProvider(cfg);
      const { context, sources, excludedPrivate, usedSessions } = await retrieve(buildRetrievalQuery(q, prevQuestion), {
        includePrivate: local,
      });
      const privacyNote =
        excludedPrivate > 0
          ? `\n\nNota: ${excludedPrivate === 1 ? "una call privata è esclusa" : `${excludedPrivate} call private sono escluse`} da queste note perché il modello è in cloud. Se la domanda sembra riguardarle, dillo in una riga.`
          : "";
      // The answer is written into its own bubble as it streams in. `streaming`
      // marks the one turn being written, so the thinking dots live inside it.
      setTurns((t) => [...t, { role: "assistant", content: "", sources, streaming: true, used: usedSessions }]);
      const writeLast = (patch: Partial<ChatTurn>) =>
        setTurns((t) => {
          const i = t.length - 1;
          if (i < 0 || !t[i].streaming) return t;
          const next = t.slice();
          next[i] = { ...next[i], ...patch };
          return next;
        });
      // Earlier answers may quote a call that is private now (written by a
      // local model, or before the call was marked): a cloud model must not
      // get them back through the history.
      const safeHistory = local ? history : withoutPrivateTurns(history, await privateSessionIds());
      const answer = await chatStream(
        [
          { role: "system", content: `${SYSTEM_PROMPT}${privacyNote}${answerLanguageNote()}\n\nOggi è ${todayLong()}.\n\nNOTE:\n${context}` },
          ...recentHistory(safeHistory, 8),
          { role: "user", content: q },
        ],
        cfg,
        (soFar) => writeLast({ content: soFar }),
      );
      writeLast({ content: answer, streaming: false });
      await appendMessage(tid, "assistant", answer, sources, false, usedSessions);
    } catch (e) {
      const msg = t("Non sono riuscito a rispondere: {error}", { error: String(e) });
      setTurns((t) => {
        // Replace an unfinished bubble instead of leaving an empty one behind.
        const base = t.length && t[t.length - 1].streaming ? t.slice(0, -1) : t;
        return [...base, { role: "assistant", content: msg, error: true }];
      });
      await appendMessage(tid, "assistant", msg, null, true).catch(() => {});
    } finally {
      setAsking(false);
    }
  }

  // The new thread is created by the first question (see ask): until then
  // nothing is written, so "Annulla" only has to put the screen back.
  function newChat() {
    const before = { turns, threadId, draft };
    setDraft("");
    setTurns([]);
    setThreadId(null);
    return () => {
      setTurns(before.turns);
      setThreadId(before.threadId);
      setDraft(before.draft);
    };
  }

  return { turns, asking, draft, setDraft, ask, newChat };
}
