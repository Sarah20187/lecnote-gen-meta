// Written for this repository. LecNote's pre-existing library.ts (private, before the hackathon) has a
// fuller displayTitle; structure.ts only needs a lecture title without a leading "L3 –" style number.

const NUMBER_PREFIX = /^(?:L|Lecture|Lec|第)?\s*(\d+)\s*(?:讲|课)?\s*[-–—:._\s]+/i;

/** A lecture's title as shown: trimmed, and without a leading number that equals `no`. */
export function displayTitle(title: string, no?: number | null): string {
  const clean = title.normalize("NFC").trim();
  if (no == null) return clean;
  const m = NUMBER_PREFIX.exec(clean);
  if (m && Number(m[1]) === no) return clean.slice(m[0].length).trim() || clean;
  return clean;
}
