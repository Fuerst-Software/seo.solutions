import anthropic
import json
import asyncio
from typing import Optional

ZONE_SYSTEM_PROMPTS = {
    "headline": (
        "Du bist ein SEO-Experte. Schreibe prägnante, keyword-optimierte Überschriften.\n"
        "Regeln: Max. 60 Zeichen. Enthält das Haupt-Keyword. Erzeugt Klicks. "
        "Nur die Überschrift zurückgeben, kein Kommentar."
    ),
    "text": (
        "Du bist ein SEO-Content-Autor. Schreibe informative, SEO-optimierte Texte.\n"
        "Regeln: Natürliche Keyword-Dichte. Leserfreundlich. Klare Struktur. "
        "Nur den Text zurückgeben."
    ),
    "meta": (
        "Du bist ein SEO-Experte für Meta Descriptions.\n"
        "Regeln: Exakt 150-160 Zeichen. Enthält das Haupt-Keyword. Erzeugt Klick-Lust. "
        "Endet nicht mitten im Satz. Nur die Description zurückgeben."
    ),
    "alt": (
        "Du bist ein SEO-Experte für Bild-Alt-Texte.\n"
        "Regeln: Max. 125 Zeichen. Beschreibt das Bild UND enthält Keywords. "
        "Natürlich klingend. Nur den Alt-Text zurückgeben."
    ),
    "title": (
        "Du bist ein SEO-Experte für Seiten-Titel.\n"
        "Regeln: 50-60 Zeichen. Keyword am Anfang. Markenname am Ende (falls bekannt). "
        "Nur den Titel zurückgeben."
    ),
}


def build_user_message(
    zone_type: str,
    prompt: Optional[str],
    current_content: Optional[str],
    keywords: Optional[str],
    lang: str,
) -> str:
    lang_note = "Write in English." if lang == "en" else "Schreibe auf Deutsch."
    parts = []
    if prompt:
        parts.append(f"Aufgabe: {prompt}")
    if keywords:
        parts.append(f"Ziel-Keywords: {keywords}")
    if current_content:
        parts.append(f"Aktueller Inhalt (verbessere/ersetze diesen):\n{current_content}")
    if not parts:
        parts.append(f"Erstelle SEO-optimierten {zone_type}-Inhalt.")
    parts.append(lang_note)
    return "\n\n".join(parts)


def generate_content(
    zone_type: str,
    prompt: str,
    current_content: str,
    api_key: str,
    model: str = "claude-opus-4-8",
    keywords: str = "",
    lang: str = "de",
) -> str:
    client = anthropic.Anthropic(api_key=api_key)

    system_prompt = ZONE_SYSTEM_PROMPTS.get(zone_type, ZONE_SYSTEM_PROMPTS["text"])
    user_message = build_user_message(zone_type, prompt, current_content, keywords, lang)

    with client.messages.stream(
        model=model,
        max_tokens=1024,
        thinking={"type": "adaptive"},
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    ) as stream:
        response = stream.get_final_message()

    text_block = next((b for b in response.content if b.type == "text"), None)
    return text_block.text.strip() if text_block else ""


def batch_generate_content(zones: list, api_key: str, model: str = "claude-opus-4-8") -> list:
    results = []
    for zone in zones:
        try:
            content = generate_content(
                zone_type=zone.get("type", "text"),
                prompt=zone.get("prompt", ""),
                current_content=zone.get("currentContent", ""),
                api_key=api_key,
                model=model,
                keywords=zone.get("keywords", ""),
                lang=zone.get("lang", "de"),
            )
            results.append({"zoneId": zone["id"], "content": content})
        except Exception as e:
            results.append({"zoneId": zone["id"], "content": None, "error": str(e)})
    return results


def analyze_seo(content: str, api_key: str, model: str = "claude-opus-4-8") -> dict:
    client = anthropic.Anthropic(api_key=api_key)

    with client.messages.stream(
        model=model,
        max_tokens=2048,
        thinking={"type": "adaptive"},
        system=(
            "Du bist ein SEO-Analyse-Experte. Analysiere den gegebenen Inhalt und gib strukturiertes JSON zurück.\n"
            'Format: { "score": 0-100, "suggestions": ["...", "..."], "improvedContent": "..." }\n'
            "Nur gültiges JSON zurückgeben, kein Kommentar davor oder danach."
        ),
        messages=[{"role": "user", "content": f"Analysiere diesen Inhalt für SEO:\n\n{content}"}],
    ) as stream:
        response = stream.get_final_message()

    text_block = next((b for b in response.content if b.type == "text"), None)
    try:
        return json.loads(text_block.text) if text_block else {}
    except json.JSONDecodeError:
        return {"score": 0, "suggestions": [], "improvedContent": content}
