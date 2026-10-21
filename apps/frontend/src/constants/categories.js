/**
 * Icons for detection categories — shared by the detection list,
 * risk breakdown and dashboard cards.
 */

export const CATEGORY_ICONS = {
  CREDIT_CARD   : '💳',
  SSN           : '🪪',
  AADHAAR       : '🪪',
  PAN           : '🪪',
  PHONE         : '📞',
  EMAIL         : '📧',
  BANK_ACCOUNT  : '🏦',
  IBAN          : '🏦',
  IFSC          : '🏦',
  PASSPORT      : '🛂',
  API_KEY       : '🔑',
  IP_ADDRESS    : '🌐',
  MAC_ADDRESS   : '🌐',
  PERSON        : '👤',
  LOCATION      : '📍',
  ORGANIZATION  : '🏢',
  DATE_OF_BIRTH : '🎂',
  MEDICAL       : '🩺',
  CUSTOM        : '⚙️',
};

/**
 * Categories a scan can store in the audit log, for filter dropdowns.
 * IBAN is left out on purpose: IBAN hits are stored as BANK_ACCOUNT.
 */
export const FILTER_CATEGORIES = [
  'CREDIT_CARD', 'SSN', 'AADHAAR', 'PAN', 'PHONE', 'EMAIL', 'BANK_ACCOUNT', 'IFSC',
  'PASSPORT', 'API_KEY', 'IP_ADDRESS', 'MAC_ADDRESS',
  'PERSON', 'LOCATION', 'ORGANIZATION', 'DATE_OF_BIRTH', 'MEDICAL', 'CUSTOM',
];

export function categoryIcon(category) {
  return CATEGORY_ICONS[category] ?? '🔍';
}
