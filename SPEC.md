# UCSC Schedule Planner — Build Spec

Status: data pipeline + Knowi datasets built. Local prototype working. Knowi App not yet built. Last updated 2026-09-09.
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

Knowi (account `lauren`, datasource "UCSC Planner Feed", REST host
https://raw.githubusercontent.com/laurenmitch/ucsc-planner/main, refreshed every 6h):

| dataset | id | rows (2026-09-09) |
|---|---|---|
| UCSC Terms | 183239 | 1 |
| UCSC Classes | 183240 | 1514 |
| UCSC Sections | 183241 | 1431 |

Knowi typed `section` as Integer ("01" -> 1); the app zero-pads it. `start_time`/`end_time`
stayed strings, weekday flags are Boolean, `meeting_start/end` and `scraped_at` are Date.
Classes also carries two Cloud9QL helper columns Lauren added: `class_nbr_str`, `course_check`.


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

- **Repo**: Knowi-managed. **Access**: knowi_sign_in. **Database**: managed (saved plans).

### Layout (from Lauren's mockup, 2026-09-09)
- **Top menu**: term selector and a class picker (subject -> course) tucked into a menu /
  drawer at the top, out of the way. Picking a course adds it to the tray. No seat counts.
- **Middle**: one plan's weekly calendar (Sun-Sat columns, time rows) in a bold framed card.
  Left/right arrows on the sides page between plans ("Plan A", "Plan B", ...). Plans can be
  added, renamed, duplicated, deleted.
- **Bottom tray**: persists across plans. One row per selected course: course title on the
  left, then one draggable card per section showing section label and days/time.
  Each course has its own color; all its cards and calendar blocks use that color.
  Each section card shows a small badge with the number of plans it is on (hidden at 0).
- **Drag and drop**: drag a section card onto the calendar and it snaps into its real
  day/time blocks. Drop is final (no confirm). Overlaps highlighted. Remove via X on the
  block or drag back to the tray.

### Two levels of "section" at UCSC
A course like CLNI 1 has several **lecture sections** (01, 02, 03 - rows in `classes`,
each with its own days/time), and each lecture may have **discussion/lab sections**
(rows in `sections`). Proposed mapping to the mockup:
- Tray cards = lecture sections (`classes` rows for that course).
- After a lecture card is dropped, if it has discussions, a small chooser appears on the
  calendar block (or a second row of cards under the lecture) to pick the DIS/LAB, which
  adds its own block in the same color, lighter shade.
- **Open question for Lauren**: show discussion cards in the tray from the start, or only
  after the lecture is placed?

- **Look and feel**: bold framed calendar card, gradient fill, retro display font for
  day headers (per mockup). Iterate after first version.

## Open items
- Draft permission email to UCSC Registrar / ITS (optional).
- Confirm GitHub Actions can reach pisa.ucsc.edu (no IP blocking) on first run.
- Repo: https://github.com/laurenmitch/ucsc-planner (public)
- Raw JSON base: https://raw.githubusercontent.com/laurenmitch/ucsc-planner/main/data/
