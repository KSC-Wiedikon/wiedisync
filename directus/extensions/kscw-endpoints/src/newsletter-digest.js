/**
 * Monthly Newsletter Digest
 * POST /kscw/newsletter/digest — triggered by Directus Flow cron (1st of month)
 * Gathers news, game results, upcoming games, events from last/next 30 days.
 * Calls Claude API for locale-specific editorial summaries.
 * Sends branded HTML emails filtered by subscriber category preferences.
 */

import crypto from 'crypto';
import { buildEmailLayout, formatDateCH, FRONTEND_URL, escHtml } from './email-template.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DEEPL_API_KEY = process.env.DEEPL_API_KEY || '';
// See newsletter.js — kscw.ch is the live domain; the pages.dev default put a bare
// project hostname (and an extra 302) into every member-facing digest link.
const WEBSITE_URL = process.env.KSCW_WEBSITE_URL || 'https://kscw.ch';

/**
 * Constant-time bearer comparison — avoids leaking the admin token via response
 * timing. Length mismatch returns false up front (length isn't a secret here),
 * which also keeps crypto.timingSafeEqual from throwing on unequal buffers.
 */
function constantTimeEqual(a, b) {
  const aBuf = Buffer.from(String(a ?? ''), 'utf8');
  const bBuf = Buffer.from(String(b ?? ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ── Allowlist HTML sanitizer for the AI summary ─────────────────────────────
// The summary is HTML emitted by Claude from data that includes externally
// scraped fields (opponent names, leagues). A prompt injection could otherwise
// smuggle <script>/onerror/javascript: into a newsletter that reaches every
// public subscriber. We keep the intended <b>/<a>/<br> formatting but strip
// everything dangerous. Duplicated from kscw-hooks/src/sanitize-html.js —
// extensions don't share a module graph, same duplication pattern as
// error-log.js. Keep the two in sync if the threat model changes.
const SUMMARY_ALLOWED_TAGS = new Set([
  'p', 'br', 'span', 'div',
  'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'a',
]);
const SUMMARY_DANGEROUS_BLOCK_TAGS = [
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'label',
  'video', 'audio', 'source', 'track', 'canvas', 'noscript',
];
const SUMMARY_DANGEROUS_VOID_TAGS = [
  'link', 'meta', 'base', 'img', 'picture', 'frame', 'frameset',
];
function summaryHrefIsSafe(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.startsWith('https://')) return true;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('#')) return true;
  return false;
}
function sanitizeSummaryHtml(input) {
  if (typeof input !== 'string') return '';
  let s = input;
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  for (const tag of SUMMARY_DANGEROUS_BLOCK_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?</${tag}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '');
  }
  for (const tag of SUMMARY_DANGEROUS_VOID_TAGS) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*/?>`, 'gi'), '');
  }
  s = s.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (match, tag, attrs) => {
    const lower = tag.toLowerCase();
    const isClose = match.startsWith('</');
    if (!SUMMARY_ALLOWED_TAGS.has(lower)) return '';
    if (isClose) return `</${lower}>`;
    if (lower === 'a') {
      const hrefDouble = attrs.match(/\bhref\s*=\s*"([^"]*)"/i);
      const hrefSingle = attrs.match(/\bhref\s*=\s*'([^']*)'/i);
      const href = hrefDouble?.[1] ?? hrefSingle?.[1] ?? null;
      if (href && summaryHrefIsSafe(href)) {
        const safe = href
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
          .replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<a href="${safe}" target="_blank" rel="noopener noreferrer">`;
      }
      return '<a>';
    }
    return `<${lower}>`;
  });
  s = s.replace(/<\s*\/?\s*(script|style|iframe|svg|object|embed|form)\b[^>]*>?/gi, '');
  s = s.replace(/\son\w+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\son\w+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\son\w+\s*=\s*[^\s>]+/gi, '');
  s = s.replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, '$1=$2#$2');
  s = s.replace(/(href|src)\s*=\s*("|')\s*vbscript:[^"']*\2/gi, '$1=$2#$2');
  s = s.replace(/(href|src)\s*=\s*("|')\s*data:(?!image\/)[^"']*\2/gi, '$1=$2#$2');
  // Fail closed: if anything dangerous survived, drop the summary entirely
  // rather than email an XSS/phishing vector to the whole subscriber list.
  if (/<\s*\/?\s*(script|style|iframe|svg|object|embed|form)\b/i.test(s)
      || /\son\w+\s*=/i.test(s)
      || /javascript:/i.test(s)) {
    return '';
  }
  return s;
}

async function generateSummary(locale, data, monthLabel, year) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const baseUrl = WEBSITE_URL;

    const vbLabel = 'Volleyball';
    const bbLabel = 'Basketball';
    const newsLabel = 'News';
    const outlookLabel = locale === 'de' ? 'Ausblick' : 'Outlook';

    const rules = [
      // No locale segment — the site is single-URL; /de|/en/* only 301s back to the bare
      // path, and a model told to emit them produces links that redirect for every reader.
      `Use FULL absolute HTML links with base URL ${baseUrl}/. Example: <a href="${baseUrl}/volleyball/">Volleyball</a>.`,
      `Structure the summary in these sections using bold headers separated by <br><br>:`,
      `1. <b>${newsLabel}</b> — 1-2 sentences about news articles.`,
      `2. <b>🏐 ${vbLabel}</b> — 1-2 sentences about volleyball results/highlights ONLY. Only mention volleyball teams here.`,
      `3. <b>🏀 ${bbLabel}</b> — 1-2 sentences about basketball results/highlights ONLY. Only mention basketball teams here.`,
      `4. <b>${outlookLabel}</b> — 1-2 sentences about upcoming games, split by sport.`,
      `The data has [volleyball] or [basketball] tags — use them to assign teams to the correct sport section. NEVER put a basketball team in the volleyball section or vice versa.`,
      // Sections 1-3 are the retrospective; section 4 is the ONLY forward-looking one.
      // Stated as a scope per section, because a blanket "do not mention the future"
      // contradicts the Ausblick/Outlook section three lines above it and the model has
      // to pick one — silently, and usually against the section subscribers read for it.
      `Sections 1-3 report on ${monthLabel} ${year}. The ${outlookLabel} section is the one place that looks ahead.`,
      `No markdown. Only HTML (<b>, <a>, <br>). No <p> tags, no # headers.`,
      `Write enthusiastically but factually. Keep each section concise.`,
    ].join(' ');

    const prompt = locale === 'de'
      ? `Schreibe eine strukturierte Zusammenfassung für den KSCW Newsletter ${monthLabel} ${year} auf Deutsch. ${rules} Hier sind die Daten: ${JSON.stringify(data)}`
      : `Write a structured summary for the KSCW newsletter for ${monthLabel} ${year} in English. ${rules} Here is the data: ${JSON.stringify(data)}`;

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const result = await resp.json();
    if (result.error) {
      console.error('Claude API error:', result.error.message || JSON.stringify(result.error));
      return null;
    }
    // Token accounting. The other two Claude call sites (sql-ai.js, expense-upload.js)
    // log usage; without it there is no way to see what a prompt change costs here, or
    // whether a summary is being truncated against max_tokens.
    const usage = result.usage || {};
    console.log('[newsletter-digest] summary generated', JSON.stringify({
      locale,
      tokensIn: usage.input_tokens ?? null,
      tokensOut: usage.output_tokens ?? null,
    }));
    return result.content?.[0]?.text || null;
  } catch (err) {
    console.error('Claude API call failed:', err.message);
    return null;
  }
}

function buildGameCard(g, showScore) {
  const time = g.time ? g.time.slice(0, 5) : '';
  const dateStr = formatDateCH(g.date);
  const isVB = g.league && !/liga.*basket|sbl|lnb|proball/i.test(g.league);
  const sportColor = isVB ? '#FFC832' : '#F97316';

  // Determine winner for color highlighting
  const homeScore = g.home_score ?? null;
  const awayScore = g.away_score ?? null;
  const homeWon = homeScore !== null && awayScore !== null && homeScore > awayScore;
  const awayWon = homeScore !== null && awayScore !== null && awayScore > homeScore;
  const winColor = '#22c55e';
  const loseColor = '#ef4444';

  // KSCW team is bold
  const isKscwHome = g.type === 'home';
  const homeBold = isKscwHome ? 'font-weight:700;color:#ffffff' : 'color:#94a3b8';
  const awayBold = !isKscwHome ? 'font-weight:700;color:#ffffff' : 'color:#94a3b8';

  // Score colors
  const homeScoreStyle = showScore && homeWon ? `color:${winColor};font-weight:800` : showScore && awayWon ? `color:${loseColor};font-weight:700` : 'color:#e2e8f0;font-weight:700';
  const awayScoreStyle = showScore && awayWon ? `color:${winColor};font-weight:800` : showScore && homeWon ? `color:${loseColor};font-weight:700` : 'color:#e2e8f0;font-weight:700';

  // League badge
  const leagueShort = g.league ? g.league.replace(/Gruppe?\s*/i, '').slice(0, 12) : '';

  let card = `<table width="100%" cellpadding="0" cellspacing="0" style="border-bottom:1px solid #334155;margin-bottom:2px"><tr>`;

  // Left: date + time
  card += `<td style="vertical-align:top;padding:10px 8px 10px 0;width:70px"><div style="font-size:12px;color:#64748b">${dateStr}</div>`;
  if (time) card += `<div style="font-size:11px;color:#475569">${escHtml(time)}</div>`;
  card += `</td>`;

  // (sport dot removed — games grouped by sport section instead)

  // Score column (separate from team names)
  if (showScore) {
    card += `<td style="vertical-align:top;padding:8px 6px 8px 0;width:28px;text-align:right">`;
    card += `<div style="font-size:13px;line-height:1.5;${homeScoreStyle}">${homeScore ?? '-'}</div>`;
    card += `<div style="font-size:13px;line-height:1.5;${awayScoreStyle}">${awayScore ?? '-'}</div>`;
    card += `</td>`;
  }

  // Team names column
  card += `<td style="vertical-align:top;padding:8px 0">`;
  card += `<div style="font-size:13px;line-height:1.5;${homeBold}">${escHtml(g.home_team)}</div>`;
  card += `<div style="font-size:13px;line-height:1.5;${awayBold}">${escHtml(g.away_team)}</div>`;
  card += `</td>`;

  // League badge
  if (leagueShort) {
    card += `<td style="vertical-align:top;padding:12px 0 10px;width:70px;text-align:right"><span style="font-size:10px;color:#64748b;border:1px solid #334155;border-radius:4px;padding:2px 6px;white-space:nowrap">${escHtml(leagueShort)}</span></td>`;
  }

  card += `</tr></table>`;
  return card;
}

function buildDigestHtml(locale, summary, news, results, upcoming, events, unsubUrl) {
  const t = (de, en) => locale === 'de' ? de : en;
  let body = '';

  // AI Summary
  if (summary) {
    body += `<div style="font-size:14px;color:#e2e8f0;line-height:1.7;margin-bottom:20px;padding:16px;background:#0f172a;border-radius:8px;border-left:3px solid #FFC832;text-align:justify">${sanitizeSummaryHtml(summary)}</div>`;
  }

  // News section
  if (news.length > 0) {
    body += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;margin:20px 0 8px">News</div>`;
    for (const n of news) {
      // No locale prefix — /de|/en/* 301s onto the bare path (public/_redirects) and the
      // page reads ?article= off the query string. See the note in newsletter.js.
      const link = `${WEBSITE_URL}/news/?article=${escHtml(n.slug)}`;
      const title = (locale === 'en' && n.title_en) ? n.title_en : n.title;
      body += `<div style="padding:8px 0;border-bottom:1px solid #334155"><a href="${link}" style="color:#60a5fa;text-decoration:none;font-weight:600;font-size:14px">${escHtml(title)}</a>`;
      const excerpt = (locale === 'en' && n._excerptEn) ? n._excerptEn : n.excerpt;
      if (excerpt) body += `<div style="color:#94a3b8;font-size:13px;margin-top:2px;text-align:justify">${escHtml(excerpt)}</div>`;
      body += '</div>';
    }
  }

  // Results section — grouped by sport
  if (results.length > 0) {
    body += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;margin:20px 0 12px">${t('Resultate', 'Results')}</div>`;
    const vbResults = results.filter(g => !g._sport || g._sport === 'volleyball');
    const bbResults = results.filter(g => g._sport === 'basketball');
    if (vbResults.length > 0) {
      body += `<div style="font-size:12px;font-weight:700;color:#FFC832;margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.3px">🏐 Volleyball</div>`;
      for (const g of vbResults) body += buildGameCard(g, true);
    }
    if (bbResults.length > 0) {
      body += `<div style="font-size:12px;font-weight:700;color:#F97316;margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.3px">🏀 Basketball</div>`;
      for (const g of bbResults) body += buildGameCard(g, true);
    }
  }

  // Upcoming games — grouped by sport
  if (upcoming.length > 0) {
    body += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;margin:20px 0 12px">${t('Kommende Spiele', 'Upcoming Games')}</div>`;
    const vbUpcoming = upcoming.filter(g => !g._sport || g._sport === 'volleyball');
    const bbUpcoming = upcoming.filter(g => g._sport === 'basketball');
    if (vbUpcoming.length > 0) {
      body += `<div style="font-size:12px;font-weight:700;color:#FFC832;margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.3px">🏐 Volleyball</div>`;
      for (const g of vbUpcoming) body += buildGameCard(g, false);
    }
    if (bbUpcoming.length > 0) {
      body += `<div style="font-size:12px;font-weight:700;color:#F97316;margin:12px 0 6px;text-transform:uppercase;letter-spacing:0.3px">🏀 Basketball</div>`;
      for (const g of bbUpcoming) body += buildGameCard(g, false);
    }
  }

  // Events
  if (events.length > 0) {
    body += `<div style="font-size:11px;text-transform:uppercase;letter-spacing:0.5px;color:#64748b;font-weight:700;margin:20px 0 8px">Events</div>`;
    for (const ev of events) {
      body += `<div style="padding:6px 0;border-bottom:1px solid #334155;font-size:13px;color:#e2e8f0"><span style="color:#94a3b8">${formatDateCH(ev.startDate || ev.date)}</span> &nbsp; ${escHtml(ev.title)}${ev.location ? ' — ' + escHtml(ev.location) : ''}</div>`;
    }
  }

  // Unsubscribe
  body += `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #334155;text-align:center;font-size:12px;color:#64748b"><a href="${unsubUrl}" style="color:#64748b;text-decoration:underline">${t('Newsletter abbestellen', 'Unsubscribe')}</a></div>`;

  const now = new Date();
  const monthNames = locale === 'de'
    ? ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
    : ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

  return buildEmailLayout(body, {
    title: `KSCW ${t('Monatsupdate', 'Monthly Update')}`,
    subtitle: `${monthNames[prevMonth]} ${year}`,
  });
}

export function registerNewsletterDigest(router, { database, logger, services, getSchema }) {
  const log = logger.child({ endpoint: 'newsletter-digest' });

  router.post('/newsletter/digest', async (req, res) => {
    try {
      // Require auth — validate bearer token against Directus admin token
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const token = authHeader.slice(7);
      const adminToken = process.env.DIRECTUS_ADMIN_TOKEN || process.env.ADMIN_ACCESS_TOKEN;
      if (!adminToken || !constantTimeEqual(token, adminToken)) {
        log.warn('newsletter-digest: invalid bearer token attempt');
        return res.status(403).json({ error: 'Forbidden' });
      }

      const now = new Date();
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(now.getDate() - 30);
      const thirtyDaysFromNow = new Date(now);
      thirtyDaysFromNow.setDate(now.getDate() + 30);

      const agoISO = thirtyDaysAgo.toISOString().slice(0, 10);
      const nowISO = now.toISOString().slice(0, 10);
      const futureISO = thirtyDaysFromNow.toISOString().slice(0, 10);

      // Fetch news
      const news = await database('news')
        .where('is_published', true)
        .where('published_at', '>=', agoISO)
        .orderBy('published_at', 'desc')
        .select('title', 'title_en', 'slug', 'excerpt', 'category');

      // Fetch recent results (with league, type, sets)
      const results = await database('games')
        .where('date', '>=', agoISO)
        .where('date', '<=', nowISO)
        .whereNotNull('home_score')
        .orderBy('date', 'desc')
        .limit(20)
        .select('date', 'time', 'home_team', 'away_team', 'home_score', 'away_score', 'kscw_team', 'type', 'league', 'sets_json');

      // Fetch upcoming games
      const upcoming = await database('games')
        .where('date', '>', nowISO)
        .where('date', '<=', futureISO)
        .orderBy('date', 'asc')
        .limit(20)
        .select('date', 'time', 'home_team', 'away_team', 'kscw_team', 'type', 'league');

      // Fetch events
      const events = await database('events')
        .where('start_date', '>=', agoISO)
        .where('start_date', '<=', futureISO)
        .orderBy('start_date', 'asc')
        .select('title', 'start_date as startDate', 'location');

      if (!news.length && !results.length && !upcoming.length && !events.length) {
        log.info('Newsletter digest: no content, skipping');
        return res.json({ success: true, sent: 0, reason: 'no_content' });
      }

      const subscribers = await database('newsletter_subscribers')
        .where('verified', true)
        .select('email', 'locale', 'categories', 'unsubscribe_token');

      if (!subscribers.length) {
        log.info('Newsletter digest: no subscribers');
        return res.json({ success: true, sent: 0, reason: 'no_subscribers' });
      }

      // Resolve team sports for category filtering
      const teamIds = [...new Set([...results, ...upcoming].map(g => g.kscw_team).filter(Boolean))];
      const teamSports = {};
      if (teamIds.length) {
        const teams = await database('teams').whereIn('id', teamIds).select('id', 'sport');
        for (const t of teams) teamSports[t.id] = t.sport;
      }

      // Attach sport to each game for grouping in email template
      for (const g of results) g._sport = teamSports[g.kscw_team] || 'volleyball';
      for (const g of upcoming) g._sport = teamSports[g.kscw_team] || 'volleyball';

      // Generate AI summaries (2 calls: DE + EN)
      const baseSummary = {
        results: results.slice(0, 5).map(r => `[${r._sport}] ${r.home_team} ${r.home_score}:${r.away_score} ${r.away_team}`),
        upcoming: upcoming.slice(0, 5).map(u => `[${u._sport}] ${u.home_team} vs ${u.away_team} (${u.date})`),
        events: events.slice(0, 3).map(e => e.title),
      };
      const summaryDataDE = { ...baseSummary, news: news.slice(0, 5).map(n => n.title) };
      const summaryDataEN = { ...baseSummary, news: news.slice(0, 5).map(n => n.title_en || n.title) };

      const monthNamesDE = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
      const monthNamesEN = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
      const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();

      const summaryDE = await generateSummary('de', summaryDataDE, monthNamesDE[prevMonth], prevYear);
      const summaryEN = await generateSummary('en', summaryDataEN, monthNamesEN[prevMonth], prevYear);

      // Translate excerpts to EN via DeepL
      const hasEnSubscribers = subscribers.some(s => s.locale === 'en');
      if (hasEnSubscribers && DEEPL_API_KEY) {
        for (const n of news) {
          if (!n.excerpt) continue;
          try {
            const transResp = await fetch('https://api-free.deepl.com/v2/translate', {
              method: 'POST',
              headers: { 'Authorization': `DeepL-Auth-Key ${DEEPL_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: [n.excerpt], source_lang: 'DE', target_lang: 'EN' }),
            });
            const transResult = await transResp.json();
            n._excerptEn = transResult.translations?.[0]?.text || n.excerpt;
          } catch (err) { console.error('DeepL translation failed:', err.message); n._excerptEn = n.excerpt; }
        }
      }

      // Send emails
      const schema = await getSchema();
      const { MailService } = services;
      const mail = new MailService({ schema, knex: database });
      let sent = 0;

      for (const sub of subscribers) {
        const cats = typeof sub.categories === 'string' ? JSON.parse(sub.categories) : sub.categories || ['volleyball', 'basketball', 'club'];
        const catSet = new Set(cats);

        const subNews = news.filter(n => catSet.has(n.category || 'club'));
        const subResults = results.filter(g => !g.kscw_team || catSet.has(teamSports[g.kscw_team] || 'club'));
        const subUpcoming = upcoming.filter(g => !g.kscw_team || catSet.has(teamSports[g.kscw_team] || 'club'));
        const subEvents = catSet.has('club') ? events : [];

        if (!subNews.length && !subResults.length && !subUpcoming.length && !subEvents.length) continue;

        const summary = sub.locale === 'en' ? summaryEN : summaryDE;
        const unsubUrl = `${WEBSITE_URL}/news/?unsubscribe=${sub.unsubscribe_token}`;
        const html = buildDigestHtml(sub.locale, summary, subNews, subResults, subUpcoming, subEvents, unsubUrl);

        const monthNames = sub.locale === 'de'
          ? ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember']
          : ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
        const year = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const subject = sub.locale === 'de'
          ? `KSCW Monatsupdate — ${monthNames[prevMonth]} ${year}`
          : `KSCW Monthly Update — ${monthNames[prevMonth]} ${year}`;

        try {
          await mail.send({ to: sub.email, subject, html });
          sent++;
        } catch (mailErr) {
          log.error({ msg: `Failed to send digest to ${sub.email}: ${mailErr.message}` });
        }
      }

      log.info(`Newsletter digest sent to ${sent} subscribers`);
      res.json({ success: true, sent });
    } catch (err) {
      log.error({ msg: `newsletter/digest: ${err.message}`, stack: err.stack });
      res.status(500).json({ error: 'Internal error' });
    }
  });
}
