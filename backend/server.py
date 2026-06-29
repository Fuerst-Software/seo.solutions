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


def haversine_km(lat1, lon1, lat2, lon2):
    """Entfernung zwischen zwei Koordinaten in km (Haversine-Formel)."""
    if lat1 is None or lon1 is None or lat2 is None or lon2 is None:
        return None
    import math
    try:
        lat1, lon1, lat2, lon2 = float(lat1), float(lon1), float(lat2), float(lon2)
    except (TypeError, ValueError):
        return None
    r = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    return round(2 * r * math.asin(math.sqrt(a)), 2)


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

        # Branche-Filter: wenn query angegeben, muss Suchbegriff in Kategorie
        # oder Name vorkommen, sonst Firma überspringen.
        q = (query or "").strip().lower()
        if q:
            haystack = (category + " " + name).lower()
            q_terms = [t for t in q.split() if len(t) > 2] or [q]
            if not any(t in haystack for t in q_terms):
                continue

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
            "lat": None, "lon": None,
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

        for bz_url in bezirk_links[:15]:
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

        # Radius vom User nutzen (bis 50km).
        safe_radius = min(int(radius or 5000), 50000)
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
            # OHNE Branche: craft + shop + office (KEIN amenity — verursacht Timeouts)
            lines = [
                f'node["craft"]["name"](around:{safe_radius},{lat},{lon});',
                f'node["shop"]["name"](around:{safe_radius},{lat},{lon});',
                f'node["office"]["name"](around:{safe_radius},{lat},{lon});',
                f'way["craft"]["name"](around:{safe_radius},{lat},{lon});',
                f'way["shop"]["name"](around:{safe_radius},{lat},{lon});',
            ]

        overpass_body = "\n".join(lines)
        overpass_query = f"[out:json][timeout:30];\n(\n{overpass_body}\n);\nout center 500;"
        print(f"[OSM] Tags: {matched_tags or 'alle Firmen'}, {len(lines)} filters, radius={safe_radius}")

        # Overpass mit Fallback-Servern (Hauptserver oft überlastet)
        OVERPASS_SERVERS = [
            "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
        ]
        ov_data = None
        for srv in OVERPASS_SERVERS:
            try:
                print(f"[OSM] Trying: {srv}")
                ov_resp = requests.post(srv, data={"data": overpass_query}, headers=OSM_HEADERS, timeout=35)
                if ov_resp.status_code == 200:
                    ov_data = ov_resp.json()
                    remark = str(ov_data.get("remark", ""))
                    if "error" not in remark.lower() and "timeout" not in remark.lower():
                        print(f"[OSM] OK from {srv}")
                        break
                    print(f"[OSM] Timeout from {srv}")
                    ov_data = None
            except Exception as e:
                print(f"[OSM] Failed {srv}: {e}")
        if not ov_data:
            print("[OSM] All servers failed")
            return results

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

            # Koordinaten: node hat lat/lon direkt, way hat sie in "center"
            el_lat = el.get("lat")
            el_lon = el.get("lon")
            if el_lat is None or el_lon is None:
                center = el.get("center") or {}
                el_lat = center.get("lat")
                el_lon = center.get("lon")

            results.append({
                "lat": el_lat, "lon": el_lon,
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
    portals = body.get("portals", "all")
    sort = (body.get("sort") or "score_desc").strip()

    # maxResults: beliebige Zahl 1-1000
    try:
        max_results = int(body.get("maxResults", 50))
    except (TypeError, ValueError):
        max_results = 50
    max_results = max(1, min(max_results, 1000))

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

    # Entfernung zum Suchort berechnen (Haversine), wenn Koordinaten vorhanden
    search_lat = search_lon = None
    try:
        geo_resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": location, "format": "json", "limit": 1},
            headers=OSM_HEADERS,
            timeout=10,
        )
        geo_data = geo_resp.json()
        if geo_data:
            search_lat = float(geo_data[0]["lat"])
            search_lon = float(geo_data[0]["lon"])
    except Exception as e:
        print(f"[SEARCH] Geocode error: {e}")

    for biz in all_results:
        biz["distance_km"] = haversine_km(search_lat, search_lon, biz.get("lat"), biz.get("lon"))

    # Sortierung gemäß sort-Parameter
    def _dist_key(b):
        d = b.get("distance_km")
        return d if d is not None else float("inf")

    if sort == "score_asc":
        # schlechteste Scores zuerst, nur mit (online) Website
        all_results.sort(key=lambda b: (
            not b.get("hasWebsite"),
            not b.get("siteOnline"),
            (b.get("seoScore") or 0),
            b["name"],
        ))
    elif sort == "no_website":
        # Firmen ohne Website zuerst
        all_results.sort(key=lambda b: (
            bool(b.get("hasWebsite")),
            -(b.get("seoScore") or 0),
            b["name"],
        ))
    elif sort == "distance":
        # nächste Firmen zuerst
        all_results.sort(key=lambda b: (_dist_key(b), b["name"]))
    else:
        # Default "score_desc": beste SEO-Scores zuerst (nur mit Website)
        all_results.sort(key=lambda b: (
            not b.get("hasWebsite"),
            not b.get("siteOnline"),
            -(b.get("seoScore") or 0),
            b["name"],
        ))

    print(f"[SEARCH] Total: {len(all_results)} from: {', '.join(sources_used) or 'keine Quellen'}")

    limit = min(max_results, len(all_results))
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


# ===== COMPANY DIGITAL FOOTPRINT =====

def _footprint_wko_detail(name, location):
    """Sucht Firma auf firmen.wko.at und extrahiert Inhaber/Kontakt/Adresse/Branche."""
    out = {"owner": None, "phones": [], "emails": [], "website": "",
           "address": "", "category": "", "uid": None}
    try:
        results = _ddg_search(f'"{name}" site:firmen.wko.at')
        detail_url = ""
        for r in results:
            if "firmen.wko.at" in r["url"].lower():
                detail_url = r["url"]
                break
        if not detail_url:
            return out
        resp = requests.get(detail_url, headers=SEARCH_HEADERS, timeout=10, allow_redirects=True)
        if resp.status_code != 200:
            return out
        soup = BeautifulSoup(resp.text, "html.parser")
        text = soup.get_text(" ", strip=True)

        # Telefonnummern (alle tel: Links)
        for tel in soup.select("a[href^='tel:']"):
            sp = tel.find("span")
            num = (sp.get_text(strip=True) if sp else tel.get_text(strip=True)) or tel["href"].replace("tel:", "")
            num = num.strip()
            if num and num not in out["phones"]:
                out["phones"].append(num)
        # Emails (alle mailto: Links)
        for mail in soup.select("a[href^='mailto:']"):
            em = mail["href"].replace("mailto:", "").strip()
            if em and em not in out["emails"]:
                out["emails"].append(em)
        # Website
        web_icon = soup.find("use", attrs={"xlink:href": "#website"})
        if web_icon:
            link = web_icon.find_parent("a")
            if link:
                sp = link.find("span")
                w = sp.get_text(strip=True) if sp else ""
                if w and not w.startswith("http"):
                    w = "https://" + w
                out["website"] = w
        # Adresse
        street_el = soup.select_one(".address .street") or soup.select_one(".street")
        place_el = soup.select_one(".address .place") or soup.select_one(".place")
        street = street_el.get_text(strip=True) if street_el else ""
        place = (place_el.get_text(strip=True).replace("\xa0", " ").strip()) if place_el else ""
        out["address"] = f"{street}, {place}".strip(", ")
        # Branche
        cat_el = soup.select_one(".title-details") or soup.find("h2")
        if cat_el:
            out["category"] = cat_el.get_text(strip=True)[:120]
        # Inhaber / Geschäftsführer — Label-Suche
        m = re.search(r"(?:Inhaber|Gesch[äa]ftsf[üu]hrer|Eigent[üu]mer|Gesch[äa]ftsleitung)\s*:?\s*([A-ZÄÖÜ][\wäöüß.\-]+(?:\s+[A-ZÄÖÜ][\wäöüß.\-]+){0,3})", text)
        if m:
            out["owner"] = m.group(1).strip()
        # UID
        uid = re.search(r"(ATU\d{8})", text)
        if uid:
            out["uid"] = uid.group(1)
    except Exception as e:
        print(f"[FOOTPRINT WKO] {e}")
    return out


def _footprint_social(name, platform, domain):
    """DuckDuckGo Suche nach Social-Media-Profil."""
    try:
        results = _ddg_search(f'"{name}" site:{domain}')
        for r in results:
            url = r["url"]
            if domain in url.lower():
                return {"platform": platform, "url": url, "found": True}
    except Exception:
        pass
    return {"platform": platform, "url": None, "found": False}


def _footprint_directory(name, display, domain):
    """DuckDuckGo Suche in einem Online-Verzeichnis."""
    try:
        results = _ddg_search(f'"{name}" site:{domain}')
        for r in results:
            url = r["url"]
            if domain in url.lower():
                return {"name": display, "url": url, "found": True}
    except Exception:
        pass
    return {"name": display, "url": None, "found": False}


def _footprint_maps(name, location):
    try:
        results = _ddg_search(f'"{name}" "{location}" google maps')
        for r in results:
            if "google." in r["url"].lower() and "maps" in r["url"].lower():
                return r["url"]
        return results[0]["url"] if results else None
    except Exception:
        return None


def _footprint_reviews(name, location):
    try:
        results = _ddg_search(f'"{name}" "{location}" bewertungen')
        for r in results:
            text = (r.get("title", "") + " " + r.get("snippet", ""))
            m = re.search(r"(\d[\.,]\d)\s*(?:Sterne|stars|/\s*5)?.{0,40}?(\d+)\s*(?:Bewertung|Rezension|review)", text, re.I)
            if m:
                return f"{m.group(1)} Sterne, {m.group(2)} Bewertungen"
        # nur Sterne
        for r in results:
            text = (r.get("title", "") + " " + r.get("snippet", ""))
            m = re.search(r"(\d[\.,]\d)\s*Sterne", text, re.I)
            if m:
                return f"{m.group(1)} Sterne"
        return None
    except Exception:
        return None


def _footprint_website_extras(url):
    """Zusätzliche Website-Checks: sitemap, robots, tracking, last-modified, social links."""
    extras = {
        "hasSitemap": False, "hasRobotsTxt": False, "lastModified": None,
        "socialLinksOnSite": [],
        "trackingCodes": {"googleAnalytics": False, "googleTagManager": False,
                          "facebookPixel": False, "googleAds": False,
                          "newsletterMailchimp": False, "newsletterSendinblue": False,
                          "newsletterCleverReach": False, "crmHubSpot": False,
                          "remarketingCriteo": False, "linkedInPixel": False,
                          "pinterestPixel": False, "cookieConsent": False},
    }
    if not url:
        return extras
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    try:
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"
        for path, key in (("/sitemap.xml", "hasSitemap"), ("/robots.txt", "hasRobotsTxt")):
            try:
                h = requests.head(base + path, headers=SEARCH_HEADERS, timeout=8, allow_redirects=True)
                if h.status_code == 405:  # HEAD nicht erlaubt -> GET
                    h = requests.get(base + path, headers=SEARCH_HEADERS, timeout=8, allow_redirects=True)
                extras[key] = h.status_code < 400
            except Exception:
                pass
        # Hauptseite holen für tracking + social + last-modified
        resp = requests.get(url, headers=SEARCH_HEADERS, timeout=10, allow_redirects=True)
        extras["lastModified"] = resp.headers.get("Last-Modified")
        html = resp.text
        h = html.lower()
        extras["trackingCodes"]["facebookPixel"] = "fbq(" in h or "connect.facebook.net/en_us/fbevents.js" in h
        extras["trackingCodes"]["googleAds"] = "adsbygoogle" in h or "googleadservices" in h
        extras["trackingCodes"]["googleTagManager"] = "gtm.js" in h or "googletagmanager.com" in h
        extras["trackingCodes"]["googleAnalytics"] = "gtag(" in h or "google-analytics.com" in h or re.search(r"\bga\(", h) is not None
        # Erweiterte Tracking-/Marketing-Erkennung
        extras["trackingCodes"]["newsletterMailchimp"] = "mailchimp" in h or "mc.js" in h
        extras["trackingCodes"]["newsletterSendinblue"] = "sendinblue" in h or "sib.js" in h
        extras["trackingCodes"]["newsletterCleverReach"] = "cleverreach" in h
        extras["trackingCodes"]["crmHubSpot"] = "hubspot" in h
        extras["trackingCodes"]["remarketingCriteo"] = "criteo" in h
        extras["trackingCodes"]["linkedInPixel"] = "linkedin.com/px" in h or "snap.licdn.com" in h
        extras["trackingCodes"]["pinterestPixel"] = "pintrk(" in h or "pinterest" in h
        extras["trackingCodes"]["cookieConsent"] = "cookiebot" in h or "cookieconsent" in h or "onetrust" in h
        soup = BeautifulSoup(html, "html.parser")
        social_domains = ["facebook.com", "instagram.com", "linkedin.com",
                          "youtube.com", "tiktok.com", "twitter.com", "x.com"]
        seen = set()
        for a in soup.find_all("a", href=True):
            href = a["href"]
            if href.startswith("http") and any(d in href.lower() for d in social_domains):
                if href not in seen:
                    seen.add(href)
                    extras["socialLinksOnSite"].append(href)
    except Exception as e:
        print(f"[FOOTPRINT WEB] {e}")
    return extras


# ===== NEUE FOOTPRINT-ANALYSEN =====

def _footprint_facebook_ads(name, location):
    """Sucht in der Facebook Ads Library nach Werbekampagnen"""
    try:
        results = _ddg_search(f'"{name}" site:facebook.com/ads/library')
    except Exception:
        results = []
    url = f"https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=AT&q={requests.utils.quote(name)}"
    return {"adsLibraryUrl": url, "foundInSearch": len(results) > 0, "searchResults": results[:3]}


def _footprint_impressum(website):
    """Scrapt ALLE Unterseiten nach Stammdaten — nicht nur Impressum."""
    out = {"found": False, "url": None, "owner": None, "firmenbuch": None,
           "uid": None, "phones": [], "emails": [], "foundOn": []}
    if not website:
        return out
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    try:
        parsed = urlparse(website)
        base = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return out

    # Statische Pfade + CMS-Varianten
    static_paths = [
        "/impressum", "/imprint", "/about", "/about-us", "/kontakt",
        "/contact", "/ueber-uns", "/team", "/unternehmen", "/company",
        "/datenschutz", "/agb", "/legal",
        # CMS-Pfade (Joomla, WordPress, etc.)
        "/index.php/impressum", "/index.php/kontakt", "/index.php/about",
        "/index.php/datenschutz", "/index.php/ueber-uns",
    ]

    # ZUERST: Startseite laden und echte Impressum/Kontakt-Links finden
    found_links = set()
    try:
        hp_resp = requests.get(base, headers=SEARCH_HEADERS, timeout=6, allow_redirects=True)
        if hp_resp.status_code == 200:
            hp_soup = BeautifulSoup(hp_resp.text, "html.parser")
            for a in hp_soup.find_all("a", href=True):
                href = a.get("href", "").lower()
                text = a.get_text(strip=True).lower()
                if any(kw in href or kw in text for kw in ["impressum", "imprint", "kontakt", "contact", "about", "über uns", "ueber-uns", "datenschutz", "team"]):
                    full_href = a.get("href", "")
                    if full_href.startswith("/"):
                        found_links.add(full_href)
                    elif full_href.startswith(base):
                        found_links.add(full_href.replace(base, ""))
    except Exception:
        pass

    # Gefundene Links haben Priorität, dann statische Pfade
    paths = list(found_links) + [p for p in static_paths if p not in found_links]
    all_phones = set()
    all_emails = set()

    for path in paths:
        try:
            resp = requests.get(base + path, headers=SEARCH_HEADERS, timeout=6, allow_redirects=True)
            if resp.status_code != 200 or len(resp.text) < 200:
                continue
            out["found"] = True
            out["foundOn"].append(path)
            soup = BeautifulSoup(resp.text, "html.parser")
            text = soup.get_text(" ", strip=True)

            # Geschäftsführer — mehrere Patterns
            if not out["owner"]:
                patterns = [
                    r"(?:Gesch[äa]ftsf[üu]hrer|Inhaber|Eigent[üu]mer|CEO|Managing\s*Director|Firmeninhaber|Betriebsleiter)\s*:?\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß.\-]+){1,3})",
                    r"(?:Verantwortlich|V\.?i\.?S\.?d\.?P\.?|Medieninhaber)\s*:?\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß.\-]+){1,3})",
                ]
                for pat in patterns:
                    m = re.search(pat, text)
                    if m:
                        name_candidate = m.group(1).strip()
                        # Validierung: muss Vor- + Nachname sein (mind. 2 Wörter)
                        if len(name_candidate.split()) >= 2 and len(name_candidate) < 60:
                            out["owner"] = name_candidate
                            break

            # Firmenbuch
            if not out["firmenbuch"]:
                fn = re.search(r"FN\s*\d{3,7}\s*[a-z]", text, re.I)
                if fn:
                    out["firmenbuch"] = fn.group(0).strip()

            # UID
            if not out["uid"]:
                uid = re.search(r"ATU\d{8}", text)
                if uid:
                    out["uid"] = uid.group(0)

            # Telefonnummern
            for tel in soup.select("a[href^='tel:']"):
                num = tel["href"].replace("tel:", "").strip()
                if num and len(num) > 5:
                    all_phones.add(num)
            # Auch Telefon-Patterns im Text
            for tel_match in re.findall(r"(?:Tel|Telefon|Phone|Fon|Mobil)\s*\.?\s*:?\s*([\+\d\s/\-\(\)]{8,20})", text):
                cleaned = tel_match.strip()
                if cleaned and len(cleaned) > 6:
                    all_phones.add(cleaned)

            # Emails
            for mail in soup.select("a[href^='mailto:']"):
                em = mail["href"].replace("mailto:", "").split("?")[0].strip().lower()
                if em and "@" in em:
                    all_emails.add(em)
            # Auch Email-Patterns im Text
            for em_match in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", text):
                all_emails.add(em_match.lower())

        except Exception:
            continue

    out["phones"] = list(all_phones)[:8]
    out["emails"] = list(all_emails)[:8]

    # IMMER auch Startseite durchsuchen (hat oft Kontaktdaten im Footer)
    try:
        resp = requests.get(base, headers=SEARCH_HEADERS, timeout=6, allow_redirects=True)
        if resp.status_code == 200:
            soup = BeautifulSoup(resp.text, "html.parser")
            text = soup.get_text(" ", strip=True)
            # GF von Startseite
            if not out["owner"]:
                for pat in [
                    r"(?:Gesch[äa]ftsf[üu]hrer|Inhaber|Eigent[üu]mer|CEO)\s*:?\s*([A-ZÄÖÜ][a-zäöüß]+(?:\s+[A-ZÄÖÜ][a-zäöüß.\-]+){1,3})",
                ]:
                    m = re.search(pat, text)
                    if m and len(m.group(1).split()) >= 2:
                        out["owner"] = m.group(1).strip()
                        break
            # Telefone von Startseite
            for tel in soup.select("a[href^='tel:']"):
                num = tel["href"].replace("tel:", "").strip()
                if num and len(num) > 5:
                    all_phones.add(num)
            for tel_match in re.findall(r"(?:Tel|Telefon|Phone|Fon|Mobil|Handy)\s*\.?\s*:?\s*([\+\d\s/\-\(\)]{8,20})", text):
                cleaned = tel_match.strip()
                if cleaned and len(cleaned) > 6:
                    all_phones.add(cleaned)
            # Emails von Startseite
            for mail in soup.select("a[href^='mailto:']"):
                em = mail["href"].replace("mailto:", "").split("?")[0].strip().lower()
                if em and "@" in em:
                    all_emails.add(em)
            for em_match in re.findall(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}", text):
                all_emails.add(em_match.lower())
    except Exception:
        pass

    out["phones"] = list(all_phones)[:8]
    out["emails"] = list(all_emails)[:8]

    # DuckDuckGo als letzte Quelle für Telefon + GF
    if not out["phones"] or not out["owner"]:
        try:
            domain_name = parsed.netloc.replace("www.", "")
            ddg_results = _ddg_search(f'"{domain_name}" telefon OR phone OR kontakt')
            for r in ddg_results[:5]:
                snippet = r.get("snippet", "") + " " + r.get("title", "")
                # Telefon aus Snippets
                if not out["phones"]:
                    for tel_match in re.findall(r"(\+43[\d\s/\-]{6,16}|0\d{3,4}[\s/\-]?\d{3,8})", snippet):
                        cleaned = tel_match.strip()
                        if cleaned and cleaned not in out["phones"]:
                            out["phones"].append(cleaned)
                # GF aus Snippets
                if not out["owner"]:
                    m = re.search(r"(?:Inhaber|Gesch[äa]ftsf[üu]hrer|CEO)\s*:?\s*([A-ZÄÖÜ][a-zäöüß]+\s+[A-ZÄÖÜ][a-zäöüß]+)", snippet)
                    if m:
                        out["owner"] = m.group(1).strip()
        except Exception:
            pass

    return out


def _footprint_domain(website):
    """Domain-Info: Server-Header, Hosting-Erkennung, SSL-Details."""
    out = {"domain": None, "registeredSince": None, "hostingProvider": None,
           "server": None, "protocol": None, "sslIssuer": None}
    if not website:
        return out
    try:
        if not website.startswith(("http://", "https://")):
            website = "https://" + website
        domain = urlparse(website).netloc
        out["domain"] = domain

        # HTTP Headers für Server-Info
        try:
            resp = requests.head(website, timeout=6, allow_redirects=True,
                                 headers={"User-Agent": "Mozilla/5.0"})
            headers = resp.headers
            out["server"] = headers.get("Server", "")
            out["protocol"] = "HTTP/2" if resp.raw.version == 20 else "HTTP/1.1"

            # Hosting erkennen aus Headers
            if "cloudflare" in str(headers).lower():
                out["hostingProvider"] = "Cloudflare"
            elif "nginx" in out["server"].lower():
                out["hostingProvider"] = "Nginx Server"
            elif "apache" in out["server"].lower():
                out["hostingProvider"] = "Apache Server"
            elif "litespeed" in out["server"].lower():
                out["hostingProvider"] = "LiteSpeed"

            # CDN erkennen
            cdn_headers = ["x-cdn", "x-cache", "cf-ray", "x-fastly-request-id", "x-amz-cf-id"]
            for h in cdn_headers:
                if h in (k.lower() for k in headers.keys()):
                    out["cdn"] = True
                    break
        except Exception:
            pass

        # Website-Alter aus Wayback Machine (zuverlässigste Quelle)
        try:
            ts_resp = requests.get(
                f"https://archive.org/wayback/available?url={domain}&timestamp=19900101",
                timeout=8
            )
            if ts_resp.status_code == 200:
                ts_data = ts_resp.json()
                snap = ts_data.get("archived_snapshots", {}).get("closest", {})
                if snap.get("timestamp"):
                    ts = snap["timestamp"]
                    out["registeredSince"] = f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}"
        except Exception:
            pass

        # Fallback: DuckDuckGo WHOIS
        if not out["registeredSince"]:
            try:
                results = ddg_rate_limited(f"{domain} whois registered created")
                for r in results[:3]:
                    text = r.get("title", "") + " " + r.get("snippet", "")
                    d = re.search(r"(?:Creat|Regist)\w*\s*(?:Date|on)?\s*:?\s*(\d{4}-\d{2}-\d{2})", text, re.I)
                    if d:
                        out["registeredSince"] = d.group(1)
                        break
            except Exception:
                pass

    except Exception:
        pass
    return out


def _footprint_wayback(website):
    """Prüft web.archive.org für Website-Historie."""
    out = {"available": False, "firstSnapshot": None, "snapshotUrl": None, "totalSnapshots": None}
    if not website:
        return out
    try:
        if not website.startswith(("http://", "https://")):
            website = "https://" + website
        domain = urlparse(website).netloc
        resp = requests.get(f"https://archive.org/wayback/available?url={domain}", timeout=8)
        if resp.status_code == 200:
            data = resp.json()
            snap = (data.get("archived_snapshots") or {}).get("closest") or {}
            if snap.get("available"):
                out["available"] = True
                out["snapshotUrl"] = snap.get("url")
                out["firstSnapshot"] = snap.get("timestamp")
        # Anzahl Snapshots über timemap
        try:
            tm = requests.get(
                f"http://web.archive.org/web/timemap/json?url={domain}&output=json",
                timeout=8,
            )
            if tm.status_code == 200:
                rows = tm.json()
                if isinstance(rows, list) and len(rows) > 1:
                    out["totalSnapshots"] = len(rows) - 1  # erste Zeile = Header
                    first = rows[1]
                    # timestamp-Spalte suchen
                    for cell in first:
                        if re.fullmatch(r"\d{14}", str(cell)):
                            out["firstSnapshot"] = out["firstSnapshot"] or str(cell)
                            break
        except Exception:
            pass
    except Exception:
        pass
    return out


def _footprint_indexed_pages(website):
    """Zählt wie viele Seiten bei Suchmaschinen indexiert sind."""
    out = {"estimatedPages": 0, "indexedUrls": []}
    if not website:
        return out
    try:
        if not website.startswith(("http://", "https://")):
            website = "https://" + website
        domain = urlparse(website).netloc
        results = _ddg_search(f"site:{domain}")
        out["estimatedPages"] = len(results)
        out["indexedUrls"] = [r["url"] for r in results[:10]]
    except Exception:
        pass
    return out


def _footprint_blog(website):
    """Prüft ob die Website einen Blog/News Bereich hat."""
    out = {"hasBlog": False, "blogUrl": None, "lastPostDate": None}
    if not website:
        return out
    if not website.startswith(("http://", "https://")):
        website = "https://" + website
    try:
        parsed = urlparse(website)
        base = f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return out
    for path in ("/blog", "/news", "/aktuelles", "/magazin", "/journal"):
        try:
            h = requests.head(base + path, headers=SEARCH_HEADERS, timeout=6, allow_redirects=True)
            if h.status_code == 405:
                h = requests.get(base + path, headers=SEARCH_HEADERS, timeout=6, allow_redirects=True)
            if h.status_code < 400:
                out["hasBlog"] = True
                out["blogUrl"] = base + path
                try:
                    page = requests.get(base + path, headers=SEARCH_HEADERS, timeout=8, allow_redirects=True)
                    if page.status_code == 200:
                        soup = BeautifulSoup(page.text, "html.parser")
                        t = soup.find("time")
                        if t:
                            out["lastPostDate"] = t.get("datetime") or t.get_text(strip=True)
                        else:
                            m = re.search(r"\d{1,2}\.\s*\w+\s*\d{4}|\d{4}-\d{2}-\d{2}", page.text)
                            if m:
                                out["lastPostDate"] = m.group(0)
                except Exception:
                    pass
                break
        except Exception:
            continue
    return out


def _footprint_review_portals(name, location):
    """Sucht auf Kununu, TrustPilot, ProvenExpert."""
    portals = [
        ("Kununu", "kununu.com"),
        ("TrustPilot", "trustpilot.com"),
        ("ProvenExpert", "provenexpert.com"),
    ]
    out = []
    for disp, dom in portals:
        try:
            results = _ddg_search(f'"{name}" site:{dom}')
            found_url = None
            for r in results:
                if dom in r["url"].lower():
                    found_url = r["url"]
                    break
            out.append({"name": disp, "url": found_url, "found": found_url is not None})
        except Exception:
            out.append({"name": disp, "url": None, "found": False})
    return out


def _footprint_backlinks(website):
    """Schätzt Backlinks durch Suche nach der Domain."""
    out = {"estimatedBacklinks": 0, "sources": []}
    if not website:
        return out
    try:
        if not website.startswith(("http://", "https://")):
            website = "https://" + website
        domain = urlparse(website).netloc
        results = _ddg_search(f'"{domain}" -site:{domain}')
        out["estimatedBacklinks"] = len(results)
        out["sources"] = [r["url"] for r in results[:5]]
    except Exception:
        pass
    return out


def _build_conversation_guide(company, analysis, web_extras, social_media, reviews_info, location):
    """Strukturierter Gesprächsleitfaden für den Vertrieb."""
    owner = company.get("owner")
    anrede = f"Herr/Frau {owner}" if owner else "Herr/Frau [Name]"

    pain_points = []
    lt = analysis.get("loadTime")
    if lt and lt >= 3:
        pain_points.append(f"Ihre Website lädt in {lt} Sekunden — das kostet Sie Besucher.")
    if not analysis.get("https"):
        pain_points.append("Sie haben kein HTTPS — der Browser warnt Besucher vor Ihrer Seite.")
    if not analysis.get("hasMobile"):
        pain_points.append("Ihre Website ist nicht für Smartphones optimiert.")
    if not analysis.get("metaDescription"):
        pain_points.append("Es fehlt eine Meta Description — Google zeigt nur zufälligen Text.")
    if not (web_extras["trackingCodes"].get("googleAnalytics") or web_extras["trackingCodes"].get("googleTagManager")):
        pain_points.append("Sie haben kein Website-Tracking — Sie sehen nicht, woher Besucher kommen.")

    icebreaker = "Ich habe gesehen, dass Sie online schon gut aufgestellt sind"
    if reviews_info:
        icebreaker = f"Ich habe gesehen, dass Sie bereits {reviews_info} haben — Glückwunsch!"
    elif analysis.get("title"):
        icebreaker = f"Ich bin auf Ihre Website gestoßen ({analysis.get('title')[:50]}) und mir ist etwas aufgefallen."

    last_mod = web_extras.get("lastModified")
    urgency = "Eine veraltete Website verliert kontinuierlich an Ranking."
    if last_mod:
        urgency = f"Ihre Website wurde laut Server zuletzt am {last_mod} aktualisiert."

    return {
        "opening": f"Guten Tag {anrede}, mein Name ist [Ihr Name] von seo.solutions.",
        "icebreaker": icebreaker,
        "painPoints": pain_points or ["Wir haben Ihre Online-Präsenz analysiert und einige Potenziale gefunden."],
        "solution": "Wir könnten für Sie diese Punkte beheben und Ihre Sichtbarkeit bei Google deutlich steigern.",
        "urgency": urgency,
        "competitorHint": f"Ihre Mitbewerber in {location or 'Ihrer Region'} haben in diesen Bereichen bereits aufgerüstet." if location else "Ihre Mitbewerber haben in diesen Bereichen bereits aufgerüstet.",
    }


def _build_seo_explanations(analysis):
    """Baut seoExplanations Array aus quick_analyze Ergebnis."""
    title = analysis.get("title", "")
    meta = analysis.get("metaDescription", "")
    exp = []

    def add(factor, status, score, maxScore, explanation):
        exp.append({"factor": factor, "status": status, "score": score,
                    "maxScore": maxScore, "explanation": explanation})

    # Title
    if not title:
        add("Title Tag", "missing", 0, 14, "Der Title Tag ist der wichtigste SEO-Faktor — er fehlt, dadurch erscheint die Seite ohne aussagekräftigen Titel in Google.")
    elif 30 <= len(title) <= 65:
        add("Title Tag", "good", 14, 14, "Der Title Tag hat die ideale Länge und wird in Google vollständig angezeigt.")
    else:
        add("Title Tag", "bad", 7, 14, "Der Title Tag ist vorhanden, aber zu kurz oder zu lang — optimal sind 30 bis 65 Zeichen.")

    # Meta Description
    if not meta:
        add("Meta Description", "missing", 0, 13, "Ohne Meta Description zeigt Google einen zufälligen Textausschnitt statt Ihrer Werbebotschaft.")
    elif 120 <= len(meta) <= 160:
        add("Meta Description", "good", 13, 13, "Die Meta Description hat die ideale Länge und wirbt aktiv für Klicks aus den Suchergebnissen.")
    else:
        add("Meta Description", "bad", 7, 13, "Die Meta Description ist vorhanden, sollte aber 120 bis 160 Zeichen umfassen.")

    # HTTPS
    if analysis.get("https"):
        add("HTTPS / SSL", "good", 12, 12, "Die Seite ist verschlüsselt — das schützt Besucherdaten und ist ein Google-Ranking-Faktor.")
    else:
        add("HTTPS / SSL", "missing", 0, 12, "Ohne SSL-Verschlüsselung warnt der Browser vor der Seite und Google stuft sie schlechter ein.")

    # Mobile
    if analysis.get("hasMobile"):
        add("Mobile-Optimierung", "good", 10, 10, "Die Seite ist für Smartphones optimiert — über die Hälfte aller Besucher kommt mobil.")
    else:
        add("Mobile-Optimierung", "missing", 0, 10, "Die Seite ist nicht für Smartphones optimiert, dadurch springen mobile Besucher schnell ab.")

    # H1
    h1 = analysis.get("h1Tags") or []
    if len(h1) == 1:
        add("H1 Überschrift", "good", 9, 9, "Es gibt genau eine Hauptüberschrift — so versteht Google sofort, worum es auf der Seite geht.")
    elif len(h1) == 0:
        add("H1 Überschrift", "missing", 0, 9, "Es fehlt eine Hauptüberschrift (H1) — Google fehlt dadurch das zentrale Thema der Seite.")
    else:
        add("H1 Überschrift", "bad", 5, 9, "Es gibt mehrere H1-Überschriften — für klare SEO-Signale sollte nur eine verwendet werden.")

    # Content
    words = analysis.get("wordCount", 0)
    if words >= 300:
        add("Textinhalt", "good", 10, 10, f"Mit {words} Wörtern bietet die Seite genug Inhalt, damit Google sie thematisch einordnen kann.")
    else:
        add("Textinhalt", "bad", 3, 10, f"Mit nur {words} Wörtern hat die Seite zu wenig Inhalt — Google bevorzugt ausführlichere Seiten.")

    # Speed
    lt = analysis.get("loadTime", 0)
    if lt and lt < 3:
        add("Ladezeit", "good", 8, 8, f"Die Seite lädt in {lt}s — schnell genug, damit Besucher nicht abspringen.")
    else:
        add("Ladezeit", "bad", 2, 8, f"Die Seite lädt in {lt}s — jede Sekunde über 3s kostet Besucher und Ranking.")

    # Schema
    if analysis.get("hasSchema"):
        add("Strukturierte Daten", "good", 5, 5, "Strukturierte Daten (Schema.org) helfen Google, Rich-Ergebnisse wie Sterne anzuzeigen.")
    else:
        add("Strukturierte Daten", "missing", 0, 5, "Es fehlen strukturierte Daten — dadurch kann Google keine Rich-Snippets wie Bewertungssterne zeigen.")

    return exp


def _build_sales_tips(analysis, web_extras, social_media, directories, google_presence):
    tips = []
    lt = analysis.get("loadTime")
    if lt and lt >= 3:
        tips.append(f"Die Website lädt in {lt} Sekunden — jede Sekunde über 3s kostet ca. 7% der Besucher.")
    if not analysis.get("metaDescription"):
        tips.append("Es fehlt eine Meta Description — das bedeutet Google zeigt einen zufälligen Textausschnitt statt Ihrer Werbebotschaft.")
    if not analysis.get("https"):
        tips.append("Keine SSL-Verschlüsselung — der Browser warnt Besucher vor der Seite und Google stuft sie ab.")
    if not analysis.get("hasMobile"):
        tips.append("Die Website ist nicht für Smartphones optimiert — über die Hälfte aller Besucher kommt mobil.")
    if not web_extras["trackingCodes"]["facebookPixel"]:
        tips.append("Kein Facebook Pixel — Online-Werbung ist dadurch deutlich weniger effektiv.")
    if not (web_extras["trackingCodes"]["googleAnalytics"] or web_extras["trackingCodes"]["googleTagManager"]):
        tips.append("Kein Website-Tracking installiert — Sie sehen nicht, woher Ihre Besucher kommen oder was sie tun.")
    if not analysis.get("hasSchema"):
        tips.append("Keine strukturierten Daten — Google kann keine Bewertungssterne direkt in den Suchergebnissen anzeigen.")
    if not web_extras["hasSitemap"]:
        tips.append("Keine Sitemap gefunden — Google findet dadurch möglicherweise nicht alle Unterseiten.")
    missing_social = [s["platform"] for s in social_media if not s["found"]]
    if missing_social:
        tips.append(f"Kein Profil auf {', '.join(missing_social)} gefunden — hier verschenken Sie Reichweite an die Konkurrenz.")
    missing_dirs = [d["name"] for d in directories if not d["found"]]
    if missing_dirs:
        tips.append(f"Kein Eintrag in {', '.join(missing_dirs)} — diese Verzeichnisse bringen lokale Sichtbarkeit und Backlinks.")
    if not google_presence.get("reviewsInfo"):
        tips.append("Keine Google-Bewertungen gefunden — Bewertungen sind der wichtigste Vertrauensfaktor für Neukunden.")
    return tips


@app.post("/api/company/footprint")
def company_footprint():
    body = request.get_json() or {}
    name = (body.get("name") or "").strip()
    location = (body.get("location") or "").strip()
    website = (body.get("website") or "").strip()
    phone = (body.get("phone") or "").strip()
    email = (body.get("email") or "").strip()

    if not name:
        return jsonify({"error": "name ist erforderlich"}), 400

    cache_key = f"footprint:{name.lower()}:{location.lower()}"
    cached = cache_get(cache_key)
    if cached is not None:
        cached = dict(cached)
        cached["cached"] = True
        return jsonify(cached)

    # Jede Aufgabe als (key, callable) — alle parallel im ThreadPoolExecutor.
    # Kleines Delay pro DDG-Query zur Rate-Limit-Vermeidung.
    ddg_lock = threading.Lock()

    def ddg_rate_limited(fn, *args):
        with ddg_lock:
            time.sleep(0.3)
        return fn(*args)

    social_targets = [
        ("Facebook", "facebook.com"), ("Instagram", "instagram.com"),
        ("LinkedIn", "linkedin.com"), ("YouTube", "youtube.com"),
        ("TikTok", "tiktok.com"),
    ]
    directory_targets = [
        ("Herold.at", "herold.at"), ("FirmenABC.at", "firmenabc.at"),
        ("GelbeSeiten.at", "gelbeseiten.at"), ("Yelp.at", "yelp.at"),
    ]

    tasks = {}
    with ThreadPoolExecutor(max_workers=8) as pool:
        tasks["wko"] = pool.submit(_footprint_wko_detail, name, location)
        if website:
            tasks["analysis"] = pool.submit(quick_analyze, website)
            tasks["web_extras"] = pool.submit(_footprint_website_extras, website)
            tasks["impressum"] = pool.submit(_footprint_impressum, website)
            tasks["domain"] = pool.submit(ddg_rate_limited, _footprint_domain, website)
            tasks["wayback"] = pool.submit(_footprint_wayback, website)
            tasks["indexed"] = pool.submit(ddg_rate_limited, _footprint_indexed_pages, website)
            tasks["blog"] = pool.submit(_footprint_blog, website)
            tasks["backlinks"] = pool.submit(ddg_rate_limited, _footprint_backlinks, website)
        tasks["facebookAds"] = pool.submit(ddg_rate_limited, _footprint_facebook_ads, name, location)
        tasks["reviewPortals"] = pool.submit(ddg_rate_limited, _footprint_review_portals, name, location)
        for plat, dom in social_targets:
            tasks[f"social:{plat}"] = pool.submit(ddg_rate_limited, _footprint_social, name, plat, dom)
        for disp, dom in directory_targets:
            tasks[f"dir:{disp}"] = pool.submit(ddg_rate_limited, _footprint_directory, name, disp, dom)
        tasks["maps"] = pool.submit(ddg_rate_limited, _footprint_maps, name, location)
        tasks["reviews"] = pool.submit(ddg_rate_limited, _footprint_reviews, name, location)

        def res(key, default=None):
            f = tasks.get(key)
            if not f:
                return default
            try:
                return f.result(timeout=10)
            except Exception:
                return default

        wko = res("wko") or {}
        analysis = res("analysis") or {}
        web_extras = res("web_extras") or {
            "hasSitemap": False, "hasRobotsTxt": False, "lastModified": None,
            "socialLinksOnSite": [],
            "trackingCodes": {"googleAnalytics": False, "googleTagManager": False,
                              "facebookPixel": False, "googleAds": False}}
        social_media = [res(f"social:{p}", {"platform": p, "url": None, "found": False}) for p, _ in social_targets]
        directories = [res(f"dir:{d}", {"name": d, "url": None, "found": False}) for d, _ in directory_targets]
        maps_url = res("maps")
        reviews_info = res("reviews")
        facebook_ads = res("facebookAds") or {"adsLibraryUrl": None, "foundInSearch": False, "searchResults": []}
        impressum = res("impressum") or {"found": False, "url": None, "owner": None,
                                         "firmenbuch": None, "uid": None, "phones": [], "emails": []}
        domain_info = res("domain") or {"domain": None, "registrationDate": None,
                                        "hostingProvider": None, "searchResults": []}
        wayback = res("wayback") or {"available": False, "firstSnapshot": None,
                                     "snapshotUrl": None, "totalSnapshots": None}
        indexed_pages = res("indexed") or {"estimatedPages": 0, "indexedUrls": []}
        blog = res("blog") or {"hasBlog": False, "blogUrl": None, "lastPostDate": None}
        backlinks = res("backlinks") or {"estimatedBacklinks": 0, "sources": []}
        review_portals = res("reviewPortals") or []

    # Firmen-Stammdaten zusammenführen (Request-Werte haben Vorrang, WKO ergänzt)
    phones = []
    if phone:
        phones.append(phone)
    for p in wko.get("phones", []):
        if p not in phones:
            phones.append(p)
    emails = []
    if email:
        emails.append(email)
    for e in wko.get("emails", []):
        if e not in emails:
            emails.append(e)
    # Impressum-Kontaktdaten ergänzen
    for p in impressum.get("phones", []):
        if p not in phones:
            phones.append(p)
    for e in impressum.get("emails", []):
        if e not in emails:
            emails.append(e)

    final_website = website or wko.get("website", "")

    website_block = dict(analysis)
    website_block.update({
        "hasSitemap": web_extras["hasSitemap"],
        "hasRobotsTxt": web_extras["hasRobotsTxt"],
        "lastModified": web_extras["lastModified"],
        "socialLinksOnSite": web_extras["socialLinksOnSite"],
        "trackingCodes": web_extras["trackingCodes"],
    })

    google_presence = {"mapsUrl": maps_url, "reviewsInfo": reviews_info}

    company = {
        "name": name,
        "owner": wko.get("owner") or impressum.get("owner"),
        "phones": phones,
        "emails": emails,
        "address": wko.get("address") or location,
        "website": final_website,
        "category": wko.get("category", ""),
        "uid": wko.get("uid") or impressum.get("uid"),
        "firmenbuch": impressum.get("firmenbuch"),
    }

    response = {
        "company": company,
        "website": website_block,
        "socialMedia": social_media,
        "googlePresence": google_presence,
        "directories": directories,
        "facebookAds": facebook_ads,
        "impressum": impressum,
        "domainInfo": domain_info,
        "wayback": wayback,
        "indexedPages": indexed_pages,
        "blog": blog,
        "reviews": review_portals,
        "backlinks": backlinks,
        "seoExplanations": _build_seo_explanations(analysis) if website else [],
        "salesTips": _build_sales_tips(analysis, web_extras, social_media, directories, google_presence) if website else [],
        "conversationGuide": _build_conversation_guide(company, analysis, web_extras, social_media, reviews_info, location) if website else {},
    }

    cache_set(cache_key, response)
    return jsonify(response)


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
