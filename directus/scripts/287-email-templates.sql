-- 287-email-templates.sql
--
-- Editable transactional email copy (`email_templates`) + an archive of what was
-- actually sent (`email_sends`).
--
-- WHY
-- ---
-- The document-request email added on 2026-08-06 is remediation copy: it goes to
-- families whose paperwork the club destroyed, and the exact wording is a judgement
-- call the people who talk to those families should own. Until now every word of
-- every transactional email lived in `kscw-endpoints` and changing one required an
-- ext:deploy — so the copy was effectively frozen between deploys and out of reach
-- of the committee members who actually write to parents.
--
-- SAFETY MODEL — why an editable template cannot break a send
-- -----------------------------------------------------------
-- The compiled-in copy in registration.js stays, and is the FALLBACK. Merging is
-- per FIELD, not per row (email-templates.js → mergeTemplate):
--   * no row for this locale        → every field falls back to code
--   * row exists, one box cleared   → that field falls back to code
--   * this table missing entirely   → loadTemplate catches and returns null
-- so the worst outcome of a bad edit is the email people are already getting.
-- A blank box therefore RESTORES the default rather than sending an empty subject.
--
-- `{{documents}}` is required in body_html and enforced by the kscw-hooks write
-- filter, not just in the browser: the items API is reachable from the Directus
-- admin app and any API client, and a body without it tells a family that something
-- is missing without ever saying what.
--
-- WHY email_sends EXISTS
-- ----------------------
-- `user_logs` records that a send happened, by whom, to which address. It cannot
-- answer "what exactly did we tell this family?" once the template is editable —
-- re-rendering the template in November gives November's wording, not August's. So
-- the rendered subject + body are stored at send time. Written only by the endpoint;
-- staff read it, nobody edits it.
--
-- ⚠ It holds member-facing PII (name + email inside the body), so it is admin/
-- superuser/sport-admin read ONLY — never in the Member policy. setup-permissions.mjs
-- is the source of truth for that; this migration grants nothing.
--
-- Schema + seed, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS email_templates (
  id            serial PRIMARY KEY,
  template_key  varchar(64)  NOT NULL,
  locale        varchar(5)   NOT NULL,
  subject       text,
  title         varchar(255),
  greeting      varchar(255),
  body_html     text,
  cta_label     varchar(120),
  footer        varchar(255),
  updated_by_name  varchar(255),
  updated_by_email varchar(255),
  date_updated  timestamptz
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_templates_key_locale_uniq') THEN
    ALTER TABLE email_templates ADD CONSTRAINT email_templates_key_locale_uniq UNIQUE (template_key, locale);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_templates_locale_chk') THEN
    ALTER TABLE email_templates ADD CONSTRAINT email_templates_locale_chk
      CHECK (locale IN ('de', 'gsw', 'en', 'fr', 'it'));
  END IF;
END $$;

COMMENT ON TABLE email_templates IS
  'Staff-editable copy for transactional emails, one row per (template_key, locale). The compiled-in copy in kscw-endpoints remains the per-FIELD fallback — a missing row or a cleared box restores the default, so editing text can never break a send. Placeholders are {{name}}-style; the kscw-hooks write filter rejects unknown ones and requires {{documents}} in body_html.';
COMMENT ON COLUMN email_templates.body_html IS
  'Message body, staff-authored HTML. MUST contain {{documents}}. Sanitized on write (script/style/iframe/on* handlers/javascript: URLs stripped) and again at send.';

CREATE TABLE IF NOT EXISTS email_sends (
  id            serial PRIMARY KEY,
  template_key  varchar(64),
  locale        varchar(5),
  to_email      varchar(255),
  subject       text,
  body_html     text,
  collection_name varchar(64),
  record_id     varchar(64),
  sent_by       integer,
  sent_by_name  varchar(255),
  sent_at       timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_sends_sent_by_fkey') THEN
    ALTER TABLE email_sends ADD CONSTRAINT email_sends_sent_by_fkey
      FOREIGN KEY (sent_by) REFERENCES members(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_sends_sent_at_idx ON email_sends (sent_at DESC);
CREATE INDEX IF NOT EXISTS email_sends_record_idx  ON email_sends (collection_name, record_id);

COMMENT ON TABLE email_sends IS
  'Archive of transactional emails actually sent: the rendered subject + body at send time. Exists because email_templates is editable — re-rendering later gives today''s wording, not what the recipient received. Written by kscw-endpoints only; read-only for staff. Holds PII (name + email in the body) — admin/superuser/sport-admin read only, never Member.';

-- Seed the current compiled-in copy so the editor opens on real text rather than
-- empty boxes. ON CONFLICT DO NOTHING: a re-run must never clobber staff edits.
INSERT INTO email_templates (template_key, locale, subject, title, greeting, body_html, cta_label, footer)
VALUES ('registration_docs_request', 'de', 'Bitte Dokumente erneut hochladen — KSC Wiedikon Basketball', 'Dokumente fehlen', 'Hallo {{name}},', '<p>wegen eines technischen Fehlers auf unserer Seite sind die Dokumente zur Anmeldung von <strong style="color:#e2e8f0">{{name}}</strong> bei uns nicht lesbar angekommen. Das liegt nicht an dir — wir müssen dich leider trotzdem bitten, sie noch einmal hochzuladen.</p>
<p><strong style="color:#e2e8f0">Diese Dokumente fehlen uns noch:</strong></p>
{{documents}}
<p>Über den Button unten kommst du direkt auf die Upload-Seite. Referenz und E-Mail sind bereits ausgefüllt — du musst nur noch die Dateien auswählen (JPG, PNG oder PDF, max. 10 MB pro Datei).</p>
<p style="font-size:13px;color:#94a3b8">Referenz: {{reference}} · E-Mail: {{email}}</p>
<p>Die Anmeldung selbst bleibt gültig — es fehlen nur die Dokumente für die Lizenz bei Swiss Basketball. Bei Fragen antworte einfach auf diese E-Mail oder schreib an <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>', 'Dokumente hochladen', 'Vielen Dank — KSC Wiedikon Basketball')
ON CONFLICT (template_key, locale) DO NOTHING;

INSERT INTO email_templates (template_key, locale, subject, title, greeting, body_html, cta_label, footer)
VALUES ('registration_docs_request', 'gsw', 'Bitte Dokumente erneut hochladen — KSC Wiedikon Basketball', 'Dokumente fehlen', 'Hallo {{name}},', '<p>wegen eines technischen Fehlers auf unserer Seite sind die Dokumente zur Anmeldung von <strong style="color:#e2e8f0">{{name}}</strong> bei uns nicht lesbar angekommen. Das liegt nicht an dir — wir müssen dich leider trotzdem bitten, sie noch einmal hochzuladen.</p>
<p><strong style="color:#e2e8f0">Diese Dokumente fehlen uns noch:</strong></p>
{{documents}}
<p>Über den Button unten kommst du direkt auf die Upload-Seite. Referenz und E-Mail sind bereits ausgefüllt — du musst nur noch die Dateien auswählen (JPG, PNG oder PDF, max. 10 MB pro Datei).</p>
<p style="font-size:13px;color:#94a3b8">Referenz: {{reference}} · E-Mail: {{email}}</p>
<p>Die Anmeldung selbst bleibt gültig — es fehlen nur die Dokumente für die Lizenz bei Swiss Basketball. Bei Fragen antworte einfach auf diese E-Mail oder schreib an <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>', 'Dokumente hochladen', 'Vielen Dank — KSC Wiedikon Basketball')
ON CONFLICT (template_key, locale) DO NOTHING;

INSERT INTO email_templates (template_key, locale, subject, title, greeting, body_html, cta_label, footer)
VALUES ('registration_docs_request', 'en', 'Please re-upload your documents — KSC Wiedikon Basketball', 'Documents missing', 'Hi {{name}},', '<p>because of a technical fault on our side, the documents for <strong style="color:#e2e8f0">{{name}}</strong>''s registration did not reach us in a readable state. This was not your mistake — but we do have to ask you to upload them once more.</p>
<p><strong style="color:#e2e8f0">These documents are still missing:</strong></p>
{{documents}}
<p>The button below takes you straight to the upload page. Your reference and email are already filled in — you only need to pick the files (JPG, PNG or PDF, max. 10 MB each).</p>
<p style="font-size:13px;color:#94a3b8">Reference: {{reference}} · Email: {{email}}</p>
<p>The registration itself stays valid — only the documents for the Swiss Basketball licence are missing. If anything is unclear, just reply to this email or write to <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>', 'Upload documents', 'Thank you — KSC Wiedikon Basketball')
ON CONFLICT (template_key, locale) DO NOTHING;

INSERT INTO email_templates (template_key, locale, subject, title, greeting, body_html, cta_label, footer)
VALUES ('registration_docs_request', 'fr', 'Merci de téléverser à nouveau tes documents — KSC Wiedikon Basketball', 'Documents manquants', 'Salut {{name}},', '<p>en raison d''une erreur technique de notre côté, les documents de l''inscription de <strong style="color:#e2e8f0">{{name}}</strong> ne nous sont pas parvenus dans un état lisible. Ce n''est pas de ta faute — nous devons malgré tout te demander de les téléverser une nouvelle fois.</p>
<p><strong style="color:#e2e8f0">Ces documents nous manquent encore :</strong></p>
{{documents}}
<p>Le bouton ci-dessous te mène directement à la page de téléversement. Ta référence et ton e-mail sont déjà remplis — il te suffit de choisir les fichiers (JPG, PNG ou PDF, 10 Mo max. par fichier).</p>
<p style="font-size:13px;color:#94a3b8">Référence : {{reference}} · E-mail : {{email}}</p>
<p>L''inscription elle-même reste valable — seuls les documents pour la licence Swiss Basketball manquent. Pour toute question, réponds simplement à cet e-mail ou écris à <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>', 'Téléverser les documents', 'Merci beaucoup — KSC Wiedikon Basketball')
ON CONFLICT (template_key, locale) DO NOTHING;

INSERT INTO email_templates (template_key, locale, subject, title, greeting, body_html, cta_label, footer)
VALUES ('registration_docs_request', 'it', 'Per favore ricarica i tuoi documenti — KSC Wiedikon Basketball', 'Documenti mancanti', 'Ciao {{name}},', '<p>a causa di un errore tecnico da parte nostra, i documenti dell''iscrizione di <strong style="color:#e2e8f0">{{name}}</strong> non ci sono arrivati in forma leggibile. Non è colpa tua — dobbiamo comunque chiederti di caricarli un''altra volta.</p>
<p><strong style="color:#e2e8f0">Ci mancano ancora questi documenti:</strong></p>
{{documents}}
<p>Il pulsante qui sotto ti porta direttamente alla pagina di caricamento. Riferimento ed e-mail sono già compilati — devi solo scegliere i file (JPG, PNG o PDF, max. 10 MB ciascuno).</p>
<p style="font-size:13px;color:#94a3b8">Riferimento: {{reference}} · E-mail: {{email}}</p>
<p>L''iscrizione resta valida — mancano solo i documenti per la licenza Swiss Basketball. Per domande rispondi a questa e-mail o scrivi a <a href="mailto:kontakt@kscw.ch" style="color:#F97316">kontakt@kscw.ch</a>.</p>', 'Carica i documenti', 'Grazie mille — KSC Wiedikon Basketball')
ON CONFLICT (template_key, locale) DO NOTHING;

-- Register both collections + their fields for the items API. An unregistered
-- table is invisible to Directus, so the admin page could not read or write it.
INSERT INTO directus_collections (collection, icon, note, "group", hidden, singleton, sort_field)
SELECT 'email_templates', 'mail', 'Staff-editable copy for transactional emails. The code defaults remain the per-field fallback.', NULL, false, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'email_templates');

INSERT INTO directus_collections (collection, icon, note, "group", hidden, singleton, sort_field)
SELECT 'email_sends', 'outgoing_mail', 'Archive of transactional emails actually sent. Written by the backend; read-only.', NULL, false, false, NULL
WHERE NOT EXISTS (SELECT 1 FROM directus_collections WHERE collection = 'email_sends');

INSERT INTO directus_fields (collection, field, interface, display, readonly, hidden, sort, width, note)
SELECT v.collection, v.field, v.interface, v.display, v.readonly, v.hidden, v.sort, v.width, v.note
FROM (VALUES
  ('email_templates', 'template_key', 'input',            'raw',   true,  false,  1, 'half', 'Which email this is. Set by the migration; not editable.'),
  ('email_templates', 'locale',       'select-dropdown',  'raw',   true,  false,  2, 'half', 'de / gsw / en / fr / it.'),
  ('email_templates', 'subject',      'input',            'raw',   false, false,  3, 'full', 'Subject line. Plain text — {{documents}} is not allowed here.'),
  ('email_templates', 'title',        'input',            'raw',   false, false,  4, 'half', 'Headline inside the email.'),
  ('email_templates', 'greeting',     'input',            'raw',   false, false,  5, 'half', 'e.g. "Hallo {{name}},".'),
  ('email_templates', 'body_html',    'input-rich-text-html', 'raw', false, false, 6, 'full', 'Message body. MUST contain {{documents}}.'),
  ('email_templates', 'cta_label',    'input',            'raw',   false, false,  7, 'half', 'Text on the button.'),
  ('email_templates', 'footer',       'input',            'raw',   false, false,  8, 'half', 'Small line under the button.'),
  ('email_templates', 'updated_by_name',  'input',    'raw', true, false,  9, 'half', NULL),
  ('email_templates', 'updated_by_email', 'input',    'raw', true, true,  10, 'half', NULL),
  ('email_templates', 'date_updated',     'datetime', 'datetime', true, false, 11, 'half', NULL),
  ('email_sends', 'template_key',    'input',    'raw',      true, false, 1, 'half', NULL),
  ('email_sends', 'locale',          'input',    'raw',      true, false, 2, 'half', NULL),
  ('email_sends', 'to_email',        'input',    'raw',      true, false, 3, 'half', NULL),
  ('email_sends', 'subject',         'input',    'raw',      true, false, 4, 'full', NULL),
  ('email_sends', 'body_html',       'input-multiline', 'raw', true, false, 5, 'full', 'The message exactly as it was sent.'),
  ('email_sends', 'collection_name', 'input',    'raw',      true, false, 6, 'half', NULL),
  ('email_sends', 'record_id',       'input',    'raw',      true, false, 7, 'half', NULL),
  ('email_sends', 'sent_by',         'input',    'raw',      true, false, 8, 'half', NULL),
  ('email_sends', 'sent_by_name',    'input',    'raw',      true, false, 9, 'half', NULL),
  ('email_sends', 'sent_at',         'datetime', 'datetime', true, false, 10, 'half', NULL)
) AS v(collection, field, interface, display, readonly, hidden, sort, width, note)
WHERE NOT EXISTS (
  SELECT 1 FROM directus_fields f WHERE f.collection = v.collection AND f.field = v.field);

DO $$
DECLARE n integer; missing integer;
BEGIN
  SELECT count(*) INTO n FROM email_templates WHERE template_key = 'registration_docs_request';
  IF n <> 5 THEN
    RAISE EXCEPTION 'migration 287: expected 5 seeded locales for registration_docs_request, got %', n;
  END IF;
  -- The one invariant the whole feature rests on: without {{documents}} the email
  -- names no documents at all.
  SELECT count(*) INTO missing FROM email_templates
   WHERE template_key = 'registration_docs_request' AND body_html NOT LIKE '%{{documents}}%';
  IF missing > 0 THEN
    RAISE EXCEPTION 'migration 287: % seeded rows are missing the {{documents}} placeholder', missing;
  END IF;
  RAISE NOTICE 'migration 287: email_templates seeded (% locales), email_sends ready', n;
END $$;

COMMIT;
