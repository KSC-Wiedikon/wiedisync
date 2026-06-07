# Layer 1 — Import Dependency Graph (mechanical)

Derived by parsing every static + dynamic import in `src/` (`extract-graph.mjs`). **773 files**, **125,418 LOC**, **33 areas**, **223 cross-area edges**. Edges are exact (resolved `@/` alias + relative paths); counts = number of import statements crossing the boundary.

## Areas (by size & coupling)

`in` = import statements pointing *into* the area (how depended-upon it is); `out` = imports it makes outward.

| Area | LOC | Files | In | Out |
|---|--:|--:|--:|--:|
| `components` | 38,734 | 235 | 289 | 273 |
| `i18n` | 18,085 | 162 | 10 | 0 |
| `modules/admin` | 11,299 | 37 | 19 | 149 |
| `modules/hallenplan` | 4,888 | 20 | 15 | 71 |
| `modules/gameScheduling` | 4,075 | 27 | 4 | 68 |
| `modules/calendar` | 3,835 | 13 | 4 | 84 |
| `modules/games` | 3,483 | 12 | 5 | 100 |
| `modules/auth` | 3,187 | 10 | 9 | 92 |
| `modules/messaging` | 3,061 | 46 | 9 | 69 |
| `modules/teams` | 2,997 | 8 | 4 | 94 |
| `modules/scorer` | 2,914 | 9 | 2 | 54 |
| `modules/trainings` | 2,848 | 8 | 5 | 87 |
| `modules/spielplanung` | 2,841 | 20 | 1 | 86 |
| `hooks` | 2,805 | 29 | 261 | 56 |
| `modules/absences` | 2,595 | 12 | 2 | 91 |
| `ui` | 2,481 | 26 | 225 | 27 |
| `modules/events` | 2,004 | 4 | 2 | 68 |
| `utils` | 1,741 | 21 | 270 | 11 |
| `modules/forms` | 1,605 | 9 | 5 | 37 |
| `modules/home` | 1,456 | 3 | 2 | 38 |
| `modules/guide` | 1,412 | 25 | 11 | 14 |
| `lib` | 1,269 | 4 | 358 | 1 |
| `types` | 996 | 2 | 182 | 0 |
| `modules/fines` | 901 | 5 | 4 | 28 |
| `modules/broadcast` | 830 | 7 | 3 | 10 |
| `modules/polls` | 620 | 4 | 3 | 11 |
| `modules/tasks` | 548 | 4 | 3 | 12 |
| `modules/feedback` | 484 | 1 | 1 | 9 |
| `modules/carpool` | 440 | 4 | 1 | 14 |
| `modules/legal` | 262 | 2 | 3 | 0 |
| `modules/changelog` | 257 | 1 | 3 | 1 |
| `modules/news` | 241 | 1 | 1 | 10 |
| `app-root` | 224 | 2 | 0 | 69 |

## Foundation layer (shared internals)

These areas are imported by everything; the diagram shows how they depend on *each other*. `i18n` and `types` are leaves (in-degree only — nothing they import internally is graphed).

```mermaid
graph LR
  lib["lib<br/>in:358 out:1"]
  utils["utils<br/>in:270 out:11"]
  hooks["hooks<br/>in:261 out:56"]
  components["components<br/>in:289 out:273"]
  ui["ui<br/>in:225 out:27"]
  types["types<br/>in:182 out:0"]
  i18n["i18n<br/>in:10 out:0"]
  components -->|169| lib
  components -->|42| hooks
  ui -->|25| lib
  hooks -->|25| lib
  components -->|22| utils
  components -->|15| ui
  hooks -->|15| types
  hooks -->|14| utils
  components -->|12| types
  utils -->|6| types
  components -->|5| assets
  utils -->|2| i18n
  utils -->|2| lib
  components -->|1| i18n
  components -->|1| data
  ui -->|1| utils
  ui -->|1| hooks
  hooks -->|1| i18n
  lib -->|1| utils
```

## Cross-feature coupling (module → module)

Feature modules mostly fan *down* into the foundation and rarely import each other. The few module→module edges below are the real cross-feature dependencies — everything else is decoupled.

```mermaid
graph LR
  modules_calendar["calendar"]
  modules_hallenplan["hallenplan"]
  modules_absences["absences"]
  modules_admin["admin"]
  modules_messaging["messaging"]
  modules_home["home"]
  modules_games["games"]
  modules_polls["polls"]
  modules_scorer["scorer"]
  modules_guide["guide"]
  modules_teams["teams"]
  modules_auth["auth"]
  modules_legal["legal"]
  modules_events["events"]
  modules_tasks["tasks"]
  modules_broadcast["broadcast"]
  modules_forms["forms"]
  modules_gameScheduling["gameScheduling"]
  modules_carpool["carpool"]
  modules_trainings["trainings"]
  modules_news["news"]
  modules_spielplanung["spielplanung"]
  modules_fines["fines"]
  modules_calendar -->|13| modules_hallenplan
  modules_absences -->|3| modules_calendar
  modules_admin -->|2| modules_messaging
  modules_home -->|2| modules_games
  modules_messaging -->|2| modules_polls
  modules_scorer -->|2| modules_guide
  modules_teams -->|2| modules_messaging
  modules_absences -->|1| modules_guide
  modules_absences -->|1| modules_hallenplan
  modules_absences -->|1| modules_admin
  modules_auth -->|1| modules_messaging
  modules_auth -->|1| modules_legal
  modules_calendar -->|1| modules_absences
  modules_calendar -->|1| modules_games
  modules_events -->|1| modules_tasks
  modules_events -->|1| modules_broadcast
  modules_events -->|1| modules_guide
  modules_forms -->|1| modules_admin
  modules_gameScheduling -->|1| modules_admin
  modules_games -->|1| modules_guide
  modules_games -->|1| modules_tasks
  modules_games -->|1| modules_carpool
  modules_games -->|1| modules_broadcast
  modules_games -->|1| modules_trainings
  modules_hallenplan -->|1| modules_guide
  modules_home -->|1| modules_trainings
  modules_home -->|1| modules_events
  modules_home -->|1| modules_guide
  modules_home -->|1| modules_forms
  modules_news -->|1| modules_home
  modules_spielplanung -->|1| modules_admin
  modules_spielplanung -->|1| modules_guide
  modules_teams -->|1| modules_trainings
  modules_teams -->|1| modules_fines
  modules_teams -->|1| modules_polls
  modules_teams -->|1| modules_auth
  modules_trainings -->|1| modules_fines
  modules_trainings -->|1| modules_tasks
  modules_trainings -->|1| modules_broadcast
  modules_trainings -->|1| modules_guide
```

| From | To | Imports |
|---|---|--:|
| `calendar` | `hallenplan` | 13 |
| `absences` | `calendar` | 3 |
| `admin` | `messaging` | 2 |
| `home` | `games` | 2 |
| `messaging` | `polls` | 2 |
| `scorer` | `guide` | 2 |
| `teams` | `messaging` | 2 |
| `absences` | `guide` | 1 |
| `absences` | `hallenplan` | 1 |
| `absences` | `admin` | 1 |
| `auth` | `messaging` | 1 |
| `auth` | `legal` | 1 |
| `calendar` | `absences` | 1 |
| `calendar` | `games` | 1 |
| `events` | `tasks` | 1 |
| `events` | `broadcast` | 1 |
| `events` | `guide` | 1 |
| `forms` | `admin` | 1 |
| `gameScheduling` | `admin` | 1 |
| `games` | `guide` | 1 |
| `games` | `tasks` | 1 |
| `games` | `carpool` | 1 |
| `games` | `broadcast` | 1 |
| `games` | `trainings` | 1 |
| `hallenplan` | `guide` | 1 |
| `home` | `trainings` | 1 |
| `home` | `events` | 1 |
| `home` | `guide` | 1 |
| `home` | `forms` | 1 |
| `news` | `home` | 1 |
| `spielplanung` | `admin` | 1 |
| `spielplanung` | `guide` | 1 |
| `teams` | `trainings` | 1 |
| `teams` | `fines` | 1 |
| `teams` | `polls` | 1 |
| `teams` | `auth` | 1 |
| `trainings` | `fines` | 1 |
| `trainings` | `tasks` | 1 |
| `trainings` | `broadcast` | 1 |
| `trainings` | `guide` | 1 |

## Module → foundation usage matrix

How heavily each feature module leans on each shared area (import-statement counts). Blank = no direct import.

| Module | `lib` | `hooks` | `utils` | `ui` | `components` | `types` | `i18n` |
|---|--:|--:|--:|--:|--:|--:|--:|
| `admin` | 19 | 11 | 18 | 21 | 71 | 7 |  |
| `games` | 7 | 22 | 29 | 3 | 23 | 10 | 1 |
| `teams` | 11 | 11 | 29 | 10 | 20 | 7 |  |
| `absences` | 5 | 17 | 13 | 22 | 18 | 10 |  |
| `spielplanung` | 9 | 10 | 24 | 12 | 9 | 20 |  |
| `trainings` | 7 | 18 | 19 | 8 | 23 | 7 | 1 |
| `auth` | 11 | 13 | 13 | 17 | 18 | 5 | 3 |
| `hallenplan` | 7 | 8 | 17 | 9 | 13 | 16 |  |
| `calendar` | 3 | 14 | 16 | 1 | 19 | 16 |  |
| `gameScheduling` | 11 | 5 | 4 | 23 | 6 | 18 |  |
| `messaging` | 9 | 20 | 11 | 22 | 3 | 2 |  |
| `events` | 4 | 17 | 10 | 5 | 25 | 4 |  |
| `scorer` | 6 | 7 | 13 | 5 | 11 | 10 |  |
| `forms` | 10 | 5 | 4 | 11 | 5 | 1 |  |
| `home` | 3 | 10 | 5 |  | 11 | 3 |  |
| `fines` | 5 | 8 | 1 | 5 | 5 | 4 |  |
| `guide` |  | 5 |  | 9 |  |  |  |
| `carpool` | 1 | 3 | 1 | 7 |  | 2 |  |
| `tasks` | 1 | 4 |  | 3 |  | 4 |  |
| `polls` | 1 | 3 | 1 | 4 |  | 2 |  |
| `broadcast` | 1 |  | 1 | 7 | 1 |  |  |
| `feedback` | 2 | 1 | 2 | 4 |  |  |  |
| `news` | 1 | 3 | 1 | 1 | 2 | 1 |  |
| `changelog` |  |  |  | 1 |  |  |  |

## Top 25 cross-area edges

| From | To | Imports |
|---|---|--:|
| `components` | `lib` | 169 |
| `modules/admin` | `components` | 71 |
| `components` | `hooks` | 42 |
| `modules/games` | `utils` | 29 |
| `modules/teams` | `utils` | 29 |
| `ui` | `lib` | 25 |
| `hooks` | `lib` | 25 |
| `modules/events` | `components` | 25 |
| `modules/spielplanung` | `utils` | 24 |
| `modules/gameScheduling` | `ui` | 23 |
| `modules/games` | `components` | 23 |
| `modules/trainings` | `components` | 23 |
| `components` | `utils` | 22 |
| `modules/absences` | `ui` | 22 |
| `modules/games` | `hooks` | 22 |
| `modules/messaging` | `ui` | 22 |
| `modules/admin` | `ui` | 21 |
| `modules/messaging` | `hooks` | 20 |
| `modules/spielplanung` | `types` | 20 |
| `modules/teams` | `components` | 20 |
| `modules/admin` | `lib` | 19 |
| `modules/calendar` | `components` | 19 |
| `modules/trainings` | `utils` | 19 |
| `modules/absences` | `components` | 18 |
| `modules/admin` | `utils` | 18 |

