"""
Smart rewrite: swap sensitive values for realistic fakes, then put them back.

Unlike masking ("[PERSON REDACTED]"), a pseudonymized prompt still reads
naturally, so an LLM can answer it properly:

    "Priya Sharma, card 4111 1111 1111 1111"  →  "Ananya Rao, card 4532 8710 2291 0046"

Fakes keep the original's format, and the checksummed ones stay valid (Luhn
for cards, Verhoeff for Aadhaar, mod-97 for IBANs), so nothing looks
artificial to the model. The same original always gets the same fake within
a session, and two different originals never share a fake, so the chatbot's
reply can be restored exactly.

Mappings live only in memory and expire after a TTL. They are never written
to disk or to the backend's database.
"""

from __future__ import annotations

import random
import re
import secrets
import threading
import time
from dataclasses import dataclass, field
from datetime import date
from typing import Callable, Optional

from faker import Faker

from .validators import digits_only, luhn_valid, verhoeff_valid

_faker = Faker("en_IN")
_rng = random.SystemRandom()

MAX_ATTEMPTS = 20

MEDICAL_CONDITIONS = [
    "asthma", "migraine", "hypertension", "eczema", "anaemia", "arthritis",
    "hypothyroidism", "sinusitis", "gastritis", "insomnia",
]

API_KEY_PREFIX = re.compile(r"^(AKIA|ASIA|sk-|sk_live_|sk_test_|ghp_|gho_|xox[abp]-)")


# ── Format-preserving helpers ────────────────────────────────────────────────

def _random_like(ch: str) -> str:
    if ch.isdigit():
        return str(_rng.randrange(10))
    if ch.isupper():
        return chr(_rng.randrange(65, 91))
    if ch.islower():
        return chr(_rng.randrange(97, 123))
    return ch


def _shape(original: str, keep: int = 0) -> str:
    """Random value with the same layout: digits → digits, letters → letters, separators kept."""
    return original[:keep] + "".join(_random_like(c) for c in original[keep:])


def _fill_digits(template: str, digits: str) -> str:
    """Writes digits into the digit positions of template, keeping its separators."""
    it = iter(digits)
    return "".join(next(it) if c.isdigit() else c for c in template)


def _random_digits(n: int) -> str:
    return "".join(str(_rng.randrange(10)) for _ in range(n))


def _with_check_digit(body: str, valid: Callable[[str], bool]) -> str:
    for d in "0123456789":
        if valid(body + d):
            return body + d
    raise ValueError("no check digit")  # unreachable for Luhn / Verhoeff


def _match_case(original: str, fake: str) -> str:
    if original.isupper():
        return fake.upper()
    if original.islower():
        return fake.lower()
    return fake


# ── Fakes per category ───────────────────────────────────────────────────────

def _fake_person(original: str) -> str:
    # Same number of words, so each name part can be restored on its own
    parts = original.split()
    if len(parts) <= 1:
        return _faker.first_name()
    return " ".join([_faker.first_name() for _ in parts[:-1]] + [_faker.last_name()])


def _fake_credit_card(original: str) -> str:
    digits = digits_only(original)
    # Keep the first digit so the card network (Visa 4, Mastercard 5, Amex 3) stays the same
    body = digits[0] + _random_digits(len(digits) - 2)
    return _fill_digits(original, _with_check_digit(body, luhn_valid))


def _fake_aadhaar(original: str) -> str:
    body = str(_rng.randrange(2, 10)) + _random_digits(10)
    return _fill_digits(original, _with_check_digit(body, verhoeff_valid))


def _fake_ssn(original: str) -> str:
    area = _rng.randrange(1, 900)
    while area == 666:
        area = _rng.randrange(1, 900)
    number = f"{area:03d}{_rng.randrange(1, 100):02d}{_rng.randrange(1, 10000):04d}"
    return _fill_digits(original, number) if len(digits_only(original)) == 9 else number


def _fake_pan(original: str) -> str:
    letters = lambda n: "".join(chr(_rng.randrange(65, 91)) for _ in range(n))  # noqa: E731
    holder = original[3].upper() if len(original) == 10 and original[3].isalpha() else "P"
    pan = letters(3) + holder + letters(1) + _random_digits(4) + letters(1)
    return _match_case(original, pan)


def _iban_check_digits(country: str, bban: str) -> str:
    numeric = "".join(str(int(ch, 36)) for ch in bban + country + "00")
    return f"{98 - int(numeric) % 97:02d}"


def _fake_bank_account(original: str) -> str:
    compact = re.sub(r"\s", "", original).upper()
    if re.fullmatch(r"[A-Z]{2}[0-9]{2}[A-Z0-9]+", compact):
        country, bban = compact[:2], _shape(compact[4:])
        iban = country + _iban_check_digits(country, bban) + bban
        # Put the original spacing back ("GB29 NWBK ..." stays grouped)
        it = iter(iban)
        return "".join(next(it) if not c.isspace() else c for c in original.upper())
    return _shape(original)


def _fake_phone(original: str) -> str:
    # Keep the country code and the first digit of the number (mobile vs landline)
    m = re.match(r"^\s*(\+\d{1,3}[\s-]?)?\D*\d", original)
    keep = m.end() if m else 0
    return _shape(original, keep=keep)


def _fake_email(_original: str) -> str:
    return _faker.free_email()


def _fake_ip(original: str) -> str:
    return _faker.ipv6() if ":" in original else _faker.ipv4_private()


def _fake_api_key(original: str) -> str:
    m = API_KEY_PREFIX.match(original)
    return _shape(original, keep=m.end() if m else 0)


def _fake_date(original: str) -> str:
    dob: date = _faker.date_of_birth(minimum_age=18, maximum_age=80)
    if re.search(r"[A-Za-z]", original):
        return dob.strftime("%d %B %Y")
    if re.match(r"^\d{4}-", original):
        return dob.isoformat()
    m = re.search(r"[/.-]", original)
    sep = m.group() if m else "/"
    return dob.strftime(f"%d{sep}%m{sep}%Y")


def _fake_medical(original: str) -> str:
    options = [c for c in MEDICAL_CONDITIONS if c != original.lower()]
    return _match_case(original, _rng.choice(options))


FAKERS: dict[str, Callable[[str], str]] = {
    "PERSON": _fake_person,
    "LOCATION": lambda _o: _faker.city(),
    "ORGANIZATION": lambda _o: _faker.company(),
    "EMAIL": _fake_email,
    "PHONE": _fake_phone,
    "CREDIT_CARD": _fake_credit_card,
    "AADHAAR": _fake_aadhaar,
    "SSN": _fake_ssn,
    "PAN": _fake_pan,
    "BANK_ACCOUNT": _fake_bank_account,
    "IBAN": _fake_bank_account,
    "IP_ADDRESS": _fake_ip,
    "MAC_ADDRESS": lambda _o: _faker.mac_address(),
    "API_KEY": _fake_api_key,
    "DATE_OF_BIRTH": _fake_date,
    "DATE_TIME": _fake_date,
    "MEDICAL": _fake_medical,
}


def fake_value(category: str, original: str) -> str:
    """One fake for original; unknown categories get a same-shape random value."""
    return FAKERS.get(category.upper(), _shape)(original)


# ── Session mapping ──────────────────────────────────────────────────────────

# Words that say nothing about who or where ("Infosys Ltd" → "Kumar Ltd" is fine)
GENERIC_WORDS = {"and", "the", "of", "ltd", "pvt", "inc", "llc", "limited", "sons", "group", "co", "corp"}


def _words(value: str) -> set[str]:
    """Lower-cased alphabetic words of 2+ letters (numbers are checked as whole values)."""
    return {w.lower() for w in re.findall(r"[A-Za-z]{2,}", value)}


NUMERIC_CATEGORIES = {"CREDIT_CARD", "AADHAAR", "SSN", "PHONE", "BANK_ACCOUNT", "IBAN"}


@dataclass
class Replacement:
    category: str
    original: str
    fake: str
    start: int
    end: int
    fakeStart: int
    fakeEnd: int


@dataclass
class Session:
    id: str
    # (CATEGORY, original) → fake, and fake → original for restore
    forward: dict[tuple[str, str], str] = field(default_factory=dict)
    reverse: dict[str, tuple[str, str]] = field(default_factory=dict)
    last_used: float = field(default_factory=time.monotonic)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def fake_for(self, category: str, original: str, context: str) -> str:
        key = (category.upper(), original)
        if key in self.forward:
            return self.forward[key]

        context_words = _words(context)
        original_words = _words(original)
        fake = None
        for _ in range(MAX_ATTEMPTS):
            candidate = fake_value(category, original)
            if self._acceptable(category, candidate, original_words, context, context_words):
                fake = candidate
                break
        if fake is None:
            # Last resort: a same-shape value with a suffix that can't collide
            fake = f"{_shape(original)}-{len(self.reverse) + 1}"

        self.forward[key] = fake
        self.reverse[fake] = key
        return fake

    def _acceptable(self, category: str, candidate: str, original_words: set[str],
                    context: str, context_words: set[str]) -> bool:
        """
        A fake must be new, must not occur in the prompt (or restoring the reply would
        rewrite unrelated text), and must not share a distinctive word with the
        original: "Priya Sharma" → "Ananya Sharma" would leak the surname.
        """
        if candidate in self.reverse or candidate.lower() in context.lower():
            return False
        words = _words(candidate) - GENERIC_WORDS
        if words & original_words:
            return False
        if category.upper() == "PERSON":
            # Name parts are restored one by one, so each must be unique too
            taken = {w.lower() for f, (c, _o) in self.reverse.items() if c == "PERSON" for w in f.split()}
            if words & (context_words | taken):
                return False
        return True

    def pseudonymize(self, text: str, entities: list[dict]) -> tuple[str, list[Replacement]]:
        out: list[str] = []
        replacements: list[Replacement] = []
        cursor = 0
        offset = 0

        for e in sorted(entities, key=lambda e: e["start"]):
            start, end = e["start"], e["end"]
            # Skip overlaps and spans that don't match the text
            if start < cursor or end > len(text) or text[start:end] != e["match"]:
                continue
            fake = self.fake_for(e["category"], e["match"], text)
            out.append(text[cursor:start])
            out.append(fake)
            fake_start = start + offset
            replacements.append(Replacement(
                category=e["category"], original=e["match"], fake=fake,
                start=start, end=end, fakeStart=fake_start, fakeEnd=fake_start + len(fake),
            ))
            offset += len(fake) - (end - start)
            cursor = end

        out.append(text[cursor:])
        return "".join(out), replacements

    def _restore_pairs(self) -> dict[str, str]:
        """fake variant → original variant, including name parts and unspaced numbers."""
        pairs: dict[str, str] = {}
        part_owners: dict[str, set[str]] = {}

        for fake, (category, original) in self.reverse.items():
            pairs[fake] = original

            if category == "PERSON":
                # LLMs often say just "Ananya" — map each name part back to its counterpart
                for f_part, o_part in zip(fake.split(), original.split()):
                    part_owners.setdefault(f_part, set()).add(o_part)

            if category in NUMERIC_CATEGORIES:
                compact = re.sub(r"[\s-]", "", fake)
                if compact != fake:
                    pairs.setdefault(compact, re.sub(r"[\s-]", "", original))

        for f_part, owners in part_owners.items():
            # Only when unambiguous: one fake part ↔ one original part
            if len(owners) == 1 and f_part not in pairs:
                pairs[f_part] = next(iter(owners))
        return pairs

    def restore(self, text: str) -> tuple[str, dict[str, int]]:
        pairs = self._restore_pairs()
        if not pairs:
            return text, {}
        # Longest first, so "Ananya Rao" wins over "Ananya"; one pass, so no cascading
        keys = sorted(pairs, key=len, reverse=True)
        pattern = re.compile(r"(?<!\w)(?:" + "|".join(re.escape(k) for k in keys) + r")(?!\w)")
        counts: dict[str, int] = {}

        def swap(m: re.Match) -> str:
            counts[m.group()] = counts.get(m.group(), 0) + 1
            return pairs[m.group()]

        return pattern.sub(swap, text), counts


class MappingStore:
    """In-memory sessions with a sliding TTL and a size cap. Thread-safe."""

    def __init__(self, ttl_seconds: int, max_sessions: int):
        self.ttl = ttl_seconds
        self.max = max_sessions
        self._sessions: dict[str, Session] = {}
        self._lock = threading.Lock()

    def _evict(self, now: float) -> None:
        expired = [k for k, s in self._sessions.items() if now - s.last_used > self.ttl]
        for k in expired:
            del self._sessions[k]
        while len(self._sessions) >= self.max:
            oldest = min(self._sessions, key=lambda k: self._sessions[k].last_used)
            del self._sessions[oldest]

    def get(self, mapping_id: str) -> Optional[Session]:
        with self._lock:
            now = time.monotonic()
            s = self._sessions.get(mapping_id)
            if s is None or now - s.last_used > self.ttl:
                self._sessions.pop(mapping_id, None)
                return None
            s.last_used = now
            return s

    def get_or_create(self, mapping_id: Optional[str]) -> Session:
        if mapping_id:
            s = self.get(mapping_id)
            if s is not None:
                return s
        with self._lock:
            self._evict(time.monotonic())
            s = Session(id=secrets.token_urlsafe(16))
            self._sessions[s.id] = s
            return s

    def delete(self, mapping_id: str) -> bool:
        with self._lock:
            return self._sessions.pop(mapping_id, None) is not None

    def __len__(self) -> int:
        return len(self._sessions)
