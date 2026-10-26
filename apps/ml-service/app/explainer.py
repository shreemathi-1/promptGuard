"""
"Why is this risky?" explanations for detections.

The template explanation is always available (no LLM needed). With Ollama
running, the LLM can write a version tailored to the surrounding text; the
sensitive value itself is replaced with [VALUE] before it reaches the model.
"""

from __future__ import annotations

from typing import Optional

from .llm import OllamaClient

TEMPLATES: dict[str, dict] = {
    "CREDIT_CARD": {
        "summary": "A payment card number can be used for fraudulent online purchases.",
        "risks": ["Card-not-present fraud needs only the number, expiry and CVV",
                  "Storing or sharing card data breaks PCI DSS rules"],
        "recommendation": "Remove the number, or keep only the last 4 digits.",
    },
    "AADHAAR": {
        "summary": "An Aadhaar number is a lifelong national ID linked to biometrics, bank accounts and SIM cards.",
        "risks": ["Enables identity fraud and fake KYC", "Cannot be changed if leaked",
                  "Sharing it may breach India's DPDP Act"],
        "recommendation": "Use a masked Aadhaar (XXXX XXXX 1234) or a Virtual ID instead.",
    },
    "PAN": {
        "summary": "A PAN identifies a taxpayer in India and is required for most financial transactions.",
        "risks": ["Used to open loans or credit lines in someone else's name", "Exposes tax records"],
        "recommendation": "Remove the PAN or replace it with a placeholder.",
    },
    "SSN": {
        "summary": "A US Social Security Number is the key to someone's credit and tax identity.",
        "risks": ["Identity theft and fraudulent credit applications", "Very hard to change once leaked"],
        "recommendation": "Remove it; if needed, keep only the last 4 digits.",
    },
    "BANK_ACCOUNT": {
        "summary": "A bank account or IBAN can be used to set up fraudulent debits or social-engineering scams.",
        "risks": ["Unauthorised direct debits", "Convincing phishing that quotes real account details"],
        "recommendation": "Remove the account number or mask all but the last 4 characters.",
    },
    "IFSC": {
        "summary": "An IFSC code identifies a bank branch; next to an account number it completes the payment details.",
        "risks": ["Combined with an account number it allows transfers to be set up"],
        "recommendation": "Only share it if the account number is removed.",
    },
    "PASSPORT": {
        "summary": "A passport number is a government ID used for travel and identity verification.",
        "risks": ["Identity fraud and forged documents", "Lets others book travel or visas in the holder's name"],
        "recommendation": "Remove the passport number.",
    },
    "API_KEY": {
        "summary": "A secret key gives whoever holds it the same access as its owner.",
        "risks": ["Attackers can read data, run up cloud bills or pivot into other systems",
                  "Keys pasted into chatbots may be kept in their logs"],
        "recommendation": "Revoke and rotate this key now, then load secrets from environment variables.",
    },
    "EMAIL": {
        "summary": "An email address identifies a person and is the main target for phishing.",
        "risks": ["Targeted phishing and spam", "Links the prompt to a real person"],
        "recommendation": "Replace it with a placeholder such as user@example.com.",
    },
    "PHONE": {
        "summary": "A phone number identifies a person and can be used for scams or SIM-swap attacks.",
        "risks": ["Vishing and SMS phishing", "SIM-swap attacks that take over OTP-protected accounts"],
        "recommendation": "Remove the number or mask all but the last few digits.",
    },
    "IP_ADDRESS": {
        "summary": "An IP address can reveal internal network layout or a user's location.",
        "risks": ["Helps attackers map and target internal systems"],
        "recommendation": "Replace it with a documentation address such as 192.0.2.1.",
    },
    "MAC_ADDRESS": {
        "summary": "A MAC address uniquely identifies a device.",
        "risks": ["Device tracking", "Helps target specific hardware on a network"],
        "recommendation": "Remove the MAC address.",
    },
    "PERSON": {
        "summary": "A person's name is personal data; with other details it identifies them.",
        "risks": ["Combined with other data it enables profiling or impersonation",
                  "Sharing it without consent may breach GDPR or the DPDP Act"],
        "recommendation": "Use Smart Rewrite to swap the name for a realistic fake.",
    },
    "LOCATION": {
        "summary": "A location, combined with a name, narrows down who and where someone is.",
        "risks": ["Re-identification of anonymised data", "Physical safety risk if it is a home address"],
        "recommendation": "Generalise it (\"a city in South India\") or swap it with Smart Rewrite.",
    },
    "ORGANIZATION": {
        "summary": "An organisation name can reveal confidential business relationships.",
        "risks": ["Leaks clients, partners or unannounced deals", "Links the prompt to a real company"],
        "recommendation": "Replace it with a generic name such as \"the client\".",
    },
    "DATE_OF_BIRTH": {
        "summary": "A date of birth is a common security question and identity-verification field.",
        "risks": ["Helps pass identity checks with banks and telecoms", "Never changes"],
        "recommendation": "Remove it, or keep only the year.",
    },
    "MEDICAL": {
        "summary": "Health information is special-category personal data with the strictest legal protection.",
        "risks": ["Discrimination by employers or insurers", "Breaches HIPAA, GDPR Article 9 or the DPDP Act"],
        "recommendation": "Remove the condition or describe it generically.",
    },
}

DEFAULT_TEMPLATE = {
    "summary": "This value matched a custom rule your team defined as sensitive.",
    "risks": ["Your organisation has marked this kind of data as not for sharing"],
    "recommendation": "Remove or mask the value before sending the prompt.",
}

ALIASES = {"IBAN": "BANK_ACCOUNT", "DATE_TIME": "DATE_OF_BIRTH", "MEDICAL_CONDITION": "MEDICAL"}


def _describe_reason(reason: str) -> Optional[str]:
    code, _, detail = reason.partition(":")
    if code == "context":
        return f'the word "{detail}" appears nearby'
    if code == "negative_context":
        return f'the word "{detail}" nearby suggests it may not be real'
    if code.endswith("_invalid"):
        return f"{code[:-8].replace('_', ' ')} check failed"
    if code.endswith("_valid"):
        return f"{code[:-6].replace('_', ' ')} check passed"
    if code in ("custom_rule", "unverified_number"):
        return None
    return code.replace("_", " ") + (f" {detail}" if detail else "")


def evidence(source: Optional[str], confidence: Optional[float], reasons: list[str], recognizer: Optional[str]) -> list[str]:
    """Plain-language list of why this detection was flagged."""
    items = []
    if source == "AI":
        model = f" ({recognizer})" if recognizer else ""
        items.append(f"found by the AI entity model{model}")
    elif source == "HYBRID":
        items.append("matched a regex rule and was verified by the ML validator")
    elif source == "REGEX":
        items.append("matched a regex rule")
    items += [d for d in (_describe_reason(r) for r in reasons) if d]
    if isinstance(confidence, (int, float)):
        items.append(f"confidence {round(confidence * 100)}%")
    return items


def template_explanation(category: str) -> dict:
    key = ALIASES.get(category.upper(), category.upper())
    return dict(TEMPLATES.get(key, DEFAULT_TEMPLATE))


def mask_value(context: str, match: str) -> str:
    """The LLM sees the surrounding text, never the sensitive value itself."""
    if not context:
        return ""
    return context.replace(match, "[VALUE]") if match else context


LLM_SYSTEM = """You explain to a non-expert why a piece of data in their prompt is sensitive.
The value itself is hidden as [VALUE]. Be specific to the context, concrete and brief.
Reply with one JSON object only:
{"summary": "one or two sentences", "risks": ["short risk", "short risk"], "recommendation": "one sentence"}"""


def llm_explanation(client: OllamaClient, category: str, context: str, match: str, facts: list[str]) -> tuple[dict, str]:
    prompt = [f"Category: {category}"]
    if context:
        prompt.append(f"Text around it: {mask_value(context, match)}")
    if facts:
        prompt.append("Why it was flagged: " + "; ".join(facts))
    raw, model = client.chat_json(
        [{"role": "system", "content": LLM_SYSTEM}, {"role": "user", "content": "\n".join(prompt)}],
        temperature=0.3,
        max_tokens=300,
    )
    fallback = template_explanation(category)
    risks = raw.get("risks")
    explanation = {
        "summary": str(raw.get("summary") or fallback["summary"])[:600],
        "risks": [str(r)[:200] for r in risks][:4] if isinstance(risks, list) and risks else fallback["risks"],
        "recommendation": str(raw.get("recommendation") or fallback["recommendation"])[:300],
    }
    # Never echo a value the model guessed back into the UI
    if match:
        explanation = {k: (v.replace(match, "[VALUE]") if isinstance(v, str) else [r.replace(match, "[VALUE]") for r in v])
                       for k, v in explanation.items()}
    return explanation, model

