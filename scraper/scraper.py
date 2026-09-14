"""Scrape company information from https://type.jp/job-company/ into public/companies.csv."""

import csv
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE_URL = "https://type.jp/job-company/"
# Written straight into the deployed site so a commit + push publishes new data.
OUTPUT = Path(__file__).resolve().parent.parent / "public" / "companies.csv"
WORKERS = 4
DELAY = 0.3
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept-Language": "ja,en;q=0.8",
}
FIELDS = [
    "company_name",
    "website",
    "representative",
    "employees",
    "founded",
    "capital",
    "type_url",
]
LABELS = {
    "代表者": "representative",
    "従業員数": "employees",
    "設立": "founded",
    "資本金": "capital",
}

session = requests.Session()
session.headers.update(HEADERS)


def fetch(url, retries=3):
    for attempt in range(retries):
        try:
            resp = session.get(url, timeout=20)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            resp.encoding = "utf-8"
            time.sleep(DELAY)
            return BeautifulSoup(resp.text, "html.parser")
        except requests.RequestException as exc:
            if attempt == retries - 1:
                print(f"  ! failed {url}: {exc}", file=sys.stderr)
                return None
            time.sleep(2 * (attempt + 1))


def clean(text):
    return re.sub(r"\s+", " ", text.replace("　", " ")).strip()


def dd_text(dd):
    # Keep the first line only: extra lines are often long biographies.
    lines = [clean(t) for t in dd.get_text("\n").split("\n")]
    lines = [t for t in lines if t]
    return lines[0] if lines else ""


def extract_fields(container):
    data = {}
    if container is None:
        return data
    for dl in container.select("dl"):
        dt, dd = dl.find("dt"), dl.find("dd")
        if not dt or not dd:
            continue
        key = LABELS.get(clean(dt.get_text()))
        if key and key not in data:
            data[key] = dd_text(dd)
    return data


def company_links():
    soup = fetch(BASE_URL)
    if soup is None:
        sys.exit("Could not load the company index page.")
    seen, links = set(), []
    for ul in soup.select("ul.mod-link-list"):
        for a in ul.select("li a[href]"):
            url = urljoin(BASE_URL, a["href"])
            if url not in seen:
                seen.add(url)
                links.append((clean(a.get_text()), url))
    return links


def scrape_company(listed_name, url):
    row = dict.fromkeys(FIELDS, "")
    row["company_name"] = listed_name
    row["type_url"] = url

    soup = fetch(url)
    if soup is None:
        return row

    logo = soup.select_one("header.mod-page-title .thumb img[alt]")
    h1 = soup.select_one("header.mod-page-title h1")
    if logo and clean(logo["alt"]):
        row["company_name"] = clean(logo["alt"])
    elif h1:
        row["company_name"] = clean(h1.get_text()).removesuffix("の転職・求人情報")

    row.update(extract_fields(soup.select_one("div.mod-job-info")))

    # The website only appears on job detail pages.
    job = soup.find("a", href=re.compile(r"/job-\d+/\d+_detail/"))
    if job:
        job_soup = fetch(urljoin(url, job["href"]))
        if job_soup is not None:
            homepage = job_soup.select_one("dl.uq-detail-homepage dd a[href]")
            if homepage:
                row["website"] = homepage["href"].strip()
            extra = extract_fields(job_soup.select_one("section.mod-company-info"))
            for key, value in extra.items():
                if not row[key]:
                    row[key] = value
    return row


def main():
    links = company_links()
    print(f"Found {len(links)} companies")
    rows = [None] * len(links)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(scrape_company, name, url): i
            for i, (name, url) in enumerate(links)
        }
        for done, future in enumerate(as_completed(futures), 1):
            i = futures[future]
            rows[i] = future.result()
            if done % 25 == 0 or done == len(links):
                print(f"  {done}/{len(links)}")

    with open(OUTPUT, "w", newline="", encoding="utf-8-sig") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {OUTPUT}")


if __name__ == "__main__":
    main()
