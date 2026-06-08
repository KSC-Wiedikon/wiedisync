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
  })
}

/**
 * Build a transactional email for the opponent flow.
 * @param {string} lang  opponent language (de/gsw/en/fr/it), falls back to de
 * @param {'home_booked'|'home_proposals_sent'|'proposals_sent'|'game_confirmed'} kind
 * @param {object} vars  { contact, kscw, opp, date, time, hall, list, slots }
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
  else { subject = t.confSubject; text = t.conf(vars) }
  const html = buildHtml(lang, kind, vars)
  return { subject, text, html }
}
