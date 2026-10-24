/**
 * "You have been fined" email to the fined member.
 *
 * Every fine already lands as a `fine_issued` notification (bell + home news
 * feed) and, apart from the deadline sweep's own, a push. A push is easy to
 * miss and a bell entry only exists for someone who opens the app, while a fine
 * is money they owe — so the member also gets it by email, in their language.
 *
 * Called from both write paths: the `fines.items.create` action in kscw-hooks
 * (leader-issued fines and the deadline sweep, which go through ItemsService)
 * and duty-late.js (raw insert, so that action never fires for it).
 *
 * Never throws: the fine is committed before this runs, and a mail failure must
 * not undo or block it.
 */
import { buildEmailLayout, buildInfoCard, escHtml, formatDateCH, FRONTEND_URL } from './email-template.js'
import { loadSuppressed, normaliseEmail } from './email-suppression.js'

const LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }

// Category labels mirror src/i18n/locales/<lang>/fines.ts (category*).
const COPY = {
  de: {
    subject: (team, amount) => `WiediSync — Neue Busse von ${team}: ${amount}`,
    title: 'Neue Busse',
    greeting: (name) => `Hallo ${name}`,
    intro: (team, amount) => `Du hast von <strong>${team}</strong> eine Busse über <strong>${amount}</strong> erhalten.`,
    team: 'Team', amount: 'Betrag', category: 'Kategorie', reason: 'Grund', date: 'Datum',
    categories: { late_signin: 'Späte Anmeldung', no_show: 'Nicht erschienen', late_payment: 'Zahlungsverzug', custom: 'Andere' },
    outro: 'Fragen zur Busse? Melde dich bei deinem Coach oder Teamverantwortlichen.',
    cta: 'Meine Bussen ansehen',
  },
  gsw: {
    subject: (team, amount) => `WiediSync — Neui Buess vo ${team}: ${amount}`,
    title: 'Neui Buess',
    greeting: (name) => `Hoi ${name}`,
    intro: (team, amount) => `Du häsch vo <strong>${team}</strong> e Buess über <strong>${amount}</strong> übercho.`,
    team: 'Team', amount: 'Betrag', category: 'Kategorii', reason: 'Grund', date: 'Datum',
    categories: { late_signin: 'Späti Aamäldig', no_show: 'Nöd ercho', late_payment: 'Zahligsverzog', custom: 'Andersch' },
    outro: 'Frage zur Buess? Meld di bi dim Coach oder de Teamverantwortliche.',
    cta: 'Mini Buesse aaluege',
  },
  en: {
    subject: (team, amount) => `WiediSync — New fine from ${team}: ${amount}`,
    title: 'New fine',
    greeting: (name) => `Hi ${name}`,
    intro: (team, amount) => `<strong>${team}</strong> has fined you <strong>${amount}</strong>.`,
    team: 'Team', amount: 'Amount', category: 'Category', reason: 'Reason', date: 'Date',
    categories: { late_signin: 'Late sign-in', no_show: 'No-show', late_payment: 'Late payment', custom: 'Custom' },
    outro: 'Questions about this fine? Ask your coach or team responsible.',
    cta: 'View my fines',
  },
  fr: {
    subject: (team, amount) => `WiediSync — Nouvelle amende de ${team} : ${amount}`,
    title: 'Nouvelle amende',
    greeting: (name) => `Bonjour ${name}`,
    intro: (team, amount) => `<strong>${team}</strong> t'a infligé une amende de <strong>${amount}</strong>.`,
    team: 'Équipe', amount: 'Montant', category: 'Catégorie', reason: 'Motif', date: 'Date',
    categories: { late_signin: 'Inscription tardive', no_show: 'Absence', late_payment: 'Retard de paiement', custom: 'Autre' },
    outro: "Des questions sur cette amende ? Adresse-toi à ton coach ou au responsable d'équipe.",
    cta: 'Voir mes amendes',
  },
  it: {
    subject: (team, amount) => `WiediSync — Nuova multa da ${team}: ${amount}`,
    title: 'Nuova multa',
    greeting: (name) => `Ciao ${name}`,
    intro: (team, amount) => `<strong>${team}</strong> ti ha inflitto una multa di <strong>${amount}</strong>.`,
    team: 'Squadra', amount: 'Importo', category: 'Categoria', reason: 'Motivo', date: 'Data',
    categories: { late_signin: 'Iscrizione tardiva', no_show: 'Mancata presenza', late_payment: 'Ritardo di pagamento', custom: 'Altro' },
    outro: 'Domande su questa multa? Rivolgiti al tuo coach o al responsabile della squadra.',
    cta: 'Vedi le mie multe',
  },
}

/**
 * @param {object} opts
 * @param {import('knex').Knex} opts.database
 * @param {any} opts.services   Directus services (MailService)
 * @param {() => Promise<any>} opts.getSchema
 * @param {any} opts.log
 * @param {{ id: number|string, member: number|string, amount: number|string, currency?: string,
 *           category?: string, reason?: string|null, activity_date?: string|Date|null }} opts.fine
 * @param {string} opts.teamName
 */
export async function sendFineIssuedEmail({ database, services, getSchema, log, fine, teamName }) {
  try {
    if (!fine?.member) return
    const member = await database('members').where('id', fine.member).first('email', 'first_name', 'language')
    const email = normaliseEmail(member?.email)
    if (!email || email.includes('@placeholder')) return
    const suppressed = await loadSuppressed(database, [email])
    if (suppressed.has(email)) return

    const tt = COPY[LANG_TO_CODE[member.language] || 'de']
    const amountStr = `${fine.currency || 'CHF'} ${Number(fine.amount).toFixed(2)}`
    const categoryLabel = tt.categories[fine.category] || fine.category || ''
    const reason = String(fine.reason || '').trim()
    const dateStr = fine.activity_date ? formatDateCH(fine.activity_date) : ''

    const rows = [
      { label: tt.team, value: teamName, halfWidth: true },
      { label: tt.amount, value: amountStr, halfWidth: true },
      { label: tt.category, value: categoryLabel, halfWidth: !!dateStr },
      ...(dateStr ? [{ label: tt.date, value: dateStr, halfWidth: true }] : []),
      ...(reason ? [{ label: tt.reason, value: reason }] : []),
    ]
    const bodyHtml =
      `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${tt.intro(escHtml(teamName), escHtml(amountStr))}</div>` +
      buildInfoCard(rows) +
      `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(tt.outro)}</div>`
    const html = buildEmailLayout(bodyHtml, {
      title: tt.title,
      subtitle: `WiediSync — ${teamName}`,
      greeting: member.first_name ? tt.greeting(member.first_name) : undefined,
      ctaUrl: `${FRONTEND_URL}/fines`,
      ctaLabel: tt.cta,
    })
    const text = [
      member.first_name ? `${tt.greeting(member.first_name)},` : '',
      '',
      `${tt.team}: ${teamName}`,
      `${tt.amount}: ${amountStr}`,
      `${tt.category}: ${categoryLabel}`,
      dateStr ? `${tt.date}: ${dateStr}` : '',
      reason ? `${tt.reason}: ${reason}` : '',
      '',
      tt.outro,
      `${FRONTEND_URL}/fines`,
    ].filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n')

    const { MailService } = services
    const mailService = new MailService({ schema: await getSchema(), knex: database })
    await mailService.send({ to: email, subject: tt.subject(teamName, amountStr), html, text })
  } catch (err) {
    log.warn({ msg: `[fines] email for fine ${fine?.id} failed: ${err.message}`, event: 'fine_email_failed' })
  }
}
