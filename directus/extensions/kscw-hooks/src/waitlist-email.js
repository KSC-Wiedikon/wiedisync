/**
 * Waiting-list emails (migration 437/438, owner request 30.10.2026).
 *
 * Two moments get an email on top of the bell + push, in the member's language:
 *   - promoted: a seat freed up (somebody said No, a Maybe turned into No at the
 *     deadline, the max went up) and the first person in line got it;
 *   - bumped: the member lost their seat — a team player took a guest's place
 *     (guests give way to team players), or the max went down.
 *
 * Sent from capacity-moves.js, only for moves that are still true and for an
 * activity that is ahead and not cancelled. Never throws: the seat change is
 * committed before this runs, and a mail failure must not block the queue.
 */
import { buildEmailLayout, buildInfoCard, escHtml } from '../../kscw-endpoints/src/email-template.js'
import { loadSuppressed, normaliseEmail } from '../../kscw-endpoints/src/email-suppression.js'

const LANG_TO_CODE = { german: 'de', swiss_german: 'gsw', english: 'en', french: 'fr', italian: 'it' }

const COPY = {
  de: {
    training: 'Training',
    activity: 'Aktivität', date: 'Datum', time: 'Zeit',
    greeting: (name) => `Hallo ${name}`,
    cta: 'In WiediSync öffnen',
    promoted: {
      subject: (label, date) => `WiediSync — Du hast einen Platz: ${label}, ${date}`,
      title: 'Du hast einen Platz',
      intro: (label, date) => `Für <strong>${label}</strong> am ${date} ist ein Platz frei geworden. Du bist jetzt angemeldet.`,
      outro: 'Kannst du doch nicht? Sag in der App ab, dann bekommt die nächste Person auf der Warteliste den Platz.',
    },
    bumped: {
      subject: (label, date) => `WiediSync — Warteliste: ${label}, ${date}`,
      title: 'Auf der Warteliste',
      intro: (label, date) => `<strong>${label}</strong> am ${date} ist voll und dein Platz ist weg: Du bist jetzt auf der Warteliste.`,
      guest: 'Teamspieler haben Vorrang vor Gastspielern.',
      outro: 'Sobald ein Platz frei wird, rückst du automatisch nach und bekommst Bescheid.',
    },
  },
  gsw: {
    training: 'Training',
    activity: 'Aktivität', date: 'Datum', time: 'Ziit',
    greeting: (name) => `Hoi ${name}`,
    cta: 'I WiediSync öffne',
    promoted: {
      subject: (label, date) => `WiediSync — Du häsch en Platz: ${label}, ${date}`,
      title: 'Du häsch en Platz',
      intro: (label, date) => `Für <strong>${label}</strong> am ${date} isch en Platz frei worde. Du bisch jetzt aagmäldet.`,
      outro: 'Chasch doch nöd? Mäld di i de App ab, denn überchunnt di nächscht Person uf de Wartelischtä de Platz.',
    },
    bumped: {
      subject: (label, date) => `WiediSync — Wartelischtä: ${label}, ${date}`,
      title: 'Uf de Wartelischtä',
      intro: (label, date) => `<strong>${label}</strong> am ${date} isch voll und din Platz isch weg: Du bisch jetzt uf de Wartelischtä.`,
      guest: 'Teamspieler händ Vorrang vor Gastspieler.',
      outro: 'Sobald en Platz frei wird, rutschisch automatisch nache und überchunsch Bscheid.',
    },
  },
  en: {
    training: 'Training',
    activity: 'Activity', date: 'Date', time: 'Time',
    greeting: (name) => `Hi ${name}`,
    cta: 'Open in WiediSync',
    promoted: {
      subject: (label, date) => `WiediSync — You got a spot: ${label}, ${date}`,
      title: 'You got a spot',
      intro: (label, date) => `A spot opened up for <strong>${label}</strong> on ${date}. You are now signed up.`,
      outro: 'Can’t make it after all? Say No in the app so the next person on the waiting list gets the spot.',
    },
    bumped: {
      subject: (label, date) => `WiediSync — Waiting list: ${label}, ${date}`,
      title: 'On the waiting list',
      intro: (label, date) => `<strong>${label}</strong> on ${date} is full and you lost your spot: you are now on the waiting list.`,
      guest: 'Team players have priority over guest players.',
      outro: 'You move up automatically as soon as a spot opens, and we will let you know.',
    },
  },
  fr: {
    training: 'Entraînement',
    activity: 'Activité', date: 'Date', time: 'Heure',
    greeting: (name) => `Bonjour ${name}`,
    cta: 'Ouvrir dans WiediSync',
    promoted: {
      subject: (label, date) => `WiediSync — Tu as une place : ${label}, ${date}`,
      title: 'Tu as une place',
      intro: (label, date) => `Une place s’est libérée pour <strong>${label}</strong> le ${date}. Tu es maintenant inscrit·e.`,
      outro: 'Finalement tu ne peux pas ? Dis non dans l’app pour que la personne suivante sur la liste d’attente ait la place.',
    },
    bumped: {
      subject: (label, date) => `WiediSync — Liste d’attente : ${label}, ${date}`,
      title: 'Sur la liste d’attente',
      intro: (label, date) => `<strong>${label}</strong> le ${date} est complet et tu as perdu ta place : tu es maintenant sur la liste d’attente.`,
      guest: 'Les joueurs de l’équipe ont la priorité sur les joueurs invités.',
      outro: 'Tu remontes automatiquement dès qu’une place se libère, et nous te prévenons.',
    },
  },
  it: {
    training: 'Allenamento',
    activity: 'Attività', date: 'Data', time: 'Ora',
    greeting: (name) => `Ciao ${name}`,
    cta: 'Apri in WiediSync',
    promoted: {
      subject: (label, date) => `WiediSync — Hai un posto: ${label}, ${date}`,
      title: 'Hai un posto',
      intro: (label, date) => `Si è liberato un posto per <strong>${label}</strong> il ${date}. Ora sei iscritto/a.`,
      outro: 'Alla fine non puoi? Rispondi No nell’app, così il posto va alla prossima persona in lista d’attesa.',
    },
    bumped: {
      subject: (label, date) => `WiediSync — Lista d’attesa: ${label}, ${date}`,
      title: 'In lista d’attesa',
      intro: (label, date) => `<strong>${label}</strong> del ${date} è al completo e hai perso il posto: ora sei in lista d’attesa.`,
      guest: 'I giocatori della squadra hanno la precedenza sui giocatori ospiti.',
      outro: 'Passi avanti automaticamente appena si libera un posto, e ti avvisiamo.',
    },
  },
}

/**
 * The email for one move, in one language. Pure — the test pins it.
 * @param {object} p
 * @param {string} p.locale de | gsw | en | fr | it
 * @param {'confirmed'|'waitlisted'} p.move confirmed = got a seat, waitlisted = lost it
 * @param {'training'|'event'} p.activityType
 * @param {{ team?: string, title?: string, date?: string, time?: string }} p.vars
 * @param {boolean} [p.isGuest] adds the "team players first" line to a lost seat
 * @param {string} [p.firstName]
 * @param {string} p.url
 */
export function waitlistEmailContent({ locale, move, activityType, vars, isGuest, firstName, url }) {
  const tt = COPY[locale] || COPY.de
  const kind = move === 'confirmed' ? tt.promoted : tt.bumped
  const label = activityType === 'training' ? `${tt.training} ${vars.team || ''}`.trim() : (vars.title || '')
  const date = vars.date || ''
  const guestLine = move !== 'confirmed' && isGuest ? kind.guest : ''
  const rows = [
    { label: tt.activity, value: label },
    { label: tt.date, value: date, halfWidth: !!vars.time },
    ...(vars.time ? [{ label: tt.time, value: vars.time, halfWidth: true }] : []),
  ]
  const bodyHtml =
    `<div style="font-size:14px;color:#e2e8f0;margin-bottom:16px">${kind.intro(escHtml(label), escHtml(date))}` +
    (guestLine ? ` ${escHtml(guestLine)}` : '') + '</div>' +
    buildInfoCard(rows) +
    `<div style="font-size:13px;color:#94a3b8;margin-top:16px">${escHtml(kind.outro)}</div>`
  const html = buildEmailLayout(bodyHtml, {
    title: kind.title,
    subtitle: `WiediSync — ${label}`,
    greeting: firstName ? tt.greeting(firstName) : undefined,
    ctaUrl: url,
    ctaLabel: tt.cta,
  })
  const strip = (s) => s.replace(/<[^>]+>/g, '')
  const text = [
    firstName ? `${tt.greeting(firstName)},` : '',
    '',
    strip(kind.intro(label, date)) + (guestLine ? ` ${guestLine}` : ''),
    '',
    `${tt.activity}: ${label}`,
    `${tt.date}: ${date}${vars.time ? `, ${vars.time}` : ''}`,
    '',
    kind.outro,
    url,
  ].filter((l, i, a) => l !== '' || (a[i - 1] ?? '') !== '').join('\n')
  return { subject: kind.subject(label, date), html, text }
}

/**
 * Send it. Skips members without a usable address and suppressed addresses.
 * @param {object} p
 * @param {import('knex').Knex} p.database
 * @param {any} p.services Directus services (MailService)
 * @param {() => Promise<any>} p.getSchema
 * @param {any} p.log
 * @param {number|string} p.memberId
 */
export async function sendWaitlistEmail({ database, services, getSchema, log, memberId, move, activityType, vars, isGuest, url }) {
  try {
    const member = await database('members').where('id', memberId).first('email', 'first_name', 'language')
    const email = normaliseEmail(member?.email)
    if (!email || email.includes('@placeholder')) return
    const suppressed = await loadSuppressed(database, [email])
    if (suppressed.has(email)) return
    const content = waitlistEmailContent({
      locale: LANG_TO_CODE[member.language] || 'de',
      move, activityType, vars, isGuest, firstName: member.first_name, url,
    })
    const { MailService } = services
    const mailService = new MailService({ schema: await getSchema(), knex: database })
    await mailService.send({ to: email, subject: content.subject, html: content.html, text: content.text })
  } catch (err) {
    log?.warn?.({ msg: `[waitlist-email] member ${memberId} (${move}) failed: ${err.message}`, event: 'waitlist_email_failed' })
  }
}
