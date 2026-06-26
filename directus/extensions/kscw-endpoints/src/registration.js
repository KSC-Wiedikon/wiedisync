/**
 * Registration Form — unified member registration (VB/BB/Passive)
 * POST /kscw/registration — public, Turnstile protected
 * POST /kscw/registration/:id/files — public, upload ID files after registration
 */

import { buildEmailLayout, buildInfoCard, formatDateCH, bucketEmailsByLocale, escHtml } from './email-template.js'
import crypto from 'crypto'

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
    { label: l.gender, value: reg.geschlecht || '-', halfWidth: true },
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
    { label: l.adminType, value: reg.membership_type, halfWidth: true },
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
    subtitle: `${reg.vorname} ${reg.nachname} — ${reg.membership_type}`,
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

export function registerRegistration(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'registration' })

  // Per-IP throttle for the public /registration/:id/files route. The route
  // authorizes writes by matching a short (~4-digit) reference_number, so without
  // a limiter an attacker could brute-force references and overwrite a victim's
  // uploaded ID/document file pointers (IDOR). 10 attempts / 10 min per IP, with
  // a tighter lockout once reference mismatches (the brute-force signal) pile up.
  const fileAttachIp = new Map() // ip → { count, resetAt, mismatches }

  // POST /kscw/registration — create new registration
  router.post('/registration', async (req, res) => {
    try {
      const body = req.body
      if (!body || !body.vorname || !body.nachname || !body.email || !body.membership_type) {
        return res.status(400).json({ error: 'vorname, nachname, email, membership_type required' })
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(body.email)) {
        return res.status(400).json({ error: 'Invalid email format' })
      }

      const validTypes = ['volleyball', 'basketball', 'passive']
      if (!validTypes.includes(body.membership_type)) {
        return res.status(400).json({ error: 'Invalid membership_type' })
      }

      if (!body.turnstile_token || !(await verifyTurnstile(body.turnstile_token))) {
        return res.status(400).json({ error: 'Captcha verification failed' })
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
        email: body.email.trim().toLowerCase(),
        telefon_mobil: body.telefon_mobil || null,
        adresse: body.adresse || null,
        plz: body.plz || null,
        ort: body.ort || null,
        geburtsdatum: body.geburtsdatum || null,
        nationalitaet: body.nationalitaet || null,
        geschlecht: body.geschlecht || null,
        ahv_nummer: body.ahv_nummer || null,
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
            subject: lAdmin.adminSubject(reg.vorname, reg.nachname, reg.membership_type),
            html: buildAdminNotificationEmail(reg, loc),
          })
        }

        // Owner alias: send a copy in the registering user's locale.
        // (If real admins are absent — e.g. a passive registration with no
        // sport admins — this also serves as the admin notification.)
        const ownerLAdmin = T[locale] || T.de
        await mail.send({
          to: [OWNER_EMAIL],
          subject: ownerLAdmin.adminSubject(reg.vorname, reg.nachname, reg.membership_type),
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
      const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown'
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
      const { reference_number, id_upload_front, id_upload_back, bb_doc_lizenz, bb_doc_selfdecl, bb_doc_natdecl } = req.body
      if (!reference_number) {
        return res.status(400).json({ error: 'reference_number required' })
      }

      let reg
      try {
        reg = await itemsService.readOne(id)
      } catch {
        return res.status(404).json({ error: 'Registration not found' })
      }
      if (!reg || reg.status !== 'pending') {
        return res.status(404).json({ error: 'Registration not found' })
      }
      if (reg.reference_number !== reference_number) {
        // Track mismatches for the brute-force lockout above.
        const e = fileAttachIp.get(ip)
        if (e) e.mismatches = (e.mismatches || 0) + 1
        return res.status(403).json({ error: 'Invalid reference number' })
      }
      // Only accept well-formed directus_files UUIDs — never an arbitrary value.
      const fileId = (v) => (typeof v === 'string' && UUID_RE.test(v)) ? v : null
      const update = {}
      if (fileId(id_upload_front)) update.id_upload_front = id_upload_front
      if (fileId(id_upload_back)) update.id_upload_back = id_upload_back
      if (fileId(bb_doc_lizenz)) update.bb_doc_lizenz = bb_doc_lizenz
      if (fileId(bb_doc_selfdecl)) update.bb_doc_selfdecl = bb_doc_selfdecl
      if (fileId(bb_doc_natdecl)) update.bb_doc_natdecl = bb_doc_natdecl

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
}
