/**
 * Which language a VolleyManager team name is kept in: the one of the region
 * the team's club is in — Ticino Italian, Romandie French, German-speaking
 * Switzerland German (owner, 2026-11-22). VolleyManager answers `name` in the
 * language of the logged-in account/role and sends all three under
 * `translations`, so the sync never depends on how the shared account is set.
 *
 * Same rule as OpenVolley's VM sync (lib/vmSync.js teamLanguage). Its twin in
 * the extension tree is NON_GERMAN_ASSOCIATIONS in kscw-endpoints/src/sv-sync.js
 * (the two trees are separate deploy units and cannot import each other).
 */

function deepGet(obj, ...keys) {
  for (const k of keys) {
    if (obj && typeof obj === 'object') obj = obj[k];
    else return null;
  }
  return obj ?? null;
}

/**
 * `entity.translations[lang][key]` when it is a non-empty string, else the
 * German text, else the plain field.
 */
export function translatedText(entity, lang = 'de', key = 'name') {
  if (!entity || typeof entity !== 'object') return null;
  for (const l of lang === 'de' ? ['de'] : [lang, 'de']) {
    const v = deepGet(entity, 'translations', l, key);
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return entity[key] ?? null;
}

/** League category and other association-level names: always German. */
export function germanText(entity, key = 'name') {
  return translatedText(entity, 'de', key);
}

// A Swiss Volley club number starts with its regional association's code
// (VolleyManager's club.identifier, e.g. 912530).
const ASSOCIATION_LANGUAGE = {
  901: 'fr', // Genève
  902: 'fr', // Vaud
  904: 'fr', // Neuchâtel
  907: 'de', // Bern
  909: 'de', // Nordwestschweiz
  910: 'de', // Aargau / Solothurn
  911: 'de', // Innerschweiz
  912: 'de', // Zürich
  913: 'de', // Ostschweiz
  914: 'de', // Südostschweiz
  915: 'it', // Ticino
};
// Bilingual associations (903 Valais, 905 Jura / Seeland, 906 Fribourg):
// French, but for the clubs of their German-speaking part, listed by number.
export const BILINGUAL_ASSOCIATIONS = new Set(['903', '905', '906']);
const GERMAN_SPEAKING_CLUBS = new Set([
  '903025', '903059', '903095', '903100', '903155', '903190', '903192', '903300', // Oberwallis: Brig, Goms, Lalden, Raron, Visp
  '905090', '905270', '905998', // Biel/Bienne (bilingual, German majority), Nidau
  '906035', '906040', '906100', '906170', '906205', '906260', '906291', '906340', '906365', '906370', // Sense + See: Plaffeien, Bösingen, Düdingen, Gurmels, Kerzers, Murten, Rechthalten, Schmitten, Tafers, Ueberstorf
]);

/** 'de' | 'fr' | 'it' for a team; no club number, or one of no known association: German. */
export function teamLanguage(team) {
  const id = String(deepGet(team, 'club', 'identifier') ?? '').trim();
  if (!/^\d{6}$/.test(id)) return 'de';
  const assoc = id.slice(0, 3);
  if (BILINGUAL_ASSOCIATIONS.has(assoc)) return GERMAN_SPEAKING_CLUBS.has(id) ? 'de' : 'fr';
  return ASSOCIATION_LANGUAGE[assoc] ?? 'de';
}

/** A team's name in its own region's language (see teamLanguage). */
export function teamName(team) {
  return translatedText(team, teamLanguage(team));
}
