#!/usr/bin/env python3
"""
UCSC Schedule of Classes scraper.

Pulls every class for the current and future quarters from
https://pisa.ucsc.edu/class_search/ and writes flat JSON files that Knowi's
REST datasource can read directly.

Standard library only. Polite: identified User-Agent, small worker pool,
per-request pause. Course descriptions are deliberately NOT collected.

Usage:
    python3 scrape.py                 # current + future terms -> ../data/
    python3 scrape.py --terms 2268    # specific term(s)
    python3 scrape.py --limit 50      # first N classes per term (for testing)
"""

import argparse
import base64
import html
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

BASE = "https://pisa.ucsc.edu/class_search/index.php"
USER_AGENT = "ucsc-planner-scraper/1.0 (schedule planning demo; contact lauren@knowi.com)"
WORKERS = 4
PAUSE_SECONDS = 0.25
RETRIES = 3

DAY_TOKENS = ["M", "Tu", "W", "Th", "F", "Sa", "Su"]
DAY_FIELDS = {"M": "mon", "Tu": "tue", "W": "wed", "Th": "thu", "F": "fri", "Sa": "sat", "Su": "sun"}
DAY_RE = re.compile(r"(Tu|Th|Sa|Su|M|W|F)")
TIME_RE = re.compile(r"(\d{1,2}:\d{2}[AP]M)\s*-\s*(\d{1,2}:\d{2}[AP]M)")

_pause_lock = threading.Lock()


# ----------------------------------------------------------------------------- http

def _request(url, data=None):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": USER_AGENT})
    last_err = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return resp.read().decode("utf-8", "ignore")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, OSError) as e:
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"failed after {RETRIES} attempts: {url} ({last_err})")


def polite_get(url):
    time.sleep(PAUSE_SECONDS)
    return _request(url)


def search_form_html():
    return _request(BASE)


def list_classes_html(term_code):
    data = {
        "action": "results",
        "binds[:term]": term_code,
        "binds[:reg_status]": "all",
        "binds[:subject]": "",
        "binds[:catalog_nbr_op]": "=",
        "binds[:catalog_nbr]": "",
        "binds[:title]": "",
        "binds[:instr_name_op]": "=",
        "binds[:instructor]": "",
        "binds[:ge]": "",
        "binds[:crse_units_op]": "=",
        "binds[:crse_units_from]": "",
        "binds[:crse_units_to]": "",
        "binds[:crse_units_exact]": "",
        "binds[:days]": "",
        "binds[:times]": "",
        "binds[:acad_career]": "",
        "binds[:session_code]": "",
        "rec_start": "0",
        "rec_dur": "5000",
    }
    return _request(BASE, data)


def detail_url(term_code, class_nbr):
    term_code = str(term_code)
    class_nbr = str(class_nbr)
    serialized = (
        f'a:2:{{s:5:":STRM";s:{len(term_code)}:"{term_code}";'
        f's:10:":CLASS_NBR";s:{len(class_nbr)}:"{class_nbr}";}}'
    )
    blob = base64.b64encode(serialized.encode()).decode()
    return f"{BASE}?action=detail&class_data={urllib.parse.quote(blob)}"


# ----------------------------------------------------------------------------- parsing helpers

def clean(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def to_24h(t):
    """'09:20AM' -> '09:20', '01:05PM' -> '13:05'"""
    m = re.match(r"(\d{1,2}):(\d{2})([AP]M)", t)
    if not m:
        return None
    h, mi, ap = int(m.group(1)), m.group(2), m.group(3)
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return f"{h:02d}:{mi}"


def parse_days_times(text):
    """'MWF 09:20AM-10:25AM' -> dict with days, start_time, end_time, day booleans."""
    text = clean(text)
    out = {"days": "", "start_time": None, "end_time": None, "time_tba": False}
    for f in DAY_FIELDS.values():
        out[f] = False
    tm = TIME_RE.search(text)
    if tm:
        out["start_time"] = to_24h(tm.group(1))
        out["end_time"] = to_24h(tm.group(2))
        day_part = text[: tm.start()].strip()
    else:
        out["time_tba"] = True
        day_part = ""
    tokens = DAY_RE.findall(day_part)
    ordered = [d for d in DAY_TOKENS if d in tokens]
    out["days"] = "".join(ordered)
    for d in ordered:
        out[DAY_FIELDS[d]] = True
    out["days_raw"] = text
    return out


def parse_terms(form_html):
    """Return (current_code, [{term_code, term_name}...]) from the search form."""
    sel = re.search(r'<select[^>]*name\s*=\s*["\']binds\[:term\]["\'][^>]*>(.*?)</select>', form_html, re.S)
    if not sel:
        raise RuntimeError("term select not found")
    terms, current = [], None
    for m in re.finditer(r'<option\s+value\s*=\s*["\'](\d+)["\']([^>]*)>([^<]*)', sel.group(1)):
        code, attrs, name = m.group(1), m.group(2), clean(m.group(3))
        terms.append({"term_code": int(code), "term_name": name})
        if "selected" in attrs:
            current = int(code)
    if current is None:
        current = max(t["term_code"] for t in terms)
    return current, terms


def parse_subjects(form_html):
    sel = re.search(r'<select[^>]*name\s*=\s*["\']binds\[:subject\]["\'][^>]*>(.*?)</select>', form_html, re.S)
    if not sel:
        raise RuntimeError("subject select not found")
    out = {}
    for m in re.finditer(r'<option\s+value\s*=\s*["\']([A-Z]+)["\'][^>]*>([^<]*)', sel.group(1)):
        out[m.group(1)] = clean(m.group(2))
    return out


def parse_class_list(list_html, term_code, subjects):
    """One dict per row panel on the results page."""
    rows = re.split(r'id="rowpanel_\d+"', list_html)[1:]
    classes = []
    for r in rows:
        status_m = re.search(r'<img[^>]+alt="([^"]+)"', r)
        head_m = re.search(r'<a id="class_id_(\d+)"[^>]*>(.*?)</a>', r, re.S)
        if not head_m:
            continue
        class_nbr = int(head_m.group(1))
        heading = clean(head_m.group(2))  # "MATH 19A - 01   Calc:Sci,Engin,Math"
        hm = re.match(r"([A-Z]+)\s+(\S+)\s+-\s+(\S+)\s+(.*)$", heading)
        if hm:
            subject, catalog_nbr, section, title = hm.groups()
        else:
            subject, catalog_nbr, section, title = "", "", "", heading

        def field(label):
            m = re.search(r'<i class="sr-only">' + re.escape(label) + r"</i>(.*?)</div>", r, re.S)
            return clean(m.group(1)) if m else ""

        instructor = field("Instructor:")
        location = field("Location:")
        day_time = field("Day and Time:")
        enr = re.search(r"(\d+)\s+of\s+(\d+)\s+Enrolled", clean(r))
        instruction_mode = field("Instruction Mode:")

        loc_type, room = "", location
        lm = re.match(r"([A-Z]+):\s*(.*)$", location)
        if lm:
            loc_type, room = lm.group(1), lm.group(2).strip()

        c = {
            "term_code": term_code,
            "class_nbr": class_nbr,
            "subject": subject,
            "subject_name": subjects.get(subject, ""),
            "catalog_nbr": catalog_nbr,
            "section": section,
            "course": f"{subject} {catalog_nbr}".strip(),
            "title": title,
            "instructor": instructor,
            "component": loc_type,  # LEC, SEM, LAB, STU, ...
            "room": room,
            "instruction_mode": instruction_mode,
            "status": status_m.group(1) if status_m else "",
            "enrolled": int(enr.group(1)) if enr else None,
            "capacity": int(enr.group(2)) if enr else None,
        }
        c.update(parse_days_times(day_time))
        classes.append(c)
    return classes


def parse_detail(detail_html):
    """Units, GE, meetings, and associated sections from a class detail page."""
    out = {"units": None, "ge": "", "meetings": [], "sections": []}
    for m in re.finditer(r"<dt>([^<]+)</dt>\s*<dd>(.*?)</dd>", detail_html, re.S):
        k, v = clean(m.group(1)), clean(m.group(2))
        if k == "Credits":
            um = re.search(r"([\d.]+)", v)
            out["units"] = float(um.group(1)) if um else None
        elif k == "General Education":
            out["ge"] = v
        elif k == "Class Number":
            out["class_nbr"] = int(v) if v.isdigit() else None

    mi = re.search(r"Meeting Information</h2>.*?<table.*?</table>", detail_html, re.S)
    if mi:
        for tr in re.findall(r"<tr>(.*?)</tr>", mi.group(0), re.S):
            tds = [clean(x) for x in re.findall(r"<td>(.*?)</td>", tr, re.S)]
            if len(tds) < 4:
                continue
            mtg = parse_days_times(tds[0])
            dates = re.findall(r"\d{2}/\d{2}/\d{2}", tds[3])
            mtg.update({
                "room": tds[1],
                "instructor": tds[2],
                "meeting_start": _mdY(dates[0]) if dates else None,
                "meeting_end": _mdY(dates[1]) if len(dates) > 1 else None,
            })
            out["meetings"].append(mtg)

    si = re.search(r"Associated Discussion Sections or Labs</h2>(.*?)</div>\s*</div>\s*</div>", detail_html, re.S)
    if si:
        for row in re.split(r'<div class="row row-striped">', si.group(1))[1:]:
            cols = [clean(x) for x in re.findall(r'<div class="col-xs-6 col-sm-3">(.*?)</div>', row, re.S)]
            if not cols:
                continue
            head = re.match(r"#(\d+)\s+(.*)$", cols[0])
            st = re.search(r'alt="([^"]+)"', row)
            sec = {
                "section_nbr": int(head.group(1)) if head else None,
                "section_code": head.group(2).strip() if head else cols[0],
                "instructor": cols[2] if len(cols) > 2 else "",
                "room": re.sub(r"^Loc:\s*", "", cols[3]) if len(cols) > 3 else "",
                "status": st.group(1) if st else (cols[6] if len(cols) > 6 else ""),
            }
            enr = re.search(r"Enrl:\s*(\d+)\s*/\s*(\d+)", cols[4]) if len(cols) > 4 else None
            sec["enrolled"] = int(enr.group(1)) if enr else None
            sec["capacity"] = int(enr.group(2)) if enr else None
            sec.update(parse_days_times(cols[1] if len(cols) > 1 else ""))
            cm = re.match(r"([A-Z]+)\s+(\S+)", sec["section_code"])
            sec["component"] = cm.group(1) if cm else ""
            out["sections"].append(sec)
    return out


def _mdY(s):
    try:
        return datetime.strptime(s, "%m/%d/%y").strftime("%Y-%m-%d")
    except ValueError:
        return None


# ----------------------------------------------------------------------------- orchestration

def scrape_term(term_code, term_name, subjects, limit=None, log=print):
    log(f"[{term_code}] {term_name}: fetching class list")
    classes = parse_class_list(list_classes_html(term_code), term_code, subjects)
    if limit:
        classes = classes[:limit]
    log(f"[{term_code}] {len(classes)} classes; fetching details with {WORKERS} workers")

    sections, failures = [], []
    by_nbr = {c["class_nbr"]: c for c in classes}

    def work(nbr):
        return nbr, parse_detail(polite_get(detail_url(term_code, nbr)))

    done = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        futs = [ex.submit(work, nbr) for nbr in by_nbr]
        for f in as_completed(futs):
            done += 1
            try:
                nbr, d = f.result()
            except Exception as e:  # noqa: BLE001
                failures.append(str(e))
                continue
            c = by_nbr[nbr]
            c["units"] = d["units"]
            c["ge"] = d["ge"]
            mtgs = d["meetings"]
            if mtgs:
                m0 = mtgs[0]
                # Prefer the detail page's meeting info (authoritative) over the list row.
                for k in ("days", "start_time", "end_time", "time_tba", "days_raw", *DAY_FIELDS.values()):
                    c[k] = m0[k]
                if m0.get("room"):
                    c["room"] = m0["room"]
                c["meeting_start"] = m0.get("meeting_start")
                c["meeting_end"] = m0.get("meeting_end")
                c["extra_meetings"] = json.dumps(
                    [{k: v for k, v in m.items() if k in ("days", "start_time", "end_time", "room", "days_raw")}
                     for m in mtgs[1:]]
                ) if len(mtgs) > 1 else ""
                c["meeting_count"] = len(mtgs)
            else:
                c["meeting_start"] = c["meeting_end"] = None
                c["extra_meetings"] = ""
                c["meeting_count"] = 0
            c["has_sections"] = bool(d["sections"])
            c["section_count"] = len(d["sections"])
            for s in d["sections"]:
                s["term_code"] = term_code
                s["parent_class_nbr"] = nbr
                s["course"] = c["course"]
                s["title"] = c["title"]
                sections.append(s)
            if done % 100 == 0:
                log(f"[{term_code}] {done}/{len(by_nbr)} details")
    if failures:
        log(f"[{term_code}] WARNING {len(failures)} detail fetches failed; first: {failures[0]}")
    return classes, sections, failures


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--terms", nargs="*", type=int, help="term codes to scrape (default: current + future)")
    ap.add_argument("--limit", type=int, help="max classes per term (testing)")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "data"))
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    form = search_form_html()
    current, all_terms = parse_terms(form)
    subjects = parse_subjects(form)

    if args.terms:
        wanted = [t for t in all_terms if t["term_code"] in set(args.terms)]
    else:
        wanted = [t for t in all_terms if t["term_code"] >= current]
    wanted.sort(key=lambda t: t["term_code"])
    scraped_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"current term {current}; scraping {[t['term_code'] for t in wanted]}")

    all_classes, all_sections, all_failures = [], [], []
    for t in wanted:
        c, s, f = scrape_term(t["term_code"], t["term_name"], subjects, limit=args.limit)
        for row in c:
            row["term_name"] = t["term_name"]
            row["scraped_at"] = scraped_at
        for row in s:
            row["scraped_at"] = scraped_at
        all_classes += c
        all_sections += s
        all_failures += f

    terms_out = [
        {**t, "is_current": t["term_code"] == current, "class_count": sum(1 for c in all_classes if c["term_code"] == t["term_code"]),
         "scraped_at": scraped_at}
        for t in wanted
    ]
    subjects_out = sorted(
        {(c["term_code"], c["subject"], c["subject_name"]) for c in all_classes}
    )
    subjects_out = [{"term_code": a, "subject": b, "subject_name": cn} for a, b, cn in subjects_out]

    def dump(name, rows):
        path = os.path.join(args.out, name)
        with open(path, "w") as fh:
            json.dump(rows, fh, indent=0, sort_keys=True)
            fh.write("\n")
        print(f"wrote {path} ({len(rows)} rows)")

    dump("terms.json", terms_out)
    dump("subjects.json", subjects_out)
    dump("classes.json", all_classes)
    dump("sections.json", all_sections)
    with open(os.path.join(args.out, "meta.json"), "w") as fh:
        json.dump({"scraped_at": scraped_at, "current_term": current,
                   "terms": [t["term_code"] for t in wanted],
                   "classes": len(all_classes), "sections": len(all_sections),
                   "detail_failures": len(all_failures)}, fh, indent=2)
    if all_failures:
        print(f"{len(all_failures)} detail fetches failed", file=sys.stderr)
        sys.exit(2 if len(all_failures) > len(all_classes) * 0.05 else 0)


if __name__ == "__main__":
    main()
