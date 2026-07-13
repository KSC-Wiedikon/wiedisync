/**
 * Registration Form — unified member registration (VB/BB/Passive)
 * POST /kscw/registration — public, Turnstile protected
 * POST /kscw/registration/:id/files — public, upload ID files after registration
 */

import { buildEmailLayout, buildInfoCard, formatDateCH, bucketEmailsByLocale, escHtml } from './email-template.js'
import { normalizePhone, normalizeIban, normalizeAhv, normalizeEmail } from './normalize.js'
import { BB_SITUATIONS, bbRequiredDocs } from './bb-docs.js'
import crypto from 'crypto'
import { streamManagedFile } from './storage-read.js'

const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET || ''

const OWNER_EMAIL = process.env.OWNER_EMAIL || 'kontakt@kscw.ch'

/**
 * Look up sport admin emails from the members table.
 * VB registration → members with role containing 'vb_admin'
 * BB registration → members with role containing 'bb_admin'
 * Passive / fallback → OWNER_EMAIL
 * Global admins (admin/superuser) are always included.
 */
async function getSportAdminEmails(database, membershipType) {
  const adminRole = membershipType === 'volleyball' ? 'vb_admin'
    : membershipType === 'basketball' ? 'bb_admin'
    : null

  // Get global admins (admin or superuser role) + sport-specific admins
  const rows = await database('members')
    .join('directus_users', 'members.user', 'directus_users.id')
    .whereNotNull('directus_users.email')
    // Migration 156: skip admins who opted out of new-registration emails.
    .where('members.email_notify_registrations', true)
    .andWhere(function () {
      this.whereRaw("members.role::jsonb @> '\"admin\"'")
        .orWhereRaw("members.role::jsonb @> '\"superuser\"'")
      if (adminRole) {
        this.orWhereRaw("members.role::jsonb @> ?", [JSON.stringify(adminRole)])
      }
    })
    .select('directus_users.email')

  const emails = [...new Set(rows.map(r => r.email.toLowerCase()))]
  return emails.length ? emails : [OWNER_EMAIL]
}

async function verifyTurnstile(token) {
  if (!TURNSTILE_SECRET) {
    console.error('[registration] TURNSTILE_SECRET not configured — rejecting request')
    return false
  }
  const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: String(token) }).toString(),
  })
  return (await resp.json()).success === true
}

function generateRefNumber() {
  const now = new Date()
  const y = now.getFullYear()
  const rand = String(1000 + (crypto.randomBytes(2).readUInt16BE(0) % 9000))
  return `REG-${y}-${rand}`
}

// ── Confirmation emails ─────────────────────────────────────────

// ── i18n strings for emails ────────────────────────────────────
// Five locales: de | gsw (Swiss German) | en | fr | it.
// Long bodies (vbBody/bbBody/passiveBody) are paragraph-length;
// short labels follow the field naming convention used elsewhere in the app.
const VB_FEE_LINES = {
  de: 'Erwerbstätige: CHF 440.–<br>Studenten/Studentinnen / Lernende: CHF 380.–<br>Schüler/Schülerinnen (Meisterschaft): CHF 310.–<br>Schüler/Schülerinnen (nur Turniere): CHF 210.–<br>Schüler/Schülerinnen (nur Turniere, 1. Saison): CHF 110.–',
  gsw: 'Erwärbstätigi: CHF 440.–<br>Studänte / Lehrlig: CHF 380.–<br>Schüeler (Meisterschaft): CHF 310.–<br>Schüeler (nur Turnier): CHF 210.–<br>Schüeler (nur Turnier, 1. Saison): CHF 110.–',
  en: 'Working adults: CHF 440.–<br>Students / apprentices: CHF 380.–<br>Pupils (championship): CHF 310.–<br>Pupils (tournaments only): CHF 210.–<br>Pupils (tournaments only, 1st season): CHF 110.–',
  fr: 'Personnes actives : CHF 440.–<br>Étudiant·e·s / apprenti·e·s : CHF 380.–<br>Élèves (championnat) : CHF 310.–<br>Élèves (tournois uniquement) : CHF 210.–<br>Élèves (tournois uniquement, 1ʳᵉ saison) : CHF 110.–',
  it: 'Adulti che lavorano: CHF 440.–<br>Studenti / apprendisti: CHF 380.–<br>Allievi (campionato): CHF 310.–<br>Allievi (solo tornei): CHF 210.–<br>Allievi (solo tornei, 1ª stagione): CHF 110.–',
}

const T = {
  de: {
    greeting: name => `Hallo ${name},`,
    vbTitle: 'Willkommen beim KSC Wiedikon!',
    vbSubtitle: 'Deine Volleyball-Anmeldung ist eingegangen',
    vbSubject: 'Willkommen beim KSC Wiedikon — Volleyball',
    vbFooter: 'Sportliche Grüsse — KSC Wiedikon Volleyball',
    vbFeeHeader: 'Mitgliederbeiträge',
    vbBody: `<p>Bitte beachte, dass der Lizenzierungsprozess ab Zahlung des Mitgliederbeitrags mind. eine Woche dauert.</p>
      <p>Du erhältst in den nächsten Tagen (oder im August, der Hauptrechnungsperiode) eine Rechnung von uns. Deine Lizenz wird erst bestellt, wenn der Beitrag beim KSCW eingetroffen ist — also einfach möglichst bald einzahlen.</p>
      <p>Neu musst du dir unter <a href="https://volleymanager.volleyball.ch/login" style="color:#FFC832">volleymanager.volleyball.ch</a> ein Login erstellen, falls du noch keines besitzt.</p>
      <p>Bei Fragen zum Club, deinem Team oder dem Lizenzierungsprozess kann dir dein Coach oder auch wir gerne Auskunft geben.</p>`,
    bbTitle: 'Anmeldung eingegangen',
    bbSubtitle: 'KSC Wiedikon Basketball',
    bbSubject: 'Anmeldung eingegangen — KSC Wiedikon Basketball',
    bbFooter: 'KSC Wiedikon Basketball',
    bbBody: `<p>Deine Anmeldung wird von unserem Admin-Team geprüft. Du wirst benachrichtigt, sobald sie genehmigt wurde.</p>
      <p><strong style="color:#e2e8f0">Nächste Schritte:</strong></p>
      <ul style="padding-left:20px;margin:8px 0">
        <li>Stelle sicher, dass du deine ID-Kopie (Vorder- und Rückseite) hochgeladen hast</li>
        <li>Der Lizenzantrag wird vom Admin vorbereitet</li>
        <li>Die Bearbeitung dauert in der Regel einige Werktage</li>
      </ul>
      <p>Bei Fragen wende dich an deinen Coach oder an <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>`,
    passiveTitle: 'Passivmitgliedschaft',
    passiveSubtitle: 'Anmeldung eingegangen',
    passiveSubject: 'Passivmitgliedschaft — KSC Wiedikon',
    passiveBody: `<p>Deine Anmeldung als Passivmitglied ist eingegangen und wird geprüft.</p>
      <p>Du erhältst in den nächsten Tagen eine Rechnung für den Passivmitgliederbeitrag (CHF 50.–).</p>
      <p>Bei Fragen erreichst du uns unter <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
    name: 'Name', team: 'Team', fee: 'Beitragskategorie', dob: 'Geburtsdatum',
    email: 'E-Mail', phone: 'Telefon', address: 'Adresse', nationality: 'Nationalität',
    gender: 'Geschlecht', licence: 'Lizenz', refLevel: 'Schiedsrichter-Stufe', ref: 'Referenz',
    adminTitle: 'Neue Anmeldung',
    adminCta: 'Im Admin prüfen',
    adminSubject: (vorname, nachname, type) => `[KSCW] Neue Anmeldung: ${vorname} ${nachname} (${type})`,
    adminType: 'Typ', adminAhv: 'AHV', adminKantonsschule: 'Kantonsschule', adminBemerkungen: 'Bemerkungen',
    adminNextSteps: 'Nächste Schritte:',
    adminStep1: 'Daten im Admin-Bereich prüfen und ggf. bearbeiten',
    adminStep2: 'Anmeldung bestätigen oder ablehnen',
    adminStep3: 'Nach Bestätigung wird automatisch eine CSV-Datei generiert',
  },
  gsw: {
    greeting: name => `Hoi ${name},`,
    vbTitle: 'Willkomme bim KSC Wiedikon!',
    vbSubtitle: 'Dini Volleyball-Aamäldig isch agcho',
    vbSubject: 'Willkomme bim KSC Wiedikon — Volleyball',
    vbFooter: 'Sportlichi Grüess — KSC Wiedikon Volleyball',
    vbFeeHeader: 'Mitgliederbyträg',
    vbBody: `<p>Bitte beachte, dass de Lizenzierigsprozess ab dr Zahlig vom Mitgliederbytrag mind. ä Wuche dauert.</p>
      <p>Du überchunsch i de nächste Täg (oder im Auguscht, dr Haupträchnigsperiode) ä Rächnig vo eus. Dini Lizenz wird erst bstellt, wenn de Bytrag bim KSCW aacho isch — also eifach so schnäll wie möglich yzahle.</p>
      <p>Neu muesch dir under <a href="https://volleymanager.volleyball.ch/login" style="color:#FFC832">volleymanager.volleyball.ch</a> ä Login mache, falls du no kä hesch.</p>
      <p>Bi Frage zum Club, dym Team oder em Lizenzierigsprozess cha dir dini Trainerin oder dr Trainer oder au mir gärn Uskunft geh.</p>`,
    bbTitle: 'Aamäldig agcho',
    bbSubtitle: 'KSC Wiedikon Basketball',
    bbSubject: 'Aamäldig agcho — KSC Wiedikon Basketball',
    bbFooter: 'KSC Wiedikon Basketball',
    bbBody: `<p>Dini Aamäldig wird vo eusem Admin-Team prüeft. Du wirsch informiert, sobald si bewilligt isch.</p>
      <p><strong style="color:#e2e8f0">Nächsti Schritt:</strong></p>
      <ul style="padding-left:20px;margin:8px 0">
        <li>Stell sicher, dass du dini ID-Kopie (Vorder- und Rückseite) ufeglade hesch</li>
        <li>De Lizenzaatrag wird vom Admin vorbereitet</li>
        <li>D Bearbeitig dauert i de Regle ä paar Werchtäg</li>
      </ul>
      <p>Bi Frage chunsch zu dym Coach oder a <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>`,
    passiveTitle: 'Passivmitgliedschaft',
    passiveSubtitle: 'Aamäldig agcho',
    passiveSubject: 'Passivmitgliedschaft — KSC Wiedikon',
    passiveBody: `<p>Dini Aamäldig als Passivmitglied isch agcho und wird prüeft.</p>
      <p>Du überchunsch i de nächste Täg ä Rächnig für de Passivmitgliedsbytrag (CHF 50.–).</p>
      <p>Bi Frage erreichsch eus under <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
    name: 'Name', team: 'Team', fee: 'Bytragskategorie', dob: 'Geburtsdatum',
    email: 'E-Mail', phone: 'Telefon', address: 'Adrässe', nationality: 'Nationalität',
    gender: 'Gschlächt', licence: 'Lizenz', refLevel: 'Schiedsrichter-Stuefe', ref: 'Referenz',
    adminTitle: 'Neui Aamäldig',
    adminCta: 'Im Admin prüefe',
    adminSubject: (vorname, nachname, type) => `[KSCW] Neui Aamäldig: ${vorname} ${nachname} (${type})`,
    adminType: 'Typ', adminAhv: 'AHV', adminKantonsschule: 'Kantonsschuel', adminBemerkungen: 'Bemerkige',
    adminNextSteps: 'Nächsti Schritt:',
    adminStep1: 'Date im Admin-Bereich prüefe und ev. bearbeite',
    adminStep2: 'Aamäldig bestätige oder abläne',
    adminStep3: 'Noch dr Bestätigig wird automatisch ä CSV-Datei gmacht',
  },
  en: {
    greeting: name => `Hello ${name},`,
    vbTitle: 'Welcome to KSC Wiedikon!',
    vbSubtitle: 'Your volleyball registration has been received',
    vbSubject: 'Welcome to KSC Wiedikon — Volleyball',
    vbFooter: 'Best regards — KSC Wiedikon Volleyball',
    vbFeeHeader: 'Membership Fees',
    vbBody: `<p>Please note that the licensing process takes at least one week after payment of the membership fee.</p>
      <p>You will receive an invoice from us in the next few days (or in August, the main billing period). Your licence will only be ordered once the fee has been received by KSCW — so please pay as soon as possible.</p>
      <p>You also need to create a login at <a href="https://volleymanager.volleyball.ch/login" style="color:#FFC832">volleymanager.volleyball.ch</a> if you don't have one yet.</p>
      <p>For questions about the club, your team or the licensing process, your coach or we are happy to help.</p>`,
    bbTitle: 'Registration received',
    bbSubtitle: 'KSC Wiedikon Basketball',
    bbSubject: 'Registration received — KSC Wiedikon Basketball',
    bbFooter: 'KSC Wiedikon Basketball',
    bbBody: `<p>Your registration will be reviewed by our admin team. You will be notified once it has been approved.</p>
      <p><strong style="color:#e2e8f0">Next steps:</strong></p>
      <ul style="padding-left:20px;margin:8px 0">
        <li>Make sure you have uploaded your ID copy (front and back)</li>
        <li>The licence application will be prepared by the admin</li>
        <li>Processing usually takes a few business days</li>
      </ul>
      <p>For questions, contact your coach or <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>`,
    passiveTitle: 'Passive Membership',
    passiveSubtitle: 'Registration received',
    passiveSubject: 'Passive Membership — KSC Wiedikon',
    passiveBody: `<p>Your registration as a passive member has been received and will be reviewed.</p>
      <p>You will receive an invoice for the passive membership fee (CHF 50.–) in the next few days.</p>
      <p>For questions, reach us at <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
    name: 'Name', team: 'Team', fee: 'Fee Category', dob: 'Date of Birth',
    email: 'Email', phone: 'Phone', address: 'Address', nationality: 'Nationality',
    gender: 'Sex', licence: 'Licence', refLevel: 'Referee Level', ref: 'Reference',
    adminTitle: 'New Registration',
    adminCta: 'Review in admin',
    adminSubject: (vorname, nachname, type) => `[KSCW] New registration: ${vorname} ${nachname} (${type})`,
    adminType: 'Type', adminAhv: 'AHV', adminKantonsschule: 'Cantonal School', adminBemerkungen: 'Notes',
    adminNextSteps: 'Next steps:',
    adminStep1: 'Review the data in the admin area and edit if needed',
    adminStep2: 'Approve or reject the registration',
    adminStep3: 'After approval, a CSV file is automatically generated',
  },
  fr: {
    greeting: name => `Salut ${name},`,
    vbTitle: 'Bienvenue au KSC Wiedikon !',
    vbSubtitle: 'Ton inscription en volleyball a été reçue',
    vbSubject: 'Bienvenue au KSC Wiedikon — Volleyball',
    vbFooter: 'Salutations sportives — KSC Wiedikon Volleyball',
    vbFeeHeader: 'Cotisations',
    vbBody: `<p>Note que la procédure de licence prend au minimum une semaine à partir du paiement de la cotisation.</p>
      <p>Tu recevras une facture de notre part dans les prochains jours (ou en août, la principale période de facturation). Ta licence ne sera commandée qu'une fois la cotisation reçue par le KSCW — donc paie aussi vite que possible.</p>
      <p>Tu dois en plus te créer un compte sur <a href="https://volleymanager.volleyball.ch/login" style="color:#FFC832">volleymanager.volleyball.ch</a> si tu n'en as pas encore.</p>
      <p>Pour toute question sur le club, ton équipe ou la procédure de licence, ton coach ou nous-mêmes te répondrons volontiers.</p>`,
    bbTitle: 'Inscription reçue',
    bbSubtitle: 'KSC Wiedikon Basketball',
    bbSubject: 'Inscription reçue — KSC Wiedikon Basketball',
    bbFooter: 'KSC Wiedikon Basketball',
    bbBody: `<p>Ta candidature sera examinée par notre équipe d'administration. Tu seras notifié·e dès qu'elle sera approuvée.</p>
      <p><strong style="color:#e2e8f0">Prochaines étapes :</strong></p>
      <ul style="padding-left:20px;margin:8px 0">
        <li>Assure-toi d'avoir téléchargé la copie de ta pièce d'identité (recto et verso)</li>
        <li>La demande de licence sera préparée par l'administrateur</li>
        <li>Le traitement prend généralement quelques jours ouvrables</li>
      </ul>
      <p>Pour toute question, contacte ton coach ou <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>`,
    passiveTitle: 'Membre passif·ve',
    passiveSubtitle: 'Inscription reçue',
    passiveSubject: 'Membre passif·ve — KSC Wiedikon',
    passiveBody: `<p>Ton inscription comme membre passif·ve a été reçue et sera examinée.</p>
      <p>Tu recevras dans les prochains jours une facture pour la cotisation de membre passif·ve (CHF 50.–).</p>
      <p>Pour toute question, écris-nous à <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
    name: 'Nom', team: 'Équipe', fee: 'Catégorie de cotisation', dob: 'Date de naissance',
    email: 'E-mail', phone: 'Téléphone', address: 'Adresse', nationality: 'Nationalité',
    gender: 'Sexe', licence: 'Licence', refLevel: "Niveau d'arbitrage", ref: 'Référence',
    adminTitle: 'Nouvelle inscription',
    adminCta: "Vérifier dans l'admin",
    adminSubject: (vorname, nachname, type) => `[KSCW] Nouvelle inscription : ${vorname} ${nachname} (${type})`,
    adminType: 'Type', adminAhv: 'AVS', adminKantonsschule: 'École cantonale', adminBemerkungen: 'Remarques',
    adminNextSteps: 'Prochaines étapes :',
    adminStep1: "Vérifier les données dans l'espace admin et les modifier si nécessaire",
    adminStep2: "Approuver ou refuser l'inscription",
    adminStep3: 'Après approbation, un fichier CSV est généré automatiquement',
  },
  it: {
    greeting: name => `Ciao ${name},`,
    vbTitle: 'Benvenuto al KSC Wiedikon!',
    vbSubtitle: 'La tua iscrizione al volleyball è stata ricevuta',
    vbSubject: 'Benvenuto al KSC Wiedikon — Volleyball',
    vbFooter: 'Saluti sportivi — KSC Wiedikon Volleyball',
    vbFeeHeader: 'Quote associative',
    vbBody: `<p>Tieni presente che il processo di licenza richiede almeno una settimana a partire dal pagamento della quota associativa.</p>
      <p>Riceverai una fattura da noi nei prossimi giorni (o in agosto, il principale periodo di fatturazione). La tua licenza verrà ordinata solo dopo che la quota sarà stata ricevuta dal KSCW — quindi paga il prima possibile.</p>
      <p>Devi inoltre creare un account su <a href="https://volleymanager.volleyball.ch/login" style="color:#FFC832">volleymanager.volleyball.ch</a> se non ne hai già uno.</p>
      <p>Per domande sul club, sulla tua squadra o sul processo di licenza, il tuo coach o noi stessi ti risponderemo volentieri.</p>`,
    bbTitle: 'Iscrizione ricevuta',
    bbSubtitle: 'KSC Wiedikon Basketball',
    bbSubject: 'Iscrizione ricevuta — KSC Wiedikon Basketball',
    bbFooter: 'KSC Wiedikon Basketball',
    bbBody: `<p>La tua iscrizione sarà esaminata dal nostro team di amministrazione. Riceverai una notifica non appena sarà approvata.</p>
      <p><strong style="color:#e2e8f0">Prossimi passi:</strong></p>
      <ul style="padding-left:20px;margin:8px 0">
        <li>Assicurati di aver caricato la copia del tuo documento d'identità (fronte e retro)</li>
        <li>La richiesta di licenza sarà preparata dall'amministratore</li>
        <li>L'elaborazione richiede di solito alcuni giorni lavorativi</li>
      </ul>
      <p>Per domande, contatta il tuo coach o <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>`,
    passiveTitle: 'Socio passivo',
    passiveSubtitle: 'Iscrizione ricevuta',
    passiveSubject: 'Socio passivo — KSC Wiedikon',
    passiveBody: `<p>La tua iscrizione come socio passivo è stata ricevuta e sarà esaminata.</p>
      <p>Riceverai nei prossimi giorni una fattura per la quota di socio passivo (CHF 50.–).</p>
      <p>Per domande scrivici a <a href="mailto:kontakt@kscw.ch" style="color:#4A55A2">kontakt@kscw.ch</a>.</p>`,
    name: 'Nome', team: 'Squadra', fee: 'Categoria quota', dob: 'Data di nascita',
    email: 'E-mail', phone: 'Telefono', address: 'Indirizzo', nationality: 'Nazionalità',
    gender: 'Sesso', licence: 'Licenza', refLevel: 'Livello arbitrale', ref: 'Riferimento',
    adminTitle: 'Nuova iscrizione',
    adminCta: "Verifica nell'admin",
    adminSubject: (vorname, nachname, type) => `[KSCW] Nuova iscrizione: ${vorname} ${nachname} (${type})`,
    adminType: 'Tipo', adminAhv: 'AVS', adminKantonsschule: 'Scuola cantonale', adminBemerkungen: 'Note',
    adminNextSteps: 'Prossimi passi:',
    adminStep1: "Verifica i dati nell'area admin e modificali se necessario",
    adminStep2: "Approva o rifiuta l'iscrizione",
    adminStep3: "Dopo l'approvazione, viene generato automaticamente un file CSV",
  },
}

const REG_LOCALES = ['de', 'gsw', 'en', 'fr', 'it']
function t(locale) { return T[locale] || T.de }

// Capitalize the first letter for display. The registration form stores
// free-text gender ("männlich") and the membership_type enum ("basketball")
// in lowercase — both should render capitalized in emails ("Männlich",
// "Basketball"). Returns the input unchanged when falsy/non-string.
function capFirst(s) {
  if (!s || typeof s !== 'string') return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function buildSummaryCard(reg, locale) {
  const l = t(locale)
  const dob = reg.geburtsdatum ? formatDateCH(reg.geburtsdatum) : '-'
  return buildInfoCard([
    { label: l.name, value: `${reg.vorname} ${reg.nachname}`, halfWidth: true },
    { label: l.team, value: reg.team || '-', halfWidth: true },
    { label: l.fee, value: reg.beitragskategorie || '-', halfWidth: true },
    { label: l.dob, value: dob, halfWidth: true },
    { label: l.email, value: reg.email },
    { label: l.phone, value: reg.telefon_mobil || '-' },
    { label: l.address, value: `${reg.adresse || ''}, ${reg.plz || ''} ${reg.ort || ''}` },
    { label: l.nationality, value: reg.nationalitaet || '-', halfWidth: true },
    { label: l.gender, value: capFirst(reg.geschlecht) || '-', halfWidth: true },
    ...(reg.lizenz ? [{ label: l.licence, value: reg.lizenz }] : []),
    ...(reg.schiedsrichter_stufe ? [{ label: l.refLevel, value: reg.schiedsrichter_stufe }] : []),
    { label: l.ref, value: reg.reference_number },
  ])
}

function buildVolleyballEmail(reg, locale) {
  const l = t(locale)
  const summary = buildSummaryCard(reg, locale)

  const feeLines = VB_FEE_LINES[locale] || VB_FEE_LINES.de
  const feeTable = `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;border:1px solid #334155;border-radius:8px;overflow:hidden;margin:12px 0">
  <tr><td style="padding:16px 20px">
    <div style="font-size:11px;text-transform:uppercase;color:#64748b;letter-spacing:0.5px;margin-bottom:8px;font-weight:700">${l.vbFeeHeader}</div>
    <div style="font-size:13px;color:#e2e8f0;line-height:1.8">${feeLines}</div>
  </td></tr>
</table>`

  const body = summary + feeTable + `
<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px;text-align:justify">
  ${l.vbBody}
</div>`

  return buildEmailLayout(body, {
    title: l.vbTitle,
    subtitle: l.vbSubtitle,
    sport: 'volleyball',
    greeting: l.greeting(reg.vorname),
    footerExtra: l.vbFooter,
  })
}

function buildBasketballEmail(reg, locale) {
  const l = t(locale)
  const summary = buildSummaryCard(reg, locale)

  const body = summary + `
<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px;text-align:justify">
  ${l.bbBody}
</div>`

  return buildEmailLayout(body, {
    title: l.bbTitle,
    subtitle: l.bbSubtitle,
    sport: 'basketball',
    greeting: l.greeting(reg.vorname),
    footerExtra: l.bbFooter,
  })
}

function buildPassiveEmail(reg, locale) {
  const l = t(locale)
  const summary = buildInfoCard([
    { label: l.name, value: `${reg.vorname} ${reg.nachname}` },
    { label: l.email, value: reg.email },
    { label: l.phone, value: reg.telefon_mobil || '-' },
    ...(reg.lizenz ? [{ label: l.licence, value: reg.lizenz }] : []),
    ...(reg.schiedsrichter_stufe ? [{ label: l.refLevel, value: reg.schiedsrichter_stufe }] : []),
    { label: l.ref, value: reg.reference_number },
  ])

  const body = summary + `
<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px;text-align:justify">
  ${l.passiveBody}
</div>`

  return buildEmailLayout(body, {
    title: l.passiveTitle,
    subtitle: l.passiveSubtitle,
    greeting: l.greeting(reg.vorname),
    footerExtra: 'KSC Wiedikon',
  })
}

// ── Admin notification email ────────────────────────────────────

function buildAdminNotificationEmail(reg, locale = 'de') {
  const l = t(locale)
  const dob = reg.geburtsdatum ? formatDateCH(reg.geburtsdatum) : '-'
  const sport = reg.membership_type === 'volleyball' ? 'volleyball' : reg.membership_type === 'basketball' ? 'basketball' : null

  const summary = buildInfoCard([
    { label: l.name, value: `${reg.vorname} ${reg.nachname}`, halfWidth: true },
    { label: l.adminType, value: capFirst(reg.membership_type), halfWidth: true },
    { label: l.team, value: reg.team || '-', halfWidth: true },
    { label: l.fee, value: reg.beitragskategorie || '-', halfWidth: true },
    { label: l.email, value: reg.email, halfWidth: true },
    { label: l.phone, value: reg.telefon_mobil || '-', halfWidth: true },
    { label: l.address, value: `${reg.adresse || ''}, ${reg.plz || ''} ${reg.ort || ''}` },
    { label: l.dob, value: dob, halfWidth: true },
    { label: l.nationality, value: reg.nationalitaet || '-', halfWidth: true },
    { label: l.adminAhv, value: reg.ahv_nummer || '-', halfWidth: true },
    { label: l.adminKantonsschule, value: reg.kantonsschule || '-', halfWidth: true },
    ...(reg.lizenz ? [{ label: l.licence, value: reg.lizenz }] : []),
    ...(reg.schiedsrichter_stufe ? [{ label: l.refLevel, value: reg.schiedsrichter_stufe }] : []),
    { label: l.ref, value: reg.reference_number },
  ])

  const instructions = `
<div style="font-size:13px;color:#94a3b8;line-height:1.7;margin-top:12px">
  <p><strong style="color:#e2e8f0">${l.adminNextSteps}</strong></p>
  <ol style="padding-left:20px;margin:8px 0">
    <li>${l.adminStep1}</li>
    <li>${l.adminStep2}</li>
    <li>${l.adminStep3}</li>
  </ol>
</div>`

  const body = summary +
    (reg.bemerkungen ? `<div style="font-size:13px;color:#94a3b8;margin-top:12px"><strong style="color:#e2e8f0">${l.adminBemerkungen}:</strong><br>${escHtml(reg.bemerkungen)}</div>` : '') +
    instructions

  return buildEmailLayout(body, {
    title: l.adminTitle,
    subtitle: `${reg.vorname} ${reg.nachname} — ${capFirst(reg.membership_type)}`,
    sport,
    ctaUrl: 'https://wiedisync.kscw.ch/admin/anmeldungen',
    ctaLabel: l.adminCta,
  })
}

// ── Endpoint ────────────────────────────────────────────────────

// directus_files primary keys are UUIDs — reject anything else so the public
// file-attach route can't point a registration's file columns at an arbitrary
// string value.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Private quarantine folder for registration documents (migration 169; same
// UUID on every environment). Files uploaded via /registration/upload are born
// in here — never folder-less, never anonymous-readable via /assets.
const REGISTRATION_FILES_FOLDER = 'a0000167-0000-4000-8000-000000000001'
const UPLOAD_ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'])
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024
// The registration document columns a member is allowed to view for their own
// (post-approval) registration. Mirrors REGISTRATION_FILE_COLS in kscw-hooks.
const SELF_DOC_FIELDS = [
  'id_upload_front', 'id_upload_back',
  'bb_doc_lizenz', 'bb_doc_freibrief', 'bb_doc_selfdecl',
  'bb_doc_natdecl', 'bb_doc_u18parents', 'bb_doc_schoolcert',
]

export function registerRegistration(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'registration' })

  // ── Member self-view of their own registration documents ────────────────────
  // After approval the registration row is kept and stamped with `member`, so a
  // logged-in member can see the ID / basketball docs they uploaded. Read-only,
  // strictly scoped to the caller's own registration (via members.user →
  // registrations.member); the private folder + file id both come from the
  // caller's own row, so this never widens access to anyone else's files.
  const findSelfRegistration = async (userId) => {
    if (!userId) return null
    const self = await database('members').where('user', userId).select('id').first()
    if (!self) return null
    // Most recent registration linked to this member.
    return database('registrations').where('member', self.id).orderBy('id', 'desc').first()
  }

  // GET /kscw/registration/my-docs — list the caller's own uploaded documents.
  router.get('/registration/my-docs', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })
      const reg = await findSelfRegistration(userId)
      if (!reg) return res.json({ reference_number: null, status: null, docs: [] })
      const ids = SELF_DOC_FIELDS.map((f) => reg[f]).filter(Boolean)
      const files = ids.length
        ? await database('directus_files').whereIn('id', ids).select('id', 'filename_download', 'type', 'filesize')
        : []
      const byId = new Map(files.map((f) => [String(f.id), f]))
      const docs = SELF_DOC_FIELDS
        .filter((f) => reg[f] && byId.has(String(reg[f])))
        .map((f) => {
          const file = byId.get(String(reg[f]))
          return { field: f, filename: file.filename_download || f, type: file.type || null, size: file.filesize ?? null }
        })
      return res.json({ reference_number: reg.reference_number || null, status: reg.status || null, docs })
    } catch (err) {
      log.error({ msg: `registration/my-docs: ${err.message}`, endpoint: 'registration/my-docs', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /kscw/registration/my-docs/:field — stream one of the caller's own docs.
  router.get('/registration/my-docs/:field', async (req, res) => {
    try {
      const userId = req.accountability?.user
      if (!userId) return res.status(401).json({ error: 'Unauthorized' })
      const field = String(req.params.field || '')
      if (!SELF_DOC_FIELDS.includes(field)) return res.status(400).json({ error: 'Invalid document' })
      const reg = await findSelfRegistration(userId)
      const fileId = reg?.[field]
      if (!fileId) return res.status(404).json({ error: 'Not found' })
      // The id came from the caller's own registration; also pin the private
      // folder so a mismatched/repointed id can't reach an unrelated file.
      const row = await database('directus_files')
        .where({ id: fileId, folder: REGISTRATION_FILES_FOLDER })
        .first('id', 'filename_disk', 'filename_download', 'type')
      if (!row || !row.filename_disk) return res.status(404).json({ error: 'Not found' })
      // Read through the storage abstraction, not the local disk: it resolves the driver
      // from directus_files.storage per row, so this keeps working when uploads move to R2.
      await streamManagedFile(
        row.id,
        { services, getSchema, database },
        res,
        { filename: row.filename_download || field, type: row.type },
      )
      return
    } catch (err) {
      if (err?.code === 'ENOENT') return res.status(404).json({ error: 'Not found' })
      log.error({ msg: `registration/my-docs/:field: ${err.message}`, endpoint: 'registration/my-docs', stack: err.stack })
      return res.status(500).json({ error: 'Internal error' })
    }
  })

  // Per-IP throttle for the public /registration/:id/files route. The route
  // authorizes writes by matching a short (~4-digit) reference_number, so without
  // a limiter an attacker could brute-force references and overwrite a victim's
  // uploaded ID/document file pointers (IDOR). 10 attempts / 10 min per IP, with
  // a tighter lockout once reference mismatches (the brute-force signal) pile up.
  const fileAttachIp = new Map() // ip → { count, resetAt, mismatches }

  // Per-IP throttle for the public /registration create route. Turnstile already
  // gates it, but each accepted submission fans out several staff/owner
  // notification emails — a solved or misconfigured Turnstile shouldn't turn that
  // into an email amplifier. Defense-in-depth: 5 submissions / 10 min per IP.
  const registerIp = new Map() // ip → { count, resetAt }

  // POST /kscw/registration — create new registration
  router.post('/registration', async (req, res) => {
    try {
      const body = req.body
      if (!body || !body.vorname || !body.nachname || !body.email || !body.membership_type) {
        return res.status(400).json({ error: 'vorname, nachname, email, membership_type required' })
      }

      // ── Contact-data guards (2026-07-07) — reject un-normalizable values at the
      // door and store the CANONICAL form (normalize.js), so both databases stay
      // standardized (INFRA.md → "Contact-data normalization rule"). Messages are
      // localized: they reach real users via the public form (which mirrors these
      // checks client-side — server = bypass/stale-cache backstop).
      const isEn = body.locale === 'en'
      const emailNorm = normalizeEmail(body.email)
      if (!emailNorm.ok || !emailNorm.value) {
        return res.status(400).json({ error: 'Invalid email format' })
      }
      const phoneNorm = normalizePhone(body.telefon_mobil)
      if (!phoneNorm.ok) {
        return res.status(400).json({
          error: isEn
            ? 'Please check the phone number — it does not look like a valid number.'
            : 'Bitte überprüfe die Telefonnummer — sie scheint ungültig zu sein.',
          code: 'invalid_phone',
        })
      }
      const ahvNorm = normalizeAhv(body.ahv_nummer)
      if (!ahvNorm.ok) {
        return res.status(400).json({
          error: isEn
            ? 'Please check the AHV number (format 756.XXXX.XXXX.XX) — the check digit does not match.'
            : 'Bitte überprüfe die AHV-Nummer (Format 756.XXXX.XXXX.XX) — die Prüfziffer stimmt nicht.',
          code: 'invalid_ahv',
        })
      }
      // IBAN is OPTIONAL and used only to pay money back (reimbursements) —
      // registrations.iban, migration 185.
      const ibanNorm = normalizeIban(body.iban)
      if (!ibanNorm.ok) {
        return res.status(400).json({
          error: isEn
            ? 'Please check the IBAN — it is not a valid account number.'
            : 'Bitte überprüfe die IBAN — sie ist keine gültige Kontonummer.',
          code: 'invalid_iban',
        })
      }

      const validTypes = ['volleyball', 'basketball', 'passive']
      if (!validTypes.includes(body.membership_type)) {
        return res.status(400).json({ error: 'Invalid membership_type' })
      }

      // AHV requiredness mirror (the form enforces it client-side): active VB
      // members under 23 and BB members under 25 need an AHV number for the
      // association licence. Server-side so a bypassed/stale form can't create
      // a licence-blocked registration.
      if (!ahvNorm.value && body.geburtsdatum && ['volleyball', 'basketball'].includes(body.membership_type)) {
        const dob = new Date(body.geburtsdatum)
        if (!Number.isNaN(dob.getTime())) {
          const now = new Date()
          let age = now.getFullYear() - dob.getFullYear()
          const m = now.getMonth() - dob.getMonth()
          if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--
          const limit = body.membership_type === 'volleyball' ? 23 : 25
          if (age < limit) {
            return res.status(400).json({
              error: isEn
                ? 'The AHV number is required for the licence at your age.'
                : 'Die AHV-Nummer ist für die Lizenz in deinem Alter erforderlich.',
              code: 'ahv_required',
            })
          }
        }
      }

      // Per-IP rate limit (defense-in-depth behind Turnstile — each submission
      // fans out several notification emails). cf-connecting-ip is the real
      // client IP; the leftmost XFF value is attacker-spoofable behind CF.
      const xff = req.headers['x-forwarded-for']
      const ip = req.headers['cf-connecting-ip']
        || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
        || req.ip || 'unknown'
      const now = Date.now()
      const regEntry = registerIp.get(ip)
      if (regEntry && now < regEntry.resetAt) {
        if (regEntry.count >= 5) return res.status(429).json({ error: 'Too many requests. Please try again later.' })
        regEntry.count++
      } else {
        registerIp.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 })
      }
      if (registerIp.size > 1000) {
        for (const [k, v] of registerIp) { if (now > v.resetAt) registerIp.delete(k) }
      }

      if (!body.turnstile_token || !(await verifyTurnstile(body.turnstile_token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
      }

      // Server-side document enforcement (basketball): the registration is only
      // created once the required documents are already uploaded to /files and
      // their UUIDs arrive WITH the create payload — closes the create-before-
      // upload gap that stranded REG-2026-5041 doc-less (2026-07-04, Safari
      // upload failure after the row was committed). Required: ID front/back +
      // signed licence application; non-Swiss additionally the FIBA self
      // declaration + national team declaration (5 total). Mirrors the client
      // gate in kscw-website registration-form.js — same rule for every
      // basketball function, as on the form.
      const docId = (v) => (typeof v === 'string' && UUID_RE.test(v)) ? v : null
      const docs = {
        id_upload_front: docId(body.id_upload_front),
        id_upload_back: docId(body.id_upload_back),
        bb_doc_lizenz: docId(body.bb_doc_lizenz),
        bb_doc_freibrief: docId(body.bb_doc_freibrief),
        bb_doc_selfdecl: docId(body.bb_doc_selfdecl),
        bb_doc_natdecl: docId(body.bb_doc_natdecl),
        bb_doc_u18parents: docId(body.bb_doc_u18parents),
        bb_doc_schoolcert: docId(body.bb_doc_schoolcert),
      }
      const bbSituation = BB_SITUATIONS.includes(body.bb_situation) ? body.bb_situation : null
      if (body.membership_type === 'basketball') {
        const natCode = (body.nationalitaet_code || '').trim().toUpperCase().slice(0, 2)
        // Situation + nationality + age drive the required set (school certificate
        // is optional → never required). Mirrors the client gate.
        const required = bbRequiredDocs(bbSituation, natCode, body.geburtsdatum)
        const missing = required.filter((k) => !docs[k])
        if (missing.length) {
          // Localized: this message reaches users on a STALE cached form JS
          // (pre-eager-upload, sends no doc ids) — tell them to reload so the
          // new bundle takes over.
          const msg = body.locale === 'en'
            ? 'Required documents missing. Please reload the page and try again.'
            : 'Erforderliche Dokumente fehlen. Bitte lade die Seite neu und versuche es erneut.'
          return res.status(400).json({ error: msg, code: 'docs_required', missing })
        }
      }
      // Provided doc ids must be REAL files that already live in the PRIVATE
      // registration folder — i.e. produced by /registration/upload. Without the
      // folder scope a caller could pass the UUID of any PUBLIC asset (team photo,
      // sponsor logo, harvested from /assets), and the quarantine hook would then
      // move that public file into the private folder (breaking the public read)
      // and the orphan sweep would eventually delete it. Anonymous data loss.
      const providedDocIds = [...new Set(Object.values(docs).filter(Boolean))]
      if (providedDocIds.length) {
        const found = await database('directus_files')
          .whereIn('id', providedDocIds)
          .where('folder', REGISTRATION_FILES_FOLDER)
          .count('id as n').first()
        if (Number(found?.n) !== providedDocIds.length) {
          return res.status(400).json({ error: 'Invalid document reference', code: 'docs_invalid' })
        }
      }

      const reference_number = generateRefNumber()

      const schema = await getSchema()
      const { ItemsService, MailService } = services
      const itemsService = new ItemsService('registrations', { schema, knex: database })

      const id = await itemsService.createOne({
        status: 'pending',
        membership_type: body.membership_type,
        anrede: body.anrede || null,
        vorname: body.vorname.trim(),
        nachname: body.nachname.trim(),
        email: emailNorm.value,
        telefon_mobil: phoneNorm.value,
        adresse: body.adresse || null,
        plz: body.plz || null,
        ort: body.ort || null,
        geburtsdatum: body.geburtsdatum || null,
        nationalitaet: body.nationalitaet || null,
        nationalitaet_code: (body.nationalitaet_code || '').trim().toUpperCase().slice(0, 2) || null,
        geschlecht: body.geschlecht || null,
        ahv_nummer: ahvNorm.value,
        iban: ibanNorm.value,
        team: Array.isArray(body.team) ? body.team.join(', ') : (body.team || null),
        beitragskategorie: body.beitragskategorie || null,
        kantonsschule: body.kantonsschule || null,
        rolle: body.rolle || null,
        lizenz: body.lizenz || null,
        schiedsrichter_stufe: body.schiedsrichter_stufe || null,
        bemerkungen: body.bemerkungen || null,
        locale: body.locale === 'en' ? 'en' : 'de',
        reference_number,
        submitted_at: new Date().toISOString(),
        // Licensing situation (new / Swiss-club transfer / from abroad / returner)
        // — drives the required document set on re-upload + admin review.
        bb_situation: bbSituation,
        // Document file ids arrive with the create since the eager-upload form
        // (v3.3.0); the quarantine hook moves them to the private folder.
        ...docs,
      })

      const reg = await itemsService.readOne(id)

      // Send confirmation email to user (in the locale they used)
      const locale = body.locale === 'en' ? 'en' : 'de'
      const l = t(locale)
      const mail = new MailService({ schema, knex: database })
      try {
        let emailHtml
        let emailSubject
        if (body.membership_type === 'volleyball') {
          emailHtml = buildVolleyballEmail(reg, locale)
          emailSubject = l.vbSubject
        } else if (body.membership_type === 'basketball') {
          emailHtml = buildBasketballEmail(reg, locale)
          emailSubject = l.bbSubject
        } else {
          emailHtml = buildPassiveEmail(reg, locale)
          emailSubject = l.passiveSubject
        }

        await mail.send({
          to: reg.email,
          subject: emailSubject,
          html: emailHtml,
        })

        // Notify sport admins (resolved from DB) — one email per locale bucket
        // so each admin reads it in their own `members.language`. The OWNER_EMAIL
        // is a forwarding alias (kontakt@kscw.ch) without a member record, so
        // we used to CC it on whichever bucket happened to have people — that
        // pushed the German copy to anglophone admins via the alias. Instead,
        // send the OWNER_EMAIL its own copy in the registering user's locale
        // (matches the form they submitted, deterministic regardless of admin
        // composition). Real admins still get their bucketed locale.
        const adminEmails = await getSportAdminEmails(database, body.membership_type)
        const ownerLower = OWNER_EMAIL.toLowerCase()
        const adminTo = adminEmails.filter(e => e !== ownerLower)
        const adminBuckets = await bucketEmailsByLocale(database, adminTo)

        for (const loc of REG_LOCALES) {
          const tos = adminBuckets[loc]
          if (!tos.length) continue
          const lAdmin = T[loc] || T.de
          await mail.send({
            to: tos,
            subject: lAdmin.adminSubject(reg.vorname, reg.nachname, capFirst(reg.membership_type)),
            html: buildAdminNotificationEmail(reg, loc),
          })
        }

        // Owner alias: send a copy in the registering user's locale.
        // (If real admins are absent — e.g. a passive registration with no
        // sport admins — this also serves as the admin notification.)
        const ownerLAdmin = T[locale] || T.de
        await mail.send({
          to: [OWNER_EMAIL],
          subject: ownerLAdmin.adminSubject(reg.vorname, reg.nachname, capFirst(reg.membership_type)),
          html: buildAdminNotificationEmail(reg, locale),
        })
      } catch (emailErr) {
        log.warn({ msg: `Confirmation email failed: ${emailErr.message}`, id })
        // Don't fail the registration if email fails
      }

      log.info({ msg: 'Registration created', id, type: body.membership_type, ref: reference_number })
      res.json({ success: true, id, reference_number })
    } catch (err) {
      log.error({
        msg: `registration: ${err.message}`,
        endpoint: 'registration',
        method: req.method,
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/registration/:id/files — upload ID files
  // Frontend sends files as FormData after initial registration
  router.post('/registration/:id/files', async (req, res) => {
    try {
      const { id } = req.params
      if (!id) return res.status(400).json({ error: 'id required' })

      // Rate limit + brute-force lockout (reference_number is short, so this is
      // the real protection against IDOR overwrites — see fileAttachIp above).
      // cf-connecting-ip is the real client IP: CF appends the client to XFF, so
      // the leftmost XFF value is attacker-spoofable and would hand each spoofed
      // header a fresh bucket, defeating the limiter + lockout below.
      const xff = req.headers['x-forwarded-for']
      const ip = req.headers['cf-connecting-ip']
        || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
        || req.ip || 'unknown'
      const now = Date.now()
      const ipEntry = fileAttachIp.get(ip)
      if (ipEntry && now < ipEntry.resetAt) {
        if (ipEntry.count >= 10 || ipEntry.mismatches >= 5) {
          return res.status(429).json({ error: 'Too many requests' })
        }
        ipEntry.count++
      } else {
        fileAttachIp.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000, mismatches: 0 })
      }
      if (fileAttachIp.size > 1000) {
        for (const [k, v] of fileAttachIp) { if (now > v.resetAt) fileAttachIp.delete(k) }
      }

      const schema = await getSchema()
      const { ItemsService, FilesService } = services
      const itemsService = new ItemsService('registrations', { schema, knex: database })

      // Verify registration exists, is pending, and caller knows the reference number
      const { reference_number, id_upload_front, id_upload_back, bb_doc_lizenz, bb_doc_freibrief, bb_doc_selfdecl, bb_doc_natdecl, bb_doc_u18parents, bb_doc_schoolcert } = req.body
      if (!reference_number) {
        return res.status(400).json({ error: 'reference_number required' })
      }

      let reg
      try {
        reg = await itemsService.readOne(id)
      } catch {
        return res.status(404).json({ error: 'Registration not found' })
      }
      // 'approved' is allowed for the late document re-upload page (a stranded
      // registration may have been approved before its docs arrived — e.g.
      // REG-2026-5041); it requires the registration email as a second factor
      // on top of the reference number.
      if (!reg || !['pending', 'approved'].includes(reg.status)) {
        return res.status(404).json({ error: 'Registration not found' })
      }
      if (reg.reference_number !== reference_number) {
        // Track mismatches for the brute-force lockout above.
        const e = fileAttachIp.get(ip)
        if (e) e.mismatches = (e.mismatches || 0) + 1
        return res.status(403).json({ error: 'Invalid reference number' })
      }
      // Registration email as a MANDATORY second factor on BOTH pending and
      // approved rows (2026-07-05 audit #8). The reference number alone is short
      // (~4 digits ≈ 9000 values), brute-forceable across a season with IP
      // rotation, and on a PENDING row the attach could overwrite already-uploaded
      // doc pointers. Requiring the registration email — which every legitimate
      // caller has (the create fallback + the nachreichen page both send it) —
      // closes the enumeration→overwrite path. Mismatches feed the same lockout.
      const email = String(req.body.email || '').trim().toLowerCase()
      if (!email || email !== String(reg.email || '').toLowerCase()) {
        const e = fileAttachIp.get(ip)
        if (e) e.mismatches = (e.mismatches || 0) + 1
        return res.status(403).json({ error: 'Invalid reference number' })
      }
      // Only accept well-formed directus_files UUIDs that ACTUALLY EXIST and live
      // in the PRIVATE registration folder — mirrors the create route's docs-exist
      // check so a brute-forcer can't point a victim's doc columns at fabricated
      // UUIDs OR at a public asset (which the quarantine hook would then privatise
      // and the sweep delete). On APPROVED rows the attach is fill-only: a ref+email
      // holder may complete missing documents but never silently REPLACE ones an
      // admin already reviewed at approval time.
      const fileId = (v) => (typeof v === 'string' && UUID_RE.test(v)) ? v : null
      const providedIds = [id_upload_front, id_upload_back, bb_doc_lizenz, bb_doc_freibrief, bb_doc_selfdecl, bb_doc_natdecl, bb_doc_u18parents, bb_doc_schoolcert]
        .map(fileId).filter(Boolean)
      if (providedIds.length) {
        const found = await database('directus_files')
          .whereIn('id', providedIds)
          .where('folder', REGISTRATION_FILES_FOLDER)
          .count('id as n').first()
        if (Number(found?.n || 0) !== providedIds.length) {
          return res.status(400).json({ error: 'One or more uploaded files not found' })
        }
      }
      const lockExisting = reg.status === 'approved'
      const update = {}
      const setDoc = (col, v) => {
        if (fileId(v) && !(lockExisting && reg[col])) update[col] = v
      }
      setDoc('id_upload_front', id_upload_front)
      setDoc('id_upload_back', id_upload_back)
      setDoc('bb_doc_lizenz', bb_doc_lizenz)
      setDoc('bb_doc_freibrief', bb_doc_freibrief)
      setDoc('bb_doc_selfdecl', bb_doc_selfdecl)
      setDoc('bb_doc_natdecl', bb_doc_natdecl)
      setDoc('bb_doc_u18parents', bb_doc_u18parents)
      setDoc('bb_doc_schoolcert', bb_doc_schoolcert)

      if (Object.keys(update).length) {
        await itemsService.updateOne(id, update)
      }

      res.json({ success: true })
    } catch (err) {
      log.error({
        msg: `registration files: ${err.message}`,
        endpoint: 'registration/:id/files',
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // GET /kscw/registration/doc-status — document completeness for the public
  // "Dokumente nachreichen" (late re-upload) page. Auth = reference number +
  // registration email together; shares the attach limiter (incl. its
  // brute-force mismatch lockout). Responds 404 on ANY mismatch so the route
  // never confirms which half was wrong. Returns booleans only — no PII.
  router.get('/registration/doc-status', async (req, res) => {
    try {
      const reference = String(req.query.reference || '').trim()
      const email = String(req.query.email || '').trim().toLowerCase()
      if (!reference || !email) return res.status(400).json({ error: 'reference and email required' })

      const xff = req.headers['x-forwarded-for']
      const ip = req.headers['cf-connecting-ip']
        || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
        || req.ip || 'unknown'
      const now = Date.now()
      const ipEntry = fileAttachIp.get(ip)
      if (ipEntry && now < ipEntry.resetAt) {
        if (ipEntry.count >= 10 || ipEntry.mismatches >= 5) {
          return res.status(429).json({ error: 'Too many requests' })
        }
        ipEntry.count++
      } else {
        fileAttachIp.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000, mismatches: 0 })
      }
      if (fileAttachIp.size > 1000) {
        for (const [k, v] of fileAttachIp) { if (now > v.resetAt) fileAttachIp.delete(k) }
      }

      const reg = await database('registrations')
        .whereRaw('LOWER(reference_number) = ?', [reference.toLowerCase()])
        .first('id', 'status', 'email', 'membership_type', 'nationalitaet_code', 'geburtsdatum', 'bb_situation', 'reference_number',
          'id_upload_front', 'id_upload_back', 'bb_doc_lizenz', 'bb_doc_freibrief', 'bb_doc_selfdecl', 'bb_doc_natdecl', 'bb_doc_u18parents', 'bb_doc_schoolcert')
      const emailOk = reg && String(reg.email || '').toLowerCase() === email
      if (!reg || !emailOk || !['pending', 'approved'].includes(reg.status)) {
        const e = fileAttachIp.get(ip)
        if (e) e.mismatches = (e.mismatches || 0) + 1
        return res.status(404).json({ error: 'Registration not found' })
      }

      const natCode = (reg.nationalitaet_code || '').trim().toUpperCase()
      const required = reg.membership_type === 'basketball'
        ? bbRequiredDocs(reg.bb_situation, natCode, reg.geburtsdatum)
        : []
      return res.json({
        id: reg.id,
        reference_number: reg.reference_number,
        membership_type: reg.membership_type,
        status: reg.status,
        required,
        docs: {
          id_upload_front: !!reg.id_upload_front,
          id_upload_back: !!reg.id_upload_back,
          bb_doc_lizenz: !!reg.bb_doc_lizenz,
          bb_doc_freibrief: !!reg.bb_doc_freibrief,
          bb_doc_selfdecl: !!reg.bb_doc_selfdecl,
          bb_doc_natdecl: !!reg.bb_doc_natdecl,
          bb_doc_u18parents: !!reg.bb_doc_u18parents,
          bb_doc_schoolcert: !!reg.bb_doc_schoolcert,
        },
      })
    } catch (err) {
      log.error({
        msg: `registration doc-status: ${err.message}`,
        endpoint: 'registration/doc-status',
        stack: err.stack,
      })
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // POST /kscw/registration/upload?filename=… — public single-file upload for
  // registration documents. Replaces the anonymous core POST /files for this
  // flow: the file is created INSIDE the private registration folder
  // (migration 169) instead of folder-less/anon-readable, and MIME + size are
  // enforced server-side. The browser sends the raw File as the request body
  // (fetch body: file → Content-Type = the file's own type; no multipart
  // parsing needed). Orphans (abandoned forms, re-picks) are swept nightly by
  // the kscw-hooks registration-docs cron. Per-IP limited.
  const uploadIp = new Map() // ip → { count, resetAt }
  router.post('/registration/upload', async (req, res) => {
    try {
      const xff = req.headers['x-forwarded-for']
      const ip = req.headers['cf-connecting-ip']
        || (typeof xff === 'string' ? xff.split(',')[0].trim() : '')
        || req.ip || 'unknown'
      const now = Date.now()
      const entry = uploadIp.get(ip)
      if (entry && now < entry.resetAt) {
        if (entry.count >= 30) return res.status(429).json({ error: 'Too many uploads. Please try again later.' })
        entry.count++
      } else {
        uploadIp.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 })
      }
      if (uploadIp.size > 1000) {
        for (const [k, v] of uploadIp) { if (now > v.resetAt) uploadIp.delete(k) }
      }

      const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
      if (!UPLOAD_ALLOWED_MIME.has(type)) {
        return res.status(400).json({ error: 'Invalid file type. Allowed: JPG, PNG, WebP, GIF, PDF.' })
      }
      if (Number(req.headers['content-length'] || 0) > UPLOAD_MAX_BYTES) {
        return res.status(413).json({ error: 'File too large (max 10 MB).' })
      }

      const rawName = String(req.query.filename || 'document')
      const filename = rawName.replace(/[\\/\u0000-\u001f]/g, '').slice(0, 200) || 'document'

      // Hard cap while streaming — Content-Length alone is client-controlled.
      let bytes = 0
      req.on('data', (chunk) => {
        bytes += chunk.length
        if (bytes > UPLOAD_MAX_BYTES) req.destroy()
      })

      const { FilesService } = services
      const schema = await getSchema()
      const filesService = new FilesService({ schema, knex: database })
      const storage = (process.env.STORAGE_LOCATIONS || 'local').split(',')[0].trim()
      const newFileId = await filesService.uploadOne(req, {
        storage,
        filename_download: filename,
        type,
        folder: REGISTRATION_FILES_FOLDER,
      })
      log.info({ msg: 'Registration document uploaded', file: newFileId, type, bytes })
      return res.json({ id: newFileId })
    } catch (err) {
      log.error({
        msg: `registration upload: ${err.message}`,
        endpoint: 'registration/upload',
        stack: err.stack,
      })
      res.status(500).json({ error: 'Upload failed' })
    }
  })
}
