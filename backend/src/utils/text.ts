/**
 * Best-effort guess of whether a rental is furnished from its free text
 * (title + description), for when the listing has no structured furnished flag.
 * Returns undefined when the text gives no signal.
 *
 * Checks the negative ("non meublé", "vide") first so "non meublé" is not
 * mis-read as furnished. `\bmeubl` needs a word boundary so "immeuble" (building)
 * does not count as "meublé".
 */
export function inferFurnished(text: string | undefined): boolean | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();

  if (/\bnon[\s-]*meubl/.test(t) || /\bvide\b/.test(t) || /\bsans meuble/.test(t)) {
    return false;
  }
  if (/\bmeubl/.test(t)) {
    return true;
  }
  return undefined;
}

/**
 * Detect a shared-housing (colocation) rental from its free text (title + body).
 * These are per-room roommate rentals we want to exclude from whole-flat search.
 *
 * `\bcoloc` covers "colocation" / "colocataire" / "coloc'" (no common French
 * word contains "coloc" otherwise). Also catches the explicit "chambre en
 * colocation" and English "flatshare"/"room in a shared".
 */
export function isColocation(text: string | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return /\bcoloc/.test(t) || /\bflat[\s-]*share\b/.test(t) || /\bshared\s+(flat|apartment|house)\b/.test(t);
}
