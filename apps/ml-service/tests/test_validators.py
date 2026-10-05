from app.validators import (
    _VERHOEFF_D, _VERHOEFF_P, aadhaar_valid, aba_valid, assess_hit, iban_valid,
    luhn_valid, pan_valid, shannon_entropy, verhoeff_valid,
)

INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9]


def with_verhoeff_digit(body: str) -> str:
    c = 0
    for i, ch in enumerate(reversed(body)):
        c = _VERHOEFF_D[c][_VERHOEFF_P[(i + 1) % 8][int(ch)]]
    return body + str(INV[c])


VALID_AADHAAR = with_verhoeff_digit("23456789012")


def score(text, category, match):
    start = text.index(match)
    return assess_hit(text, category, match, start, start + len(match))


def test_luhn():
    assert luhn_valid("4111111111111111")
    assert not luhn_valid("4111111111111112")


def test_verhoeff_and_aadhaar():
    assert verhoeff_valid(VALID_AADHAAR)
    assert aadhaar_valid(VALID_AADHAAR)
    broken = VALID_AADHAAR[:-1] + str((int(VALID_AADHAAR[-1]) + 1) % 10)
    assert not aadhaar_valid(broken)
    assert not aadhaar_valid("1" + VALID_AADHAAR[1:])  # cannot start with 0 or 1


def test_iban_aba_pan():
    assert iban_valid("GB82 WEST 1234 5698 7654 32")
    assert not iban_valid("GB83WEST12345698765432")
    assert aba_valid("021000021")
    assert not aba_valid("021000022")
    assert pan_valid("ABCPE1234F")
    assert not pan_valid("ABCXE1234F")


def test_entropy():
    assert shannon_entropy("aaaa") == 0
    assert shannon_entropy("aB3xK9pQ2mZ7") > 3.5


def test_card_checksum_and_context():
    good = score("my card 4111 1111 1111 1111 exp 12/29", "CREDIT_CARD", "4111 1111 1111 1111")
    bad = score("my card 4111 1111 1111 1112", "CREDIT_CARD", "4111 1111 1111 1112")
    assert good.confidence >= 0.9 and good.checksum is True
    assert bad.confidence < 0.5 and bad.checksum is False


def test_order_id_is_not_aadhaar():
    a = score("Order ID 1234 5678 9012 has shipped", "AADHAAR", "1234 5678 9012")
    assert a.confidence < 0.5


def test_valid_aadhaar_with_context():
    number = f"{VALID_AADHAAR[:4]} {VALID_AADHAAR[4:8]} {VALID_AADHAAR[8:]}"
    a = score(f"My Aadhaar is {number}", "AADHAAR", number)
    assert a.confidence >= 0.95
    assert "context:aadhaar" in a.reasons


def test_bank_account_needs_context():
    plain = score("ref 4455667788 attached", "BANK_ACCOUNT", "4455667788")
    ctx = score("account number 4455667788", "BANK_ACCOUNT", "4455667788")
    assert plain.confidence < 0.6 <= ctx.confidence


def test_api_key_entropy_and_negative_context():
    key = "aB3xK9pQ2mZ7wR5tY8uI1oP4sD6fG0hJ"
    assert score(f"api key: {key}", "API_KEY", key).confidence >= 0.9
    sha = "a" * 32
    assert score(f"commit {sha}", "API_KEY", sha).confidence < 0.5


def test_custom_category_trusted():
    assert score("EMP-00123", "CUSTOM", "EMP-00123").confidence == 0.75
