import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teamLanguage, teamName, translatedText, germanText } from '../vm-team-language.mjs';
import { gameToSvrzRow } from '../svrz-scheduling-sync.mjs';

// VM's shape: `name` in the logged-in account's language, all three under translations
const team = (clubId, names) => ({
  name: names.it ?? names.de,
  club: clubId == null ? undefined : { identifier: clubId },
  translations: { de: { name: names.de ?? '' }, fr: { name: names.fr ?? '' }, it: { name: names.it ?? '' } },
});
const names = { de: 'Muster DE', fr: 'Muster FR', it: 'Muster IT' };

test('Ticino Italian, Romandie French, German-speaking Switzerland German', () => {
  assert.equal(teamName(team('915001', names)), 'Muster IT');
  for (const id of ['901001', '902001', '904001']) assert.equal(teamName(team(id, names)), 'Muster FR', id);
  for (const id of ['907001', '909001', '910001', '911001', '912530', '913001', '914001']) assert.equal(teamName(team(id, names)), 'Muster DE', id);
});

test('bilingual associations: French unless the club is in the German-speaking part', () => {
  assert.equal(teamLanguage(team('903060', names)), 'fr', 'Valais romand');
  assert.equal(teamLanguage(team('903300', names)), 'de', 'Oberwallis');
  assert.equal(teamLanguage(team('906150', names)), 'fr', 'Fribourg');
  assert.equal(teamLanguage(team('906100', names)), 'de', 'Sense');
  assert.equal(teamLanguage(team('905320', names)), 'fr', 'Jura');
  assert.equal(teamLanguage(team('905270', names)), 'de', 'Seeland');
});

test('no or unknown club number: German; number ids count', () => {
  assert.equal(teamName(team(null, names)), 'Muster DE');
  assert.equal(teamName(team('999001', names)), 'Muster DE');
  assert.equal(teamLanguage(null), 'de');
  assert.equal(teamName(team(915001, names)), 'Muster IT');
});

test('empty text falls back to German, then the plain field', () => {
  assert.equal(teamName(team('915001', { de: 'Muster DE', it: ' ' })), 'Muster DE');
  assert.equal(teamName({ name: 'Plain', club: { identifier: '901001' } }), 'Plain');
  assert.equal(translatedText(null), null);
  assert.equal(germanText({ name: 'Coppa', translations: { de: { name: 'Cup' } } }), 'Cup');
});

test('gameToSvrzRow: region names, never the account language', () => {
  const row = gameToSvrzRow({
    number: 406001,
    encounter: {
      teamHome: team('912001', { de: 'VBC Musterdorf HU23-1', fr: 'VBC Musterdorf 1', it: 'VBC Musterdorf 1' }),
      teamAway: team('915001', { de: 'Pallavolo Esempio DE', fr: 'Pallavolo Esempio DE', it: 'Pallavolo Esempio' }),
    },
  });
  assert.equal(row.home_team_name, 'VBC Musterdorf HU23-1');
  assert.equal(row.away_team_name, 'Pallavolo Esempio');
  assert.equal(row.home_club_id, '912001');
});

test('gameToSvrzRow: league category in German', () => {
  const row = gameToSvrzRow({
    number: 406002,
    encounter: {
      teamHome: { name: 'A', leagueCategory: { name: 'Coppa', translations: { de: { name: 'Cup' }, it: { name: 'Coppa' } } } },
      teamAway: { name: 'B' },
    },
  });
  assert.equal(row.league_short, 'Cup');
});
