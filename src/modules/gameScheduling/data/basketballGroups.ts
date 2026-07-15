// AUTO-EXTRACTED from ProBasket 'Übersicht Teamanmeldungen 26/27' (Gruppeneinteilung).
// Provisional groups — refresh once per season from the ProBasket Nextcloud share.
// Multi-group leagues (e.g. HU16, MixU12) list ALL teams provisionally: a fine
// superset for the opponent search. Free-text fallback covers anything missing.

export interface BbGroup { code: string; label: string; sex: 'm' | 'f' | 'mixed'; teams: string[] }

export const BB_GROUPS: Record<string, BbGroup> = {
  "D1LRA": { code: "D1LRA", label: "Damen 1. Liga", sex: "f", teams: ["BC Arlesheim D1", "BC Olympiakos D1", "RJ Lakers D1", "BC Seuzach-Stammheim D1", "Frauenfeld Damen 1", "Emmen Basket D1", "Baskets Feldkirch D1", "KSC Wiedikon Lions D1", "Opfikon Basket Blizzards D1", "Zug Basket D1"] },
  "D3LRA": { code: "D3LRA", label: "Damen 3. Liga", sex: "f", teams: ["Marmotas Damen D3", "BC Winterthur 2 D3", "Mörschwil Griffins D3", "KSC Wiedikon Rhinos D3", "Mutschellen Damen D3", "St. Otmar St. Gallen Basketball Damen D3", "Stingerz Zürich Damen D3", "Goldcoast Wallabies D3"] },
  "DU12 TU": { code: "DU12 TU", label: "DU12TU", sex: "f", teams: ["Baar Bumble Bees DU12 Team Gold", "Baden Basket 54 DU12", "BC Alte Kanti Aarau Lightning DU12T", "BS Kriens Queens Du12", "BZO Greifensee Mariposas DU12", "Frauenfeld DU12 (Turnier)", "KSC Wiedikon DU12", "Mutschellen DU12", "Regensdorf Penguins DU12", "Rüti Centellas DU12", "Goldcoast Wallabies DU12"] },
  "DU14 Regional": { code: "DU14 Regional", label: "DU14 Regional", sex: "f", teams: ["Baar Bumble Bees DU14", "Baden Basket 54 DU14", "BC Brunnen DU14", "BCBE DU14", "BC Olten-Zofingen DU14 A", "BC Silvercoast DU14", "BS Kriens Queens Du14", "BZO BC Effretikon Orcas DU14", "KSC Wiedikon DU14", "Mutschellen DU14", "Goldcoast Wallabies DU14R"] },
  "DU18/U20 Rookie": { code: "DU18/U20 Rookie", label: "DU20 Rookie", sex: "f", teams: ["BIQ DU18 (Ausser Konk.)", "BS Kriens Queens Du18", "Emmen Basket DU18", "GC Zurich DU18", "KSC Wiedikon DU18 A", "KSC Wiedikon DU18 B", "Mutschellen DU18", "Seeblick Bears DU18", "STV Luzern Basket DU18", "BC Zürich 93 DU18/DU20", "St. Otmar St. Gallen Basketball DU20B", "St. Otmar St. Gallen Basketball DU20A"] },
  "H1LRA": { code: "H1LRA", label: "Herren 1. Liga", sex: "m", teams: ["BC Bears Wil H1", "BC Oerlikon Grizzlies H1", "BC Winterthur 2 H1", "Mörschwil Griffins H1", "Ikaros Zürich H1", "KSC Wiedikon Herren 1 H1", "Opfikon Basket H1", "Stingers Zürich H1", "STV Luzern Basket Herren 1", "Zug Basket H1"] },
  "H2LRA": { code: "H2LRA", label: "Herren 2. Liga", sex: "m", teams: ["Aarau Basket H1", "BBC Schaan H2", "BZO Highlanders H2", "Frauenfeld Herren 1", "GRBB Chur Herren 1 H2", "KSC Wiedikon Herren 2 H2", "Opfikon Basket Wolves H2", "Opfikon Basket Rams H2", "Unicorn 02 Basket H2", "Wohlen Basket H2", "Zug Basket H2"] },
  "H4LRA": { code: "H4LRA", label: "Herren 4. Liga", sex: "m", teams: ["Aarau Basket H4", "BBC Inwil Hoopers H4 Team Rhei", "BBC Inwil Hoopers H4 Team Panta", "BBC Lions Heat H4", "BBZU Rockets H4", "BC Bears Wil H4", "BC Oerlikon Grizzlies H4", "RJ Lakers 1 H4", "BC Seetal H4", "BC Seuzach-Stammheim H4", "BC Silvercoast H4", "BC Altstetten H4 II", "BC Altstetten H4", "BCL Rivers H4", "BS Arth-Goldau H4", "BZO Buzzers H4", "Frauenfeld Herren 2 H4", "KSC Wiedikon Herren 3 (Unicorns) H4", "KTV Schaffhausen H2", "Megas Alexandros H4", "Mutschellen Herren 2 H4", "Oberthurgau Pirates H4", "Rüti Basket Herren H4", "St. Otmar St. Gallen Basketball H4", "Stingerz FIVE4 H4", "STV Basket Kreuzlingen H4", "STV Luzern Basket Herren 2 H4", "Sursee Basket H4", "TV Reussbühl Rebels H4", "Wohlen Basket 2 H4"] },
  "HU14 Regional": { code: "HU14 Regional", label: "HU14 Regional", sex: "m", teams: ["Baden Basket 54 HU14R", "BBC Glarus HU14", "BBC Inwil Hoopers HU14 Team Axis", "BBZU Huskies HU14", "BCBE Panthers HU14", "BC Olten-Zofingen Bulldogs HU14", "BC Silvercoast HU14", "BC Sins HU14", "BC Uster HU14", "BC Winterthur HU14", "BC Zürich 93 HU14", "BIQ HU14", "BS Kriens Hu14 Sharks", "BS Kriens HU14 Falcons", "BV Bregenz-Romanshorn HU14", "BZO BC Effretikon Rookies HU14", "BZO BC Wetzikon Sooners HU14", "BZO Greifensee Eagles HU14", "Emmen Basket HU14", "GC Zürich HU14 C", "GC Zürich HU14 B", "GRBB Chur HU14", "KSC Wiedikon HU14", "KTV Schaffhausen HU14", "Mutschellen HU14", "Oberthurgau Pirates HU14", "Opfikon Basket Blaze HU14", "Regensdorf Pirates HU14", "Rheintal Scorpions HU14", "Rüti Basket HU14", "Seeblick Bears HU14", "St. Otmar St. Gallen Basketball HU14", "STV Basket Kreuzlingen HU14", "STV Luzern Basket HU14", "Unicorn 02 Basket HU14", "Goldcoast Wallabies HU14", "Wohlen Basket HU14", "Zug Basket HU14"] },
  "HU16 Regional": { code: "HU16 Regional", label: "HU16 Regional", sex: "m", teams: ["Baden Basket 54 HU16R", "BBC Glarus HU16", "BBC Inwil Hoopers HU16 Team Nexus", "BBZU Tigers HU16", "BC Brunnen HU16", "BCBE Bulls HU16", "BCBE Sharks HU16 PR", "Marmotas Herren U16", "BC Olten-Zofingen Bulldogs HU16", "BC Seetal HU16", "BC Sins HU16", "BC Zürich 93 HU16R", "BS Kriens Hu16 Rising Stars", "BC Silvercoast HU16R", "BS Kriens Hu16 Dragons", "BZO BC Wetzikon Wizards HU16", "Frauenfeld HU16-A Tigers", "Frauenfeld HU16-B Lakers", "Emmen Basket HU16", "GC Zürich HU16 C", "GC Zürich HU16 B", "GRBB Chur HU16", "KSC Wiedikon HU16", "KTV Schaffhausen HU16R", "Linth Basket HU16", "Mutschellen HU16", "Oberthurgau Pirates HU16", "Opfikon Basket Mavericks HU16", "Regensdorf Blizzards HU16", "Rheintal Scorpions HU16", "Rüti-Basket Ballers HU16", "Seeblick Bears HU16R", "St. Otmar St. Gallen Basketball HU16B", "STV Basket Kreuzlingen HU16B", "STV Basket Kreuzlingen HU16A", "STV Luzern Basket HU16", "Unicorn 02 Basket HU16", "Goldcoast Wallabies HU16R", "Wohlen Basket HU16", "Zug Basket HU16"] },
  "HU18 Regional": { code: "HU18 Regional", label: "HU18 Regional", sex: "m", teams: ["Baden Basket 54 HU18R", "BC Bears Wil HU18", "BC Oerlikon Grizzlies HU18", "BC Olten-Zofingen Bulldogs HU18", "BC Sarnen HU18", "BC Seuzach-Stammheim HU18", "BC Zürich 93 HU18", "Frauenfeld HU18 Bulls", "Baskets Feldkirch HU18", "KSC Wiedikon HU18", "Linth Basket - Wattwil HU18", "Mutschellen HU18", "Opfikon Basket HU18", "St. Otmar St. Gallen Basketball HU18", "STV Basket Kreuzlingen HU18", "STV Luzern Basket HU18", "Goldcoast Wallabies HU18"] },
  "MixU12": { code: "MixU12", label: "MixU12M", sex: "mixed", teams: ["Neuenhof Tigers MU12", "Baden Basket 54 HU12", "BBC Glarus MU12", "Freienbach Flyers MU12", "BBZU Road Runners MU12", "BC Alte Kanti Aarau HU12 Wizards (Turniere)", "BC Bears Wil MU12", "BC Brunnen MU12", "BCBE Eagles U12 B", "BCBE Eagles U12", "BC Fällanden Red Lions MU12", "BC Olten-Zofingen HU12", "BC Seuzach Stammheim MU12", "BC Uster MU12", "BC Zürich 93 MU12 Süd", "BC Zürich 93 MU12 Nord", "BIQ U12", "BS Kriens Mu12 Suns", "BS Kriens Mu12 Dragons", "BSC Obfelden MU12", "Romanshorn-Bregenz MU12", "BZO BC Wetzikon Vaders MU12", "BZO Greifensee Crows MU12", "Frauenfeld MU12 Pandas (Turnier)", "Emmen Basket MixU12M", "GRBB Chur MU12", "Ikaros Zürich MU12", "KSC Wiedikon HU12", "KTV Schaffhausen MU12", "Linth Basket MU12", "Mutschellen HU12", "Opfikon Basket Grizzlies MU12", "Regensdorf Panthers HU12", "Rüti Basket MU12", "Immensee Panthers MU12", "St. Otmar St. Gallen Basketball MIXU12A", "STV Basket Kreuzlingen MU12", "STV Luzern Basket Racoons MU12", "Sursee Basket MU12", "TV Reussbühl Basket MU12", "Unicorn 02 Basket MU12", "Goldcoast Wallabies HU12", "Weinland BC MU12", "Wohlen Basket MixU12 B", "Zug Basket MU12 Promo"] },
  "MixU10": { code: "MixU10", label: "MixU10M", sex: "mixed", teams: ["Baden Basket 54 HU10", "Neuenhof Tigers MU10", "BBZU Turtles MU10", "BBZU Wolves MU10", "BC Alte Kanti Aarau Pirates 3 MU10", "BC Alte Kanti Aarau Pirates 1 MU10", "BC Alte Kanti Aarau Pirates 2 MU10", "BC Brunnen MU10", "BCBE Dolphins 2 U10", "BCBE Dolphins 1 U10", "BC Fällanden Red Lions MU10", "BC Olten-Zofingen HU10", "BC Seuzach Stammheim MU10", "BC Silvercoast MU10", "BC Uster MU10", "BC Zürich 93 MU10 Nord A", "BC Zürich 93 MU10 Süd", "BIQ U10", "BS Kriens Mu10 Hurricanes", "BS Kriens Mu10 Flames", "BSC Obfelden MU10", "Romanshorn-Bregenz MU10", "BZO Greifensee U10", "BZO BC Wetzikon Flyers MU10", "Frauenfeld MU10 (Turnier)", "Emmen Basket Mix U10", "GC Zürich MU10", "GRBB Chur MU10", "Ikaros Zürich U10", "KSC Wiedikon MU10", "KTV Schaffhausen MU10", "Linth Basket MU10", "Mutschellen HU10", "Oberthurgau Pirates U10", "Opfikon Basket Grizzlies MU10", "Regensdorf Weasels HU10", "Regensdorf Foxes HU10", "Rüti Basket MU10", "St. Otmar St. Gallen Basketball MIXU10", "STV Basket Kreuzlingen MU10", "STV Luzern Basket Squirrels MU10", "Sursee Basket MU10", "TV Reussbühl Basket MU10", "Unicorn 02 Basket MU10", "Goldcoast Wallabies MU10 2", "Goldcoast Wallabies MU10", "Weinland BC MU10", "Wohlen Basket MixU10 A", "Zug Basket MU10"] },
  "DU10": { code: "DU10", label: "MixU10M", sex: "f", teams: ["Regensdorf Swans DU10", "Mutschellen DU10", "KSC Wiedikon DU10", "BC Uster DU10", "BC Olten-Zofingen DU10", "BC Alte Kanti Aarau DU10", "Baden Basket 54 DU10"] },
  "MixU8": { code: "MixU8", label: "MixU8M", sex: "mixed", teams: ["Baar Bumble Bees DU8", "Baden Basket 54 U8", "BBZU Avengers MU8", "BC Alte Kanti Aarau Kangaroos MU8", "BC Fällanden Red Lions MU8", "BC Seuzach-Stammheim MU8", "BC Uster MU8", "BC Zürich 93 MU8 Süd", "BS Kriens Mu8 Pirates", "BZO Greifensee U8", "Frauenfeld MU8 (Turnier)", "Emmen Basket Mix U8", "Ikaros Zürich U8", "KSC Wiedikon MU8", "KTV Schaffhausen MU8", "Regensdorf Racoons MU8", "Rüti Basket MU8", "STV Basket Kreuzlingen MU8", "STV Luzern Basket Colibri MU08", "Unicorn 02 Basket U8", "Goldcoast Wallabies U8", "Zug Basket MU8"] },
}

/** KSCW basketball team (teams.bb_source_id) → its ProBasket group code. */
export const KSCW_TEAM_GROUP: Record<string, string> = {
  "4445": "D1LRA",
  "1077": "D3LRA",
  "5104": "DU12 TU",
  "5441": "DU14 Regional",
  "5697": "DU18/U20 Rookie",
  "7182": "DU18/U20 Rookie",
  "1348": "H1LRA",
  "4829": "H2LRA",
  "7183": "H4LRA",
  "5790": "HU14 Regional",
  "5498": "HU16 Regional",
  "5789": "HU18 Regional",
  "5791": "MixU12",
  "5287": "MixU10",
  "6724": "MixU8",
}

/** Opponent teams for a KSCW team (its group minus the KSCW entry). */
export function opponentsFor(bbSourceId: string | null | undefined): string[] {
  const code = bbSourceId ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  const g = code ? BB_GROUPS[code] : undefined
  if (!g) return []
  return g.teams.filter((t) => !/wiedikon/i.test(t))
}

/** Derived sex ('m'|'f'|'mixed') for a KSCW team's group, or null. */
export function sexForGroup(bbSourceId: string | null | undefined): 'm' | 'f' | 'mixed' | null {
  const code = bbSourceId ? KSCW_TEAM_GROUP[String(bbSourceId)] : undefined
  return code ? BB_GROUPS[code]?.sex ?? null : null
}
