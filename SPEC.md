# UCSC Schedule Planner — Build Spec

Status: planning (nothing built yet). Last updated 2026-09-09.
Knowi account: `lauren` (lauren@knowi.com).

## Goal

A Knowi App where a UC Santa Cruz student picks a quarter, browses classes by subject,
drops them onto a weekly calendar, and keeps several named draft schedules
("Best Case", "Plan B", ...).

## Data source

UCSC Schedule of Classes: https://pisa.ucsc.edu/class_search/index.php

- No official API (UCSC). Verified 2026-09-09 that an anonymous form-encoded POST to
  `index.php` with `action=results` and `rec_dur=5000` returns every class for a term
  in one HTML response (Fall 2026 = 1,514 classes).
- Class detail page: `index.php?action=detail&class_data=<base64 of PHP-serialized
  {":STRM": term, ":CLASS_NBR": nbr}>`. Provides units, GE, meeting dates, and the
  associated discussion sections / labs with their own days, times, rooms.
- GET requests do not work; must POST. No CORS headers, so the browser cannot call
  PISA directly. No robots.txt.
- Terms: dropdown `binds[:term]` (e.g. 2268 = Fall 2026). Scrape every term whose
  code >= current quarter so future quarters appear automatically.
- Subjects: 79 in dropdown `binds[:subject]`.

### Compliance choices
- Keep class title; **drop course descriptions entirely** (only copyrightable field).
- Identify scraper in User-Agent with a contact email; ~1 request/sec.
- Refresh every 6 hours.
- App behind Knowi sign-in initially.

## Pipeline

1. **Scraper** (Python, own GitHub repo, GitHub Actions cron `0 */6 * * *`)
   - One POST per term for the class list, one GET per class for details/sections.
   - Writes `data/terms.json`, `data/classes.json`, `data/sections.json`; commits if changed.
2. **Knowi REST datasource** pointed at the raw GitHub JSON URLs.
   - Three queries (terms, classes, sections), each scheduled every 6 hours → three datasets.
   - Knowi's REST connector only parses JSON/XML/CSV and sends JSON bodies, which is why
     it cannot hit PISA directly.
3. **Knowi App** reads the three datasets via its asset allowlist.

## Datasets

### terms
| field | example |
|---|---|
| term_code | 2268 |
| term_name | 2026 Fall Quarter |
| is_current | true |

### classes (one row per lecture / primary section)
| field | example |
|---|---|
| term_code | 2268 |
| class_nbr | 12394 |
| subject | MATH |
| subject_name | Mathematics |
| catalog_nbr | 19A |
| section | 01 |
| title | Calc:Sci,Engin,Math |
| instructor | Pan,J. |
| days | MWF (also boolean mon..sat) |
| start_time / end_time | 09:20 / 10:25 (24h) |
| room | ClassroomUnit 002 |
| units | 5 |
| ge | MF |
| instruction_mode | In Person |
| status | Open / Closed (hidden by default in UI) |
| meeting_start / meeting_end | 2026-09-24 / 2026-12-04 |
| has_sections | true |

### sections (one row per discussion / lab)
| field | example |
|---|---|
| term_code | 2268 |
| parent_class_nbr | 12394 |
| section_nbr | 12399 |
| section_code | DIS 01A |
| days | M |
| start_time / end_time | 12:00 / 13:05 |
| room | McHenry Clrm 1257 |
| instructor | Staff |
| status | Closed |

## App

- **Repo**: Knowi-managed. **Access**: knowi_sign_in. **Database**: managed (saved schedules).
- **Term selector**: current + future quarters from `terms`.
- **Picker**: Subject dropdown → class list (catalog nbr, title, days/time, instructor).
  No seat counts. Clicking a class adds it to the tray.
- **Tray** (bottom of page): selected classes. If a class has sections, a section
  dropdown appears on the tray card. Tray items are draggable.
- **Calendar**: weekly Mon–Fri (Sat if any class needs it), 7am–10pm. Dropping a tray
  item places the lecture block and the chosen section block at their real times.
  Drop is final — no confirm step. Overlaps are highlighted. Remove via X or drag back.
- **Schedules**: tabs per user, named ("Best Case", "Plan B"). New / rename / duplicate /
  delete. Each schedule stores its term and placed classes+sections in the managed DB.
- **Look and feel**: TBD, iterate after first version.

## Open items
- Draft permission email to UCSC Registrar / ITS (optional).
- Confirm GitHub Actions can reach pisa.ucsc.edu (no IP blocking) on first run.
