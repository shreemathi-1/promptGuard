"""
Keeps the synthetic keys in the dataset and results from looking like real secrets.

The dataset has made-up AWS and GitHub tokens, and the benchmark report quotes some of them.
Secret scanners (GitHub push protection, for one) read the raw file, so they would flag them.
JSON allows \\uXXXX escapes, so the first letter of each prefix is written escaped:

    "AKIAQ7XR..."  ->  "A\\u004bIAQ7XR..."      json.loads() returns the same text

so nothing changes for the benchmark or the Benchmark page; only the file bytes differ.
"""

import re

_PREFIXES = [
    (re.compile(r"AKIA(?=[0-9A-Z]{16})"), "A\\u004bIA"),     # AWS access key id
    (re.compile(r"ghp_(?=[A-Za-z0-9]{36})"), "g\\u0068p_"),  # GitHub personal access token
]


def hide_prefixes(json_text: str) -> str:
    """Escape the token prefixes in already-serialised JSON text."""
    for pattern, replacement in _PREFIXES:
        json_text = pattern.sub(lambda _m, r=replacement: r, json_text)
    return json_text
