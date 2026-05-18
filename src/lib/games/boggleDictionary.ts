// Server-only Boggle dictionary loader. Builds an in-memory Set on first call
// and reuses it for all subsequent validations. The package
// `an-array-of-english-words` is ~275k words and only loaded server-side, so it
// never ships to the client bundle.

let dictionary: Set<string> | null = null;

export async function getDictionary(): Promise<Set<string>> {
  if (dictionary) return dictionary;
  const mod = await import('an-array-of-english-words');
  const words: string[] = (mod.default ?? (mod as unknown as string[])) as string[];
  // Uppercase + length filter (Boggle min word length is 3).
  const set = new Set<string>();
  for (const w of words) {
    if (w.length >= 3) set.add(w.toUpperCase());
  }
  dictionary = set;
  return set;
}

export async function isWord(w: string): Promise<boolean> {
  const dict = await getDictionary();
  return dict.has(w.toUpperCase());
}
