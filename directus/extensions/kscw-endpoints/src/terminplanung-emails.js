/**
 * Transactional email copy for the Terminplanung opponent flow, per language.
 *
 * Opponent-facing emails go out in the language the opponent picked on the
 * public page (game_scheduling_opponents.language). gsw maps to de on purpose:
 * formal Swiss correspondence is written in High German, not dialect.
 *
 * Callers pass already-formatted Swiss date/time strings (dd.mm.yyyy / HH:MM).
 * For the slot/date list, callers pass BOTH:
 *   - `vars.list`  — a pre-joined plain-text block (`• …` lines) for the text fallback
 *   - `vars.slots` — structured rows [{ date, time, hall }] for the HTML info card
 */

import { buildEmailLayout, buildInfoCard, buildAlertBox, escHtml } from './email-template.js'
import { buildSchedSignatureRows } from './scheduling-signature.js'

export const VALID_LANGS = ['de', 'gsw', 'en', 'fr', 'it']

const T = {
  de: {
    homeSubject: 'Heimspiel gebucht – KSC Wiedikon',
    home: (v) =>
      `Hallo ${v.contact},\n\n` +
      `Das Heimspiel ${v.kscw} – ${v.opp} ist gebucht:\n${v.date}, ${v.time} Uhr, ${v.hall}.\n\n` +
      `Dieses Spiel tragen wir im VolleyManager (Swiss Volley) ein – du musst dafür nichts weiter tun.\n\n` +
      `Sportliche Grüsse\nKSC Wiedikon`,
    homePropSubject: 'Heimspiel-Vorschläge erhalten – KSC Wiedikon',
    homeProp: (v) =>
      `Hallo ${v.contact},\n\n` +
      `Wir haben deine Slot-Vorschläge für das Heimspiel ${v.kscw} – ${v.opp} (in unserer Halle) erhalten:\n${v.list}\n\n` +
      `Hinweis: Diese Slots sind noch nicht reserviert – wir bestätigen einen davon und melden uns. Ein vorgeschlagener Slot kann zwischenzeitlich anderweitig vergeben werden.\n\n` +
      `Sportliche Grüsse\nKSC Wiedikon`,
    reproposalSubject: 'Neue Heimspiel-Slots benötigt – KSC Wiedikon',
    reproposal: (v) =>
      `Hallo ${v.contact},\n\n` +
      `Leider sind deine vorgeschlagenen Slots für das Heimspiel ${v.kscw} – ${v.opp} (in unserer Halle) nicht mehr verfügbar.\n\n` +
      `Bitte wähle über deinen Link drei neue Slots aus:\n${v.url}\n\n` +
      `Vielen Dank und sportliche Grüsse\nKSC Wiedikon`,
    propSubject: 'Terminvorschläge erhalten – KSC Wiedikon',
    prop: (v) =>
      `Hallo ${v.contact},\n\n` +
      `Wir haben deine Terminvorschläge für das Auswärtsspiel ${v.opp} – ${v.kscw} erhalten:\n${v.list}\n\n` +
      `Wir bestätigen einen Termin in Kürze und melden uns wieder.\n\n` +
      `Sportliche Grüsse\nKSC Wiedikon`,
    confSubject: 'Spieltermin bestätigt – KSC Wiedikon',
    conf: (v) =>
      `Hallo ${v.contact},\n\n` +
      `Der Termin für das Auswärtsspiel ${v.opp} – ${v.kscw} ist bestätigt:\n${v.date}${v.time ? `, ${v.time} Uhr` : ''}.\n\n` +
      `Bitte trage diesen Termin im VolleyManager (Swiss Volley) ein. Das Heimspiel tragen wir selbst ein.\n\n` +
      `Danke und sportliche Grüsse\nKSC Wiedikon`,
  },
  en: {
    homeSubject: 'Home game booked – KSC Wiedikon',
    home: (v) =>
      `Hello ${v.contact},\n\n` +
      `The home game ${v.kscw} – ${v.opp} is booked:\n${v.date}, ${v.time}, ${v.hall}.\n\n` +
      `We'll enter this game in VolleyManager (Swiss Volley) — nothing further needed from you for this one.\n\n` +
      `Best regards\nKSC Wiedikon`,
    homePropSubject: 'Home-game slot proposals received – KSC Wiedikon',
    homeProp: (v) =>
      `Hello ${v.contact},\n\n` +
      `We've received your slot proposals for the home game ${v.kscw} – ${v.opp} (in our hall):\n${v.list}\n\n` +
      `Note: these slots are not reserved yet — we'll confirm one and get back to you. A proposed slot may be taken by someone else in the meantime.\n\n` +
      `Best regards\nKSC Wiedikon`,
    reproposalSubject: 'New home-game slots needed – KSC Wiedikon',
    reproposal: (v) =>
      `Hello ${v.contact},\n\n` +
      `Unfortunately the slots you proposed for the home game ${v.kscw} – ${v.opp} (in our hall) are no longer available.\n\n` +
      `Please pick three new slots via your link:\n${v.url}\n\n` +
      `Thank you and best regards\nKSC Wiedikon`,
    propSubject: 'Date proposals received – KSC Wiedikon',
    prop: (v) =>
      `Hello ${v.contact},\n\n` +
      `We've received your proposed dates for the away game ${v.opp} – ${v.kscw}:\n${v.list}\n\n` +
      `We'll confirm one shortly and get back to you.\n\n` +
      `Best regards\nKSC Wiedikon`,
    confSubject: 'Game date confirmed – KSC Wiedikon',
    conf: (v) =>
      `Hello ${v.contact},\n\n` +
      `The date for the away game ${v.opp} – ${v.kscw} is confirmed:\n${v.date}${v.time ? `, ${v.time}` : ''}.\n\n` +
      `Please enter this date in VolleyManager (Swiss Volley); we'll enter the home game ourselves.\n\n` +
      `Thanks and best regards\nKSC Wiedikon`,
  },
  fr: {
    homeSubject: 'Match à domicile réservé – KSC Wiedikon',
    home: (v) =>
      `Bonjour ${v.contact},\n\n` +
      `Le match à domicile ${v.kscw} – ${v.opp} est réservé :\n${v.date}, ${v.time}, ${v.hall}.\n\n` +
      `Nous saisirons ce match dans VolleyManager (Swiss Volley) — rien d'autre à faire de votre côté pour celui-ci.\n\n` +
      `Cordiales salutations sportives\nKSC Wiedikon`,
    homePropSubject: 'Propositions de créneaux à domicile reçues – KSC Wiedikon',
    homeProp: (v) =>
      `Bonjour ${v.contact},\n\n` +
      `Nous avons bien reçu vos propositions de créneaux pour le match à domicile ${v.kscw} – ${v.opp} (dans notre salle) :\n${v.list}\n\n` +
      `Remarque : ces créneaux ne sont pas encore réservés — nous en confirmerons un et reviendrons vers vous. Un créneau proposé peut entre-temps être attribué à quelqu'un d'autre.\n\n` +
      `Cordiales salutations sportives\nKSC Wiedikon`,
    reproposalSubject: 'Nouveaux créneaux à domicile nécessaires – KSC Wiedikon',
    reproposal: (v) =>
      `Bonjour ${v.contact},\n\n` +
      `Malheureusement, les créneaux que vous avez proposés pour le match à domicile ${v.kscw} – ${v.opp} (dans notre salle) ne sont plus disponibles.\n\n` +
      `Merci de choisir trois nouveaux créneaux via votre lien :\n${v.url}\n\n` +
      `Merci et cordiales salutations sportives\nKSC Wiedikon`,
    propSubject: 'Propositions de dates reçues – KSC Wiedikon',
    prop: (v) =>
      `Bonjour ${v.contact},\n\n` +
      `Nous avons bien reçu vos propositions de dates pour le match à l'extérieur ${v.opp} – ${v.kscw} :\n${v.list}\n\n` +
      `Nous en confirmerons une prochainement et reviendrons vers vous.\n\n` +
      `Cordiales salutations sportives\nKSC Wiedikon`,
    confSubject: 'Date de match confirmée – KSC Wiedikon',
    conf: (v) =>
      `Bonjour ${v.contact},\n\n` +
      `La date du match à l'extérieur ${v.opp} – ${v.kscw} est confirmée :\n${v.date}${v.time ? `, ${v.time}` : ''}.\n\n` +
      `Merci de saisir cette date dans VolleyManager (Swiss Volley) ; nous saisirons nous-mêmes le match à domicile.\n\n` +
      `Merci et cordiales salutations sportives\nKSC Wiedikon`,
  },
  it: {
    homeSubject: 'Partita in casa prenotata – KSC Wiedikon',
    home: (v) =>
      `Ciao ${v.contact},\n\n` +
      `La partita in casa ${v.kscw} – ${v.opp} è prenotata:\n${v.date}, ${v.time}, ${v.hall}.\n\n` +
      `Inseriremo noi questa partita in VolleyManager (Swiss Volley) — per questa non devi fare altro.\n\n` +
      `Cordiali saluti sportivi\nKSC Wiedikon`,
    homePropSubject: 'Proposte di slot per la partita in casa ricevute – KSC Wiedikon',
    homeProp: (v) =>
      `Ciao ${v.contact},\n\n` +
      `Abbiamo ricevuto le tue proposte di slot per la partita in casa ${v.kscw} – ${v.opp} (nella nostra palestra):\n${v.list}\n\n` +
      `Nota: questi slot non sono ancora riservati — ne confermeremo uno e ti faremo sapere. Uno slot proposto potrebbe nel frattempo essere assegnato ad altri.\n\n` +
      `Cordiali saluti sportivi\nKSC Wiedikon`,
    reproposalSubject: 'Nuovi slot per la partita in casa necessari – KSC Wiedikon',
    reproposal: (v) =>
      `Ciao ${v.contact},\n\n` +
      `Purtroppo gli slot che hai proposto per la partita in casa ${v.kscw} – ${v.opp} (nella nostra palestra) non sono più disponibili.\n\n` +
      `Scegli tre nuovi slot tramite il tuo link:\n${v.url}\n\n` +
      `Grazie e cordiali saluti sportivi\nKSC Wiedikon`,
    propSubject: 'Proposte di date ricevute – KSC Wiedikon',
    prop: (v) =>
      `Ciao ${v.contact},\n\n` +
      `Abbiamo ricevuto le tue proposte di date per la partita in trasferta ${v.opp} – ${v.kscw}:\n${v.list}\n\n` +
      `Ne confermeremo una a breve e ti faremo sapere.\n\n` +
      `Cordiali saluti sportivi\nKSC Wiedikon`,
    confSubject: 'Data della partita confermata – KSC Wiedikon',
    conf: (v) =>
      `Ciao ${v.contact},\n\n` +
      `La data della partita in trasferta ${v.opp} – ${v.kscw} è confermata:\n${v.date}${v.time ? `, ${v.time}` : ''}.\n\n` +
      `Inserisci questa data in VolleyManager (Swiss Volley); la partita in casa la inseriamo noi.\n\n` +
      `Grazie e cordiali saluti sportivi\nKSC Wiedikon`,
  },
}

// gsw → de (formal Swiss correspondence is written in High German).
T.gsw = T.de

// ── HTML layer ──────────────────────────────────────────────────────────────
// Per-language micro-copy for the branded HTML rendering. Each language reuses
// the same plain-text wording above (so meaning never drifts); these strings
// only cover the few labels/headings the layout needs (greeting, title,
// intro/outro sentences, info-card labels, the "not reserved yet" alert and the
// VolleyManager instruction). gsw → de like the text layer.
const H = {
  de: {
    greeting: (n) => (n ? `Hallo ${n},` : 'Hallo,'),
    homeTitle: 'Heimspiel gebucht',
    homeIntro: (v) => `Das Heimspiel ${v.kscw} – ${v.opp} ist gebucht.`,
    homeVm: 'Dieses Spiel tragen wir im VolleyManager (Swiss Volley) ein – du musst dafür nichts weiter tun.',
    homePropTitle: 'Heimspiel-Vorschläge erhalten',
    homePropIntro: (v) => `Wir haben deine Slot-Vorschläge für das Heimspiel ${v.kscw} – ${v.opp} (in unserer Halle) erhalten:`,
    homePropAlertTitle: 'Noch nicht reserviert',
    homePropAlert: 'Diese Slots sind noch nicht reserviert – wir bestätigen einen davon und melden uns. Ein vorgeschlagener Slot kann zwischenzeitlich anderweitig vergeben werden.',
    reproposalTitle: 'Neue Heimspiel-Slots benötigt',
    reproposalIntro: (v) => `Leider sind deine vorgeschlagenen Slots für das Heimspiel ${v.kscw} – ${v.opp} (in unserer Halle) nicht mehr verfügbar. Bitte wähle drei neue Slots aus.`,
    reproposalCta: 'Drei neue Slots wählen',
    propTitle: 'Terminvorschläge erhalten',
    propIntro: (v) => `Wir haben deine Terminvorschläge für das Auswärtsspiel ${v.opp} – ${v.kscw} erhalten:`,
    propOutro: 'Wir bestätigen einen Termin in Kürze und melden uns wieder.',
    confTitle: 'Spieltermin bestätigt',
    confIntro: (v) => `Der Termin für das Auswärtsspiel ${v.opp} – ${v.kscw} ist bestätigt:`,
    confVm: 'Bitte trage diesen Termin im VolleyManager (Swiss Volley) ein. Das Heimspiel tragen wir selbst ein.',
    signoff: 'Sportliche Grüsse, KSC Wiedikon',
    lblDate: 'Datum', lblTime: 'Zeit', lblHall: 'Halle', lblSlot: 'Slot', lblGame: 'Spiel',
  },
  en: {
    greeting: (n) => (n ? `Hello ${n},` : 'Hello,'),
    homeTitle: 'Home game booked',
    homeIntro: (v) => `The home game ${v.kscw} – ${v.opp} is booked.`,
    homeVm: "We'll enter this game in VolleyManager (Swiss Volley) — nothing further needed from you for this one.",
    homePropTitle: 'Home-game slot proposals received',
    homePropIntro: (v) => `We've received your slot proposals for the home game ${v.kscw} – ${v.opp} (in our hall):`,
    homePropAlertTitle: 'Not reserved yet',
    homePropAlert: "These slots are not reserved yet — we'll confirm one and get back to you. A proposed slot may be taken by someone else in the meantime.",
    reproposalTitle: 'New home-game slots needed',
    reproposalIntro: (v) => `Unfortunately the slots you proposed for the home game ${v.kscw} – ${v.opp} (in our hall) are no longer available. Please pick three new slots.`,
    reproposalCta: 'Pick three new slots',
    propTitle: 'Date proposals received',
    propIntro: (v) => `We've received your proposed dates for the away game ${v.opp} – ${v.kscw}:`,
    propOutro: "We'll confirm one shortly and get back to you.",
    confTitle: 'Game date confirmed',
    confIntro: (v) => `The date for the away game ${v.opp} – ${v.kscw} is confirmed:`,
    confVm: "Please enter this date in VolleyManager (Swiss Volley); we'll enter the home game ourselves.",
    signoff: 'Best regards, KSC Wiedikon',
    lblDate: 'Date', lblTime: 'Time', lblHall: 'Hall', lblSlot: 'Slot', lblGame: 'Game',
  },
  fr: {
    greeting: (n) => (n ? `Bonjour ${n},` : 'Bonjour,'),
    homeTitle: 'Match à domicile réservé',
    homeIntro: (v) => `Le match à domicile ${v.kscw} – ${v.opp} est réservé.`,
    homeVm: "Nous saisirons ce match dans VolleyManager (Swiss Volley) — rien d'autre à faire de votre côté pour celui-ci.",
    homePropTitle: 'Propositions de créneaux à domicile reçues',
    homePropIntro: (v) => `Nous avons bien reçu vos propositions de créneaux pour le match à domicile ${v.kscw} – ${v.opp} (dans notre salle) :`,
    homePropAlertTitle: 'Pas encore réservés',
    homePropAlert: "Ces créneaux ne sont pas encore réservés — nous en confirmerons un et reviendrons vers vous. Un créneau proposé peut entre-temps être attribué à quelqu'un d'autre.",
    reproposalTitle: 'Nouveaux créneaux à domicile nécessaires',
    reproposalIntro: (v) => `Malheureusement, les créneaux que vous avez proposés pour le match à domicile ${v.kscw} – ${v.opp} (dans notre salle) ne sont plus disponibles. Merci de choisir trois nouveaux créneaux.`,
    reproposalCta: 'Choisir trois nouveaux créneaux',
    propTitle: 'Propositions de dates reçues',
    propIntro: (v) => `Nous avons bien reçu vos propositions de dates pour le match à l'extérieur ${v.opp} – ${v.kscw} :`,
    propOutro: 'Nous en confirmerons une prochainement et reviendrons vers vous.',
    confTitle: 'Date de match confirmée',
    confIntro: (v) => `La date du match à l'extérieur ${v.opp} – ${v.kscw} est confirmée :`,
    confVm: "Merci de saisir cette date dans VolleyManager (Swiss Volley) ; nous saisirons nous-mêmes le match à domicile.",
    signoff: 'Cordiales salutations sportives, KSC Wiedikon',
    lblDate: 'Date', lblTime: 'Heure', lblHall: 'Salle', lblSlot: 'Créneau', lblGame: 'Match',
  },
  it: {
    greeting: (n) => (n ? `Ciao ${n},` : 'Salve,'),
    homeTitle: 'Partita in casa prenotata',
    homeIntro: (v) => `La partita in casa ${v.kscw} – ${v.opp} è prenotata.`,
    homeVm: 'Inseriremo noi questa partita in VolleyManager (Swiss Volley) — per questa non devi fare altro.',
    homePropTitle: 'Proposte di slot per la partita in casa ricevute',
    homePropIntro: (v) => `Abbiamo ricevuto le tue proposte di slot per la partita in casa ${v.kscw} – ${v.opp} (nella nostra palestra):`,
    homePropAlertTitle: 'Non ancora riservati',
    homePropAlert: 'Questi slot non sono ancora riservati — ne confermeremo uno e ti faremo sapere. Uno slot proposto potrebbe nel frattempo essere assegnato ad altri.',
    reproposalTitle: 'Nuovi slot per la partita in casa necessari',
    reproposalIntro: (v) => `Purtroppo gli slot che hai proposto per la partita in casa ${v.kscw} – ${v.opp} (nella nostra palestra) non sono più disponibili. Scegli tre nuovi slot.`,
    reproposalCta: 'Scegli tre nuovi slot',
    propTitle: 'Proposte di date ricevute',
    propIntro: (v) => `Abbiamo ricevuto le tue proposte di date per la partita in trasferta ${v.opp} – ${v.kscw}:`,
    propOutro: 'Ne confermeremo una a breve e ti faremo sapere.',
    confTitle: 'Data della partita confermata',
    confIntro: (v) => `La data della partita in trasferta ${v.opp} – ${v.kscw} è confermata:`,
    confVm: 'Inserisci questa data in VolleyManager (Swiss Volley); la partita in casa la inseriamo noi.',
    signoff: 'Cordiali saluti sportivi, KSC Wiedikon',
    lblDate: 'Data', lblTime: 'Ora', lblHall: 'Palestra', lblSlot: 'Slot', lblGame: 'Partita',
  },
}
H.gsw = H.de

// Shared paragraph helper for HTML bodies.
const para = (s) => `<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px">${escHtml(s)}</p>`
// Bold paragraph — the text is still escaped; only the <strong> wrapper is raw
// (so the markup renders bold instead of showing literal "<strong>" tags).
const paraStrong = (s) => `<p style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px"><strong>${escHtml(s)}</strong></p>`

// Render the structured slot rows ({ date, time, hall }) as one info card with a
// label per row (Slot 1 / Slot 2 / …). Falls back to nothing if no rows.
function slotsCard(h, slots) {
  const rows = (Array.isArray(slots) ? slots : []).map((s, i) => {
    const parts = [s.date, s.time].filter(Boolean).join(' ')
    const value = s.hall ? `${parts}, ${s.hall}` : parts
    return { label: `${h.lblSlot} ${i + 1}`, value }
  })
  return buildInfoCard(rows)
}

function buildHtml(lang, kind, vars) {
  const h = H[lang] || H.de
  const greeting = h.greeting(vars.contact || '')
  let title = ''
  let body = ''
  let ctaUrl = null
  let ctaLabel = null

  if (kind === 'home_booked') {
    title = h.homeTitle
    const card = buildInfoCard([
      { label: h.lblGame, value: `${vars.kscw} – ${vars.opp}` },
      { label: h.lblDate, value: vars.date || '', halfWidth: true },
      { label: h.lblTime, value: vars.time || '', halfWidth: true },
      { label: h.lblHall, value: vars.hall || '' },
    ])
    body = para(h.homeIntro(vars)) + card + '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' + para(h.homeVm)
  } else if (kind === 'home_proposals_sent') {
    title = h.homePropTitle
    body = para(h.homePropIntro(vars)) + slotsCard(h, vars.slots) +
      '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' +
      buildAlertBox('info', h.homePropAlertTitle, h.homePropAlert)
  } else if (kind === 'proposals_sent') {
    title = h.propTitle
    body = para(h.propIntro(vars)) + slotsCard(h, vars.slots) +
      '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' + para(h.propOutro)
  } else if (kind === 'home_reproposal_request') {
    title = h.reproposalTitle
    body = para(h.reproposalIntro(vars))
    ctaUrl = vars.url || null
    ctaLabel = h.reproposalCta
  } else {
    // game_confirmed
    title = h.confTitle
    const rows = [{ label: h.lblGame, value: `${vars.opp} – ${vars.kscw}` }, { label: h.lblDate, value: vars.date || '' }]
    if (vars.time) rows.push({ label: h.lblTime, value: vars.time })
    body = para(h.confIntro(vars)) + buildInfoCard(rows) +
      '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' + para(h.confVm)
  }

  return buildEmailLayout(body, {
    title,
    sport: 'vb',
    greeting,
    footerExtra: h.signoff,
    signatureHtml: buildSchedSignatureRows(lang),
    ...(ctaUrl && ctaLabel ? { ctaUrl, ctaLabel } : {}),
  })
}

/**
 * Build a transactional email for the opponent flow.
 * @param {string} lang  opponent language (de/gsw/en/fr/it), falls back to de
 * @param {'home_booked'|'home_proposals_sent'|'proposals_sent'|'home_reproposal_request'|'game_confirmed'} kind
 * @param {object} vars  { contact, kscw, opp, date, time, hall, list, slots, url }
 *   - `list`  plain-text `• …` block for the text fallback
 *   - `slots` structured rows [{ date, time, hall }] for the HTML info card
 * @returns {{ subject: string, text: string, html: string }}
 */
export function schedEmail(lang, kind, vars) {
  const t = T[lang] || T.de
  let subject, text
  if (kind === 'home_booked') { subject = t.homeSubject; text = t.home(vars) }
  else if (kind === 'home_proposals_sent') { subject = t.homePropSubject; text = t.homeProp(vars) }
  else if (kind === 'proposals_sent') { subject = t.propSubject; text = t.prop(vars) }
  else if (kind === 'home_reproposal_request') { subject = t.reproposalSubject; text = t.reproposal(vars) }
  else { subject = t.confSubject; text = t.conf(vars) }
  const html = buildHtml(lang, kind, vars)
  return { subject, text, html }
}

/**
 * Build the opponent INVITE email — the first contact, sent before the club has
 * picked a language. Unlike schedEmail it is BILINGUAL (German + English) since
 * the recipient is a Swiss volleyball club whose language we don't know yet.
 * Mirrors the in-app mailto draft wording (inviteEmailTemplate.ts).
 *
 * @param {object} vars { contact, kscw, league, season, url, expires }
 *   - contact  recipient name(s) for the greeting (may be a comma-joined list)
 *   - kscw     KSCW team name, league  the KSCW team this club plays
 *   - season   season label (e.g. "2026/27")
 *   - url      tokenized invite link
 *   - expires  pre-formatted dd.mm.yyyy expiry (optional)
 * @returns {{ subject: string, text: string, html: string }}
 */
export function inviteEmail(vars) {
  const { kscw = '', league = '', season = '', url = '', expires = '', opponent = '', reminder = false, club = false } = vars || {}
  const team = league ? `${kscw} (${league})` : kscw
  // Club-portal invites (one link per opponent club, covering all their teams vs
  // KSCW) phrase the match line club-wide instead of naming a single KSCW team.
  const matchDe = club ? 'gegen alle unsere Teams' : `gegen unser Team ${team}`
  const matchEn = club ? 'against all our teams' : `against our team ${team}`
  // Reminder sends add an "ignore if you're already set" line — they go to clubs
  // that may already have scheduled everything (the tool computes who's still
  // open, but a club can have arranged a game outside the tool).
  const remDe = 'Falls bei euch bereits alles geplant ist, kannst du diese E-Mail ignorieren.'
  const remEn = 'If everything is already scheduled on your side, please ignore this email.'
  // Per-opponent subject so the spielplaner can tell at a glance which invite went
  // to whom, e.g. "Spielplanung - KSCW D1 / Rüschlikon 2". Club portals are keyed
  // by the whole club: "Spielplanung - KSC Wiedikon / <club>". Falls back to the
  // generic season subject when the names aren't available.
  const subject = club
    ? (opponent
        ? `Spielplanung - KSC Wiedikon / ${opponent}`.trim()
        : `KSC Wiedikon – Spielplanung / Game scheduling ${season}`.trim())
    : (kscw && opponent)
    ? `Spielplanung - KSCW ${kscw} / ${opponent}`.trim()
    : `KSC Wiedikon – Spielplanung / Game scheduling ${season}`.trim()

  // Generic greeting (no name): contact_email may list several club contacts,
  // so a single recipient name would be wrong for the rest.
  const text =
    `Hallo,\n\n` +
    `KSC Wiedikon lädt euch zur Spielplanung der Saison ${season} ein – ${matchDe}.\n\n` +
    `Unter folgendem Link könnt ihr eure Heim- und Auswärtsspieltermine auswählen:\n${url}\n\n` +
    (expires ? `Der Link ist bis ${expires} gültig.\n` : '') +
    (reminder ? `${remDe}\n\n` : '') +
    `Bei Fragen antwortet einfach auf diese E-Mail.\n\n` +
    `Sportliche Grüsse\nKSC Wiedikon\n\n` +
    `— — — — —\n\n` +
    `Hello,\n\n` +
    `KSC Wiedikon invites you to schedule your home and away matches for the ${season} season ${matchEn}.\n\n` +
    `Open the link below to pick your slots:\n${url}\n\n` +
    (expires ? `This link is valid until ${expires}.\n` : '') +
    (reminder ? `${remEn}\n\n` : '') +
    `If you have any questions, just reply to this email.\n\n` +
    `Best regards\nKSC Wiedikon`

  const body =
    para(`KSC Wiedikon lädt euch zur Spielplanung der Saison ${season} ein – ${matchDe}. Über den Link unten wählt ihr eure Heim- und Auswärtsspieltermine.`) +
    (reminder ? paraStrong(remDe) : '') +
    (expires ? para(`Der Link ist bis ${expires} gültig. Bei Fragen antwortet einfach auf diese E-Mail.`) : para('Bei Fragen antwortet einfach auf diese E-Mail.')) +
    '<div style="height:10px;font-size:0;line-height:0">&nbsp;</div>' +
    para(`KSC Wiedikon invites you to schedule your home and away matches for the ${season} season ${matchEn}. Use the link below to pick your slots.`) +
    (reminder ? paraStrong(remEn) : '') +
    (expires ? para(`This link is valid until ${expires}. If you have any questions, just reply to this email.`) : para('If you have any questions, just reply to this email.'))

  const html = buildEmailLayout(body, {
    title: 'Spielplanung / Game scheduling',
    sport: 'vb',
    greeting: 'Hallo / Hello,',
    footerExtra: 'Sportliche Grüsse / Best regards · KSC Wiedikon',
    signatureHtml: buildSchedSignatureRows('de'),
    ctaUrl: url,
    ctaLabel: 'Termine auswählen / Pick slots',
  })

  return { subject, text, html }
}

// ── Basketball club portal (ProBasket pre-agreement, WSR Art. 18) ───────────
//
// GERMAN ONLY, and deliberately so. The volleyball invite is bilingual DE/EN
// because SVRZ reaches Romandie clubs; ProBasket is the Nord-Ostschweizer
// Basketballverband and every club in KSCW's 15 groups corresponds in German —
// including the cross-border ones (Feldkirch Baskets, BV Bregenz 1983,
// BBC Schaan). A second language here would be noise, not service.
//
// The business case, verbatim from the association's own invitation
// (Einladung Spielplansitzung 05.09.2026):
//   "WSR Art. 18 Spielplansitzung … Einzige Ausnahme ist, wenn die Spiele bis
//    zur Spielplansitzung, im Einverständnis jeweils beider Klubs, abgemacht
//    wurden und bei der Geschäftsstelle vorliegen. Spiele die bis nach der
//    Spielplansitzung nicht fixiert wurden, werden durch die Betriebsleitung
//    Meisterschaft mit einer Umtriebsgebühr in der Höhe von CHF 50 pro Spiel
//    fixiert."
// And the exclusion, from "Anleitung Spielplanung Vorrunde 2026":
//   "In folgenden Ligen wird dieser Prozess angewandt: − Herren 1. Liga
//    − Damen 1. Liga − Alle interregionalen U14 bis U22 Ligen … Die Klubs
//    liefern bis zum 17. August 2026 dem Verband an info@probasket.ch alle
//    verfügbaren Hallenslots."
// Those leagues are scheduled by ProBasket from that Excel, so the mail says
// outright that they are not covered — a portal there would be dead UI.

/** ProBasket key dates quoted in the copy, dd.mm.yyyy per the KSCW date rule. */
const BB_SPIELPLANSITZUNG = '05.09.2026'
const BB_AVAILABILITY_DUE = '17.08.2026'

/**
 * The basketball club-portal INVITE (and its reminder variant).
 *
 * @param {object} vars
 *   - club     opponent club name (subject line + nothing else; the greeting stays
 *              generic because contact_email may list two addresses)
 *   - season   season label, e.g. "2026/27"
 *   - url      the tokenised portal link
 *   - expires  pre-formatted dd.mm.yyyy expiry (optional)
 *   - reminder true → the follow-up variant
 * @returns {{ subject: string, text: string, html: string }}
 */
export function bbClubInviteEmail(vars) {
  const {
    club = '', season = '', url = '', expires = '', reminder = false,
    // How many free pitches the club can choose from, and how many games we already put to
    // them. The instructions must match what the link actually shows: since the opponent-picks
    // flow (migrations 289/292) most invites open on a list of free dates and NO offers at all,
    // and telling such a club to "confirm or decline each game" describes an empty page.
    pickable = 0, offers = 0,
  } = vars || {}
  const canPick = Number(pickable) > 0
  const hasOffers = Number(offers) > 0
  const subject = club
    ? `Spielplanung ${season} – KSC Wiedikon / ${club}`.trim()
    : `Spielplanung ${season} – KSC Wiedikon`.trim()

  const lead =
    `KSC Wiedikon möchte die Spiele gegen eure Teams wenn möglich schon vor der Spielplansitzung vom ${BB_SPIELPLANSITZUNG} fixieren. ` +
    `Nach WSR Art. 18 entfällt die Anwesenheitspflicht für Spiele, die bis dahin im Einverständnis beider Klubs abgemacht sind und der Geschäftsstelle vorliegen.`
  const rem = 'Falls bei euch bereits alles abgemacht ist, könnt ihr diese E-Mail ignorieren.'
  const linkLead = canPick
    ? 'Unter dem folgenden Link seht ihr, welche Termine in der Kantonsschule Wiedikon für die Spiele gegen eure Teams noch frei sind. Ihr wählt selber aus, welche euch passen.'
    : 'Unter dem folgenden Link findet ihr unsere Heimspieltermine in der Kantonsschule Wiedikon. Ihr könnt jeden Termin bestätigen, ablehnen oder eine Alternative vorschlagen.'

  const pickSteps = [
    'Pro Team die Daten ankreuzen, an denen ihr zu uns kommen könnt.',
    // Said plainly because it is true: the plan row claims the slot immediately.
    'Ein angekreuzter Termin wird sofort für euch reserviert – bitte wählt nur, was ihr wirklich spielen könnt.',
    'Für die Auswärtsspiele bei euch tragt ihr eure Wunschdaten in die Bemerkung ein – wir melden uns dazu.',
  ]
  const answerSteps = [
    'Pro Spiel einen Termin bestätigen oder ablehnen.',
    'Passt kein Termin, schlagt ihr im Feld darunter eine Alternative vor.',
    'Für die Auswärtsspiele bei euch tragt ihr eure Wunschdaten in die Bemerkung ein – wir melden uns dazu.',
  ]
  // Both lists when the club has each kind of row, so no instruction describes a section the
  // link does not show.
  const steps = canPick
    ? (hasOffers ? [...pickSteps.slice(0, 2), ...answerSteps] : pickSteps)
    : answerSteps
  const scope = `Der Link gilt für alle eure Teams gegen KSC Wiedikon${expires ? ` und ist bis ${expires} gültig` : ''}.`
  const exclusion =
    `Nicht enthalten sind die Spiele der Damen 1. Liga und der Herren 1. Liga: Für diese Ligen erstellt ProBasket den Spielplan ` +
    `automatisch aus den bis am ${BB_AVAILABILITY_DUE} gemeldeten Hallenverfügbarkeiten.`
  const fee = `Bis zur Spielplansitzung vom ${BB_SPIELPLANSITZUNG} können wir die Termine ohne Umtriebsgebühr fixieren.`

  const text =
    `Hallo,\n\n` +
    `${lead}\n\n` +
    (reminder ? `${rem}\n\n` : '') +
    `${linkLead}\n${url}\n\n` +
    `So geht ihr vor:\n` +
    steps.map((s) => `• ${s}`).join('\n') + `\n\n` +
    `${scope}\n\n` +
    `${exclusion}\n\n` +
    (reminder ? `${fee}\n\n` : '') +
    `Bei Fragen antwortet einfach auf diese E-Mail.\n\n` +
    `Sportliche Grüsse\nKSC Wiedikon, Spielplanung Basketball`

  const stepsHtml =
    `<ul style="font-size:14px;color:#e2e8f0;line-height:1.6;margin:0 0 12px;padding-left:20px">` +
    steps.map((s) => `<li style="margin:0 0 4px">${escHtml(s)}</li>`).join('') +
    `</ul>`

  const body =
    para(lead) +
    (reminder ? paraStrong(rem) : '') +
    para(linkLead) +
    stepsHtml +
    para(scope) +
    buildAlertBox('info', 'Nicht enthalten: Damen 1. Liga und Herren 1. Liga', exclusion) +
    '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' +
    (reminder ? para(fee) : '') +
    para('Bei Fragen antwortet einfach auf diese E-Mail.')

  const html = buildEmailLayout(body, {
    title: reminder ? 'Spielplanung – Erinnerung' : 'Spielplanung Basketball',
    subtitle: season ? `Saison ${season}` : undefined,
    sport: 'bb',
    greeting: 'Hallo,',
    footerExtra: 'Sportliche Grüsse · KSC Wiedikon',
    signatureHtml: buildSchedSignatureRows('de', 'bb'),
    ctaUrl: url,
    ctaLabel: 'Termine ansehen und bestätigen',
  })

  return { subject, text, html }
}

/**
 * Receipt sent back to the opponent club after they answer in the portal.
 *
 * @param {object} vars
 *   - club  opponent club name
 *   - rows  [{ date, time, hall, game, status }] — all strings, already
 *           Swiss-formatted and already translated to German by the caller
 * @returns {{ subject: string, text: string, html: string }}
 */
export function bbClubResponseReceiptEmail(vars) {
  const { club = '', rows = [] } = vars || {}
  const subject = club
    ? `Rückmeldung erhalten – KSC Wiedikon / ${club}`.trim()
    : 'Rückmeldung erhalten – KSC Wiedikon'
  const lead = 'Danke – wir haben eure Rückmeldung erhalten:'
  const outro = `Die abgemachten Spiele melden wir bis zur Spielplansitzung vom ${BB_SPIELPLANSITZUNG} der Geschäftsstelle.`

  const line = (r) => [[r.date, r.time].filter(Boolean).join(', '), r.hall, r.game, r.status].filter(Boolean).join(' · ')
  const text =
    `Hallo,\n\n` +
    `${lead}\n` +
    rows.map((r) => `• ${line(r)}`).join('\n') + `\n\n` +
    `${outro}\n\n` +
    `Bei Fragen antwortet einfach auf diese E-Mail.\n\n` +
    `Sportliche Grüsse\nKSC Wiedikon, Spielplanung Basketball`

  const card = buildInfoCard(rows.map((r) => ({
    label: [r.date, r.time].filter(Boolean).join(', '),
    value: [r.game, r.hall, r.status].filter(Boolean).join(' · '),
  })))

  const body =
    para(lead) + card +
    '<div style="height:12px;font-size:0;line-height:0">&nbsp;</div>' +
    para(outro) +
    para('Bei Fragen antwortet einfach auf diese E-Mail.')

  const html = buildEmailLayout(body, {
    title: 'Rückmeldung erhalten',
    sport: 'bb',
    greeting: 'Hallo,',
    footerExtra: 'Sportliche Grüsse · KSC Wiedikon',
    signatureHtml: buildSchedSignatureRows('de', 'bb'),
  })

  return { subject, text, html }
}
