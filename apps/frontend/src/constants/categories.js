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
  PASSPORT      : '🛂',
  API_KEY       : '🔑',
  IP_ADDRESS    : '🌐',
  PERSON        : '👤',
  LOCATION      : '📍',
  ORGANIZATION  : '🏢',
  DATE_OF_BIRTH : '🎂',
  MEDICAL       : '🩺',
  CUSTOM        : '⚙️',
};

export function categoryIcon(category) {
  return CATEGORY_ICONS[category] ?? '🔍';
}
