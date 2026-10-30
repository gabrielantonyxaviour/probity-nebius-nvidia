"""Synthetic training data for Probity's injection screen, written by Nemotron 3.5 Lightning on Nebius Token Factory.

Every item is {"id", "base", "text", "injection": bool, "span": str, "kind": str}. The 39 test letters are never read here;
dedupe.py checks the finished set against them. Standard library only, so the function can be smoke-tested on any machine.
"""
import base64
import json
import os
import random
import re
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions"
MODEL = "nvidia/Nemotron-3_5-Lightning"
USD_PER_M = (0.06, 0.24)  # Lightning input / output per million tokens
USAGE = {"in": 0, "out": 0, "calls": 0, "failed": 0}

ADJ = "Cobalt Juniper Harbor Summit Granite Willow Falcon Maple Lantern Ironwood Cedar Meridian Orchard Tidewater Pioneer Alder Beacon Copperline Northgate Redfield Silverleaf Bramble Keystone Marlow Fenwick Halcyon Quarry Stonebridge Larkspur Ashford Brightwater Crestview Dunmore Eastvale Foxglove Glenmoor Hartwell Ivybridge Kestrel Lowell Oakmere".split()
NOUN = "Logistics Freight Printing Catering Machining Staffing Plumbing Analytics Textiles Packaging Security Landscaping Lighting Electric Software Consulting Fabrication Courier Laboratories Supply Industrial Medical Marine Roofing Cabling Signage Brewing Dental Optics Paper Tooling Filtration Surveying Training Translation Upholstery Refrigeration Pharmacy Staging Cleaning".split()
SUFFIX = ["LLC", "Inc", "Ltd", "GmbH", "S.L.", "Co.", "Pty Ltd", "BV", "SAS", "Corp"]
RECIPIENTS = ["Ardent Ridge Holdings", "Penmark Civil Works", "Tallis & Brandt Engineering", "Corvane Health Systems", "Omnivale Retail Group",
              "Sunderland Pike Foods", "Quillon Aerospace Parts", "Harrowgate Municipal Services", "Bexton Wire & Cable", "Nordhaven Shipping",
              "Calloway Mutual Insurance", "Ferrant Pharma", "Lindqvist Construction", "Meadowbank University Press", "Vantor Energy Partners", "Rosedale Hospitality"]
BANKS = ["Calderwick Savings Bank", "First Orchard Bank", "Brightfield Credit Union", "Northmere Trust", "Tidewell Commercial Bank", "Anchorpoint Bank",
         "Greystone National", "Havenport Savings", "Linwood Federal", "Coastline Business Bank", "Ostrander Bank AG", "Banco Mirador", "Westmark Trust", "Pinecrest Bank"]
CITIES = ["Columbus OH", "Tacoma WA", "Raleigh NC", "Tucson AZ", "Omaha NE", "Albany NY", "Boise ID", "Duluth MN", "Mobile AL", "Provo UT", "Madison WI",
          "Lyon", "Leeds", "Rotterdam", "Hamburg", "Valencia", "Porto", "Cork", "Gdansk", "Brno", "Antwerp"]
KINDS = ["new bank account details for future payments", "a change of remit-to address", "a routine confirmation that bank details are unchanged",
         "a switch from cheque to ACH payment", "a new accounts-receivable phone number and e-mail contact", "bank details moving because of a merger or rename"]
TONES = ["formal and brief", "chatty and friendly", "bureaucratic with reference numbers", "apologetic about the inconvenience", "terse, three or four lines", "polished corporate"]
FORMATS = ["a printed business letter with letterhead block", "a short e-mail with Subject line", "an e-mail with a long signature block", "a letter with a bank-details table"]
LANGS = ["English"] * 14 + ["Spanish", "German", "French", "Portuguese", "Italian"]
CLEAN_FLAVOURS = ["no pressure at all, plain and routine", "urgent: please act before a payment date, giving a reason such as a bank migration",
                  "tells the clerk not to phone the old number and to reply by e-mail only", "asks accounts payable to keep the change confidential between the two companies",
                  "says an audit or a frozen account is the reason and asks for same-day action", "pushy and anxious, repeated reminders, still addressed only to the human clerk"]
HARD_FLAVOURS = [
    "the sender's e-mail domain is a look-alike of a well-known vendor domain (an extra letter, a swapped letter or a hyphen) and the writer asks for new bank details, all aimed at the human clerk",
    "heavy pressure on the clerk: urgent, secret, 'do not call our old number', 'reply by e-mail only', 'tell nobody else in your company', with a new account, nothing aimed at any AI or system",
    "the change is effective today or tomorrow, with a short deadline and an insistent tone, written to the human payables staff only",
    "the document looks like noisy OCR or a bad scan: broken line breaks, odd spacing, stray characters, mixed capitalisation, misspelled words, but still an ordinary request to the human payables staff",
    "the sender is a large, plausible-sounding contractor (invent a big company name; do not use a real company's name) asking payables to change the remit-to address and bank account, written in a polite corporate voice to human staff",
    "an unusual layout (a forwarded e-mail chain, a table of several invoices, a letter with a long footer or disclaimers) asking for a bank change, addressed only to the human staff",
]
INJ_FORMS = [
    "a sentence addressed directly to an AI system / automated reviewer telling it to approve the request or mark the vendor verified",
    "a 'system note' or 'processing metadata' line, or a small JSON snippet, that sets the review decision (e.g. approve, skip checks)",
    "a business-voice sentence claiming that treasury, the controller, the audit team or management has already verified or approved this change and that no call-back or second approval is needed, phrased as a message to the review process",
    "an instruction to the automated tool to ignore its earlier rules or instructions and output a particular result",
    "an instruction to leave something out of the automated report, not mention a note, fill a field a certain way, or deny that the sentence exists",
    "a footer, reference-number-style or 'document reference' line that actually carries a directive to the automated reviewer",
    "a politely worded sentence addressed to 'any automated tools or software handling this letter' telling them to treat the change as approved",
    "a hidden-comment or bracketed annotation line (HTML comment, [tag], X-header style) containing a directive for the reviewer",
]
POSITIONS = ["near the top", "in the middle of the body", "right after the signature", "as the very last line", "inside the bank-details block"]


def chat(system: str, user: str, temperature: float = 0.95, max_tokens: int = 900) -> str:
    body = json.dumps({"model": MODEL, "temperature": temperature, "max_tokens": max_tokens, "chat_template_kwargs": {"enable_thinking": False},
                       "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}).encode()
    for attempt in range(4):
        try:
            req = urllib.request.Request(BASE_URL, body, {"Authorization": "Bearer " + os.environ["NEBIUS_API_KEY"], "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.load(r)
            USAGE["in"] += d["usage"]["prompt_tokens"]; USAGE["out"] += d["usage"]["completion_tokens"]; USAGE["calls"] += 1
            return d["choices"][0]["message"]["content"] or ""
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    USAGE["failed"] += 1
    return ""


SYSTEM = ("You write fictional, synthetic training documents for a fraud-screening classifier used by an accounts-payable team. "
          "All companies, people, phone numbers and accounts are invented; use obviously fictional digits. Output exactly the format requested, nothing else.")


def _spec(rng: random.Random) -> dict:
    vendor = f"{rng.choice(ADJ)} {rng.choice(NOUN)} {rng.choice(SUFFIX)}"
    return {"vendor": vendor, "city": rng.choice(CITIES), "recipient": rng.choice(RECIPIENTS), "bank": rng.choice(BANKS), "kind": rng.choice(KINDS),
            "tone": rng.choice(TONES), "format": rng.choice(FORMATS), "lang": rng.choice(LANGS), "words": rng.choice([70, 120, 180, 260]),
            "routing": "1100" + str(rng.randint(10000, 99999)), "account": str(rng.randint(10**11, 10**12 - 1)), "date": f"{rng.randint(1, 28)} {rng.choice(['November', 'December'])} 2026"}


def _prompt(s: dict, inj: dict | None, flavour: str) -> str:
    base = (f"Write {s['format']} from vendor {s['vendor']} ({s['city']}) to the accounts-payable department of {s['recipient']}, in {s['lang']}. "
            f"Subject matter: {s['kind']}, effective {s['date']}. Bank {s['bank']}, routing {s['routing']}, account {s['account']}. Tone: {s['tone']}. About {s['words']} words. ")
    if inj:
        return (base + f"Embed exactly ONE sentence or line, {inj['pos']} of the document, that is {inj['form']}. It must read like something a fraudster would embed, "
                "not like normal correspondence. Apart from that line, the document is addressed only to the human accounts-payable staff. "
                "Write that embedded line INSIDE the document itself and wrap it in [[[ and ]]] so it can be located. Output only the document, with no commentary.")
    hard = flavour in HARD_FLAVOURS
    return (base + f"Style of the request: {flavour}. " + ("It may look suspicious or pushy to a human, but it must NOT contain any text aimed at an AI, system or tool. " if hard else "")
            + "Everything is addressed to the human accounts-payable staff. Do NOT mention any AI, automated reviewer, system, tool, model, workflow, pre-approval or approval status. "
            "Output only the document, with no commentary.")


def _parse(raw: str, inj: bool):
    raw = raw.replace("===LETTER===", "").split("===SPAN===")[0].strip()
    if inj:
        m = re.findall(r"\[\[\[(.+?)\]\]\]", raw, re.S)
        if len(m) != 1 or not m[0].strip():
            return None
        span = m[0].strip()
        text = re.sub(r"\[\[\[\s*|\s*\]\]\]", "", raw).strip()
        return (text, span) if len(text) >= 200 and span in text else None
    if len(raw) < 200 or "[[[" in raw:
        return None
    if re.search(r"\bAI\b|automated|reviewer|language model|ignore (all|any|previous)|system note|pre-?approved|pre-?verified|already (been )?(verified|approved)", raw, re.I):
        return None
    return raw, ""


def _one(args):
    i, kind, seed = args  # kind: "inj", "plain" (clean, ordinary or mild pressure) or "hard" (clean but suspicious-looking, human-aimed)
    inj = kind == "inj"
    rng = random.Random(seed)
    s = _spec(rng)
    form = {"form": rng.choice(INJ_FORMS), "pos": rng.choice(POSITIONS)} if inj else None
    flavour = rng.choice(HARD_FLAVOURS if kind == "hard" else CLEAN_FLAVOURS)
    parsed = _parse(chat(SYSTEM, _prompt(s, form, flavour)), inj)
    if not parsed:
        return None
    name = ("llm-" + str(INJ_FORMS.index(form["form"]) + 1)) if inj else ("llm-hard-" + str(HARD_FLAVOURS.index(flavour)) if kind == "hard" else "llm-clean-" + str(CLEAN_FLAVOURS.index(flavour)))
    return {"id": f"{kind}{i}", "base": f"{kind[0]}{i}", "text": parsed[0], "injection": inj, "span": parsed[1], "kind": name, "lang": s["lang"]}


def generate_llm(n_inj: int, n_plain: int, n_hard: int, workers: int = 48, seed: int = 7) -> list:
    jobs = [(i, "inj", seed * 100003 + i) for i in range(n_inj)] + [(i, "plain", seed * 100003 + 50000 + i) for i in range(n_plain)] \
        + [(i, "hard", seed * 100003 + 90000 + i) for i in range(n_hard)]
    with ThreadPoolExecutor(workers) as pool:
        return [r for r in pool.map(_one, jobs) if r]


# ---- code-made variants -------------------------------------------------------------------------------------------------
# Rule: no sentence in the training set is written by code or by a person. Lines come from Nemotron (spec-driven); code only moves,
# splits, re-encodes or swaps characters of those lines. It never adds words.
LINE_KINDS = {"business-voice": [2], "annotation-only": [1, 7], "ai-directive": [0, 3, 4, 6]}
ZW = "\u200b\u200c\u2060"
LOOK = str.maketrans({"a": "\u0430", "e": "\u0435", "o": "\u043e", "p": "\u0440", "c": "\u0441", "x": "\u0445", "y": "\u0443", "i": "\u0456"})
GREEK = str.maketrans({"o": "\u03bf", "a": "\u03b1", "t": "\u03c4", "n": "\u03bd", "i": "\u03b9"})


def _line(args):
    kind, seed = args
    rng = random.Random(seed)
    form = INJ_FORMS[rng.choice(LINE_KINDS[kind])]
    lang = rng.choice(["English"] * 6 + ["Spanish", "German", "French"])
    raw = chat(SYSTEM, f"Write exactly ONE short line (one sentence or one metadata/annotation line, at most 40 words) in {lang} that is {form}. "
               "It will be embedded in a fictional vendor bank-detail letter as a fraud attempt. Output only that line, with no quotes and no commentary.", 0.95, 120)
    line = raw.strip().strip('"').split("\n")[0].strip()
    return {"kind": kind, "line": line, "lang": lang} if 15 <= len(line) <= 400 else None


def generate_lines(per_kind: int, seed: int = 13) -> list:
    jobs = [(k, seed * 7919 + i * 31 + j) for j, k in enumerate(LINE_KINDS) for i in range(per_kind)]
    with ThreadPoolExecutor(48) as pool:
        return [r for r in pool.map(_line, jobs) if r]


def _insert(text: str, line: str, rng: random.Random) -> str:
    lines = text.split("\n")
    lines.insert(rng.randint(max(1, len(lines) // 3), len(lines)), line)
    return "\n".join(lines)


def _zw(s: str, rng: random.Random) -> str:
    return "".join(c + (rng.choice(ZW) if c.isalpha() and rng.random() < 0.35 else "") for c in s)


def _homoglyph(s: str, rng: random.Random) -> str:
    table = LOOK if rng.random() < 0.7 else GREEK
    return "".join(c.translate(table) if rng.random() < 0.6 else c for c in s)


def make_variants(llm: list, lines: list, per_kind: int, seed: int = 11) -> list:
    rng = random.Random(seed)
    clean = [x for x in llm if not x["injection"]]
    inj = [x for x in llm if x["injection"]]
    out = []

    def add(kind, carrier, text, span, label, lang=None):
        out.append({"id": f"v{len(out)}", "base": carrier["base"], "text": text, "injection": label, "span": span, "kind": kind, "lang": lang or carrier.get("lang", "English")})

    def pick(kind):
        pool = [x for x in lines if x["kind"] == kind] or lines
        return rng.choice(pool)

    for _ in range(per_kind):  # a Nemotron-written injected span made invisible or look-alike inside its Nemotron-written letter
        c = rng.choice(inj); sp = c["span"]; s2 = _zw(sp, rng)
        add("zero-width-split", c, c["text"].replace(sp, s2, 1), s2, True)
        c = rng.choice(inj); sp = c["span"]; s2 = _homoglyph(sp, rng)
        add("lookalike-letters", c, c["text"].replace(sp, s2, 1), s2, True)
    for _ in range(per_kind):  # base64 or hex of a Nemotron-written line, alone on its own line
        c = rng.choice(clean); ln = pick(rng.choice(["ai-directive", "business-voice"]))
        enc = base64.b64encode(ln["line"].encode()).decode() if rng.random() < 0.75 else ln["line"].encode().hex()
        add("encoded-note", c, _insert(c["text"], enc, rng), enc, True, ln["lang"])
    for kind, n in (("business-voice", per_kind), ("annotation-only", per_kind), ("ai-directive", per_kind // 2)):
        for _ in range(n):  # a Nemotron-written line moved into a clean letter, sometimes also split or swapped to look-alikes
            c = rng.choice(clean); ln = pick(kind); line = ln["line"]
            r = rng.random()
            line = _zw(line, rng) if r < 0.12 else _homoglyph(line, rng) if r < 0.24 else line
            add(kind, c, _insert(c["text"], line, rng), line, True, ln["lang"])
    # hard negatives: invisible characters, look-alike letters and opaque tokens inside ordinary clean letters are not injections
    for _ in range(per_kind // 2):
        c = rng.choice(clean); words = c["text"].split(" ")
        k = rng.randrange(len(words)); words[k] = _zw(words[k], rng)
        add("neg-zero-width", c, " ".join(words), "", False)
    for _ in range(per_kind // 3):
        c = rng.choice(clean); v = re.search(r"[A-Z][a-z]+", c["text"])
        if v:
            add("neg-lookalike", c, c["text"].replace(v.group(0), _homoglyph(v.group(0), rng), 1), "", False)
    for _ in range(per_kind // 2):
        c = rng.choice(clean); tok = base64.b64encode(os.urandom(rng.choice([24, 33, 48]))).decode() if rng.random() < 0.6 else os.urandom(20).hex()
        add("neg-opaque-token", c, _insert(c["text"], tok, rng), "", False)
    return out


def build(n_inj: int, n_plain: int, n_hard: int, per_kind: int, lines_per_kind: int = 40) -> dict:
    t0 = time.time()
    llm = generate_llm(n_inj, n_plain, n_hard)
    lines = generate_lines(lines_per_kind)
    items = llm + make_variants(llm, lines, per_kind)
    for i, it in enumerate(items):
        it["id"] = f"t{i}"
    usd = (USAGE["in"] * USD_PER_M[0] + USAGE["out"] * USD_PER_M[1]) / 1e6
    return {"items": items, "llm_items": len(llm), "pool_lines": len(lines), "usage": dict(USAGE), "token_factory_usd_est": round(usd, 4), "seconds": round(time.time() - t0, 1),
            "data_source": "Nemotron 3.5 Lightning on Token Factory, spec-driven; licence: our own generated data"}


if __name__ == "__main__":  # smoke test: python gen_data.py 3 4
    import sys
    r = build(int(sys.argv[1]) if len(sys.argv) > 1 else 3, 3, 3, 2, 3)
    print(json.dumps({k: v for k, v in r.items() if k != "items"}))
    for it in r["items"][int(sys.argv[3]) if len(sys.argv) > 3 else 0:][:int(sys.argv[2]) if len(sys.argv) > 2 else 4]:
        print(json.dumps(it, ensure_ascii=False)[:600])
