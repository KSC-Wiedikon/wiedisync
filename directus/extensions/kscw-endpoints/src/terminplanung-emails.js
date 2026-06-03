/**
 * Transactional email copy for the Terminplanung opponent flow, per language.
 *
 * Opponent-facing emails go out in the language the opponent picked on the
 * public page (game_scheduling_opponents.language). gsw maps to de on purpose:
 * formal Swiss correspondence is written in High German, not dialect.
 *
 * Callers pass already-formatted Swiss date/time strings (dd.mm.yyyy / HH:MM).
 */

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

/**
 * Build a transactional email for the opponent flow.
 * @param {string} lang  opponent language (de/gsw/en/fr/it), falls back to de
 * @param {'home_booked'|'home_proposals_sent'|'proposals_sent'|'game_confirmed'} kind
 * @param {object} vars  { contact, kscw, opp, date, time, hall, list }
 * @returns {{ subject: string, text: string }}
 */
export function schedEmail(lang, kind, vars) {
  const t = T[lang] || T.de
  if (kind === 'home_booked') return { subject: t.homeSubject, text: t.home(vars) }
  if (kind === 'home_proposals_sent') return { subject: t.homePropSubject, text: t.homeProp(vars) }
  if (kind === 'proposals_sent') return { subject: t.propSubject, text: t.prop(vars) }
  return { subject: t.confSubject, text: t.conf(vars) }
}
