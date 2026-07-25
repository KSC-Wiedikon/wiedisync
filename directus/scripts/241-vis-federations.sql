-- Migration 241: national federation directory (VIS), for the transfer workflow.
--
-- Two questions the Transfers page has to answer need this:
--   • a member IS in VIS  → link straight to the transfer, naming the federation
--   • a member is NOT     → who do we email to have them entered? The answer is
--                           the federation's own address, and until now it lived
--                           nowhere.
--
-- Seeded from VIS `GetFederationList` (231 of 236 federations publish an email),
-- restricted to the countries our ISO→FIVB map covers. FIVB codes are IOC-style
-- and NOT derivable from ISO (DE→GER, NL→NED, LK→SRI, IR→IRI), so `iso` is stored
-- explicitly rather than computed.
--
-- ⚠ `email` is often a SEMICOLON-SEPARATED LIST ("presidenza@…; segreteria@…") —
-- kept verbatim as VIS publishes it rather than split, because which address is
-- correct for a transfer request is a judgement the club makes, not us.
--
-- Contact details drift; this is a convenience copy, not a system of record.
-- Re-seed by re-running the migration body after a GetFederationList fetch.
--
-- Schema-only + idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS vis_federations (
  vis_no  integer PRIMARY KEY,
  iso     varchar(2) NOT NULL,
  code    varchar(3) NOT NULL,
  name    text NOT NULL,
  email   text,
  website text
);

COMMENT ON TABLE vis_federations IS
  'National volleyball federations from VIS GetFederationList, keyed by VIS number, with the ISO alpha-2 of their country. email may hold several addresses separated by "; ".';

CREATE UNIQUE INDEX IF NOT EXISTS vis_federations_iso_idx ON vis_federations (iso);

INSERT INTO vis_federations (vis_no, iso, code, name, email, website) VALUES
  (78, 'DE', 'GER', 'GERMAN VOLLEYBALL FEDERATION', 'info@volleyball-verband.de', 'www.volleyball-verband.de'),
  (100, 'IT', 'ITA', 'FEDERAZIONE ITALIANA PALLAVOLO', 'presidenza@federvolley.it; segreteria@federvolley.it', 'www.federvolley.it'),
  (69, 'FR', 'FRA', 'FEDERATION FRANCAISE DE VOLLEYBALL', 'ffvb@ffvb.org', 'www.ffvb.org'),
  (1, 'AF', 'AFG', 'AFGHANISTAN VOLLEYBALL FEDERATION', 'afghanvolleyballfed@hotmail.com; secretary.general.avf@gmail.com; Saidrahim.sadat22@gmail.com', 'www.afghanistanvolleyball.org'),
  (62, 'ES', 'ESP', 'REAL FEDERACION ESPAÑOLA DE VOLEIBOL', 'presidente@esvoley.es', 'www.esvoley.es'),
  (164, 'PL', 'POL', 'POLSKI ZWIAZEK PILKI SIATKOWEJ', 'pzps@pzps.pl', 'www.pzps.pl'),
  (211, 'US', 'USA', 'U S A  VOLLEYBALL ', 'FIVBCommunications@usav.org', 'usavolleyball.org'),
  (192, 'SE', 'SWE', 'SWEDISH VOLLEYBALL ASSOCIATION', 'info@volleyboll.se', 'www.volleyboll.se'),
  (186, 'LK', 'SRI', 'SRI LANKA VOLLEYBALL FEDERATION', 'srilankavolleyball@yahoo.com', 'www.volleyballsrilanka.org'),
  (14, 'AT', 'AUT', 'OESTERREICHISCHER VOLLEYBALLVERBAND', 'office@volleynet.at', 'www.volleynet.at'),
  (165, 'PT', 'POR', 'FEDERACAO PORTUGUESA DE VOLEIBOL', 'fpvoleibol@fpvoleibol.pt', 'www.fpvoleibol.pt'),
  (64, 'ET', 'ETH', 'ETHIOPIAN VOLLEYBALL FEDERATION', 'teklunsb123@gmail.com', NULL),
  (171, 'RU', 'RUS', 'VOLLEYBALL FEDERATION OF RUSSIA', 'vfv@volleyservice.ru', 'www.volley.ru'),
  (68, 'FI', 'FIN', 'FINNISH VOLLEYBALL ASSOCIATION', 'office@lentopalloliitto.fi', 'www.lentopalloliitto.fi'),
  (32, 'BG', 'BUL', 'BULGARIAN VOLLEYBALL FEDERATION', 'international@bvf.bg', 'www.bvf.bg'),
  (52, 'CZ', 'CZE', 'CZECH VOLLEYBALL FEDERATION', 'president@cvf.cz; czech.volleyball@cvf.cz', 'www.cvf.cz'),
  (145, 'NL', 'NED', 'Nederlandse Volleybalbond (Nevobo)', 'info@nevobo.nl', 'www.volleybal.nl'),
  (153, 'NZ', 'NZL', 'VOLLEYBALL NEW ZEALAND INC.', 'teresa@volleyballnz.org.nz', 'www.volleyballnz.org.nz'),
  (159, 'PE', 'PER', 'FEDERACION PERUANA DE VOLEIBOL', 'fpv425@hotmail.com; fpvoleibol25@gmail.com; ginovegasu@hotmail.com', 'https://fpv.pe/'),
  (185, 'RS', 'SRB', 'VOLLEYBALL FEDERATION OF SERBIA', 'finance@ossrb.org; ossrb@ossrb.org', 'www.ossrb.org'),
  (4, 'AL', 'ALB', 'FEDERATA SHQIPTARE E VOLEJBOLLIT', 'secretary@fshv.org.al; info@fshv.org.al', 'www.fshv.org.al'),
  (181, 'SI', 'SLO', 'VOLLEYBALL FEDERATION OF SLOVENIA', 'ozs@odbojka.si; metod.ropret@siol.net; gregor@odbojka.si', 'www.odbojka.si'),
  (128, 'MX', 'MEX', 'FEDERACION MEXICANA DE VOLEIBOL ', 'enlace.int.fmvb@gmail.com', 'www.fmvb.mx'),
  (29, 'BR', 'BRA', 'CONFEDERAÇÃO BRASILEIRA DE VOLEIBOL', 'gabinetepresidencia@volei.org.br', 'www.cbv.com.br'),
  (73, 'GB', 'GBR', 'BRITISH VOLLEYBALL FEDERATION', 'info@britishvolleyball.org', NULL),
  (81, 'GR', 'GRE', 'HELLENIC VOLLEYBALL FEDERATION', 'hellas@volleyball.gr', 'www.volleyball.gr'),
  (91, 'HU', 'HUN', 'HUNGARIAN VOLLEYBALL FEDERATION', 'hunvolley@hunvolley.hu', 'www.hunvolley.hu'),
  (96, 'IQ', 'IRQ', 'IRAQI VOLLEYBALL FEDERATION', 'iraqvolley@gmail.com', NULL),
  (94, 'IR', 'IRI', 'VOLLEYBALL FEDERATION ISLAMIC REPUBLIC OF IRAN', 'info@volleyball.ir', 'www.volleyball.ir'),
  (45, 'CO', 'COL', 'FEDERACION COLOMBIANA DE VOLEIBOL', 'fcv@fedevoleicol.com', 'www.fedevolei.com'),
  (205, 'TR', 'TUR', 'TURKISH VOLLEYBALL FEDERATION', 'international@tvf.org.tr; nilufer.shimonsky@tvf.org.tr', 'www.tvf.org.tr'),
  (209, 'UA', 'UKR', 'UKRAINIAN VOLLEYBALL FEDERATION', 'office_uvf@ukr.net', 'www.fvu.in.ua'),
  (49, 'HR', 'CRO', 'CROATIAN VOLLEYBALL ASSOCIATION', 'info@hos-cvf.hr', 'www.hos-cvf.hr'),
  (20, 'BE', 'BEL', 'FEDERATION ROYALE BELGE DE VOLLEYBALL', 'secretariat@volleybelgium.be', 'www.volleybelgium.be'),
  (53, 'DK', 'DEN', 'VOLLEYBALL DENMARK', 'info@volleyball.dk', 'www.volleyball.dk'),
  (151, 'NO', 'NOR', 'NORGES VOLLEYBALLFORBUND', 'Charlotte.Stoelen@volleyball.no', 'www.volleyball.no'),
  (104, 'JP', 'JPN', 'JAPAN VOLLEYBALL ASSOCIATION', 'international.events@jva.or.jp', 'www.jva.or.jp'),
  (40, 'CN', 'CHN', 'CHINA VOLLEYBALL ASSOCIATION', 'cva@volleyballchina.com', 'https://www.volleyballchina.com/'),
  (109, 'KR', 'KOR', 'KOREA VOLLEYBALL ASSOCIATION', 'international@kva.or.kr', 'www.kva.or.kr'),
  (9, 'AR', 'ARG', 'FEDERACION DEL VOLEIBOL ARGENTINO (FE.VA)', 'info@feva.org.ar', 'www.feva.org.ar'),
  (36, 'CA', 'CAN', 'VOLLEYBALL CANADA ', 'transfers@volleyball.ca', 'www.volleyball.ca'),
  (50, 'CU', 'CUB', 'FEDERACION CUBANA DE VOLEIBOL', 'presidentefcv1953@gmail.com', NULL),
  (56, 'DO', 'DOM', 'FEDERACION DOMINICANA DE VOLEIBOL ', 'deportivonacional@hotmail.com', 'www.fedovoli.org'),
  (58, 'EG', 'EGY', 'EGYPTIAN VOLLEYBALL FEDERATION ', 'fevb@fevb.org', 'www.egyvb.org'),
  (204, 'TN', 'TUN', 'FEDERATION TUNISIENNE DE VOLLEY-BALL', 'ftvb@planet.tn', 'WWW.FTVB.ORG'),
  (124, 'MA', 'MAR', 'FEDERATION ROYALE MAROCAINE DE VOLLEY-BALL', 'marocvolleyball@gmail.com', NULL),
  (93, 'IN', 'IND', 'VOLLEYBALL FEDERATION OF INDIA', 'vfisteeringcommittee@gmail.com', 'https://olympic.ind.in/'),
  (197, 'TH', 'THA', 'THAILAND VOLLEYBALL ASSOCIATION', 'info@volleyball.or.th', 'volleyball.or.th/volley'),
  (169, 'RO', 'ROU', 'FEDERATIA ROMANA DE VOLEI', 'frvolei@frvolei.ro', 'www.frvolei.ro'),
  (191, 'SK', 'SVK', 'SLOVAK VOLLEYBALL FEDERATION', 'svf@svf.sk', 'www.svf.sk'),
  (63, 'EE', 'EST', 'ESTONIAN VOLLEYBALL FEDERATION (EESTI VORKPALLI LIIT)', 'kert.toobal@volley.ee; robin@volley.ee', 'www.volley.ee'),
  (113, 'LV', 'LAT', 'VOLLEYBALL FEDERATION OF LATVIA', 'lvf@volejbols.lv', 'www.volejbols.lv'),
  (120, 'LT', 'LTU', 'LITHUANIAN VOLLEYBALL FEDERATION', 'info@ltf.lt', 'www.ltf.lt'),
  (24, 'BA', 'BIH', 'VOLLEYBALL FEDERATION OF BOSNIA AND HERZEGOVINA', 'osbih2005@gmail.com', 'www.osbih.ba'),
  (130, 'MK', 'MKD', 'VOLLEYBALL FEDERATION OF NORTH MACEDONIA', 'vfmkd@vfmkd.mk', NULL),
  (134, 'ME', 'MNE', 'VOLLEYBALL FEDERATION OF MONTENEGRO', 'info@oscg.me', 'www.oscg.me'),
  (95, 'IE', 'IRL', 'VOLLEYBALL ASSOCIATION OF IRELAND', 'info@volleyballireland.com', 'www.volleyballireland.com'),
  (97, 'IS', 'ISL', 'ICELANDIC VOLLEYBALL ASSOCIATION', 'bli@bli.is', 'www.bli.is'),
  (121, 'LU', 'LUX', 'FEDERATION LUXEMBOURGEOISE DE VOLLEYBALL', 'info@flvb.lu', 'www.flvb.lu'),
  (170, 'ZA', 'RSA', 'VOLLEYBALL SOUTH AFRICA (VSA)', 'anthonymokoena77@gmail.com', 'www.volleyballsa.co.za'),
  (106, 'KE', 'KEN', 'KENYA VOLLEYBALL FEDERATION ', 'kenyavolleyfed@gmail.com', 'volleyballkenya.org'),
  (147, 'NG', 'NGR', 'NIGERIA VOLLEYBALL FEDERATION ', 'volleynigeria@yahoo.com', NULL),
  (214, 'VE', 'VEN', 'FEDERACION VENEZOLANA DE VOLEIBOL', 'fvvoficial2024@gmail.com; yeivicm@hotmail.com', 'www.fvvb.com.ve'),
  (39, 'CL', 'CHI', 'FEDERACION DE VOLEIBOL DE CHILE', 'info@fevochi.cl', 'www.fevochi.cl'),
  (210, 'UY', 'URU', 'FEDERACION URUGUAYA DE VOLLEYBALL', 'secretaria@fuv.org.uy', 'www.fuv.org.uy'),
  (157, 'PY', 'PAR', 'FEDERACION PARAGUAYA DE VOLEIBOL', 'secretariafpv0@gmail.com', NULL),
  (57, 'EC', 'ECU', 'FEDERACION ECUATORIANA DE VOLEIBOL', 'info@ecuadorvoleibol.org; johnny.molina@gmail.com', 'www.voleibolecuador.org'),
  (27, 'BO', 'BOL', 'FEDERACION BOLIVIANA DE VOLEIBOL', 'fedbolvolei@hotmail.com', 'www.boliviavolei.com'),
  (189, 'CH', 'SUI', 'SWISS VOLLEY', 'info@volleyball.ch', 'www.volleyball.ch')
ON CONFLICT (vis_no) DO UPDATE
  SET iso = EXCLUDED.iso, code = EXCLUDED.code, name = EXCLUDED.name,
      email = EXCLUDED.email, website = EXCLUDED.website;

COMMIT;

SELECT 'federations' AS t, count(*) AS n FROM vis_federations
UNION ALL SELECT 'with email', count(*) FROM vis_federations WHERE email IS NOT NULL;
