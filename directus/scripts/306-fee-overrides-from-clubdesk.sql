-- 306 — pin the register's own Mitgliederbeitrag onto the 113 members where
-- wiedisync's fee engine and ClubDesk disagree. THE REGISTER WINS (user
-- decision 2026-08-10).
--
-- WHY THIS EXISTS. The club is billing season 2026/27 from wiedisync, not from
-- ClubDesk (vendor bug). The native dues run prices every member through
-- feeBreakdown(), so whatever the engine derives is what gets invoiced — and
-- measured on prod with that same engine over all 674 active linked members,
-- 113 of them would have been billed a different number from the one the
-- register holds:
--
--   • 51 × +100  the engine adds the no-Schreiberlizenz / Offiziellen surcharge
--                where ClubDesk holds the plain base
--   • 24 × the register says 0 (a waived fee) and the engine would have billed
--                the full category amount — 440, 520, 620 …
--   • 10 × the register holds MORE than the engine derives (a 1.-Liga price on
--                a non-1.-Liga category, a Gratis member who still pays 40)
--   • 28 × per-person amounts no category can express (155, 270, 280, 430, 130)
--
-- Net effect of this migration: the August run bills CHF 19'355 LESS than the
-- engine alone would have. That is the point — those 113 numbers are decisions
-- the club already made, and an invoice must not quietly overrule them.
--
-- ⚠⚠ THE TRAP THIS FILE EXISTS TO AVOID: `fee_base_override` is the BASE, and
-- ClubDesk's cell is the TOTAL. Copying the total straight in would make the
-- engine add the CHF 100 surcharge ON TOP of a number that already contains it
-- (540 → 640). So two columns are written together:
--   • fee_surcharge_override = false  — the surcharge is inside the register's
--     number already, or was deliberately not charged; either way the engine
--     must not add it. It also pins the total against a later licence change.
--   • fee_base_override      = the base that makes the engine emit EXACTLY the
--     register's amount. For a normal member that is the register amount. For
--     a PURE GUEST (8 of the 113) the engine still subtracts the CHF 110 guest
--     reduction, so the base is stored 110 ABOVE the billed amount — the
--     comments below flag each one.
-- Every one of the 113 rows was verified by re-running feeBreakdown() with the
-- values in this file: 113/113 emit the register's amount, 0 mismatches.
--
-- NOT INCLUDED: the 11 basketball rows where ClubDesk is simply stale by the
-- +10 increase. There wiedisync is right and the correction travels the other
-- way, via migration 305. Read the two together.
--
-- Fill-only by design (`fee_base_override IS NULL`): a re-run can never
-- overwrite an override a treasurer set afterwards. All 113 were NULL when this
-- was written (prod holds 0 overrides in total).

UPDATE members m
SET fee_base_override = v.base_chf,
    fee_surcharge_override = false
FROM (VALUES
  (255, 0),  -- Daniela Imhof · VB Erwerbstätige: register 0, engine had 440
  (455, 0),  -- Jasmin Wyrsch · BB Erwerbstätige: register 0, engine had 520
  (423, 0),  -- Gordana Tomic · BB Erwerbstätige: register 0, engine had 520
  (538, 440),  -- Livio Fosco · VB Erwerbstätige: register 440, engine had 540
  (655, 40),  -- Luzi Guldener · Gratis: register 40, engine had 0
  (606, 270),  -- Jérémy Rebord · VB Student*in Meisterschaft: register 270, engine had 480
  (98, 110),  -- Livia Schlegel · VB Erwerbstätige: register 0 (guest → base sits 110 above it), engine had 330
  (663, 0),  -- Eva Schnarwyler · Passivmitglied: register 0, engine had 40
  (600, 430),  -- Tilla Tessa Honegger · VB Erwerbstätige: register 430, engine had 540
  (78, 330),  -- Hella Mönkeberg · VB Erwerbstätige: register 330, engine had 440
  (664, 0),  -- Adrian Kunz · Passivmitglied: register 0, engine had 40
  (665, 0),  -- Gina Marti · VB Erwerbstätige: register 0, engine had 440
  (238, 490),  -- Zora Hebeisen · VB Student*in Meisterschaft: register 380 (guest → base sits 110 above it), engine had 270
  (27, 330),  -- Martin Beeler · VB Erwerbstätige: register 330, engine had 540
  (594, 310),  -- Cynthia Spale · VB Schüler*in Meisterschaft: register 310, engine had 410
  (236, 0),  -- Julia Hagen · BB Erwerbstätige: register 0, engine had 520
  (389, 0),  -- Alina Schmuziger · BB Erwerbstätige: register 0, engine had 520
  (118, 0),  -- Rendel Arner · BB Erwerbstätige: register 0, engine had 620
  (731, 0),  -- Alma Yanika Zehnder · BB Erwerbstätige: register 0, engine had 520
  (69, 110),  -- Jasmin Lier · VB Erwerbstätige: register 0 (guest → base sits 110 above it), engine had 330
  (58, 550),  -- Jule Horlbog · VB Erwerbstätige: register 440 (guest → base sits 110 above it), engine had 330
  (25, 110),  -- Hanna Baumgartner · VB Erwerbstätige: register 0 (guest → base sits 110 above it), engine had 330
  (469, 490),  -- Dino Müller · VB Student*in Meisterschaft: register 380 (guest → base sits 110 above it), engine had 270
  (622, 440),  -- Keven Danieli · VB Erwerbstätige: register 440, engine had 540
  (489, 310),  -- Robin Ganguillet · BB Jugend Meisterschaft: register 310, engine had 420
  (624, 440),  -- Yuri Roth · VB Erwerbstätige: register 440, engine had 540
  (490, 0),  -- Adnan Fritsche · BB Erwerbstätige: register 0, engine had 620
  (491, 280),  -- Luca Bianchi · BB Erwerbstätige: register 280, engine had 620
  (573, 440),  -- Vitaly Gatsko · VB Erwerbstätige: register 440, engine had 540
  (575, 380),  -- Kevin Seav · VB Student*in Meisterschaft: register 380, engine had 480
  (454, 470),  -- Lilly Wunderlin · BB Erwerbstätige 1. Liga: register 470, engine had 670
  (628, 330),  -- Liv Schillig · BB Jugend Meisterschaft: register 330, engine had 420
  (515, 310),  -- Lina Burri · VB Schüler*in Meisterschaft: register 310, engine had 410
  (609, 430),  -- Jennifer Kündig · VB Erwerbstätige: register 430, engine had 540
  (574, 310),  -- Elias Abdellaoui · VB Schüler*in Meisterschaft: register 310, engine had 410
  (418, 0),  -- Cynthia Tidas · BB Erwerbstätige: register 0, engine had 520
  (497, 40),  -- Matthias Hofmann · Gratis: register 40, engine had 0
  (376, 310),  -- Aron Sadiku · VB Schüler*in Meisterschaft: register 310, engine had 410
  (369, 310),  -- Amaël Riesterer · VB Schüler*in Meisterschaft: register 310, engine had 410
  (552, 0),  -- Inara Linggi · BB Jugend Meisterschaft: register 0, engine had 320
  (343, 150),  -- Celina Paulsson · VB Erwerbstätige: register 40 (guest → base sits 110 above it), engine had 330
  (611, 310),  -- Louisa Sodige · VB Schüler*in Meisterschaft: register 310, engine had 410
  (171, 570),  -- Pénélope Courtine · BB Erwerbstätige: register 570, engine had 520
  (608, 380),  -- Leandro Muhl · VB Student*in Meisterschaft: register 380, engine had 480
  (247, 0),  -- Stephanie Huwiler · VB Erwerbstätige: register 0, engine had 440
  (623, 380),  -- Haydari Hussain · VB Student*in Meisterschaft: register 380, engine had 480
  (590, 370),  -- Tanya Spale · VB Student*in Meisterschaft: register 370, engine had 480
  (582, 380),  -- Jeannette Burri · VB Student*in Meisterschaft: register 380, engine had 480
  (517, 380),  -- Laila Mächler · VB Student*in Meisterschaft: register 380, engine had 480
  (52, 330),  -- Sarina Grieder · VB Student*in Meisterschaft: register 330, engine had 380
  (518, 310),  -- Lara Neumann · VB Schüler*in Meisterschaft: register 310, engine had 410
  (583, 310),  -- Lisa Bernhard · VB Schüler*in Meisterschaft: register 310, engine had 410
  (424, 0),  -- Karin Toolanen · BB Erwerbstätige: register 0, engine had 520
  (599, 370),  -- Shinwari Said Khan · VB Student*in Meisterschaft: register 370, engine had 480
  (177, 210),  -- Elena Deluche · VB Schüler*in Turnier: register 210, engine had 310
  (180, 330),  -- Deborah Derendinger · VB Erwerbstätige: register 330, engine had 440
  (287, 0),  -- Louisa Kuehne · BB Lernende/Studierende 1. Liga: register 0, engine had 570
  (445, 330),  -- Nadia Weber · VB Erwerbstätige: register 330, engine had 440
  (589, 440),  -- Lucy Haller · VB Erwerbstätige: register 440, engine had 540
  (591, 310),  -- Marta Hien · VB Schüler*in Meisterschaft: register 310, engine had 410
  (587, 310),  -- Gregor Chmelik · VB Schüler*in Meisterschaft: register 310, engine had 410
  (42, 380),  -- Rachèle Fabry · VB Student*in Meisterschaft: register 380, engine had 480
  (251, 310),  -- Nasir Ahmad Ibrahimkhil · VB Schüler*in Meisterschaft: register 310, engine had 410
  (196, 310),  -- Alimadad Fayazi · VB Schüler*in Meisterschaft: register 310, engine had 410
  (168, 310),  -- Niklaus Christen · VB Schüler*in Meisterschaft: register 310, engine had 410
  (581, 310),  -- Jonas Dastoor · VB Schüler*in Meisterschaft: register 310, engine had 410
  (625, 380),  -- Julia Kirschner · VB Student*in Meisterschaft: register 380, engine had 480
  (504, 310),  -- Nicola Waldinsperger · BB Jugend Meisterschaft: register 310, engine had 420
  (437, 0),  -- Nicolas Voiry · BB Erwerbstätige: register 0, engine had 520
  (160, 210),  -- Amelie Byber · VB Schüler*in Turnier: register 210, engine had 310
  (117, 210),  -- Luisa Appel · VB Schüler*in Turnier: register 210, engine had 310
  (137, 210),  -- Giulia Blaser · VB Schüler*in Turnier: register 210, engine had 310
  (597, 210),  -- Lilou Vetsch · VB Schüler*in Turnier: register 210, engine had 310
  (132, 210),  -- Gianna Bieri · VB Schüler*in Turnier: register 210, engine had 310
  (516, 380),  -- Bigna Liesch · VB Student*in Meisterschaft: register 380, engine had 480
  (592, 310),  -- Shahin Hama · VB Schüler*in Meisterschaft: register 310, engine had 410
  (584, 380),  -- Giorgia Bonomelli · VB Student*in Meisterschaft: register 380, engine had 480
  (596, 380),  -- Nikolina Gojkovic · VB Student*in Meisterschaft: register 380, engine had 480
  (122, 0),  -- Xavier Balaguer Rasillo · BB Erwerbstätige: register 0, engine had 520
  (235, 380),  -- Leroy Hafner · VB Student*in Meisterschaft: register 380, engine had 480
  (166, 210),  -- Frida Chini · VB Schüler*in Turnier: register 210, engine had 310
  (269, 210),  -- Manon Karl · VB Schüler*in Turnier: register 210, engine had 310
  (178, 0),  -- Lisa Demaison · BB Erwerbstätige: register 0, engine had 520
  (362, 210),  -- Sofia Remmele · VB Schüler*in Turnier: register 210, engine had 310
  (468, 310),  -- Tina Graf · VB Schüler*in Meisterschaft: register 310, engine had 410
  (184, 210),  -- Seraphine Diebold · VB Schüler*in Turnier: register 210, engine had 310
  (576, 155),  -- Darko Lasic · BB 2 Trainings: register 155, engine had 420
  (458, 0),  -- Elissvet Zamanidi · BB Erwerbstätige: register 0, engine had 620
  (267, 420),  -- Davide Kambli · BB Lernende/Studierende: register 420, engine had 520
  (408, 420),  -- Jacob Benjamin Steven · BB Lernende/Studierende: register 420, engine had 520
  (616, 310),  -- Shangith Shanmugarajah · BB Jugend Meisterschaft: register 310, engine had 420
  (507, 210),  -- Lena Fahrni · BB Jugend Meisterschaft: register 210, engine had 320
  (508, 310),  -- Maxim Brodmann · BB Jugend Meisterschaft: register 310, engine had 420
  (509, 210),  -- Jonathan Suter · BB Jugend Meisterschaft: register 210, engine had 320
  (580, 310),  -- Eleonore Duss · VB Schüler*in Meisterschaft: register 310, engine had 410
  (24, 310),  -- Diego Baumann · VB Student*in Meisterschaft: register 310, engine had 480
  (327, 410),  -- Alva Müller · VB Student*in Meisterschaft: register 410, engine had 480
  (86, 310),  -- Emma Palla · VB Schüler*in Meisterschaft: register 310, engine had 410
  (436, 310),  -- Rafi Villalaz · VB Schüler*in Meisterschaft: register 310, engine had 410
  (331, 110),  -- Marharyta Napasnikava · VB Erwerbstätige: register 0 (guest → base sits 110 above it), engine had 330
  (363, 570),  -- Nils Repond · BB Erwerbstätige: register 570, engine had 520
  (307, 570),  -- Elin Magyar · BB Erwerbstätige: register 570, engine had 520
  (357, 570),  -- Franziska Raff · BB Erwerbstätige: register 570, engine had 520
  (243, 310),  -- Léo Hoffmann · VB Schüler*in Meisterschaft: register 310, engine had 410
  (199, 110),  -- Noah Felsing · VB Schüler*in Turnier: register 110, engine had 310
  (314, 440),  -- Theo Mayer · VB Erwerbstätige: register 440, engine had 540
  (572, 410),  -- Nora Banfic · VB Student*in Meisterschaft: register 410, engine had 480
  (346, 410),  -- Suna Peter · VB Student*in Meisterschaft: register 410, engine had 480
  (234, 310),  -- Kimia Habibian · VB Schüler*in Meisterschaft: register 310, engine had 410
  (158, 470),  -- Gioia Buschta · BB Lernende/Studierende: register 470, engine had 420
  (422, 310),  -- Elias Tobler · VB Student*in Meisterschaft: register 310, engine had 480
  (601, 130),  -- Annalea Ablondi · VB Erwerbstätige: register 130, engine had 540
  (534, 310)   -- Alban Scholtz · VB Schüler*in Meisterschaft: register 310, engine had 410
) AS v(member_id, base_chf)
WHERE m.id = v.member_id
  AND m.fee_base_override IS NULL;
