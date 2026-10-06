"""
Confidence scoring for regex hits.

Regex rules find candidates; this module decides how likely each candidate is
to be real, using two signals:

1. Checksums / structure  (Luhn, Verhoeff, IBAN mod-97, ABA, PAN, IPv4 octets)
2. Context words near the match  ("card", "aadhaar", "account no" boost it;
   "order", "invoice", "tracking" lower it)

The approach mirrors Presidio's context-aware enhancement, but it runs on the
backend's own regex hits so the existing rule set stays the source of truth.
"""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Callable, Optional

CONTEXT_BEFORE = 50   # chars inspected before the match
CONTEXT_AFTER = 25    # chars inspected after the match
CONTEXT_BOOST = 0.30
NEGATIVE_PENALTY = 0.25
CHECKSUM_PASS = 0.90
CHECKSUM_FAIL = 0.10
DEFAULT_BASE = 0.75   # custom / unknown categories: trust the user's rule

NEGATIVE_CONTEXT = [
    "order", "invoice", "tracking", "reference", "ref", "ticket",
    "version", "build", "serial", "sku", "timestamp", "transaction id",
]


# ── Checksums ────────────────────────────────────────────────────────────────

def digits_only(value: str) -> str:
    return re.sub(r"\D", "", value)


def luhn_valid(number: str) -> bool:
    if not number.isdigit() or len(number) < 12:
        return False
    total = 0
    for i, ch in enumerate(reversed(number)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


_VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
]
_VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
]


def verhoeff_valid(number: str) -> bool:
    if not number.isdigit():
        return False
    c = 0
    for i, ch in enumerate(reversed(number)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[i % 8][int(ch)]]
    return c == 0


def aadhaar_valid(number: str) -> bool:
    # 12 digits, never starts with 0 or 1, Verhoeff check digit
    return len(number) == 12 and number[0] not in "01" and verhoeff_valid(number)


def iban_valid(value: str) -> bool:
    iban = re.sub(r"\s", "", value).upper()
    if not re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}", iban):
        return False
    rearranged = iban[4:] + iban[:4]
    numeric = "".join(str(int(ch, 36)) for ch in rearranged)
    return int(numeric) % 97 == 1


def aba_valid(number: str) -> bool:
    if len(number) != 9 or not number.isdigit() or number == "0" * 9:
        return False
    d = [int(c) for c in number]
    total = 3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])
    return total % 10 == 0


# 4th character of a PAN encodes the holder type (P = person, C = company, ...)
_PAN_HOLDER_TYPES = set("ABCFGHJLPT")


def pan_valid(value: str) -> bool:
    pan = value.upper()
    return bool(re.fullmatch(r"[A-Z]{5}[0-9]{4}[A-Z]", pan)) and pan[3] in _PAN_HOLDER_TYPES


def ipv4_valid(value: str) -> bool:
    parts = value.split(".")
    return len(parts) == 4 and all(p.isdigit() and int(p) <= 255 for p in parts)


_KNOWN_FAKE_SSNS = {"123456789", "078051120", "219099999"}


def ssn_valid(number: str) -> bool:
    if len(number) != 9 or number in _KNOWN_FAKE_SSNS:
        return False
    area, group, serial = number[:3], number[3:5], number[5:]
    return area not in ("000", "666") and area[0] != "9" and group != "00" and serial != "0000"


def shannon_entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    n = len(value)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


# ── Per-category rules ───────────────────────────────────────────────────────

@dataclass
class Assessment:
    confidence: float
    reasons: list[str] = field(default_factory=list)
    checksum: Optional[bool] = None   # None = no checksum applies


def _checksum(passed: bool, name: str) -> Assessment:
    if passed:
        return Assessment(CHECKSUM_PASS, [f"{name}_valid"], True)
    return Assessment(CHECKSUM_FAIL, [f"{name}_invalid"], False)


def _assess_credit_card(match: str) -> Assessment:
    return _checksum(luhn_valid(digits_only(match)), "luhn")


def _assess_aadhaar(match: str) -> Assessment:
    return _checksum(aadhaar_valid(digits_only(match)), "verhoeff")


def _assess_ssn(match: str) -> Assessment:
    if ssn_valid(digits_only(match)):
        return Assessment(0.65, ["ssn_structure_valid"])
    return Assessment(CHECKSUM_FAIL, ["ssn_structure_invalid"], False)


def _assess_pan(match: str) -> Assessment:
    if pan_valid(match):
        return Assessment(0.85, ["pan_holder_type_valid"], True)
    return Assessment(0.30, ["pan_holder_type_invalid"], False)


def _assess_bank_account(match: str) -> Assessment:
    compact = re.sub(r"\s", "", match).upper()
    if re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]+", compact):
        return _checksum(iban_valid(compact), "iban")
    number = digits_only(match)
    if len(number) == 9 and aba_valid(number):
        return Assessment(0.55, ["aba_checksum_valid"])
    # A bare run of digits is only an account number when the text says so
    return Assessment(0.35, ["unverified_number"])


def _assess_ip(match: str) -> Assessment:
    if "." in match:
        if ipv4_valid(match):
            return Assessment(0.70, ["ipv4_octets_valid"], True)
        return Assessment(CHECKSUM_FAIL, ["ipv4_octets_invalid"], False)
    return Assessment(0.80, ["ipv6_format"])


def _assess_phone(match: str) -> Assessment:
    number = digits_only(match)
    if len(set(number)) <= 2 or number in "01234567890123456789":
        return Assessment(0.20, ["phone_repetitive_digits"])
    return Assessment(0.60, ["phone_format"])


def _assess_api_key(match: str) -> Assessment:
    if re.fullmatch(r"(?i)AKIA[0-9A-Z]{16}", match):
        return Assessment(0.95, ["aws_key_prefix"], True)
    entropy = shannon_entropy(match)
    has_letters = bool(re.search(r"[A-Za-z]", match))
    has_digits = bool(re.search(r"[0-9]", match))
    if entropy >= 3.5 and has_letters and has_digits:
        return Assessment(0.70, [f"high_entropy:{entropy:.2f}"])
    return Assessment(0.35, [f"low_entropy:{entropy:.2f}"])


@dataclass
class CategoryRule:
    assess: Callable[[str], Assessment]
    context: list[str]
    negative_context: list[str] = field(default_factory=lambda: NEGATIVE_CONTEXT)


def _fixed(confidence: float, reason: str) -> Callable[[str], Assessment]:
    return lambda _match: Assessment(confidence, [reason])


RULES: dict[str, CategoryRule] = {
    "CREDIT_CARD": CategoryRule(_assess_credit_card, ["card", "credit", "debit", "visa", "mastercard", "amex", "cc", "payment", "cvv", "expiry"]),
    "AADHAAR": CategoryRule(_assess_aadhaar, ["aadhaar", "aadhar", "uidai", "uid", "enrolment"]),
    "SSN": CategoryRule(_assess_ssn, ["ssn", "social security", "social sec"]),
    "PAN": CategoryRule(_assess_pan, ["pan", "income tax", "permanent account"]),
    "BANK_ACCOUNT": CategoryRule(_assess_bank_account, ["account", "acct", "a/c", "bank", "routing", "iban", "ifsc", "savings", "checking", "beneficiary"]),
    "IFSC": CategoryRule(_fixed(0.75, "ifsc_format"), ["ifsc", "bank", "branch", "neft", "rtgs"]),
    "PASSPORT": CategoryRule(_fixed(0.40, "passport_format"), ["passport", "travel document", "visa application", "nationality"]),
    "PHONE": CategoryRule(_assess_phone, ["phone", "mobile", "call", "contact", "tel", "whatsapp", "cell", "sms"]),
    "IP_ADDRESS": CategoryRule(_assess_ip, ["ip", "server", "host", "address", "ssh", "connect", "gateway", "subnet"], NEGATIVE_CONTEXT),
    "MAC_ADDRESS": CategoryRule(_fixed(0.80, "mac_format"), ["mac", "device", "hardware", "ethernet", "wifi", "adapter"]),
    "EMAIL": CategoryRule(_fixed(0.95, "email_format"), ["email", "mail", "contact"], []),
    "API_KEY": CategoryRule(_assess_api_key, ["key", "token", "secret", "api", "bearer", "password", "credential", "auth"], ["commit", "sha", "hash", "checksum", "md5", "uuid"]),
}


def _find_keywords(window: str, keywords: list[str]) -> list[str]:
    return [k for k in keywords if re.search(rf"(?<![a-z0-9]){re.escape(k)}(?![a-z0-9])", window)]


def assess_hit(text: str, category: str, match: str, start: int, end: int) -> Assessment:
    """Score a single regex hit between 0 and 1."""
    rule = RULES.get(category.upper())
    if rule is None:
        return Assessment(DEFAULT_BASE, ["custom_rule"])

    result = rule.assess(match)
    before = text[max(0, start - CONTEXT_BEFORE):start].lower()
    after = text[end:end + CONTEXT_AFTER].lower()
    window = f"{before} {after}"

    positive = _find_keywords(window, rule.context)
    negative = _find_keywords(before, rule.negative_context)

    confidence = result.confidence
    if positive:
        # A failed checksum is only weakly rescued by context
        confidence += CONTEXT_BOOST / 2 if result.checksum is False else CONTEXT_BOOST
        result.reasons.append(f"context:{positive[0]}")
    if negative and not positive:
        confidence -= NEGATIVE_PENALTY
        result.reasons.append(f"negative_context:{negative[0]}")

    result.confidence = round(min(max(confidence, 0.0), 1.0), 3)
    return result
