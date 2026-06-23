import json
import os
import sys
import random
import string
import time
import re
import threading
import queue
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request, send_from_directory, abort, Response, stream_with_context
from flask_cors import CORS

# Make sure the project root is on the path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from ai.content_generator import generate_content, batch_generate_content, analyze_seo

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
CORS(app, origins=["*"])

DB_FILE = ROOT / "db" / "data.json"
CACHE_FILE = ROOT / "db" / "cache.json"
CACHE_TTL = 24 * 3600  # 24h
_cache_lock = threading.Lock()


# ===== ANALYSIS CACHE (URL -> result + timestamp, 24h gültig) =====

def _load_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    try:
        with open(CACHE_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_cache(cache: dict):
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False)
    except Exception as e:
        print(f"[CACHE] save error: {e}")


def cache_get(url: str):
    if not url:
        return None
    with _cache_lock:
        cache = _load_cache()
        entry = cache.get(url)
    if not entry:
        return None
    if time.time() - entry.get("ts", 0) > CACHE_TTL:
        return None
    return entry.get("result")


def cache_set(url: str, result: dict):
    if not url:
        return
    with _cache_lock:
        cache = _load_cache()
        cache[url] = {"ts": time.time(), "result": result}
        # einfache Größenbegrenzung
        if len(cache) > 2000:
            items = sorted(cache.items(), key=lambda kv: kv[1].get("ts", 0))
            cache = dict(items[-2000:])
        _save_cache(cache)


# ===== DATABASE =====

def read_db() -> dict:
    if not DB_FILE.exists():
        return {"websites": [], "zones": [], "jobs": [], "activities": []}
    with open(DB_FILE, encoding="utf-8") as f:
        return json.load(f)


def write_db(data: dict):
    DB_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(DB_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ===== HELPERS =====

def gen_id() -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=10)) + str(int(datetime.now().timestamp()))


def gen_api_key() -> str:
    return "seo_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=32))


def now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


# ===== SERVE FRONTEND =====

@app.route("/")
def index():
    return send_from_directory(str(ROOT), "index.html")


# ===== BUSINESS SEARCH — MULTI-PORTAL =====
# Quellen: Herold.at, Firmen ABC, WKO Firmen A-Z, OpenStreetMap/Overpass

SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "de-AT,de;q=0.9,en;q=0.8",
}
OSM_HEADERS = {"User-Agent": "seo.solutions/1.0 (contact@fuerst-software.com)"}


SKIP_DOMAINS = [
    "facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
    "youtube.com", "tiktok.com", "pinterest.com", "xing.com",
    "wko.at", "herold.at", "firmenabc.at", "firmen.at",
    "google.", "bing.com", "yahoo.com", "duckduckgo.com",
    "wikipedia.", "yelp.", "gelbeseiten.", "11880.",
    "kununu.", "glassdoor.", "indeed.", "karriere.at",
    "amazon.", "ebay.", "willhaben.at",
]


def _extract_ddg_url(href):
    """Extrahiert echte URL aus DuckDuckGo Redirect"""
    if "uddg=" in href:
        try:
            from urllib.parse import parse_qs, unquote
            qs = href.split("?", 1)[-1] if "?" in href else ""
            return unquote(parse_qs(qs).get("uddg", [""])[0])
        except Exception:
            pass
    return href if href.startswith("http") else ""


def _is_company_url(href, name):
    """Prüft ob URL zur Firma gehört (kein Portal/Social Media)"""
    if not href or not href.startswith("http"):
        return False
    href_lower = href.lower()
    if any(d in href_lower for d in SKIP_DOMAINS):
        return False
    return True


def _ddg_search(query):
    """DuckDuckGo HTML-Suche, gibt Liste von (url, title) zurück"""
    results = []
    try:
        resp = requests.get(
            "https://html.duckduckgo.com/html/",
            params={"q": query},
            headers=SEARCH_HEADERS,
            timeout=12,
        )
        if resp.status_code != 200:
            return results
        soup = BeautifulSoup(resp.text, "html.parser")
        for item in soup.select(".result"):
            a = item.select_one("a.result__a")
            if not a:
                continue
            href = _extract_ddg_url(a.get("href", ""))
            title = a.get_text(strip=True)
            snippet_el = item.select_one(".result__snippet")
            snippet = snippet_el.get_text(strip=True) if snippet_el else ""
            if href:
                results.append({"url": href, "title": title, "snippet": snippet})
    except Exception:
        pass
    return results


def deep_discover_website(name, address, phone, email, location):
    """
    Mehrstufige tiefe Website-Suche:
    1. DuckDuckGo: "Firmenname Ort"
    2. DuckDuckGo: "Firmenname Ort website"
    3. DuckDuckGo: "Firmenname Adresse"
    4. DuckDuckGo: Telefonnummer
    5. DuckDuckGo: Email-Domain
    6. WKO Detail-Seite
    """
    name_clean = name.strip()
    name_parts = [p.lower() for p in name_clean.split() if len(p) > 2]
    found_urls = []

    def score_url(url, title="", snippet=""):
        """Bewertet wie gut eine URL zur Firma passt"""
        s = 0
        url_lower = url.lower()
        combined = (title + " " + snippet).lower()
        for part in name_parts:
            if part in url_lower:
                s += 10
            if part in combined:
                s += 3
        if ".at" in url_lower or ".com" in url_lower or ".de" in url_lower:
            s += 2
        return s

    # Suchanfragen mit verschiedenen Kombinationen
    search_queries = [
        f'"{name_clean}" {location}',
        f"{name_clean} {location} website",
        f"{name_clean} {location} homepage",
    ]
    if address and len(address) > 10:
        street = address.split(",")[0].strip()
        if street:
            search_queries.append(f'"{name_clean}" "{street}"')

    if phone and len(phone) > 5:
        phone_clean = phone.replace(" ", "").replace("-", "").replace("/", "")
        search_queries.append(f'"{phone_clean}"')

    if email and "@" in email:
        domain = email.split("@")[1]
        if domain and not any(d in domain for d in ["gmail", "yahoo", "hotmail", "gmx", "outlook", "icloud", "aon"]):
            candidate = f"https://{domain}" if not domain.startswith("www.") else f"https://www.{domain}"
            try:
                test = requests.head(candidate, timeout=5, allow_redirects=True)
                if test.status_code < 400:
                    return candidate
            except Exception:
                candidate2 = f"https://www.{domain}"
                try:
                    test2 = requests.head(candidate2, timeout=5, allow_redirects=True)
                    if test2.status_code < 400:
                        return candidate2
                except Exception:
                    pass

    print(f"[DISCOVER] Searching for: {name_clean} ({len(search_queries)} queries)")

    for i, sq in enumerate(search_queries):
        results = _ddg_search(sq)
        for r in results:
            url = r["url"]
            if _is_company_url(url, name_clean):
                sc = score_url(url, r.get("title", ""), r.get("snippet", ""))
                found_urls.append((url, sc))
        if found_urls:
            best = max(found_urls, key=lambda x: x[1])
            if best[1] >= 5:
                print(f"[DISCOVER] Found (score {best[1]}): {name_clean} → {best[0]}")
                return best[0]
        # Delay zwischen DuckDuckGo Queries um Blocking zu vermeiden
        if i < len(search_queries) - 1:
            time.sleep(0.5)

    # WKO Detail-Seite als letzte Quelle
    try:
        wko_q = name_clean.lower().replace(" ", "-").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
        wko_url = f"https://firmen.wko.at/{requests.utils.quote(wko_q)}/{requests.utils.quote(location.lower())}/"
        resp = requests.get(wko_url, headers=SEARCH_HEADERS, timeout=10, allow_redirects=True)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            web_icon = soup.find("use", attrs={"xlink:href": "#website"})
            if web_icon:
                link = web_icon.find_parent("a")
                if link:
                    span = link.find("span")
                    url = span.get_text(strip=True) if span else ""
                    if url and url.startswith("http"):
                        print(f"[DISCOVER] Found via WKO detail: {name_clean} → {url}")
                        return url
    except Exception:
        pass

    if found_urls:
        best = max(found_urls, key=lambda x: x[1])
        print(f"[DISCOVER] Best guess (score {best[1]}): {name_clean} → {best[0]}")
        return best[0]

    print(f"[DISCOVER] Nothing found for: {name_clean}")
    return ""


JUNK_NAMES = {
    "alle unternehmen", "suchergebnis", "ihre suche", "ergebnisse", "treffer",
    "keine ergebnisse", "kein treffer", "mehr anzeigen", "weitere ergebnisse",
    "cookie", "datenschutz", "impressum", "agb", "kontakt", "navigation",
    "alle unternehmen an diesem standort", "ihre suche erzielte keinen treffer.",
}


def is_valid_business(name):
    if not name or len(name) < 3:
        return False
    if name.lower().strip().rstrip(".") in JUNK_NAMES:
        return False
    if name.lower().startswith(("alle ", "ihre ", "kein ", "mehr ", "weitere ")):
        return False
    return True


def search_herold(query, location):
    """Herold.at — Gelbe Seiten Österreich"""
    results = []
    try:
        q_slug = query.lower().replace(" ", "-").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
        l_slug = location.lower().split(",")[0].strip().replace(" ", "-").replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
        url = f"https://www.herold.at/gelbe-seiten/was_{q_slug}/wo_{l_slug}/"
        print(f"[Herold] Fetching: {url}")
        resp = requests.get(url, headers=SEARCH_HEADERS, timeout=15)
        print(f"[Herold] Status: {resp.status_code}, Length: {len(resp.text)}")
        if resp.status_code != 200:
            return results
        soup = BeautifulSoup(resp.text, "html.parser")

        for item in soup.find_all(["article", "div", "li", "section"]):
            classes = " ".join(item.get("class", []))
            if not any(x in classes.lower() for x in ["result", "listing", "entry", "company", "item", "card"]):
                continue
            name_el = item.find(["h2", "h3", "h4"])
            name = name_el.get_text(strip=True) if name_el else ""
            if not is_valid_business(name):
                continue

            address = ""
            for a_el in item.find_all(["span", "div", "p", "address"]):
                txt = a_el.get_text(strip=True)
                if any(x in txt for x in [",", "straße", "gasse", "weg", "platz"]) and len(txt) > 8:
                    address = txt
                    break

            phone = ""
            phone_el = item.find("a", href=lambda h: h and h.startswith("tel:"))
            if phone_el:
                phone = phone_el.get_text(strip=True) or phone_el["href"].replace("tel:", "")

            website = ""
            for a in item.find_all("a", href=True):
                href = a["href"]
                if href.startswith("http") and "herold.at" not in href and "google" not in href and "facebook" not in href:
                    website = href
                    break

            results.append({
                "name": name, "address": address or location, "phone": phone,
                "website": website, "email": "", "category": query,
                "rating": None, "source": "Herold.at",
            })
        print(f"[Herold] Found: {len(results)} results")
    except Exception as e:
        print(f"[Herold] Error: {e}")
    return results[:20]


def search_firmenabc(query, location):
    """FirmenABC.at — Firmenverzeichnis"""
    results = []
    try:
        q_enc = requests.utils.quote(query)
        l_enc = requests.utils.quote(location)
        urls_to_try = [
            f"https://www.firmenabc.at/ergebnis/{q_enc}_{l_enc}",
            f"https://www.firmenabc.at/result.aspx?what={q_enc}&where={l_enc}",
        ]
        resp = None
        for url in urls_to_try:
            print(f"[FirmenABC] Trying: {url}")
            try:
                resp = requests.get(url, headers=SEARCH_HEADERS, timeout=15, allow_redirects=True)
                print(f"[FirmenABC] Status: {resp.status_code}, Length: {len(resp.text)}")
                if resp.status_code == 200 and len(resp.text) > 2000:
                    break
            except Exception:
                continue
        if not resp or resp.status_code != 200:
            return results
        soup = BeautifulSoup(resp.text, "html.parser")

        for item in soup.find_all(["article", "div", "li", "section"]):
            classes = " ".join(item.get("class", []))
            if not any(x in classes.lower() for x in ["result", "company", "entry", "item", "card", "firma"]):
                continue
            name_el = item.find(["h2", "h3", "h4"])
            name = name_el.get_text(strip=True) if name_el else ""
            if not is_valid_business(name):
                continue

            address, phone, website, email = "", "", "", ""
            phone_el = item.find("a", href=lambda h: h and h.startswith("tel:"))
            if phone_el:
                phone = phone_el.get_text(strip=True) or phone_el["href"].replace("tel:", "")
            email_el = item.find("a", href=lambda h: h and h.startswith("mailto:"))
            if email_el:
                email = email_el["href"].replace("mailto:", "")
            for a in item.find_all("a", href=True):
                href = a["href"]
                if href.startswith("http") and "firmenabc" not in href and "google" not in href:
                    website = href
                    break
            for el in item.find_all(["span", "div", "p"]):
                txt = el.get_text(strip=True)
                if any(x in txt.lower() for x in ["straße", "gasse", "weg", "platz", ","]) and 8 < len(txt) < 120:
                    address = txt
                    break

            results.append({
                "name": name, "address": address or location, "phone": phone,
                "website": website, "email": email, "category": query,
                "rating": None, "source": "FirmenABC.at",
            })
        print(f"[FirmenABC] Found: {len(results)} results")
    except Exception as e:
        print(f"[FirmenABC] Error: {e}")
    return results[:20]


def _wko_parse_soup(s, query, location, seen_wko, results):
    """Parst WKO-Suchergebnis-Soup, füllt results (mit Dedup über seen_wko)."""
    for article in s.select("article.search-result-article"):
        name_el = article.select_one(".search-result-header h3")
        name = name_el.get_text(strip=True) if name_el else ""
        if not is_valid_business(name):
            continue
        nk = name.lower().strip()
        if nk in seen_wko:
            continue
        seen_wko.add(nk)

        cat_el = article.select_one(".title-details")
        category = cat_el.get_text(strip=True) if cat_el else ""

        street_el = article.select_one(".address .street")
        place_el = article.select_one(".address .place")
        street = street_el.get_text(strip=True) if street_el else ""
        place = place_el.get_text(strip=True).replace("\xa0", " ").strip() if place_el else ""
        address = f"{street}, {place}".strip(", ") if street or place else location

        phone = ""
        phone_el = article.select_one("a[href^='tel:']")
        if phone_el:
            span = phone_el.find("span")
            phone = span.get_text(strip=True) if span else phone_el.get_text(strip=True)

        email = ""
        email_el = article.select_one("a[href^='mailto:']")
        if email_el:
            email = email_el["href"].replace("mailto:", "")

        website = ""
        web_icon = article.find("use", attrs={"xlink:href": "#website"})
        if web_icon:
            web_link = web_icon.find_parent("a")
            if web_link:
                sp = web_link.find("span")
                website = sp.get_text(strip=True) if sp else ""

        detail_link = ""
        title_a = article.select_one("a.title-link")
        if title_a and title_a.get("href"):
            detail_link = "https://firmen.wko.at" + title_a["href"]

        results.append({
            "name": name, "address": address, "phone": phone,
            "website": website, "email": email,
            "category": category or query or "Unternehmen",
            "rating": None, "source": "WKO Firmen A-Z",
            "detailUrl": detail_link,
        })


def wko_fetch_detail(detail_url):
    """Ruft WKO-Detailseite ab und extrahiert Telefon/Email/Website."""
    out = {"phone": "", "email": "", "website": ""}
    if not detail_url:
        return out
    try:
        resp = requests.get(detail_url, headers=SEARCH_HEADERS, timeout=10, allow_redirects=True)
        if resp.status_code != 200:
            return out
        soup = BeautifulSoup(resp.text, "html.parser")
        tel = soup.select_one("a[href^='tel:']")
        if tel:
            sp = tel.find("span")
            out["phone"] = sp.get_text(strip=True) if sp else tel.get_text(strip=True)
        mail = soup.select_one("a[href^='mailto:']")
        if mail:
            out["email"] = mail["href"].replace("mailto:", "")
        web_icon = soup.find("use", attrs={"xlink:href": "#website"})
        if web_icon:
            link = web_icon.find_parent("a")
            if link:
                sp = link.find("span")
                w = sp.get_text(strip=True) if sp else ""
                if w and not w.startswith("http"):
                    w = "https://" + w
                out["website"] = w
        if not out["website"]:
            for a in soup.find_all("a", href=True):
                href = a["href"]
                if href.startswith("http") and not any(d in href.lower() for d in SKIP_DOMAINS):
                    out["website"] = href
                    break
    except Exception as e:
        print(f"[WKO detail] Error: {e}")
    return out


def search_wko(query, location, fetch_details=False):
    """WKO Firmen A-Z — sucht Hauptort + Bezirke + Pagination (Seite 2).
    Wenn query leer: allgemeine Ortssuche über alle Branchen.
    fetch_details=True: ruft Detailseiten ab für fehlende Kontaktdaten."""
    results = []
    try:
        q = query.lower().strip()
        l = location.lower().strip()
        if q:
            base_url = f"https://firmen.wko.at/{requests.utils.quote(q)}/{requests.utils.quote(l)}/"
        else:
            # Leere Branche: allgemeine Ortssuche (alle Branchen am Standort)
            base_url = f"https://firmen.wko.at/suche/{requests.utils.quote(l)}/"
        print(f"[WKO] Fetching: {base_url}")
        resp = requests.get(base_url, headers=SEARCH_HEADERS, timeout=15, allow_redirects=True)
        print(f"[WKO] Status: {resp.status_code}, Length: {len(resp.text)}")
        if resp.status_code != 200:
            return results
        soup = BeautifulSoup(resp.text, "html.parser")

        # Auch alle Bezirk-Links laden für breitere Suche (Umkreis).
        # WKO listet benachbarte Bezirke/Orte als Links; wir folgen allen, die
        # nach einem Orts-/Bezirks-Link aussehen (gleicher Branchen-Slug, anderer Ort).
        bezirk_links = []
        seen_bz = set()
        for a in soup.find_all("a", href=True):
            href = a.get("href", "").strip()
            if not href:
                continue
            href_l = href.lower()
            # Bezirk/Orts-Links: enthalten den Branchen-Slug und einen weiteren Ort-Pfad
            is_loc_link = (
                "bezirk" in href_l
                or "/bundesland/" in href_l
                or (href_l.startswith("/") and q in href_l and href_l.count("/") >= 2 and l not in href_l)
            )
            if not is_loc_link:
                continue
            full = "https://firmen.wko.at" + href if href.startswith("/") else href
            if full.lower() in seen_bz or "firmen.wko.at" not in full.lower():
                continue
            seen_bz.add(full.lower())
            bezirk_links.append(full)
        print(f"[WKO] Found {len(bezirk_links)} Bezirk/Umkreis-Links")

        all_soups = [soup]

        # Pagination: Seite 2 laden, wenn vorhanden
        try:
            next_link = None
            for a in soup.find_all("a", href=True):
                rel = " ".join(a.get("rel", [])).lower()
                txt = a.get_text(strip=True).lower()
                href = a["href"]
                if "rel=\"next\"" in str(a).lower() or rel == "next" or txt in ("weiter", "nächste", "2") or "page=2" in href.lower() or "/2/" in href:
                    next_link = "https://firmen.wko.at" + href if href.startswith("/") else href
                    break
            if next_link and "firmen.wko.at" in next_link:
                p2 = requests.get(next_link, headers=SEARCH_HEADERS, timeout=12, allow_redirects=True)
                if p2.status_code == 200:
                    all_soups.append(BeautifulSoup(p2.text, "html.parser"))
                    print(f"[WKO] Pagination: Seite 2 geladen ({next_link})")
        except Exception as e:
            print(f"[WKO] Pagination error: {e}")

        for bz_url in bezirk_links[:8]:
            try:
                bz_resp = requests.get(bz_url, headers=SEARCH_HEADERS, timeout=12, allow_redirects=True)
                if bz_resp.status_code == 200:
                    all_soups.append(BeautifulSoup(bz_resp.text, "html.parser"))
            except Exception:
                pass

        seen_wko = set()
        for s in all_soups:
            _wko_parse_soup(s, query, location, seen_wko, results)
        print(f"[WKO] Found: {len(results)} businesses from {len(all_soups)} pages")

        # Detail-Seiten abrufen für Firmen ohne Kontaktdaten
        if fetch_details:
            need_detail = [b for b in results if b.get("detailUrl") and not (b.get("phone") and b.get("email") and b.get("website"))][:20]
            if need_detail:
                print(f"[WKO] Fetching {len(need_detail)} detail pages...")
                with ThreadPoolExecutor(max_workers=6) as pool:
                    fut = {pool.submit(wko_fetch_detail, b["detailUrl"]): b for b in need_detail}
                    for f in as_completed(fut):
                        b = fut[f]
                        try:
                            d = f.result()
                            if d.get("phone") and not b.get("phone"):
                                b["phone"] = d["phone"]
                            if d.get("email") and not b.get("email"):
                                b["email"] = d["email"]
                            if d.get("website") and not b.get("website"):
                                b["website"] = d["website"]
                        except Exception:
                            pass
    except Exception as e:
        print(f"[WKO] Error: {e}")
    return results[:60]


# Deutsche Branche → OSM-Tags Zuordnung
BRANCH_TO_OSM = {
    "tischler": [("craft", "carpenter"), ("craft", "cabinet_maker")],
    "tischlerei": [("craft", "carpenter"), ("craft", "cabinet_maker")],
    "schreiner": [("craft", "carpenter")],
    "friseur": [("shop", "hairdresser")],
    "frisör": [("shop", "hairdresser")],
    "bäcker": [("shop", "bakery")],
    "bäckerei": [("shop", "bakery")],
    "metzger": [("shop", "butcher")],
    "fleischer": [("shop", "butcher")],
    "elektriker": [("craft", "electrician")],
    "installateur": [("craft", "plumber"), ("craft", "hvac")],
    "klempner": [("craft", "plumber")],
    "maler": [("craft", "painter")],
    "dachdecker": [("craft", "roofer")],
    "schmied": [("craft", "blacksmith")],
    "auto": [("shop", "car"), ("shop", "car_repair")],
    "kfz": [("shop", "car_repair")],
    "werkstatt": [("shop", "car_repair"), ("craft", "")],
    "restaurant": [("amenity", "restaurant")],
    "gasthaus": [("amenity", "restaurant"), ("amenity", "pub")],
    "hotel": [("tourism", "hotel")],
    "apotheke": [("amenity", "pharmacy")],
    "arzt": [("amenity", "doctors")],
    "zahnarzt": [("amenity", "dentist")],
    "rechtsanwalt": [("office", "lawyer")],
    "anwalt": [("office", "lawyer")],
    "steuerberater": [("office", "tax_advisor"), ("office", "accountant")],
    "immobilien": [("office", "estate_agent")],
    "versicherung": [("office", "insurance")],
    "bank": [("amenity", "bank")],
    "supermarkt": [("shop", "supermarket")],
    "blumen": [("shop", "florist")],
    "optiker": [("shop", "optician")],
    "fotograf": [("craft", "photographer")],
    "webdesign": [("office", "it"), ("craft", "")],
    "it": [("office", "it")],
}


def search_osm(query, location, radius):
    """OpenStreetMap / Overpass — ALLE Firmen im Umkreis, optional nach Branche filtern"""
    results = []
    try:
        geo_resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": location, "format": "json", "limit": 1},
            headers=OSM_HEADERS,
            timeout=10,
        )
        geo_data = geo_resp.json()
        if not geo_data:
            print(f"[OSM] Location not found: {location}")
            return results

        lat = float(geo_data[0]["lat"])
        lon = float(geo_data[0]["lon"])
        print(f"[OSM] Location: {lat}, {lon} — Radius: {radius}m — Query: '{query}'")

        query_lower = (query or "").lower().strip()

        # Radius immer begrenzen um Overpass-Timeouts zu vermeiden (max 15km).
        safe_radius = min(int(radius or 5000), 15000)
        matched_tags = []
        # OSM-Tag-Wert -> deutsche Kategorie (für Kategorie-Zuordnung)
        OSM_VAL_TO_DE = {
            "carpenter": "Tischlerei", "cabinet_maker": "Tischlerei",
            "hairdresser": "Friseur", "bakery": "Bäckerei", "butcher": "Metzgerei",
            "electrician": "Elektriker", "plumber": "Installateur", "hvac": "Installateur",
            "painter": "Maler", "roofer": "Dachdecker", "blacksmith": "Schmied",
            "car": "Autohaus", "car_repair": "KFZ-Werkstatt",
            "restaurant": "Restaurant", "pub": "Gasthaus", "hotel": "Hotel",
            "pharmacy": "Apotheke", "doctors": "Arzt", "dentist": "Zahnarzt",
            "lawyer": "Rechtsanwalt", "tax_advisor": "Steuerberater",
            "accountant": "Steuerberater", "estate_agent": "Immobilien",
            "insurance": "Versicherung", "bank": "Bank", "supermarket": "Supermarkt",
            "florist": "Blumen", "optician": "Optiker", "photographer": "Fotograf",
            "it": "IT-Dienstleister",
        }

        if query_lower:
            # MIT Branche: NUR gezielte Tag-Suche nach den Branch-Mappings.
            # Keine name-basierte Volltextsuche (führt zu falschen Treffern wie
            # "restaurant" bei "tischler").
            lines = []
            for keyword, mappings in BRANCH_TO_OSM.items():
                if keyword in query_lower or query_lower in keyword:
                    for tag_key, tag_val in mappings:
                        if tag_val:
                            lines.append(f'node["{tag_key}"="{tag_val}"]["name"](around:{safe_radius},{lat},{lon});')
                            lines.append(f'way["{tag_key}"="{tag_val}"]["name"](around:{safe_radius},{lat},{lon});')
                            matched_tags.append((tag_key, tag_val))
            if not lines:
                # Unbekannte Branche: vorsichtige Name-Suche als Fallback
                lines.append(f'node["name"~"{query_lower}",i]["craft"](around:{safe_radius},{lat},{lon});')
                lines.append(f'node["name"~"{query_lower}",i]["shop"](around:{safe_radius},{lat},{lon});')
                lines.append(f'way["name"~"{query_lower}",i]["craft"](around:{safe_radius},{lat},{lon});')
        else:
            # OHNE Branche: alle Firmen, getrennte Queries um Timeouts zu vermeiden
            lines = [
                f'node["craft"]["name"](around:{safe_radius},{lat},{lon});',
                f'node["shop"]["name"](around:{safe_radius},{lat},{lon});',
                f'node["office"]["name"](around:{safe_radius},{lat},{lon});',
            ]

        overpass_body = "\n".join(lines)
        overpass_query = f"[out:json][timeout:25];\n(\n{overpass_body}\n);\nout center 300;"
        print(f"[OSM] Tags: {matched_tags or 'alle Firmen'}, {len(lines)} filters, radius={safe_radius}")
        ov_resp = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": overpass_query},
            headers=OSM_HEADERS,
            timeout=35,
        )
        ov_data = ov_resp.json()
        elements = ov_data.get("elements", [])
        print(f"[OSM] Raw elements: {len(elements)}")

        # Branche-Filter Keywords
        query_parts = [p for p in query_lower.split() if len(p) > 2] if query_lower else []

        seen = set()
        for el in elements:
            tags = el.get("tags", {})
            name = tags.get("name", "")
            if not is_valid_business(name):
                continue

            key = name.lower().strip()
            if key in seen:
                continue
            seen.add(key)

            category_val = (
                tags.get("craft") or tags.get("shop") or tags.get("office")
                or tags.get("amenity") or tags.get("tourism") or ""
            )
            # Echte OSM-Kategorie -> deutsche Bezeichnung (statt Suchbegriff)
            category_clean = (
                OSM_VAL_TO_DE.get(category_val)
                or (category_val.replace("_", " ").title() if category_val else "")
            )

            # Branche-Filter (STRENG): wenn Branche angegeben und wir konkrete
            # Branch-Tags haben, MUSS das Element exakt eines dieser Tags tragen.
            if query_lower:
                if matched_tags:
                    tag_match = any(tags.get(tk) == tv for tk, tv in matched_tags)
                    if not tag_match:
                        continue
                else:
                    # Fallback-Branche ohne Mapping: Name oder Tag-Werte müssen matchen
                    all_vals = " ".join(str(v) for v in tags.values()).lower()
                    if not any(p in all_vals or p in name.lower() for p in query_parts):
                        continue

            addr = " ".join(filter(None, [
                tags.get("addr:street", ""), tags.get("addr:housenumber", ""),
                tags.get("addr:postcode", ""), tags.get("addr:city", ""),
            ])).strip()

            results.append({
                "name": name, "address": addr or location,
                "phone": tags.get("phone") or tags.get("contact:phone") or tags.get("mobile") or tags.get("contact:mobile", ""),
                "website": tags.get("website") or tags.get("contact:website") or tags.get("url", ""),
                "email": tags.get("email") or tags.get("contact:email", ""),
                "fax": tags.get("fax", ""),
                "operator": tags.get("operator", ""),
                "category": category_clean or "Unternehmen",
                "rating": None, "source": "OpenStreetMap",
            })
        print(f"[OSM] Matched: {len(results)} of {len(elements)} elements")
    except Exception as e:
        print(f"[OSM] Error: {e}")
    return results


def search_herold_api(query, location):
    """Herold.at — versucht JSON-API Endpunkt"""
    results = []
    try:
        url = "https://www.herold.at/api/search"
        params = {"what": query, "where": location, "category": "gelbe-seiten"}
        print(f"[Herold API] Trying: {url}")
        resp = requests.get(url, params=params, headers=SEARCH_HEADERS, timeout=12)
        print(f"[Herold API] Status: {resp.status_code}")
        if resp.status_code == 200:
            try:
                data = resp.json()
                for item in (data.get("results") or data.get("items") or data.get("data") or []):
                    name = item.get("name") or item.get("title", "")
                    if not is_valid_business(name):
                        continue
                    results.append({
                        "name": name,
                        "address": item.get("address") or item.get("street", "") + " " + item.get("city", ""),
                        "phone": item.get("phone") or item.get("tel", ""),
                        "website": item.get("website") or item.get("url", ""),
                        "email": item.get("email", ""),
                        "category": item.get("category") or query,
                        "rating": item.get("rating"),
                        "source": "Herold.at",
                    })
            except (ValueError, KeyError):
                pass
        print(f"[Herold API] Found: {len(results)}")
    except Exception as e:
        print(f"[Herold API] Error: {e}")
    return results


def detect_technologies(html, soup):
    """Erkennt eingesetzte Technologien aus Meta-Tags, Pfaden, Markern."""
    techs = []
    h = html.lower()
    gen = soup.find("meta", attrs={"name": re.compile(r"^generator$", re.I)})
    gen_c = (gen.get("content", "") if gen else "").lower()
    checks = [
        ("WordPress", ("wp-content" in h or "wp-includes" in h or "wordpress" in gen_c)),
        ("Shopify", ("cdn.shopify.com" in h or "shopify" in h)),
        ("Wix", ("wix.com" in h or "_wix" in h or "wixstatic" in h)),
        ("Squarespace", ("squarespace" in h)),
        ("Joomla", ("joomla" in gen_c or "/components/com_" in h)),
        ("TYPO3", ("typo3" in gen_c or "typo3" in h)),
        ("Drupal", ("drupal" in gen_c or "drupal" in h)),
        ("Jimdo", ("jimdo" in h)),
        ("Webflow", ("webflow" in h)),
        ("Magento", ("magento" in h or "mage/" in h)),
        ("React", ("__react" in h or "data-reactroot" in h or "react" in h and "react-dom" in h)),
        ("Vue.js", ("data-v-" in h or "vue.js" in h or "__vue" in h)),
        ("Angular", ("ng-version" in h or "angular" in h)),
        ("Bootstrap", ("bootstrap" in h)),
        ("jQuery", ("jquery" in h)),
        ("Google Analytics", ("google-analytics.com" in h or "gtag(" in h or "ga(" in h)),
        ("Google Tag Manager", ("googletagmanager.com" in h or "gtm-" in h)),
        ("Cloudflare", ("cloudflare" in h or "cdnjs.cloudflare" in h)),
    ]
    for tname, hit in checks:
        if hit:
            techs.append(tname)
    return techs


def quick_analyze(url):
    """Tiefe Website-Analyse: SEO Score aus 15+ Faktoren (mit 24h-Cache)"""
    result = {"hasWebsite": False, "online": False, "title": "", "seoScore": 0}
    if not url:
        return result
    cached = cache_get(url)
    if cached is not None:
        cached = dict(cached)
        cached["cached"] = True
        return cached
    result["hasWebsite"] = True
    try:
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        start = time.time()
        resp = requests.get(url, timeout=6, headers={
            "User-Agent": "Mozilla/5.0 (compatible; SEOSolutionsBot/1.0)"
        }, allow_redirects=True)
        load_time = round(time.time() - start, 2)
        result["loadTime"] = load_time
        result["statusCode"] = resp.status_code
        result["finalUrl"] = resp.url
        result["online"] = resp.status_code == 200
        result["https"] = resp.url.startswith("https://")
        if not result["online"]:
            return result

        html = resp.text
        soup = BeautifulSoup(html, "html.parser")

        # Title
        title_tag = soup.find("title")
        title = title_tag.get_text(strip=True) if title_tag else ""
        result["title"] = title[:100]

        # Meta Description
        meta_tag = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
        meta = meta_tag.get("content", "").strip() if meta_tag else ""
        result["metaDescription"] = meta[:200]

        # Viewport (Mobile)
        viewport = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.I)})
        result["hasMobile"] = viewport is not None

        # H1/H2/H3
        h1s = [h.get_text(strip=True) for h in soup.find_all("h1")]
        h2s = soup.find_all("h2")
        h3s = soup.find_all("h3")
        result["h1Tags"] = h1s[:3]
        result["hasH1"] = len(h1s) > 0
        result["h2Count"] = len(h2s)
        result["h3Count"] = len(h3s)

        # Wörter
        for tag in soup(["script", "style", "noscript"]):
            tag.decompose()
        text = soup.get_text(separator=" ", strip=True)
        words = len(text.split())
        result["wordCount"] = words

        # Bilder
        images = soup.find_all("img")
        imgs_total = len(images)
        imgs_with_alt = sum(1 for img in images if img.get("alt", "").strip())
        result["imagesTotal"] = imgs_total
        result["imagesWithAlt"] = imgs_with_alt
        result["imagesWithoutAlt"] = imgs_total - imgs_with_alt

        # Links
        all_links = soup.find_all("a", href=True)
        parsed = urlparse(resp.url)
        domain = parsed.netloc
        internal = external = 0
        for link in all_links:
            href = link["href"]
            if href.startswith(("#", "mailto:", "tel:", "javascript:")):
                continue
            lp = urlparse(href)
            if not lp.netloc or lp.netloc == domain:
                internal += 1
            else:
                external += 1
        result["internalLinks"] = internal
        result["externalLinks"] = external

        # Schema.org / Structured Data
        schemas = soup.find_all("script", type="application/ld+json")
        result["hasSchema"] = len(schemas) > 0

        # Open Graph
        og_title = soup.find("meta", property="og:title")
        result["hasOG"] = og_title is not None

        # Canonical
        canonical = soup.find("link", rel="canonical")
        result["hasCanonical"] = canonical is not None

        # Robots
        robots = soup.find("meta", attrs={"name": re.compile(r"^robots$", re.I)})
        robots_content = robots.get("content", "").lower() if robots else ""
        result["robotsBlocked"] = "noindex" in robots_content

        # Favicon
        favicon = soup.find("link", rel=lambda r: r and "icon" in " ".join(r if isinstance(r, list) else [r]).lower())
        result["hasFavicon"] = favicon is not None

        # CSS / JS Dateien
        css_files = soup.find_all("link", rel=lambda r: r and "stylesheet" in (r if isinstance(r, list) else [r]))
        js_files = soup.find_all("script", src=True)
        result["cssFiles"] = len(css_files)
        result["jsFiles"] = len(js_files)

        # Google Analytics / Tag Manager
        html_lower = html.lower()
        result["hasAnalytics"] = ("google-analytics.com" in html_lower or "gtag(" in html_lower or "googletagmanager.com" in html_lower)
        result["hasTagManager"] = "googletagmanager.com" in html_lower

        # Technologien
        result["technologies"] = detect_technologies(html, soup)

        # ===== SEO SCORE (0-100, fair gewichtet) =====
        score = 0
        # HTTPS (0-12) — Sicherheit & Ranking-Faktor, hoch gewichtet
        if result["https"]:
            score += 12
        # Title (0-14)
        if title:
            score += 7
            if 30 <= len(title) <= 65:
                score += 7
            elif len(title) > 10:
                score += 3
        # Meta Description (0-13)
        if meta:
            score += 7
            if 120 <= len(meta) <= 160:
                score += 6
            elif len(meta) > 50:
                score += 3
        # H1 (0-9)
        if h1s:
            score += 5
            if len(h1s) == 1:
                score += 4
        # Mobile (0-10) — Mobile-First Indexing
        if viewport:
            score += 10
        # Content (0-10)
        if words >= 300:
            score += 6
            if words >= 800:
                score += 4
        elif words >= 100:
            score += 3
        # Speed (0-8)
        if load_time < 1.5:
            score += 8
        elif load_time < 3:
            score += 5
        elif load_time < 5:
            score += 2
        # Images Alt (0-6)
        if imgs_total > 0 and imgs_with_alt == imgs_total:
            score += 6
        elif imgs_total > 0 and imgs_with_alt > 0:
            score += 3
        elif imgs_total == 0:
            score += 3
        # Links (0-6)
        if internal >= 3:
            score += 3
        if external >= 1:
            score += 3
        # Structured Data (0-5)
        if result["hasSchema"]:
            score += 5
        # H2 structure (0-4)
        if len(h2s) >= 2:
            score += 4
        elif len(h2s) >= 1:
            score += 2
        # OG / Canonical (0-3)
        if result["hasOG"]:
            score += 2
        if result["hasCanonical"]:
            score += 1
        # Penalty: noindex blockiert Indexierung komplett
        if result.get("robotsBlocked"):
            score = int(score * 0.4)

        result["seoScore"] = min(score, 100)

        # ===== Empfehlungen =====
        recs = []
        if not result["https"]:
            recs.append("Kein HTTPS — SSL-Zertifikat einrichten")
        if not title:
            recs.append("Fehlender Title-Tag")
        elif not (30 <= len(title) <= 65):
            recs.append("Title-Länge optimieren (30–65 Zeichen)")
        if not meta:
            recs.append("Fehlende Meta Description")
        elif not (120 <= len(meta) <= 160):
            recs.append("Meta Description optimieren (120–160 Zeichen)")
        if not h1s:
            recs.append("Keine H1-Überschrift")
        elif len(h1s) > 1:
            recs.append("Mehrere H1-Tags — nur eine verwenden")
        if not viewport:
            recs.append("Nicht mobiloptimiert (Viewport-Meta fehlt)")
        if words < 300:
            recs.append("Zu wenig Textinhalt (unter 300 Wörter)")
        if load_time >= 3:
            recs.append("Langsame Ladezeit")
        if imgs_total > 0 and imgs_with_alt < imgs_total:
            recs.append(f"{imgs_total - imgs_with_alt} Bilder ohne Alt-Text")
        if not result["hasSchema"]:
            recs.append("Keine strukturierten Daten (Schema.org)")
        if not result["hasOG"]:
            recs.append("Keine Open-Graph-Tags (Social Sharing)")
        if not result.get("hasFavicon"):
            recs.append("Kein Favicon")
        if not result.get("hasAnalytics"):
            recs.append("Kein Web-Tracking (Google Analytics/GTM)")
        if result.get("robotsBlocked"):
            recs.append("Seite per noindex von der Indexierung ausgeschlossen")
        result["recommendations"] = recs

        cache_set(url, result)
    except Exception as e:
        result["online"] = False
        result["error"] = str(e)
    return result


@app.post("/api/search/businesses")
def search_businesses():
    body = request.get_json() or {}
    query = body.get("query", "").strip()
    location = body.get("location", "").strip()
    radius = body.get("radius", 5000)
    analyze = body.get("analyze", True)
    discover = body.get("discover", True)
    max_results = body.get("maxResults", 50)
    portals = body.get("portals", "all")

    if not location:
        return jsonify({"error": "Ort / Stadt ist erforderlich"}), 400

    all_results = []
    seen_names = set()

    # Portal-Auswahl
    sources_used = []
    source_list = []
    if portals in ("all", "osm"):
        source_list.append(("OpenStreetMap", search_osm, (query or "", location, radius)))
    if portals in ("all", "wko") and query:
        source_list.append(("WKO Firmen A-Z", search_wko, (query, location)))
    if portals in ("all", "herold") and query:
        source_list.append(("Herold.at", search_herold, (query, location)))
    if portals in ("all", "firmenabc") and query:
        source_list.append(("FirmenABC.at", search_firmenabc, (query, location)))
    # Wenn kein Query aber spezifisches Portal gewählt
    if not query and portals == "wko":
        source_list.append(("WKO Firmen A-Z", search_wko, ("", location)))

    # PARALLEL Portal-Abfrage — alle Portale gleichzeitig
    def _search_portal(name, fn, args):
        try:
            return name, fn(*args)
        except Exception as e:
            print(f"[SEARCH] Error in {name}: {e}")
            return name, []

    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(_search_portal, n, fn, a) for n, fn, a in source_list]
        for f in as_completed(futures):
            name, found = f.result()
            count = 0
            for biz in found:
                name_key = biz["name"].lower().strip()
                if name_key not in seen_names:
                    seen_names.add(name_key)
                    all_results.append(biz)
                    count += 1
            if count > 0:
                sources_used.append(f"{name} ({count})")

    # PARALLEL: Website-Discovery für Firmen ohne Website
    no_site = [b for b in all_results if not b.get("website")]
    if no_site and discover:
        print(f"[SEARCH] Parallel website discovery for {len(no_site)} firms...")
        def _discover(biz):
            return biz, deep_discover_website(biz["name"], biz.get("address",""), biz.get("phone",""), biz.get("email",""), location)
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = [pool.submit(_discover, b) for b in no_site[:15]]
            for f in as_completed(futures):
                try:
                    biz, url = f.result()
                    if url:
                        biz["website"] = url
                        biz["websiteDiscovered"] = True
                except Exception:
                    pass

    # PARALLEL: Website-Analyse
    if analyze:
        with_site = [b for b in all_results if b.get("website")]
        print(f"[SEARCH] Parallel analyzing {len(with_site)} websites...")
        def _analyze(biz):
            return biz, quick_analyze(biz["website"])
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = [pool.submit(_analyze, b) for b in with_site]
            for f in as_completed(futures):
                try:
                    biz, analysis = f.result()
                    biz["seoScore"] = analysis.get("seoScore", 0)
                    biz["siteOnline"] = analysis.get("online", False)
                    biz["siteTitle"] = analysis.get("title", "")
                    biz["hasWebsite"] = True
                    biz["https"] = analysis.get("https", False)
                    biz["mobile"] = analysis.get("hasMobile", False)
                    biz["loadTime"] = analysis.get("loadTime", 0)
                    biz["wordCount"] = analysis.get("wordCount", 0)
                    biz["hasSchema"] = analysis.get("hasSchema", False)
                    biz["metaDesc"] = analysis.get("metaDescription", "")
                    biz["h1"] = (analysis.get("h1Tags") or [""])[0][:60]
                except Exception:
                    pass
        for biz in all_results:
            if not biz.get("website"):
                biz["hasWebsite"] = False
                biz["seoScore"] = 0
                biz["siteOnline"] = False

    # Sortierung: Beste SEO-Scores zuerst, dann mit Website, dann Rest
    all_results.sort(key=lambda b: (
        not b.get("hasWebsite"),
        not b.get("siteOnline"),
        -(b.get("seoScore") or 0),
        b["name"],
    ))

    print(f"[SEARCH] Total: {len(all_results)} from: {', '.join(sources_used) or 'keine Quellen'}")

    limit = min(max_results, len(all_results)) if max_results < 500 else len(all_results)
    return jsonify({
        "businesses": all_results[:limit],
        "count": len(all_results),
        "showing": limit,
        "sources": sources_used or ["Keine Ergebnisse"],
    })


# ===== WEBSITE SEO ANALYSIS =====

@app.post("/api/websites/analyze")
def analyze_website():
    body = request.get_json() or {}
    url = body.get("url", "").strip()
    if not url:
        return jsonify({"error": "url is required"}), 400

    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    try:
        start_time = time.time()
        resp = requests.get(url, timeout=15, headers={
            "User-Agent": "Mozilla/5.0 (compatible; SEOSolutionsBot/1.0)"
        })
        load_time = round(time.time() - start_time, 3)
        resp.raise_for_status()
    except requests.RequestException as e:
        return jsonify({"error": f"Could not fetch URL: {str(e)}"}), 400

    soup = BeautifulSoup(resp.text, "html.parser")
    parsed_url = urlparse(url)
    domain = parsed_url.netloc

    # Title
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # Meta description
    meta_desc_tag = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    meta_description = meta_desc_tag.get("content", "") if meta_desc_tag else ""

    # H1 tags
    h1_tags = [h1.get_text(strip=True) for h1 in soup.find_all("h1")]

    # Word count (visible text)
    text = soup.get_text(separator=" ", strip=True)
    word_count = len(text.split())

    # Images
    images = soup.find_all("img")
    images_total = len(images)
    images_with_alt = sum(1 for img in images if img.get("alt", "").strip())
    images_without_alt = images_total - images_with_alt

    # Links
    links = soup.find_all("a", href=True)
    internal_links = 0
    external_links = 0
    for link in links:
        href = link["href"]
        if href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        link_parsed = urlparse(href)
        if not link_parsed.netloc or link_parsed.netloc == domain:
            internal_links += 1
        else:
            external_links += 1

    # Mobile-friendly check (viewport meta)
    viewport_tag = soup.find("meta", attrs={"name": re.compile(r"^viewport$", re.I)})
    has_viewport = viewport_tag is not None

    # Basic SEO score (0-100)
    score = 0
    if title:
        score += 15
        if 30 <= len(title) <= 65:
            score += 5
    if meta_description:
        score += 15
        if 120 <= len(meta_description) <= 160:
            score += 5
    if h1_tags:
        score += 10
        if len(h1_tags) == 1:
            score += 5
    if has_viewport:
        score += 10
    if word_count >= 300:
        score += 10
    if images_total > 0 and images_without_alt == 0:
        score += 10
    if internal_links >= 3:
        score += 5
    if external_links >= 1:
        score += 5
    if load_time < 3:
        score += 5

    result = {
        "url": url,
        "title": title,
        "metaDescription": meta_description,
        "h1Tags": h1_tags,
        "wordCount": word_count,
        "images": {
            "total": images_total,
            "withAlt": images_with_alt,
            "withoutAlt": images_without_alt,
        },
        "links": {
            "internal": internal_links,
            "external": external_links,
        },
        "mobileFriendly": has_viewport,
        "loadTime": load_time,
        "seoScore": score,
    }

    return jsonify(result)


# ===== WEBSITES =====

@app.get("/api/websites")
def get_websites():
    db = read_db()
    return jsonify(db["websites"])


@app.post("/api/websites")
def create_website():
    db = read_db()
    body = request.get_json() or {}
    url = body.get("url", "").strip()
    if not url:
        return jsonify({"error": "URL required"}), 400
    website = {
        "id": gen_id(),
        "url": url,
        "name": body.get("name", url),
        "keywords": body.get("keywords", ""),
        "lang": body.get("lang", "de"),
        "apiKey": gen_api_key(),
        "createdAt": now_iso(),
    }
    db["websites"].append(website)
    write_db(db)
    return jsonify(website), 201


@app.delete("/api/websites/<website_id>")
def delete_website(website_id):
    db = read_db()
    db["websites"] = [w for w in db["websites"] if w["id"] != website_id]
    db["zones"] = [z for z in db["zones"] if z["websiteId"] != website_id]
    db["jobs"] = [j for j in db["jobs"] if j.get("websiteId") != website_id]
    write_db(db)
    return jsonify({"ok": True})


# ===== ZONES =====

@app.get("/api/zones")
def get_zones():
    db = read_db()
    website_id = request.args.get("websiteId")
    zones = db["zones"]
    if website_id:
        zones = [z for z in zones if z["websiteId"] == website_id]
    return jsonify(zones)


@app.post("/api/zones")
def create_zone():
    db = read_db()
    body = request.get_json() or {}
    website_id = body.get("websiteId", "")
    zone_id = body.get("zoneId", "").strip()
    if not website_id or not zone_id:
        return jsonify({"error": "websiteId and zoneId required"}), 400
    zone = {
        "id": gen_id(),
        "websiteId": website_id,
        "zoneId": zone_id,
        "type": body.get("type", "text"),
        "prompt": body.get("prompt", ""),
        "currentContent": body.get("currentContent", ""),
        "versions": [],
        "createdAt": now_iso(),
    }
    db["zones"].append(zone)
    write_db(db)
    return jsonify(zone), 201


@app.delete("/api/zones/<zone_id>")
def delete_zone(zone_id):
    db = read_db()
    db["zones"] = [z for z in db["zones"] if z["id"] != zone_id]
    db["jobs"] = [j for j in db["jobs"] if j.get("zoneId") != zone_id]
    write_db(db)
    return jsonify({"ok": True})


# ===== AI CONTENT GENERATION =====

@app.post("/api/ai/generate")
def ai_generate():
    body = request.get_json() or {}
    api_key = body.get("apiKey", "")
    if not api_key:
        return jsonify({"error": "Anthropic API Key required"}), 400

    try:
        content = generate_content(
            zone_type=body.get("zoneType", "text"),
            prompt=body.get("prompt", ""),
            current_content=body.get("currentContent", ""),
            api_key=api_key,
            model=body.get("model", "claude-opus-4-8"),
            keywords=body.get("keywords", ""),
            lang=body.get("lang", "de"),
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    # Persist result to zone if zoneId given
    zone_id = body.get("zoneId")
    if zone_id:
        db = read_db()
        zone = next((z for z in db["zones"] if z["id"] == zone_id), None)
        if zone:
            zone.setdefault("versions", []).insert(0, {"content": content, "time": now_iso()})
            zone["currentContent"] = content
            db.setdefault("activities", []).insert(0, {
                "title": f"Zone \"{zone['zoneId']}\" aktualisiert",
                "meta": zone.get("type", "text"),
                "status": "success",
                "color": "#22c55e",
                "time": now_iso(),
            })
            write_db(db)

    return jsonify({"content": content})


@app.post("/api/ai/batch")
def ai_batch():
    body = request.get_json() or {}
    api_key = body.get("apiKey", "")
    if not api_key:
        return jsonify({"error": "API key required"}), 400
    zones = body.get("zones", [])
    model = body.get("model", "claude-opus-4-8")
    results = batch_generate_content(zones, api_key, model)
    return jsonify({"results": results})


@app.post("/api/ai/analyze")
def ai_analyze():
    body = request.get_json() or {}
    api_key = body.get("apiKey", "")
    content = body.get("content", "")
    if not api_key or not content:
        return jsonify({"error": "apiKey and content required"}), 400
    result = analyze_seo(content, api_key, body.get("model", "claude-opus-4-8"))
    return jsonify(result)


# ===== JOBS =====

@app.get("/api/jobs")
def get_jobs():
    db = read_db()
    return jsonify(db["jobs"])


@app.post("/api/jobs")
def create_job():
    db = read_db()
    body = request.get_json() or {}
    zone_id = body.get("zoneId", "")
    zone = next((z for z in db["zones"] if z["id"] == zone_id), None)
    if not zone:
        return jsonify({"error": "Zone not found"}), 404
    job = {
        "id": gen_id(),
        "zoneId": zone_id,
        "websiteId": zone["websiteId"],
        "type": body.get("type", "optimize"),
        "schedule": body.get("schedule", "daily"),
        "status": "pending",
        "lastRun": None,
        "createdAt": now_iso(),
    }
    db["jobs"].append(job)
    write_db(db)
    return jsonify(job), 201


@app.post("/api/jobs/<job_id>/run")
def run_job(job_id):
    db = read_db()
    job = next((j for j in db["jobs"] if j["id"] == job_id), None)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    zone = next((z for z in db["zones"] if z["id"] == job["zoneId"]), None)
    if not zone:
        return jsonify({"error": "Zone not found"}), 404
    api_key = (request.get_json() or {}).get("apiKey", "")
    if not api_key:
        return jsonify({"error": "apiKey required"}), 400

    job["status"] = "running"
    write_db(db)

    try:
        content = generate_content(
            zone_type=zone.get("type", "text"),
            prompt=zone.get("prompt", ""),
            current_content=zone.get("currentContent", ""),
            api_key=api_key,
            model=(request.get_json() or {}).get("model", "claude-opus-4-8"),
        )
        zone.setdefault("versions", []).insert(0, {"content": content, "time": now_iso()})
        zone["currentContent"] = content
        job["status"] = "success"
        job["lastRun"] = now_iso()
        write_db(db)
        return jsonify({"ok": True, "content": content})
    except Exception as e:
        job["status"] = "error"
        job["errorMsg"] = str(e)
        write_db(db)
        return jsonify({"error": str(e)}), 500


@app.delete("/api/jobs/<job_id>")
def delete_job(job_id):
    db = read_db()
    db["jobs"] = [j for j in db["jobs"] if j["id"] != job_id]
    write_db(db)
    return jsonify({"ok": True})


# ===== ACTIVITIES =====

@app.get("/api/activities")
def get_activities():
    db = read_db()
    return jsonify(db.get("activities", [])[:50])


# ===== EMBED CONTENT API (called by external websites via snippet) =====

@app.get("/v1/content/<api_key>")
def get_content(api_key):
    db = read_db()
    website = next((w for w in db["websites"] if w["apiKey"] == api_key), None)
    if not website:
        return jsonify({"error": "Unknown API key"}), 404
    zones = [z for z in db["zones"] if z["websiteId"] == website["id"]]
    payload = {z["zoneId"]: {"type": z["type"], "content": z["currentContent"]} for z in zones}
    return jsonify({"zones": payload})


@app.get("/v1/content/embed.js")
def serve_embed():
    api_key = request.args.get("key", "")
    embed_path = ROOT / "snippet" / "embed.js"
    js = embed_path.read_text(encoding="utf-8").replace("__API_KEY__", api_key)
    return app.response_class(js, mimetype="application/javascript")


# ===== SERVE FRONTEND (catch-all — must be last) =====

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory(str(ROOT), filename)


# ===== START =====

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 3001))
    print(f"seo.solutions Python backend running on http://localhost:{port}")
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
