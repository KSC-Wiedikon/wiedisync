-- 208-basketplan-member-backfill.sql
--
-- Backfill member data from Basketplan (Swiss basketball), club 166, season 2025/26.
-- Source: https://www.basketplan.ch/showPrintLicences.do?clubId=166 — 256 paid licences,
-- matched to `members` on name + birthdate (237 matched, 17 Basketplan people have no member row).
--
-- What this does:
--   1. license_nr       — fill 125 empty, and CORRECT 8 members who hold a sibling's or
--                         parent's licence number (e.g. Edgar Stinson held his father Felix's).
--                         Basketplan is the issuing authority, so its value wins.
--   2. licence_category — fill 237 empty with the Basketplan taxonomy (Senior / U 6..U 20 / Offizielle/r).
--   3. birthdate        — fill 5 empty (visibility defaults to 'hidden', same as the Volleymanager backfill).
--
-- Deliberately NOT imported:
--   * adresse/plz/ort — Basketplan is frequently the WORSE source (it holds "Hagenbuchrain" where
--     we hold the correct "Hagenbuchrain 38"). 58 differ; importing them would degrade good data.
--   * 8 birthdate CONFLICTS (3 are day/month swaps) — left for manual review, not auto-overwritten.
--   * license_nr zero-padding (we store 5886, Basketplan shows 005886) — cosmetic, left alone.
--
-- Idempotent: re-running writes the same values. Fill-only except the 8 forced licence corrections.

BEGIN;

CREATE TEMP TABLE bp_backfill (
  member_id   integer PRIMARY KEY,
  licence_no  text,
  licence_cat text,
  dob         date,
  force_lic   boolean NOT NULL DEFAULT false
) ON COMMIT DROP;

INSERT INTO bp_backfill (member_id, licence_no, licence_cat, dob, force_lic) VALUES
  (502, '826724', 'Offizielle/r', NULL, false),
  (148, '846117', 'U 14', NULL, false),
  (553, '845878', 'U 14', NULL, false),
  (172, '846392', 'U 14', NULL, false),
  (503, '814849', 'Offizielle/r', NULL, false),
  (483, '780958', 'Offizielle/r', NULL, false),
  (200, '845633', 'U 14', NULL, false),
  (505, '836234', 'Offizielle/r', NULL, false),
  (496, '005886', 'Offizielle/r', DATE '1973-11-10', false),
  (249, '812847', 'U 14', NULL, false),
  (250, '823353', 'U 14', NULL, false),
  (271, '825652', 'U 14', NULL, false),
  (285, '820355', 'U 14', NULL, false),
  (495, '784204', 'Offizielle/r', DATE '1968-12-06', false),
  (291, '759984', 'Offizielle/r', NULL, false),
  (297, '846668', 'U 14', NULL, false),
  (338, '804811', 'U 14', NULL, false),
  (478, '012587', 'Offizielle/r', NULL, false),
  (509, '839169', 'U 14', NULL, false),
  (448, '843799', 'U 14', NULL, false),
  (254, '846671', 'U 14', NULL, false),
  (161, '843975', 'U 8', NULL, false),
  (194, '844573', 'U 8', NULL, false),
  (209, '843797', 'U 8', NULL, false),
  (241, '843784', 'U 8', NULL, false),
  (258, '843791', 'U 8', NULL, false),
  (565, '843794', 'U 8', NULL, false),
  (306, '843809', 'U 8', NULL, false),
  (377, '843796', 'U 8', NULL, false),
  (566, '845871', 'U 8', NULL, false),
  (533, '828759', 'Offizielle/r', NULL, false),
  (280, '847048', 'U 14', NULL, false),
  (311, '847047', 'U 14', NULL, false),
  (253, '828718', 'Senior', NULL, false),
  (112, '832440', 'U 10', NULL, false),
  (140, '844393', 'U 10', NULL, false),
  (555, '829464', 'U 10', NULL, false),
  (192, '842072', 'U 10', NULL, false),
  (204, '844472', 'U 10', NULL, false),
  (210, '846309', 'U 10', NULL, true),
  (214, '829441', 'U 10', NULL, false),
  (256, '842070', 'U 10', NULL, false),
  (264, '839798', 'U 10', NULL, false),
  (305, '844282', 'U 10', NULL, false),
  (319, '843272', 'U 10', NULL, false),
  (562, '843273', 'U 10', NULL, false),
  (406, '843263', 'U 10', NULL, false),
  (409, '829440', 'U 10', NULL, true),
  (414, '846390', 'U 10', NULL, false),
  (571, '843020', 'U 10', NULL, false),
  (110, '052157', 'Senior', NULL, false),
  (111, '757769', 'Senior', NULL, true),
  (113, '804830', 'Senior', NULL, false),
  (115, '049707', 'Senior', NULL, false),
  (119, '807895', 'U 16', NULL, false),
  (120, '808087', 'U 16', NULL, false),
  (126, '807958', 'U 18', NULL, false),
  (127, '787846', 'Senior', NULL, false),
  (134, '813392', 'U 16', NULL, false),
  (139, '787844', 'Senior', NULL, false),
  (144, '787047', 'Senior', NULL, false),
  (147, '843798', 'Senior', NULL, false),
  (149, '817647', 'Senior', NULL, false),
  (154, '773092', 'Senior', NULL, false),
  (156, '815715', 'Senior', NULL, false),
  (157, '803187', 'U 16', NULL, false),
  (159, '818217', 'U 16', NULL, false),
  (162, '022843', 'Senior', NULL, false),
  (167, '059863', 'Senior', NULL, false),
  (178, '837355', 'Senior', NULL, false),
  (174, '839018', 'Senior', NULL, false),
  (187, '835002', 'Senior', NULL, false),
  (188, '773496', 'Senior', NULL, false),
  (190, '843806', 'Senior', DATE '1998-08-30', false),
  (203, '769169', 'Senior', NULL, false),
  (532, '826811', 'Senior', NULL, false),
  (216, '825396', 'Senior', DATE '2002-05-29', false),
  (223, '836899', 'Senior', NULL, false),
  (228, '809630', 'Senior', NULL, false),
  (229, '812250', 'U 16', NULL, false),
  (240, '838003', 'U 16', NULL, false),
  (242, '828041', 'U 18', NULL, false),
  (252, '817288', 'Senior', NULL, false),
  (257, '045505', 'Senior', NULL, false),
  (265, '836955', 'Senior', NULL, false),
  (276, '845652', 'Senior', NULL, false),
  (278, '827306', 'U 16', NULL, false),
  (281, '843766', 'U 16', NULL, false),
  (282, '837575', 'U 16', NULL, false),
  (284, '836859', 'U 16', NULL, false),
  (290, '828514', 'U 16', NULL, false),
  (292, '843800', 'Senior', NULL, false),
  (293, '813391', 'U 16', NULL, false),
  (294, '835867', 'U 16', NULL, false),
  (296, '843779', 'Senior', NULL, false),
  (552, '818223', 'U 16', NULL, false),
  (299, '821051', 'U 16', NULL, false),
  (301, '836988', 'Senior', NULL, false),
  (310, '825941', 'U 16', NULL, false),
  (309, '796224', 'Senior', NULL, false),
  (315, '837574', 'Senior', NULL, false),
  (317, '839945', 'U 16', NULL, false),
  (334, '846670', 'U 18', NULL, false),
  (335, '825409', 'Senior', NULL, false),
  (337, '777885', 'Senior', NULL, false),
  (339, '823287', 'Senior', NULL, false),
  (341, '801986', 'Senior', NULL, false),
  (342, '817400', 'U 16', NULL, false),
  (345, '818220', 'U 16', NULL, false),
  (360, '755237', 'Senior', NULL, false),
  (361, '846391', 'U 18', NULL, false),
  (363, '759378', 'Senior', NULL, false),
  (372, '834358', 'U 18', NULL, false),
  (379, '055803', 'Senior', NULL, false),
  (380, '038514', 'Senior', NULL, false),
  (382, '801066', 'U 16', NULL, false),
  (384, '762233', 'Senior', NULL, false),
  (387, '807898', 'U 16', NULL, false),
  (391, '843025', 'U 16', NULL, false),
  (393, '843810', 'Senior', NULL, false),
  (395, '830338', 'U 16', NULL, false),
  (401, '057143', 'Senior', NULL, false),
  (405, '769488', 'Senior', NULL, false),
  (408, '838751', 'U 20', NULL, false),
  (411, '838585', 'U 16', NULL, false),
  (550, '812255', 'U 16', NULL, false),
  (430, '772049', 'Senior', NULL, false),
  (431, '020191', 'Senior', NULL, false),
  (432, '824972', 'Senior', NULL, false),
  (434, '836995', 'Senior', NULL, false),
  (439, '822587', 'U 16', NULL, false),
  (441, '763073', 'Senior', NULL, false),
  (443, '757067', 'Senior', NULL, false),
  (444, '836052', 'U 16', NULL, false),
  (449, '820112', 'Senior', NULL, false),
  (450, '794197', 'Senior', NULL, false),
  (453, '824198', 'U 16', NULL, false),
  (456, '765236', 'Senior', NULL, false),
  (459, '825274', 'U 16', NULL, false),
  (460, '803188', 'U 16', NULL, false),
  (549, '801096', 'U 18', NULL, false),
  (463, '771132', 'Senior', NULL, false),
  (130, '828491', 'U 18', NULL, false),
  (169, '829632', 'U 18', NULL, false),
  (560, '835115', 'U 18', NULL, false),
  (272, '846722', 'U 8', NULL, false),
  (158, '787715', 'Senior', NULL, false),
  (171, '818009', 'Senior', NULL, false),
  (230, '771527', 'Senior', NULL, false),
  (307, '843808', 'Senior', NULL, false),
  (320, '817755', 'Senior', NULL, false),
  (322, '845832', 'Senior', NULL, false),
  (324, '769752', 'Senior', NULL, false),
  (336, '818752', 'Senior', NULL, false),
  (348, '800080', 'Senior', NULL, false),
  (357, '770340', 'Senior', NULL, false),
  (403, '786666', 'Senior', NULL, false),
  (424, '825678', 'Senior', NULL, false),
  (173, '812848', 'U 16', NULL, false),
  (352, '808617', 'U 14', NULL, false),
  (150, '805965', 'Senior', NULL, false),
  (603, '777377', 'Senior', NULL, false),
  (225, '808089', 'U 20', NULL, false),
  (213, '830939', 'U 16', NULL, false),
  (433, '812260', 'U 16', NULL, false),
  (268, '818292', 'U 14', NULL, false),
  (208, '827432', 'U 16', NULL, false),
  (233, '803594', 'U 16', NULL, false),
  (417, '783008', 'Senior', NULL, false),
  (330, '846930', 'U 14', NULL, false),
  (128, '840115', 'U 12', NULL, false),
  (561, '843265', 'U 12', NULL, false),
  (205, '840577', 'U 12', NULL, false),
  (554, '826734', 'U 12', NULL, false),
  (219, '843776', 'U 12', NULL, false),
  (248, '812700', 'U 12', NULL, false),
  (558, '832655', 'U 12', NULL, false),
  (323, '843261', 'U 10', NULL, true),
  (367, '828719', 'Senior', NULL, false),
  (461, '844469', 'U 12', NULL, false),
  (125, '843781', 'U 18', NULL, false),
  (244, '801508', 'U 18', NULL, false),
  (260, '813962', 'U 18', NULL, false),
  (279, '813658', 'U 18', NULL, false),
  (283, '844263', 'U 18', NULL, false),
  (386, '813656', 'U 18', NULL, false),
  (390, '845872', 'U 18', NULL, false),
  (425, '805846', 'U 18', NULL, true),
  (447, '813692', 'U 18', NULL, false),
  (512, '844681', 'U 14', NULL, false),
  (513, '847825', 'U 6', NULL, false),
  (569, '847826', 'U 8', NULL, false),
  (511, '847910', 'Senior', DATE '1994-06-06', false),
  (286, '844265', 'U 18', NULL, false),
  (142, '832069', 'U 12', NULL, false),
  (165, '847827', 'U 12', NULL, false),
  (170, '843977', 'U 12', NULL, false),
  (182, '831926', 'U 12', NULL, false),
  (259, '845942', 'U 12', NULL, false),
  (556, '831148', 'U 12', NULL, false),
  (325, '839230', 'U 12', NULL, false),
  (328, '833972', 'U 12', NULL, false),
  (349, '839803', 'U 12', NULL, false),
  (557, '832008', 'U 12', NULL, false),
  (354, '846726', 'U 12', NULL, false),
  (370, '839165', 'U 12', NULL, false),
  (397, '833298', 'U 10', NULL, false),
  (404, '753610', 'Offizielle/r', NULL, false),
  (451, '826153', 'U 12', NULL, false),
  (454, '809621', 'Senior', NULL, false),
  (141, '835843', 'U 10', NULL, false),
  (564, '843774', 'U 12', NULL, false),
  (563, '843769', 'U 14', NULL, false),
  (183, '822531', 'U 14', NULL, false),
  (232, '842076', 'U 12', NULL, false),
  (452, '846669', 'U 12', NULL, false),
  (231, '839483', 'U 14', NULL, false),
  (350, '812257', 'U 14', NULL, true),
  (400, '846112', 'U 18', NULL, false),
  (226, '771610', 'Senior', NULL, false),
  (263, '021249', 'Senior', NULL, false),
  (535, '041811', 'Senior', NULL, false),
  (181, '843802', 'U 14', NULL, false),
  (193, '842074', 'U 14', NULL, false),
  (198, '843922', 'U 14', NULL, false),
  (218, '836856', 'U 14', NULL, false),
  (298, '843926', 'U 14', NULL, true),
  (302, '838571', 'U 14', NULL, false),
  (312, '839799', 'U 14', NULL, false),
  (551, '818291', 'U 14', NULL, false),
  (344, '843788', 'U 14', NULL, false),
  (359, '840459', 'U 14', NULL, false),
  (366, '842078', 'U 14', NULL, false),
  (368, '821052', 'U 14', NULL, false),
  (381, '839940', 'U 14', NULL, false),
  (559, '833296', 'U 14', NULL, false),
  (399, '833295', 'U 14', NULL, true);

-- 1. licence number: fill empties, plus force-correct the cross-assigned ones.
UPDATE members m
   SET license_nr = b.licence_no
  FROM bp_backfill b
 WHERE m.id = b.member_id
   AND b.licence_no IS NOT NULL
   AND (b.force_lic OR m.license_nr IS NULL OR m.license_nr = '' OR m.license_nr = '0');

-- 2. licence category: fill-only (never overwrite a Volleymanager-owned value).
UPDATE members m
   SET licence_category = b.licence_cat
  FROM bp_backfill b
 WHERE m.id = b.member_id
   AND b.licence_cat IS NOT NULL
   AND (m.licence_category IS NULL OR m.licence_category = '');

-- 3. birthdate: fill-only, default visibility to 'hidden' (mirrors vm-sync-check.mjs).
UPDATE members m
   SET birthdate = b.dob,
       birthdate_visibility = COALESCE(NULLIF(m.birthdate_visibility, ''), 'hidden')
  FROM bp_backfill b
 WHERE m.id = b.member_id
   AND b.dob IS NOT NULL
   AND m.birthdate IS NULL;

-- 4. Field labels: licence_category / license_nr now carry BOTH sports (Swiss Volley codes
--    RLL/JLL/PL/... and Basketplan's Senior / U 6..U 20 / Offizielle/r), so the admin-UI note
--    "synced from Volleymanager" is no longer true. Make it sport-neutral.
UPDATE directus_fields
   SET note = 'Licence category — imported from the sport association (Swiss Volley or Basketplan)'
 WHERE collection = 'members' AND field = 'licence_category';

UPDATE directus_fields
   SET note = 'Licence number — imported from the sport association (Swiss Volley or Basketplan)'
 WHERE collection = 'members' AND field = 'license_nr';

COMMIT;
