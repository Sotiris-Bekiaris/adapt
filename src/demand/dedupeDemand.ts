/** Normalized key for deduping demands by title (case- and whitespace-insensitive). */
export function demandTitleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}
