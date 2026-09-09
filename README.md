# UCSC Schedule Planner — data pipeline

Scrapes the public UC Santa Cruz Schedule of Classes (https://pisa.ucsc.edu/class_search/)
for the current and future quarters and publishes flat JSON that a Knowi REST datasource
reads on a schedule. Feeds a Knowi App schedule planner.

- `scraper/scrape.py` — standard-library Python scraper (no dependencies)
- `data/*.json` — latest output, refreshed every 6 hours by GitHub Actions
- `SPEC.md` — product spec for the planner app

## Data files

| file | rows |
|---|---|
| `data/terms.json` | one per scraped quarter (`term_code`, `term_name`, `is_current`) |
| `data/subjects.json` | one per subject per term |
| `data/classes.json` | one per lecture / primary class: course, title, instructor, days, `start_time`/`end_time` (24h), room, units, GE, status |
| `data/sections.json` | one per discussion / lab section, linked by `parent_class_nbr` |
| `data/meta.json` | scrape timestamp and counts |

Course descriptions are intentionally not collected. The scraper identifies itself in its
User-Agent, uses a small worker pool with a per-request pause, and runs four times a day.

## Run locally

```bash
python3 scraper/scrape.py                 # current + future terms -> data/
python3 scraper/scrape.py --terms 2268    # one term
python3 scraper/scrape.py --limit 20      # quick test
```
