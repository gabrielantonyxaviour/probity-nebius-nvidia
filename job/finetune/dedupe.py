"""Overlap check between every training item and every one of the 39 held-out test letters. Standard library only.

Three measures, each against every test letter: word 8-gram Jaccard of the whole text, character 5-gram Jaccard of the whole text, and
span containment (the share of the training item's injected span, as word 4-grams or character 12-grams, found inside a test letter).
The test letters are read for comparison only; nothing from them reaches the training set.
"""
import base64
import binascii
import re
import unicodedata

THRESH = {"word8_jaccard": 0.10, "char5_jaccard": 0.50, "span_containment": 0.50}
_ZW = dict.fromkeys(list(range(0x200B, 0x2010)) + list(range(0x202A, 0x202F)) + list(range(0x2060, 0x206A)) + [0xFEFF, 0xAD])
_LOOK = str.maketrans("аеорсухіοατνι", "aeopcyxioatni")
_B64 = re.compile(r"[A-Za-z0-9+/]{24,}={0,2}")


def norm(t: str) -> str:
    t = unicodedata.normalize("NFKC", t).translate(_ZW).translate(_LOOK).lower()
    extra = []
    for m in _B64.findall(t.replace("\n", " ")) + _B64.findall(t):
        try:
            extra.append(base64.b64decode(m + "=" * (-len(m) % 4)).decode("utf-8", "ignore"))
        except (binascii.Error, ValueError):
            pass
    return re.sub(r"\s+", " ", t + " " + " ".join(extra))


def wgrams(t: str, n: int) -> set:
    w = re.findall(r"\w+", t)
    return {tuple(w[i:i + n]) for i in range(len(w) - n + 1)}


def cgrams(t: str, n: int) -> set:
    return {t[i:i + n] for i in range(len(t) - n + 1)}


def jac(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def prepare_tests(cases: list) -> list:
    out = []
    for c in cases:
        t = norm(c["text"])
        out.append({"id": c["id"], "w8": wgrams(t, 8), "w4": wgrams(t, 4), "c5": cgrams(t, 5), "c12": cgrams(t, 12)})
    return out


def score(item: dict, tests: list) -> dict:
    t = norm(item["text"])
    w8, c5 = wgrams(t, 8), cgrams(t, 5)
    sp = norm(item["span"]) if item.get("span") else ""
    sg = wgrams(sp, 4) if len(re.findall(r"\w+", sp)) >= 4 else set()
    cg = cgrams(sp, 12) if not sg else set()
    best = {"word8_jaccard": 0.0, "char5_jaccard": 0.0, "span_containment": 0.0}
    for te in tests:
        best["word8_jaccard"] = max(best["word8_jaccard"], jac(w8, te["w8"]))
        best["char5_jaccard"] = max(best["char5_jaccard"], jac(c5, te["c5"]))
        if sg:
            best["span_containment"] = max(best["span_containment"], len(sg & te["w4"]) / len(sg))
        elif cg:
            best["span_containment"] = max(best["span_containment"], len(cg & te["c12"]) / len(cg))
    return best


def filter_items(items: list, cases: list) -> tuple:
    tests = prepare_tests(cases)
    kept, dropped, mx = [], [], {k: 0.0 for k in THRESH}
    mx_kept = {k: 0.0 for k in THRESH}
    for it in items:
        s = score(it, tests)
        for k in THRESH:
            mx[k] = max(mx[k], s[k])
        if any(s[k] > THRESH[k] for k in THRESH):
            dropped.append(it["id"])
        else:
            kept.append(it)
            for k in THRESH:
                mx_kept[k] = max(mx_kept[k], s[k])
    return kept, {"checked": len(items), "dropped": len(dropped), "kept": len(kept), "thresholds": THRESH, "max_before_drop": {k: round(v, 3) for k, v in mx.items()},
                  "max_after_drop": {k: round(v, 3) for k, v in mx_kept.items()}, "test_letters": len(tests)}
