import json
import os
import sys
import random
import string
import time
import re
from pathlib import Path
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from flask import Flask, jsonify, request, send_from_directory, abort
from flask_cors import CORS

# Make sure the project root is on the path
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from ai.content_generator import generate_content, batch_generate_content, analyze_seo

app = Flask(__name__, static_folder=str(ROOT), static_url_path="")
CORS(app)

DB_FILE = ROOT / "db" / "data.json"


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


# ===== BUSINESS SEARCH (OpenStreetMap — kostenlos) =====

OSM_HEADERS = {"User-Agent": "seo.solutions/1.0 (contact@fuerst-software.com)"}

@app.post("/api/search/businesses")
def search_businesses():
    body = request.get_json() or {}
    query = body.get("query", "").strip()
    location = body.get("location", "").strip()
    radius = body.get("radius", 5000)

    if not query or not location:
        return jsonify({"error": "query and location are required"}), 400

    try:
        geo_resp = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": location, "format": "json", "limit": 1},
            headers=OSM_HEADERS,
            timeout=10,
        )
        geo_data = geo_resp.json()
        if not geo_data:
            return jsonify({"error": f"Ort nicht gefunden: {location}"}), 400

        lat = float(geo_data[0]["lat"])
        lon = float(geo_data[0]["lon"])

        overpass_query = f"""
        [out:json][timeout:15];
        (
          nwr["name"](around:{radius},{lat},{lon});
        );
        out center 60;
        """
        ov_resp = requests.post(
            "https://overpass-api.de/api/interpreter",
            data={"data": overpass_query},
            headers=OSM_HEADERS,
            timeout=20,
        )
        ov_data = ov_resp.json()

        query_lower = query.lower()
        businesses = []
        seen_names = set()

        for el in ov_data.get("elements", []):
            tags = el.get("tags", {})
            name = tags.get("name", "")
            if not name:
                continue

            category = (
                tags.get("shop") or tags.get("craft") or tags.get("office")
                or tags.get("amenity") or tags.get("tourism") or tags.get("leisure")
                or ""
            )
            all_tags = " ".join(str(v) for v in tags.values()).lower()
            if query_lower not in all_tags and query_lower not in name.lower():
                continue

            name_key = name.lower().strip()
            if name_key in seen_names:
                continue
            seen_names.add(name_key)

            addr_parts = [
                tags.get("addr:street", ""),
                tags.get("addr:housenumber", ""),
                tags.get("addr:postcode", ""),
                tags.get("addr:city", ""),
            ]
            address = " ".join(p for p in addr_parts if p).strip()

            businesses.append({
                "name": name,
                "address": address or location,
                "phone": tags.get("phone") or tags.get("contact:phone", ""),
                "website": tags.get("website") or tags.get("contact:website", ""),
                "email": tags.get("email") or tags.get("contact:email", ""),
                "category": category.replace("_", " ").title() if category else "",
                "rating": None,
            })

        businesses.sort(key=lambda b: (not b["website"], not b["phone"], b["name"]))

        return jsonify({"businesses": businesses[:40], "count": len(businesses)})

    except requests.RequestException as e:
        return jsonify({"error": f"Suche fehlgeschlagen: {str(e)}"}), 502


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
    port = int(os.environ.get("PORT", 3000))
    print(f"seo.solutions Python backend running on http://localhost:{port}")
    debug = os.environ.get("FLASK_ENV") != "production"
    app.run(host="0.0.0.0", port=port, debug=debug)
