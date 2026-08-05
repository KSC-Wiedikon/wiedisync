// AUTO-EXTRACTED from the ProBasket workbook "Übersicht Teamanmeldungen 26/27"
// (`Teamanmeldungen_26-27.xlsx`), sheet **"Prov. Gruppeneinteilung"** — regenerated 05.08.2026.
// Provisional groups — refresh once per season from the ProBasket Nextcloud share.
//
// Source rules applied when regenerating (keep them if you re-extract):
//  • Only the "Prov. Gruppeneinteilung" sheet decides group membership. The "Klubübersicht"
//    sheet's `Kategorie` column is the *registration* category and is STALE — the two sheets
//    disagree by design (e.g. "BC Seuzach-Stammheim D1" and "Baskets Feldkirch D1" are still
//    D1LRA in Klubübersicht but were moved to D2LRA in the Gruppeneinteilung).
//  • `club` is joined from the Klubübersicht `Klub` column on the team name (exact, then
//    longest-unambiguous-prefix — Klubübersicht often carries an "(Ausser Konk.)" suffix the
//    Gruppeneinteilung drops). `club: null` = the workbook has no club for that team.
//  • `code` is the Gruppeneinteilung group header verbatim, minus the " Saison 26/27" suffix
//    (header cells read e.g. "D1LRA Saison 26/27 | … | Hin- und Rückrunde | 18 Spiele").
//    ⚠ Klubübersicht spells some of these differently ("D3LR" vs the header's "D3LRA", "DU12Tu"
//    vs "DU12 TU"), and `teams.league` in Directus carries yet a third set (Basketplan group
//    codes: "H3LS", "H4LZ", "HU14B"). The Gruppeneinteilung header wins here.
//  • `label` is the `Liga` column of the group's member rows — this is the string the ProBasket
//    "Angabe Verfügbarkeiten" workbook wants in its *Kategorie* field (see
//    `basketballAvailabilityExport.ts → kategorieFor`). Exception: every DU10 row in the
//    workbook carries "MixU10M" in the Liga column (a ProBasket copy-paste), so DU10's label is
//    hand-set to "DU10".
//
// Only groups that contain a KSCW team are listed — this table exists to power the opponent
// picker and the availability export, not to mirror the whole region. Multi-group leagues
// (HU14/HU16 Regional, MixU10/MixU12 …) are listed in full: the final group split happens at
// the Spielplansitzung, so the whole league is the correct provisional superset. Free-text
// entry in the UI covers anything missing.

/** One registered team in a ProBasket group. `club` is null when the workbook has no Klub for it. */
export interface BbTeam { name: string; club: string | null }

export interface BbGroup { code: string; label: string; sex: 'm' | 'f' | 'mixed'; teams: BbTeam[] }

export const BB_GROUPS: Record<string, BbGroup> = {
  "D1LRA": {
    code: "D1LRA", label: "Damen 1. Liga", sex: "f",
    teams: [
      { name: "BC Arlesheim D1", club: "BC Arlesheim" },
      { name: "BC Olympiakos D1", club: "BC Olympiakos" },
      { name: "RJ Lakers D1", club: "BC RJ Lakers" },
      { name: "Frauenfeld Damen 1", club: "CVJM Frauenfeld" },
      { name: "Emmen Basket D1", club: "Emmen Basket" },
      { name: "KSC Wiedikon Lions D1", club: "KSC Wiedikon" },
      { name: "Opfikon Basket Blizzards D1", club: "Opfikon Basket" },
      { name: "Zug Basket D1", club: "Zug Basket" },
    ],
  },
  "D3LRA": {
    code: "D3LRA", label: "Damen 3. Liga", sex: "f",
    teams: [
      { name: "Marmotas Damen D3", club: "BC Marmotas" },
      { name: "BC Winterthur 2 D3", club: "BC Winterthur" },
      { name: "Mörschwil Griffins D3", club: "Griffins Basketball" },
      { name: "KSC Wiedikon Rhinos D3", club: "KSC Wiedikon" },
      { name: "Mutschellen Damen D3", club: "Mutschellen Basketball" },
      { name: "St. Otmar St. Gallen Basketball Damen D3", club: "St. Otmar St. Gallen Basketball" },
      { name: "Stingerz Zürich Damen D3", club: "Stingerz" },
      { name: "Goldcoast Wallabies D3", club: "Wallabies" },
    ],
  },
  "DU12 TU": {
    code: "DU12 TU", label: "DU12TU", sex: "f",
    teams: [
      { name: "Baar Bumble Bees DU12 Team Gold", club: "Baar Bumble Bees" },
      { name: "Baden Basket 54 DU12", club: "Baden Basket 54" },
      { name: "BC Alte Kanti Aarau Lightning DU12T", club: "BC AKA" },
      { name: "BS Kriens Queens Du12", club: "BS Kriens" },
      { name: "BZO Greifensee Mariposas DU12", club: "BZO" },
      { name: "Frauenfeld DU12 (Turnier)", club: "CVJM Frauenfeld" },
      { name: "KSC Wiedikon DU12", club: "KSC Wiedikon" },
      { name: "Mutschellen DU12", club: "Mutschellen Basketball" },
      { name: "Regensdorf Penguins DU12", club: "Phönix Basket" },
      { name: "Rüti Centellas DU12", club: "Rüti Basket" },
      { name: "Goldcoast Wallabies DU12", club: "Wallabies" },
    ],
  },
  "DU14 Regional": {
    code: "DU14 Regional", label: "DU14 Regional", sex: "f",
    teams: [
      { name: "Baar Bumble Bees DU14", club: "Baar Bumble Bees" },
      { name: "Baden Basket 54 DU14", club: "Baden Basket 54" },
      { name: "BC Brunnen DU14", club: "BC Brunnen" },
      { name: "BCBE DU14", club: "BC Buchrain-Ebikon" },
      { name: "BC Olten-Zofingen DU14 A", club: "BC Olten-Zofingen" },
      { name: "BC Silvercoast DU14", club: "BC Silvercoast" },
      { name: "BS Kriens Queens Du14", club: "BS Kriens" },
      { name: "BZO BC Effretikon Orcas DU14", club: "BZO" },
      { name: "KSC Wiedikon DU14", club: "KSC Wiedikon" },
      { name: "Mutschellen DU14", club: "Mutschellen Basketball" },
      { name: "Goldcoast Wallabies DU14R", club: "Wallabies" },
    ],
  },
  "DU14/U16 Rookie": {
    code: "DU14/U16 Rookie", label: "DU16 Rookie", sex: "f",
    teams: [
      { name: "BBZU Fever DU16", club: "BBZU" },
      { name: "BC Brunnen DU16", club: "BC Brunnen" },
      { name: "BC Seuzach-Stammheim DU16", club: "BC Seuzach-Stammheim" },
      { name: "BC Zürich 93 DU16", club: "BC Zürich 93" },
      { name: "BS Kriens Queens Du16", club: "BS Kriens" },
      { name: "Frauenfeld DU16 Red Foxes", club: "CVJM Frauenfeld" },
      { name: "Opfikon Basket Ants DU16", club: "Opfikon Basket" },
      { name: "Emmen Basket DU16", club: "Emmen Basket" },
      { name: "KSC Wiedikon DU16", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen DU16", club: "KTV Schaffhausen" },
      { name: "Mutschellen DU16", club: "Mutschellen Basketball" },
      { name: "Oberthurgau Pirates DU16", club: "Oberthurgau Pirates" },
      { name: "St. Otmar St. Gallen Basketball DU16A", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Luzern Basket DU16", club: "STV Luzern Basket" },
      { name: "Zug Basket DU14/DU16", club: "Zug Basket" },
    ],
  },
  "DU18/U20 Rookie": {
    code: "DU18/U20 Rookie", label: "DU20 Rookie", sex: "f",
    teams: [
      { name: "BIQ DU18 (Ausser Konk.)", club: "BIQ" },
      { name: "BS Kriens Queens Du18", club: "BS Kriens" },
      { name: "Emmen Basket DU18", club: "Emmen Basket" },
      { name: "GC Zurich DU18", club: "GC Zürich Basketball" },
      { name: "KSC Wiedikon DU18 A", club: "KSC Wiedikon" },
      { name: "KSC Wiedikon DU18 B", club: "KSC Wiedikon" },
      { name: "Mutschellen DU18", club: "Mutschellen Basketball" },
      { name: "Seeblick Bears DU18", club: "Seeblick Bears Cham" },
      { name: "STV Luzern Basket DU18", club: "STV Luzern Basket" },
      { name: "BC Zürich 93 DU18/DU20", club: "BC Zürich 93" },
      { name: "St. Otmar St. Gallen Basketball DU20B", club: "St. Otmar St. Gallen Basketball" },
      { name: "St. Otmar St. Gallen Basketball DU20A", club: "St. Otmar St. Gallen Basketball" },
    ],
  },
  "H1LRA": {
    code: "H1LRA", label: "Herren 1. Liga", sex: "m",
    teams: [
      { name: "BC Bears Wil H1", club: "BC Bears Wil" },
      { name: "BC Oerlikon Grizzlies H1", club: "BC Oerlikon Grizzlies" },
      { name: "BC Winterthur 2 H1", club: "BC Winterthur" },
      { name: "Mörschwil Griffins H1", club: "Griffins Basketball" },
      { name: "Ikaros Zürich H1", club: "Ikaros Zürich BC" },
      { name: "KSC Wiedikon Herren 1 H1", club: "KSC Wiedikon" },
      { name: "Opfikon Basket H1", club: "Opfikon Basket" },
      { name: "Stingers Zürich H1", club: "Stingerz" },
      { name: "STV Luzern Basket Herren 1", club: "STV Luzern Basket" },
      { name: "Zug Basket H1", club: "Zug Basket" },
    ],
  },
  "H2LRA": {
    code: "H2LRA", label: "Herren 2. Liga", sex: "m",
    teams: [
      { name: "Aarau Basket H1", club: "Aarau Basket" },
      { name: "BBC Schaan H2", club: "BBC Schaan" },
      { name: "BZO Highlanders H2", club: "BZO" },
      { name: "Frauenfeld Herren 1", club: "CVJM Frauenfeld" },
      { name: "GRBB Chur Herren 1 H2", club: "GRBB" },
      { name: "KSC Wiedikon Herren 2 H2", club: "KSC Wiedikon" },
      { name: "Opfikon Basket Wolves H2", club: "Opfikon Basket" },
      { name: "Opfikon Basket Rams H2", club: "Opfikon Basket" },
      { name: "Unicorn 02 Basket H2", club: "Unicorn 02 Basket" },
      { name: "Wohlen Basket H2", club: "Wohlen Basket" },
      { name: "Zug Basket H2", club: "Zug Basket" },
    ],
  },
  "H4LRA": {
    code: "H4LRA", label: "Herren 4. Liga", sex: "m",
    teams: [
      { name: "Aarau Basket H4", club: "Aarau Basket" },
      { name: "BBC Inwil Hoopers H4 Team Rhei", club: "BBC Inwil Hoopers" },
      { name: "BBC Inwil Hoopers H4 Team Panta", club: "BBC Inwil Hoopers" },
      { name: "BBC Lions Heat H4", club: "BBC Lions Heat" },
      { name: "BBZU Rockets H4", club: "BBZU" },
      { name: "BC Bears Wil H4", club: "BC Bears Wil" },
      { name: "BC Oerlikon Grizzlies H4", club: "BC Oerlikon Grizzlies" },
      { name: "RJ Lakers 1 H4", club: "BC RJ Lakers" },
      { name: "BC Seetal H4", club: "BC Seetal" },
      { name: "BC Seuzach-Stammheim H4", club: "BC Seuzach-Stammheim" },
      { name: "BC Silvercoast H4", club: "BC Silvercoast" },
      { name: "BC Altstetten H4 II", club: "BCA" },
      { name: "BC Altstetten H4", club: "BCA" },
      { name: "BCL Rivers H4", club: "BCL Rivers" },
      { name: "BS Arth-Goldau H4", club: null },
      { name: "BZO Buzzers H4", club: "BZO" },
      { name: "Frauenfeld Herren 2 H4", club: "CVJM Frauenfeld" },
      { name: "KSC Wiedikon Herren 3 (Unicorns) H4", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen H2", club: "KTV Schaffhausen" },
      { name: "Megas Alexandros H4", club: "Megas Alexandros" },
      { name: "Mutschellen Herren 2 H4", club: "Mutschellen Basketball" },
      { name: "Oberthurgau Pirates H4", club: "Oberthurgau Pirates" },
      { name: "Rüti Basket Herren H4", club: "Rüti Basket" },
      { name: "St. Otmar St. Gallen Basketball H4", club: "St. Otmar St. Gallen Basketball" },
      { name: "Stingerz FIVE4 H4", club: "Stingerz" },
      { name: "STV Basket Kreuzlingen H4", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket Herren 2 H4", club: "STV Luzern Basket" },
      { name: "Sursee Basket H4", club: "Sursee Basket" },
      { name: "TV Reussbühl Rebels H4", club: "TVRB" },
      { name: "Wohlen Basket 2 H4", club: "Wohlen Basket" },
    ],
  },
  "HU14 Regional": {
    code: "HU14 Regional", label: "HU14 Regional", sex: "m",
    teams: [
      { name: "Baden Basket 54 HU14R", club: "Baden Basket 54" },
      { name: "BBC Inwil Hoopers HU14 Team Axis", club: "BBC Inwil Hoopers" },
      { name: "BBZU Huskies HU14", club: "BBZU" },
      { name: "BCBE Panthers HU14", club: "BC Buchrain-Ebikon" },
      { name: "BC Olten-Zofingen Bulldogs HU14", club: "BC Olten-Zofingen" },
      { name: "BC Silvercoast HU14", club: "BC Silvercoast" },
      { name: "BC Sins HU14", club: "BC Sins" },
      { name: "BC Uster HU14", club: "BC Uster" },
      { name: "BC Winterthur HU14", club: "BC Winterthur" },
      { name: "BC Zürich 93 HU14", club: "BC Zürich 93" },
      { name: "BIQ HU14", club: "BIQ" },
      { name: "BS Kriens Hu14 Sharks", club: "BS Kriens" },
      { name: "BS Kriens HU14 Falcons", club: "BS Kriens" },
      { name: "BV Bregenz-Romanshorn HU14", club: "BV Bregenz 1983" },
      { name: "BZO BC Effretikon Rookies HU14", club: "BZO" },
      { name: "BZO BC Wetzikon Sooners HU14", club: "BZO" },
      { name: "BZO Greifensee Eagles HU14", club: "BZO" },
      { name: "Emmen Basket HU14", club: "Emmen Basket" },
      { name: "GC Zürich HU14 C", club: "GC Zürich Basketball" },
      { name: "GC Zürich HU14 B", club: "GC Zürich Basketball" },
      { name: "GRBB Chur HU14", club: "GRBB" },
      { name: "KSC Wiedikon HU14", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen HU14", club: "KTV Schaffhausen" },
      { name: "Mutschellen HU14", club: "Mutschellen Basketball" },
      { name: "Oberthurgau Pirates HU14", club: "Oberthurgau Pirates" },
      { name: "Opfikon Basket Blaze HU14", club: "Opfikon Basket" },
      { name: "Regensdorf Pirates HU14", club: "Phönix Basket" },
      { name: "Rheintal Scorpions HU14", club: "Rheintal Scorpions" },
      { name: "Rüti Basket HU14", club: "Rüti Basket" },
      { name: "Seeblick Bears HU14", club: "Seeblick Bears Cham" },
      { name: "St. Otmar St. Gallen Basketball HU14", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Basket Kreuzlingen HU14", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket HU14", club: "STV Luzern Basket" },
      { name: "Unicorn 02 Basket HU14", club: "Unicorn 02 Basket" },
      { name: "Goldcoast Wallabies HU14", club: "Wallabies" },
      { name: "Wohlen Basket HU14", club: "Wohlen Basket" },
      { name: "Zug Basket HU14", club: "Zug Basket" },
    ],
  },
  "HU16 Regional": {
    code: "HU16 Regional", label: "HU16 Regional", sex: "m",
    teams: [
      { name: "Baden Basket 54 HU16R", club: "Baden Basket 54" },
      { name: "BBC Glarus HU16", club: "BBC Glarus" },
      { name: "BBC Inwil Hoopers HU16 Team Nexus", club: "BBC Inwil Hoopers" },
      { name: "BBZU Tigers HU16", club: "BBZU" },
      { name: "BC Brunnen HU16", club: "BC Brunnen" },
      { name: "BCBE Bulls HU16", club: "BC Buchrain-Ebikon" },
      { name: "BCBE Sharks HU16 PR", club: "BC Buchrain-Ebikon" },
      { name: "Marmotas Herren U16", club: "BC Marmotas" },
      { name: "BC Olten-Zofingen Bulldogs HU16", club: "BC Olten-Zofingen" },
      { name: "BC Seetal HU16", club: "BC Seetal" },
      { name: "BC Sins HU16", club: "BC Sins" },
      { name: "BC Zürich 93 HU16R", club: "BC Zürich 93" },
      { name: "BC Silvercoast HU16R", club: "BC Silvercoast" },
      { name: "BC Weinland HU16", club: null },
      { name: "BS Kriens Hu16 Dragons", club: "BS Kriens" },
      { name: "BZO BC Wetzikon Wizards HU16", club: "BZO" },
      { name: "Frauenfeld HU16-A Tigers", club: "CVJM Frauenfeld" },
      { name: "Frauenfeld HU16-B Lakers", club: "CVJM Frauenfeld" },
      { name: "Emmen Basket HU16", club: "Emmen Basket" },
      { name: "GC Zürich HU16 C", club: "GC Zürich Basketball" },
      { name: "GC Zürich HU16 B", club: "GC Zürich Basketball" },
      { name: "GRBB Chur HU16", club: "GRBB" },
      { name: "KSC Wiedikon HU16", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen HU16R", club: "KTV Schaffhausen" },
      { name: "Linth Basket HU16", club: "Linth Basket" },
      { name: "Mutschellen HU16", club: "Mutschellen Basketball" },
      { name: "Oberthurgau Pirates HU16", club: "Oberthurgau Pirates" },
      { name: "Opfikon Basket Mavericks HU16", club: "Opfikon Basket" },
      { name: "Regensdorf Blizzards HU16", club: "Phönix Basket" },
      { name: "Rheintal Scorpions HU16", club: "Rheintal Scorpions" },
      { name: "Rüti-Basket Ballers HU16", club: "Rüti Basket" },
      { name: "Seeblick Bears HU16R", club: "Seeblick Bears Cham" },
      { name: "St. Otmar St. Gallen Basketball HU16B", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Basket Kreuzlingen HU16B", club: "STV Basket Kreuzlingen" },
      { name: "STV Basket Kreuzlingen HU16A", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket HU16", club: "STV Luzern Basket" },
      { name: "Unicorn 02 Basket HU16", club: "Unicorn 02 Basket" },
      { name: "Goldcoast Wallabies HU16R", club: "Wallabies" },
      { name: "Wohlen Basket HU16", club: "Wohlen Basket" },
      { name: "Zug Basket HU16", club: "Zug Basket" },
    ],
  },
  "HU18 Regional": {
    code: "HU18 Regional", label: "HU18 Regional", sex: "m",
    teams: [
      { name: "Baden Basket 54 HU18R", club: "Baden Basket 54" },
      { name: "BC Bears Wil HU18", club: "BC Bears Wil" },
      { name: "BC Oerlikon Grizzlies HU18", club: "BC Oerlikon Grizzlies" },
      { name: "BC Olten-Zofingen Bulldogs HU18", club: "BC Olten-Zofingen" },
      { name: "BC Sarnen HU18", club: "BC Sarnen" },
      { name: "BC Seuzach-Stammheim HU18", club: "BC Seuzach-Stammheim" },
      { name: "BC Zürich 93 HU18", club: "BC Zürich 93" },
      { name: "Frauenfeld HU18 Bulls", club: "CVJM Frauenfeld" },
      { name: "Baskets Feldkirch HU18", club: "Feldkirch Baskets" },
      { name: "KSC Wiedikon HU18", club: "KSC Wiedikon" },
      { name: "Linth Basket - Wattwil HU18", club: "Linth Basket" },
      { name: "Mutschellen HU18", club: "Mutschellen Basketball" },
      { name: "Opfikon Basket HU18", club: "Opfikon Basket" },
      { name: "St. Otmar St. Gallen Basketball HU18", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Basket Kreuzlingen HU18", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket HU18", club: "STV Luzern Basket" },
      { name: "Goldcoast Wallabies HU18", club: "Wallabies" },
    ],
  },
  "MixU12": {
    code: "MixU12", label: "MixU12M", sex: "mixed",
    teams: [
      { name: "Neuenhof Tigers MU12", club: "Baden Basket 54" },
      { name: "Baden Basket 54 HU12", club: "Baden Basket 54" },
      { name: "BBC Glarus MU12", club: "BBC Glarus" },
      { name: "Freienbach Flyers MU12", club: "BBC Glarus" },
      { name: "BBZU Road Runners MU12", club: "BBZU" },
      { name: "BC Alte Kanti Aarau HU12 Wizards (Turniere)", club: "BC AKA" },
      { name: "BC Bears Wil MU12", club: "BC Bears Wil" },
      { name: "BC Brunnen MU12", club: "BC Brunnen" },
      { name: "BCBE Eagles U12 B", club: "BC Buchrain-Ebikon" },
      { name: "BCBE Eagles U12", club: "BC Buchrain-Ebikon" },
      { name: "BC Fällanden Red Lions MU12", club: "BC Fällanden Red Lions" },
      { name: "BC Olten-Zofingen HU12", club: "BC Olten-Zofingen" },
      { name: "BC Seuzach Stammheim MU12", club: "BC Seuzach-Stammheim" },
      { name: "BC Uster MU12", club: "BC Uster" },
      { name: "BC Zürich 93 MU12 Süd", club: "BC Zürich 93" },
      { name: "BC Zürich 93 MU12 Nord", club: "BC Zürich 93" },
      { name: "BIQ U12", club: "BIQ" },
      { name: "BS Kriens Mu12 Suns", club: "BS Kriens" },
      { name: "BSC Obfelden MU12", club: "BSCO" },
      { name: "Romanshorn-Bregenz MU12", club: "BV Bregenz 1983" },
      { name: "BZO BC Wetzikon Vaders MU12", club: "BZO" },
      { name: "BZO Greifensee Crows MU12", club: "BZO" },
      { name: "Frauenfeld MU12 Pandas (Turnier)", club: "CVJM Frauenfeld" },
      { name: "Emmen Basket MixU12M", club: "Emmen Basket" },
      { name: "GRBB Chur MU12", club: "GRBB" },
      { name: "Ikaros Zürich MU12", club: "Ikaros Zürich BC" },
      { name: "KSC Wiedikon HU12", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen MU12", club: "KTV Schaffhausen" },
      { name: "Linth Basket MU12", club: "Linth Basket" },
      { name: "Mutschellen HU12", club: "Mutschellen Basketball" },
      { name: "Opfikon Basket Grizzlies MU12", club: "Opfikon Basket" },
      { name: "Regensdorf Panthers HU12", club: "Phönix Basket" },
      { name: "Rüti Basket MU12", club: "Rüti Basket" },
      { name: "Immensee Panthers MU12", club: "SCB" },
      { name: "St. Otmar St. Gallen Basketball MIXU12A", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Basket Kreuzlingen MU12", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket Racoons MU12", club: "STV Luzern Basket" },
      { name: "Sursee Basket MU12", club: "Sursee Basket" },
      { name: "TV Hünenberg Rockets MU12", club: null },
      { name: "TV Reussbühl Basket MU12", club: "TVRB" },
      { name: "Unicorn 02 Basket MU12", club: "Unicorn 02 Basket" },
      { name: "Goldcoast Wallabies HU12", club: "Wallabies" },
      { name: "Weinland BC MU12", club: "Weinland BC" },
      { name: "Wohlen Basket MixU12 B", club: "Wohlen Basket" },
      { name: "Zug Basket MU12 Promo", club: "Zug Basket" },
    ],
  },
  "MixU10": {
    code: "MixU10", label: "MixU10M", sex: "mixed",
    teams: [
      { name: "Baden Basket 54 HU10", club: "Baden Basket 54" },
      { name: "Neuenhof Tigers MU10", club: "Baden Basket 54" },
      { name: "BBZU Turtles MU10", club: "BBZU" },
      { name: "BBZU Wolves MU10", club: "BBZU" },
      { name: "BC Alte Kanti Aarau Pirates 3 MU10", club: "BC AKA" },
      { name: "BC Alte Kanti Aarau Pirates 1 MU10", club: "BC AKA" },
      { name: "BC Alte Kanti Aarau Pirates 2 MU10", club: "BC AKA" },
      { name: "BC Brunnen MU10", club: "BC Brunnen" },
      { name: "BCBE Dolphins 2 U10", club: "BC Buchrain-Ebikon" },
      { name: "BCBE Dolphins 1 U10", club: "BC Buchrain-Ebikon" },
      { name: "BC Fällanden Red Lions MU10", club: "BC Fällanden Red Lions" },
      { name: "BC Olten-Zofingen HU10", club: "BC Olten-Zofingen" },
      { name: "BC Seuzach Stammheim MU10", club: "BC Seuzach-Stammheim" },
      { name: "BC Silvercoast MU10", club: "BC Silvercoast" },
      { name: "BC Uster MU10", club: "BC Uster" },
      { name: "BC Zürich 93 MU10 Nord A", club: "BC Zürich 93" },
      { name: "BC Zürich 93 MU10 Süd", club: "BC Zürich 93" },
      { name: "BIQ U10", club: "BIQ" },
      { name: "BS Kriens Mu10 Hurricanes", club: "BS Kriens" },
      { name: "BS Kriens Mu10 Flames", club: "BS Kriens" },
      { name: "BSC Obfelden MU10", club: "BSCO" },
      { name: "Romanshorn-Bregenz MU10", club: "BV Bregenz 1983" },
      { name: "BZO Greifensee U10", club: "BZO" },
      { name: "BZO BC Wetzikon Flyers MU10", club: "BZO" },
      { name: "Frauenfeld MU10 (Turnier)", club: "CVJM Frauenfeld" },
      { name: "Emmen Basket Mix U10", club: "Emmen Basket" },
      { name: "GC Zürich MU10", club: "GC Zürich Basketball" },
      { name: "GRBB Chur MU10", club: "GRBB" },
      { name: "Ikaros Zürich U10", club: "Ikaros Zürich BC" },
      { name: "KSC Wiedikon MU10", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen MU10", club: "KTV Schaffhausen" },
      { name: "Linth Basket MU10", club: "Linth Basket" },
      { name: "Mutschellen HU10", club: "Mutschellen Basketball" },
      { name: "Oberthurgau Pirates U10", club: "Oberthurgau Pirates" },
      { name: "Opfikon Basket Grizzlies MU10", club: "Opfikon Basket" },
      { name: "Regensdorf Weasels HU10", club: "Phönix Basket" },
      { name: "Regensdorf Foxes HU10", club: "Phönix Basket" },
      { name: "Rüti Basket MU10", club: "Rüti Basket" },
      { name: "St. Otmar St. Gallen Basketball MIXU10", club: "St. Otmar St. Gallen Basketball" },
      { name: "STV Basket Kreuzlingen MU10", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket Squirrels MU10", club: "STV Luzern Basket" },
      { name: "Sursee Basket MU10", club: "Sursee Basket" },
      { name: "TV Reussbühl Basket MU10", club: "TVRB" },
      { name: "Unicorn 02 Basket MU10", club: "Unicorn 02 Basket" },
      { name: "Goldcoast Wallabies MU10 2", club: "Wallabies" },
      { name: "Goldcoast Wallabies MU10", club: "Wallabies" },
      { name: "Weinland BC MU10", club: "Weinland BC" },
      { name: "Wohlen Basket MixU10 A", club: "Wohlen Basket" },
      { name: "Zug Basket MU10", club: "Zug Basket" },
    ],
  },
  "DU10": {
    code: "DU10", label: "DU10", sex: "f",
    teams: [
      { name: "Regensdorf Swans DU10", club: "Phönix Basket" },
      { name: "Mutschellen DU10", club: "Mutschellen Basketball" },
      { name: "KSC Wiedikon DU10", club: "KSC Wiedikon" },
      { name: "Baar Bumble Bees DU10", club: "Baar Bumble Bees" },
      { name: "BC Uster DU10", club: "BC Uster" },
      { name: "BC Olten-Zofingen DU10", club: "BC Olten-Zofingen" },
      { name: "BC Alte Kanti Aarau DU10", club: "BC AKA" },
      { name: "Baden Basket 54 DU10", club: "Baden Basket 54" },
    ],
  },
  "MixU8": {
    code: "MixU8", label: "MixU8M", sex: "mixed",
    teams: [
      { name: "Baar Bumble Bees DU8", club: "Baar Bumble Bees" },
      { name: "Baden Basket 54 U8", club: "Baden Basket 54" },
      { name: "BBZU Avengers MU8", club: "BBZU" },
      { name: "BC Alte Kanti Aarau Kangaroos MU8", club: "BC AKA" },
      { name: "BC Fällanden Red Lions MU8", club: "BC Fällanden Red Lions" },
      { name: "BC Seuzach-Stammheim MU8", club: "BC Seuzach-Stammheim" },
      { name: "BC Uster MU8", club: "BC Uster" },
      { name: "BC Zürich 93 MU8 Süd", club: "BC Zürich 93" },
      { name: "BS Kriens Mu8 Pirates", club: "BS Kriens" },
      { name: "BZO Greifensee U8", club: "BZO" },
      { name: "Frauenfeld MU8 (Turnier)", club: "CVJM Frauenfeld" },
      { name: "Emmen Basket Mix U8", club: "Emmen Basket" },
      { name: "Ikaros Zürich U8", club: "Ikaros Zürich BC" },
      { name: "KSC Wiedikon MU8", club: "KSC Wiedikon" },
      { name: "KTV Schaffhausen MU8", club: "KTV Schaffhausen" },
      { name: "Regensdorf Racoons MU8", club: "Phönix Basket" },
      { name: "Rüti Basket MU8", club: "Rüti Basket" },
      { name: "STV Basket Kreuzlingen MU8", club: "STV Basket Kreuzlingen" },
      { name: "STV Luzern Basket Colibri MU08", club: "STV Luzern Basket" },
      { name: "Unicorn 02 Basket U8", club: "Unicorn 02 Basket" },
      { name: "Goldcoast Wallabies U8", club: "Wallabies" },
      { name: "Zug Basket MU8", club: "Zug Basket" },
    ],
  },
}

/**
 * KSCW basketball team (`teams.bb_source_id`) → its ProBasket group code.
 * Rebuilt 05.08.2026 against the live prod rows
 * (`SELECT id, name, bb_source_id, league, gender FROM teams WHERE sport='basketball' AND active=true`
 * → 17 rows). Every entry below was checked to have a matching "KSC Wiedikon …" row in its group.
 */
export const KSCW_TEAM_GROUP: Record<string, string> = {
  "4445": "D1LRA",           // team 86 Lions D1        → KSC Wiedikon Lions D1
  "1077": "D3LRA",           // team 89 Rhinos D3       → KSC Wiedikon Rhinos D3
  "5104": "DU12 TU",         // team 70 DU12            → KSC Wiedikon DU12
  "5441": "DU14 Regional",   // team 71 DU14            → KSC Wiedikon DU14
  // ⚠ 7182 IS the DU16 squad. The active team row is named "2xDU18" — a local misnomer; the
  // parallel inactive row (teams.id 17, same bb_source_id) still reads "DU16", teams.league is
  // "DU16B", and Basketplan fixtures for 7182 show "KSC Wiedikon DU16" vs "BC Brunnen DU16" /
  // "BC Zürich 93 DU16". Do not "fix" this back to a DU18 group.
  "7182": "DU14/U16 Rookie", // team 72 "2xDU18" (=DU16) → KSC Wiedikon DU16
  "5697": "DU18/U20 Rookie", // team 73 1xDU18          → KSC Wiedikon DU18 A
  // TODO(DU18 B): the Gruppeneinteilung also lists "KSC Wiedikon DU18 B" in DU18/U20 Rookie, but
  // that squad has no `teams` row and no known Basketplan id, so it cannot be keyed here. Once the
  // DU18 B team row exists and its bb_source_id is known, add `"<id>": "DU18/U20 Rookie"`. Do NOT
  // invent an id — a wrong bb_source_id silently mis-scopes fixtures and availability exports.
  "1348": "H1LRA",           // team 75 Herren 1 H1     → KSC Wiedikon Herren 1 H1
  // ⚠ teams.league still says "H3LS" (last season's Basketplan group). For 26/27 the club
  // registered Herren 2 in the 2. Liga and the Gruppeneinteilung lists it under H2LRA.
  "4829": "H2LRA",           // team 76 Herren 2 H3     → KSC Wiedikon Herren 2 H2
  "7183": "H4LRA",           // team 77 Herren 3        → KSC Wiedikon Herren 3 (Unicorns) H4
  "5790": "HU14 Regional",   // team 83 HU14            → KSC Wiedikon HU14
  "5498": "HU16 Regional",   // team 84 HU16            → KSC Wiedikon HU16
  "5789": "HU18 Regional",   // team 85 HU18            → KSC Wiedikon HU18
  "5791": "MixU12",          // team 78 HU12            → KSC Wiedikon HU12
  "5287": "MixU10",          // team 87 MU10            → KSC Wiedikon MU10
  "6724": "MixU8",           // team 88 MU8             → KSC Wiedikon MU8
  // TODO(DU10): the workbook lists "KSC Wiedikon DU10" in the DU10 group, but no active
  // `teams` row carries a DU10 bb_source_id (checked on prod 05.08.2026), so the group stays
  // unreferenced. Add the mapping when the team row is created.
  //
  // Deliberately unmapped — 4934 (team 69, Damen D-Classics 1LR) and 4935 (team 74,
  // H-Classics 1LR). The ProBasket Classics competition is registered outside this workbook
  // (the Spiel- und Sperrdaten only reserve "25. April 2027 ProBasket Classics Final"), so
  // there is no group to point at. `hasGroupData()` returns false for both — the UI must fall
  // back to free-text opponent entry rather than render an empty picker.
}

/**
 * Does this KSCW team have a known ProBasket group?
 * `false` means "we have no opponent list", which is NOT the same as "this team has no
 * opponents" — the UI should invite free-text entry instead of showing an empty datalist.
 */
export function hasGroupData(bbSourceId: string | null | undefined): boolean {
  const code = bbSourceId ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  return !!(code && BB_GROUPS[code])
}

/** Opponent teams for a KSCW team (its group minus every KSCW entry). Empty when `hasGroupData` is false. */
export function opponentsFor(bbSourceId: string | null | undefined): string[] {
  return opponentEntriesFor(bbSourceId).map((t) => t.name)
}

/**
 * Same as `opponentsFor`, but keeps the owning club — for the per-club opponent portals
 * (one scheduling link per club, covering all of that club's teams).
 */
export function opponentEntriesFor(bbSourceId: string | null | undefined): BbTeam[] {
  const code = bbSourceId ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  const g = code ? BB_GROUPS[code] : undefined
  if (!g) return []
  // DU18/U20 Rookie holds two KSCW entries (DU18 A + DU18 B) — the filter must drop both.
  return g.teams.filter((t) => !/wiedikon/i.test(t.name))
}

/**
 * Derived sex ('m'|'f'|'mixed') for a KSCW team's group, or null.
 * ⚠ This is the *competition's* sex, not the team's. It can diverge from `teams.gender`:
 * prod team 78 (HU12, bb_source_id 5791) is gender='m' but plays in MixU12, whose sex is
 * 'mixed'. That is correct and intentional — a boys' squad entered in a mixed league. Do not
 * "reconcile" the two: callers that need the roster's gender must read `teams.gender`.
 */
export function sexForGroup(bbSourceId: string | null | undefined): 'm' | 'f' | 'mixed' | null {
  const code = bbSourceId ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  return code ? BB_GROUPS[code]?.sex ?? null : null
}
