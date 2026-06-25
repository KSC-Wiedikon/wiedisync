/**
 * Shared KSCW Spielplanung email signature.
 *
 * Two flavours, because the two email families look completely different:
 *  - LIGHT  — the manual mailbox compose/reply (scheduling-mailbox.js) sends a
 *    plain white email, so it gets the full branded light signature block the
 *    operators designed (bilingual DE + EN, crest + contact card).
 *  - DARK   — the automated opponent-facing emails (invites, reminders, proposal
 *    receipts, confirmations) use the dark `buildEmailLayout` template, so the
 *    same contact info is folded into a dark-themed footer block instead of the
 *    white card, to avoid a jarring light-on-dark clash.
 *
 * The crest is HOSTED (not inline base64) — Gmail/Outlook routinely strip
 * `data:` image URIs. Served from the frontend like the existing email logo.
 */

import { FRONTEND_URL, escHtml } from './email-template.js'

const LOGO_URL = `${FRONTEND_URL}/kscw_email_crest.png`
const SIG_EMAIL = 'volleyball@spielplanung.kscw.ch'
const SIG_EMAIL_BB = 'basketball@spielplanung.kscw.ch'
const SIG_WA_HREF = 'https://wa.me/41797891817'
const SIG_WA_DISPLAY = '+41&nbsp;79&nbsp;789&nbsp;18&nbsp;17'
const SIG_PEOPLE = 'Luca &middot; Martin &middot; Hella'

// One branded light card (the operators' design), parameterised by role + the
// contact block so the volleyball and basketball mailboxes can each emit their
// own card. The `email`/`people`/WhatsApp fields default to the volleyball
// values so the existing VB export is byte-identical; a falsy `people` drops the
// names row and a falsy `waLabel` drops the WhatsApp row (basketball placeholder
// has neither until the operators supply them).
function lightCard({ role, waLabel, email = SIG_EMAIL, people = SIG_PEOPLE, waHref = SIG_WA_HREF, waDisplay = SIG_WA_DISPLAY }) {
  const peopleRow = people ? `<div style="font-weight: bold; margin-top: 6px;">${people}</div>` : ''
  const waRow = waLabel
    ? `<div style="margin-top: 2px; font-size: 13px; color: #555555;">${waLabel}: <a href="${waHref}" style="color: #3D4A99; text-decoration: none;">${waDisplay}</a></div>`
    : ''
  return (
    `<table cellpadding="0" cellspacing="0" border="0" style="font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 14px; line-height: 1.5;">` +
    `<tr>` +
    `<td style="padding-right: 16px; border-right: 3px solid #FCDC29; vertical-align: middle;">` +
    `<img src="${LOGO_URL}" width="73" height="80" alt="KSC Wiedikon" style="display: block;">` +
    `</td>` +
    `<td style="padding-left: 16px; vertical-align: middle;">` +
    `<div style="font-size: 16px; font-weight: bold; color: #3D4A99; letter-spacing: 0.3px;">KSC Wiedikon</div>` +
    `<div style="font-size: 13px; color: #555555; margin-top: 1px;">${role}</div>` +
    peopleRow +
    `<div style="margin-top: 4px; font-size: 13px;"><a href="mailto:${email}" style="color: #3D4A99; text-decoration: none;">${email}</a></div>` +
    waRow +
    `</td>` +
    `</tr>` +
    `</table>`
  )
}

/** Plain-text signature, same fields as the card (drops empty rows). */
function sigText({ role, email, people, wa }) {
  return ['--', `KSC Wiedikon · ${role}`, people, email, wa].filter(Boolean).join('\n')
}

/**
 * Light signature for manual mailbox emails — German only (Swiss clubs;
 * formal correspondence is High German, matching the email copy convention).
 */
export const SCHEDULING_SIGNATURE_LIGHT_HTML =
  lightCard({ role: 'Spielplanung Volleyball', waLabel: 'WhatsApp (Notfall, Luca)' })

/** Plain-text signature appended to the text part of manual emails. */
export const SCHEDULING_SIGNATURE_TEXT =
  sigText({ role: 'Spielplanung Volleyball', email: SIG_EMAIL, people: 'Luca · Martin · Hella', wa: 'WhatsApp (Notfall, Luca): +41 79 789 18 17' })

// Basketball mailbox signature. PLACEHOLDER copy — basketball@spielplanung.kscw.ch
// + the "Spielplanung Basketball" role only; the scheduler names + WhatsApp line
// are intentionally omitted until the basketball operators supply them. Drop them
// into the `people` / `waLabel` args here once known.
export const SCHEDULING_SIGNATURE_BASKETBALL_LIGHT_HTML =
  lightCard({ role: 'Spielplanung Basketball', email: SIG_EMAIL_BB, people: null, waLabel: null })

export const SCHEDULING_SIGNATURE_BASKETBALL_TEXT =
  sigText({ role: 'Spielplanung Basketball', email: SIG_EMAIL_BB })

// Localised role + WhatsApp label for the dark automated footer (gsw → de).
const DARK_I18N = {
  de: { role: 'Spielplanung Volleyball', wa: 'WhatsApp (Notfall, Luca)' },
  en: { role: 'Volleyball scheduling', wa: 'WhatsApp (urgency, Luca)' },
  fr: { role: 'Planification volleyball', wa: 'WhatsApp (urgence, Luca)' },
  it: { role: 'Pianificazione pallavolo', wa: 'WhatsApp (urgenza, Luca)' },
}

/**
 * Dark-themed signature rows for the automated opponent emails. Returns a
 * `<tr>…</tr>` block injected into `buildEmailLayout` (via its `signatureHtml`
 * opt) just above the system footer bar — matching the dark card palette.
 * @param {string} lang opponent language (de/gsw/en/fr/it), falls back to de
 */
export function buildSchedSignatureRows(lang) {
  const t = DARK_I18N[lang] || DARK_I18N.de
  return (
    `<tr><td style="padding:0 28px 22px">` +
    `<table width="100%" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid #334155;padding-top:16px">` +
    `<div style="font-size:15px;font-weight:700;color:#ffffff">KSC Wiedikon</div>` +
    `<div style="font-size:13px;color:#94a3b8;margin-top:1px">${escHtml(t.role)}</div>` +
    `<div style="font-size:13px;font-weight:600;color:#e2e8f0;margin-top:8px">Luca &middot; Martin &middot; Hella</div>` +
    `<div style="font-size:13px;margin-top:6px"><a href="mailto:${SIG_EMAIL}" style="color:#FFC832;text-decoration:none">${SIG_EMAIL}</a></div>` +
    `<div style="font-size:13px;color:#94a3b8;margin-top:2px">${escHtml(t.wa)}: <a href="${SIG_WA_HREF}" style="color:#FFC832;text-decoration:none">+41 79 789 18 17</a></div>` +
    `</td></tr></table>` +
    `</td></tr>`
  )
}
