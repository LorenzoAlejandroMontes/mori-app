import type { ActionItem, Category, Memory, Participant, Segment, Session } from "../../db";
import type { SpeakerMap } from "../../speakers-logic";

/** Everything the page of one call shows, read in one go. */
export type Detail = {
  session: Session;
  categories: Category[];
  participants: Participant[];
  summary: string;
  transcript: string;
  segments: Segment[];
  audioPath: string | null;
  actions: ActionItem[];
  memories: Memory[];
  /** Who "Interlocutore" was, when the user said it. */
  speakers: SpeakerMap;
};

export type CallTab = "sintesi" | "trascritto" | "dafare";
export type SeekRequest = { id: string; start: number; n: number };
