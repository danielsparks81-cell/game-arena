// Server-only Boggle dictionary loader. Builds an in-memory Set on first call
// and reuses it for all subsequent validations.
//
// Uses the TWL06 (Tournament Word List, 2006) — the official wordlist for
// US/Canada Scrabble tournaments. ~178k entries, stricter than SCOWL: excludes
// proper nouns, abbreviations, and most non-English borrowings; includes
// Scrabble bombs like QI, ZA, JO. 2-letter words are already filtered out of
// `twl06Data.ts` at generation time since Boggle's minimum word length is 3.

import { TWL06 } from './twl06Data';

let dictionary: Set<string> | null = null;

export async function getDictionary(): Promise<Set<string>> {
  if (dictionary) return dictionary;
  dictionary = new Set(TWL06);
  return dictionary;
}

export async function isWord(w: string): Promise<boolean> {
  const dict = await getDictionary();
  return dict.has(w.toUpperCase());
}
