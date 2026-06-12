export interface DetectionPattern {
  id:          string;
  name:        string;
  category:    PatternCategory;
  severity:    Severity;
  pattern:     RegExp;
  description: string;
}

export type PatternCategory =
  | 'API_KEY'
  | 'CREDENTIAL'
  | 'PRIVATE_KEY'
  | 'TOKEN'
  | 'EMAIL'
  | 'PHONE'
  | 'NETWORK'
  | 'KEYWORD'
  | 'FINANCIAL'
  | 'CUSTOM';

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export const BUILTIN_PATTERNS: DetectionPattern[] = [
  // ── API Keys ──────────────────────────────────────────────────────────────
  {
    id:          'aws-access-key',
    name:        'AWS Access Key',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /\bAKIA[0-9A-Z]{16}\b/g,
    description: 'AWS Access Key ID',
  },
  {
    id:          'aws-secret-key',
    name:        'AWS Secret Key',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /(?:aws.{0,20})?(?:secret|key).{0,10}['\"][0-9a-zA-Z\/+]{40}['\"]/gi,
    description: 'AWS Secret Access Key',
  },
  {
    id:          'google-api-key',
    name:        'Google API Key',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /\bAIza[0-9A-Za-z\-_]{35}\b/g,
    description: 'Google API Key',
  },
  {
    id:          'openai-key',
    name:        'OpenAI API Key',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /\bsk-[a-zA-Z0-9]{20,60}\b/g,
    description: 'OpenAI API Secret Key',
  },
  {
    id:          'github-pat',
    name:        'GitHub Personal Access Token',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /\bghp_[a-zA-Z0-9]{36}\b|\bgho_[a-zA-Z0-9]{36}\b|\bghr_[a-zA-Z0-9]{36}\b/g,
    description: 'GitHub Personal / OAuth / Refresh Token',
  },
  {
    id:          'stripe-key',
    name:        'Stripe API Key',
    category:    'API_KEY',
    severity:    'CRITICAL',
    pattern:     /\b(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
    description: 'Stripe Secret / Publishable Key',
  },
  {
    id:          'generic-api-key',
    name:        'Generic API Key',
    category:    'API_KEY',
    severity:    'HIGH',
    pattern:     /(?:api[_-]?key|apikey|api[_-]?secret)\s*[:=]\s*['"]?([a-zA-Z0-9\-_.]{20,60})['"]?/gi,
    description: 'Generic API key assignment',
  },

  // ── Credentials ───────────────────────────────────────────────────────────
  {
    id:          'password-assignment',
    name:        'Password Assignment',
    category:    'CREDENTIAL',
    severity:    'HIGH',
    pattern:     /(?:password|passwd|pwd)\s*[:=]\s*['"]?([^\s'"]{6,})['"]?/gi,
    description: 'Password variable assignment',
  },
  {
    id:          'secret-assignment',
    name:        'Secret Assignment',
    category:    'CREDENTIAL',
    severity:    'HIGH',
    pattern:     /(?:secret|client_secret|app_secret)\s*[:=]\s*['"]?([a-zA-Z0-9\-_]{8,})['"]?/gi,
    description: 'Secret variable assignment',
  },
  {
    id:          'db-connection-string',
    name:        'Database Connection String',
    category:    'CREDENTIAL',
    severity:    'CRITICAL',
    pattern:     /(?:mongodb|postgres|postgresql|mysql|redis|mssql):\/\/[^:]+:[^@]+@[^\s'"]+/gi,
    description: 'Database connection string with credentials',
  },

  // ── Tokens ────────────────────────────────────────────────────────────────
  {
    id:          'jwt-token',
    name:        'JWT Token',
    category:    'TOKEN',
    severity:    'HIGH',
    pattern:     /\beyJ[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\.[a-zA-Z0-9\-_]+\b/g,
    description: 'JSON Web Token (JWT)',
  },
  {
    id:          'bearer-token',
    name:        'Bearer Token',
    category:    'TOKEN',
    severity:    'HIGH',
    pattern:     /bearer\s+([a-zA-Z0-9\-_.~+/]{20,})/gi,
    description: 'HTTP Bearer token',
  },

  // ── Private Keys ──────────────────────────────────────────────────────────
  {
    id:          'rsa-private-key',
    name:        'RSA Private Key',
    category:    'PRIVATE_KEY',
    severity:    'CRITICAL',
    pattern:     /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
    description: 'PEM-encoded private key block',
  },

  // ── Email ─────────────────────────────────────────────────────────────────
  {
    id:          'email-address',
    name:        'Email Address',
    category:    'EMAIL',
    severity:    'MEDIUM',
    pattern:     /\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g,
    description: 'Email address',
  },

  // ── Phone Numbers ─────────────────────────────────────────────────────────
  {
    id:          'india-phone',
    name:        'Indian Phone Number',
    category:    'PHONE',
    severity:    'MEDIUM',
    pattern:     /(?:\+91|0)?[6-9]\d{9}\b/g,
    description: 'Indian mobile number',
  },
  {
    id:          'us-phone',
    name:        'US Phone Number',
    category:    'PHONE',
    severity:    'MEDIUM',
    pattern:     /\b(?:\+1[\s\-]?)?(?:\([0-9]{3}\)|[0-9]{3})[\s\-]?[0-9]{3}[\s\-]?[0-9]{4}\b/g,
    description: 'US phone number',
  },

  // ── Network ───────────────────────────────────────────────────────────────
  {
    id:          'ipv4-private',
    name:        'Private IP Address',
    category:    'NETWORK',
    severity:    'LOW',
    pattern:     /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g,
    description: 'Private/internal IP address',
  },

  // ── Financial ─────────────────────────────────────────────────────────────
  {
    id:          'credit-card',
    name:        'Credit Card Number',
    category:    'FINANCIAL',
    severity:    'CRITICAL',
    pattern:     /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})\b/g,
    description: 'Credit card number (Visa/MC/Amex/Discover)',
  },

  // ── Keywords ──────────────────────────────────────────────────────────────
  {
    id:          'sensitive-keywords',
    name:        'Sensitive Keyword',
    category:    'KEYWORD',
    severity:    'MEDIUM',
    pattern:     /\b(?:confidential|top.?secret|internal.?only|do.?not.?share|proprietary|classified)\b/gi,
    description: 'Sensitive data classification keyword',
  },
];