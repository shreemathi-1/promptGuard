/**
 * Built-in DLP pattern definitions.
 * Each pattern is tested against the full input text.
 * Flags: g = global (find all matches), i = case-insensitive where relevant.
 */

const BUILTIN_PATTERNS = [
  // ── Credit Cards ──────────────────────────────────────────────────────────
  {
    name: 'Visa Card',
    description: 'Visa credit/debit card number (16 digits, starts with 4)',
    pattern: '\\b4[0-9]{3}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}\\b',
    category: 'CREDIT_CARD',
    severity: 'CRITICAL',
    is_builtin: true,
  },
  {
    name: 'Mastercard',
    description: 'Mastercard number (16 digits, starts with 51–55 or 2221–2720)',
    pattern: '\\b(?:5[1-5][0-9]{2}|222[1-9]|22[3-9][0-9]|2[3-6][0-9]{2}|27[01][0-9]|2720)[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}\\b',
    category: 'CREDIT_CARD',
    severity: 'CRITICAL',
    is_builtin: true,
  },
  {
    name: 'American Express',
    description: 'Amex card number (15 digits, starts with 34 or 37)',
    pattern: '\\b3[47][0-9]{2}[\\s\\-]?[0-9]{6}[\\s\\-]?[0-9]{5}\\b',
    category: 'CREDIT_CARD',
    severity: 'CRITICAL',
    is_builtin: true,
  },
  {
    name: 'Discover Card',
    description: 'Discover card number (16 digits, starts with 6011 or 65)',
    pattern: '\\b6(?:011|5[0-9]{2})[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}[\\s\\-]?[0-9]{4}\\b',
    category: 'CREDIT_CARD',
    severity: 'CRITICAL',
    is_builtin: true,
  },

  // ── Phone Numbers ─────────────────────────────────────────────────────────
  {
    name: 'US Phone Number',
    description: 'US phone number in various formats',
    pattern: '\\b(?:\\+1[\\s\\-]?)?(?:\\([0-9]{3}\\)|[0-9]{3})[\\s\\-]?[0-9]{3}[\\s\\-]?[0-9]{4}\\b',
    category: 'PHONE',
    severity: 'MEDIUM',
    is_builtin: true,
  },
  {
    name: 'International Phone',
    description: 'International phone number with country code',
    pattern: '\\+(?:[1-9][0-9]{0,2})[\\s\\-]?(?:[0-9][\\s\\-]?){6,14}[0-9]',
    category: 'PHONE',
    severity: 'MEDIUM',
    is_builtin: true,
  },

  // ── SSN ───────────────────────────────────────────────────────────────────
  {
    name: 'US Social Security Number',
    description: 'US SSN in formats: 123-45-6789 or 123 45 6789',
    pattern: '\\b(?!000|666|9[0-9]{2})[0-9]{3}[\\s\\-](?!00)[0-9]{2}[\\s\\-](?!0000)[0-9]{4}\\b',
    category: 'SSN',
    severity: 'CRITICAL',
    is_builtin: true,
  },

  // ── Bank Accounts ─────────────────────────────────────────────────────────
  {
    name: 'US Bank Account Number',
    description: 'US bank account number (8–17 digits)',
    pattern: '\\b[0-9]{8,17}\\b',
    category: 'BANK_ACCOUNT',
    severity: 'HIGH',
    is_builtin: true,
  },
  {
    name: 'IBAN',
    description: 'International Bank Account Number (IBAN)',
    pattern: '\\b[A-Z]{2}[0-9]{2}[A-Z0-9]{4}[0-9]{7}(?:[A-Z0-9]{0,16})\\b',
    category: 'BANK_ACCOUNT',
    severity: 'HIGH',
    is_builtin: true,
  },
  {
    name: 'ABA Routing Number',
    description: 'US ABA bank routing number (9 digits)',
    pattern: '\\b[0-9]{9}\\b',
    category: 'BANK_ACCOUNT',
    severity: 'HIGH',
    is_builtin: true,
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  {
    name: 'Email Address',
    description: 'Standard email address',
    pattern: '\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b',
    category: 'EMAIL',
    severity: 'LOW',
    is_builtin: true,
  },

  // ── Passport ──────────────────────────────────────────────────────────────
  {
    name: 'US Passport Number',
    description: 'US passport number (letter + 8 digits)',
    pattern: '\\b[A-Z]{1}[0-9]{8}\\b',
    category: 'PASSPORT',
    severity: 'CRITICAL',
    is_builtin: true,
  },

  // ── API Keys / Secrets ────────────────────────────────────────────────────
  {
    name: 'Generic API Key',
    description: 'Generic API key pattern (32+ alphanumeric chars)',
    pattern: '\\b[A-Za-z0-9]{32,45}\\b',
    category: 'API_KEY',
    severity: 'HIGH',
    is_builtin: true,
  },
  {
    name: 'AWS Access Key',
    description: 'AWS Access Key ID',
    pattern: '\\bAKIA[0-9A-Z]{16}\\b',
    category: 'API_KEY',
    severity: 'CRITICAL',
    is_builtin: true,
  },
];

module.exports = BUILTIN_PATTERNS;