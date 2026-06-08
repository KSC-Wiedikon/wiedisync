export interface BuildMailtoArgs {
  invite: {
    token: string
    team_name: string
    contact_name: string
    contact_email: string
    expires_at: string
  }
  kscwTeam: { name: string; league: string }
  season: { name: string }
  frontendUrl: string
}

export function buildInviteMailto({ invite, kscwTeam, season, frontendUrl }: BuildMailtoArgs): string {
  const link = `${frontendUrl}/terminplanung/${invite.token}`
  const expiresCh = new Date(invite.expires_at).toLocaleDateString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
  // Bilingual (EN + DE) — recipient is typically a Swiss volleyball club.
  // Admin opens this in their mail client via mailto: and can trim one half
  // before sending if they prefer single-language.
  const subject = `KSC Wiedikon — Game Scheduling / Spielplanung ${season.name}`
  const body = [
    `Hi ${invite.contact_name},`,
    '',
    `KSC Wiedikon invites you to schedule your home and away matches for the ${season.name} season against our team ${kscwTeam.name} (${kscwTeam.league}).`,
    '',
    `Open the link below to pick your slots:`,
    link,
    '',
    `This link is valid until ${expiresCh}.`,
    `If you have any questions, just reply to this email.`,
    '',
    `Best regards,`,
    `KSC Wiedikon`,
    '',
    '— — — — —',
    '',
    `Hallo ${invite.contact_name},`,
    '',
    `KSC Wiedikon lädt euch zur Spielplanung der Saison ${season.name} ein — gegen unser Team ${kscwTeam.name} (${kscwTeam.league}).`,
    '',
    `Unter folgendem Link könnt ihr eure Heim- und Auswärtsspieltermine auswählen:`,
    link,
    '',
    `Der Link ist bis ${expiresCh} gültig.`,
    `Bei Fragen antwortet einfach auf diese E-Mail.`,
    '',
    `Sportliche Grüsse`,
    `KSC Wiedikon`,
  ].join('\n')
  // contact_email may be a comma-separated list (a club's several Spielplan
  // contacts) — strip spaces so the mailto `to` stays a valid address list.
  const to = invite.contact_email.replace(/\s+/g, '')
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
