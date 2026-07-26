/**
 * Map a backend error into a translated, user-facing message.
 *
 * The API returns a stable `code` (e.g. ERR_INSUFFICIENT_STOCK) alongside its
 * English `message`. Translating the code means shopkeepers using the Gujarati
 * UI never see raw English server text. Unknown codes fall back to the
 * server's message, then to a generic string.
 */
const CODE_KEYS = {
  ERR_INSUFFICIENT_STOCK: 'Insufficient stock',
  ERR_QTY_POSITIVE: 'Quantity must be greater than zero',
  ERR_TOO_SMALL: 'Value is too small',
  ERR_TOO_LARGE: 'Value is too large',
  ERR_REQUIRED: 'This field is required',
  ERR_EMPTY_LIST: 'Please add at least one item',
  ERR_INVALID_ENUM: 'Invalid value selected',
  ERR_INVALID_DATE: 'Invalid date',
  ERR_DISCOUNT_RANGE: 'Discount is out of range',
  ERR_ALREADY_CONVERTED: 'Document has already been converted',
  ERR_ALREADY_CANCELLED: 'Already cancelled',
  ERR_CANCELLED: 'Cannot use a cancelled document',
  ERR_NOT_FOUND: 'Not found on server',
  ERR_FILE_TYPE: 'Invalid file type',
  ERR_FILE_FORMAT: 'Unsupported file format',
  ERR_UPLOAD: 'Upload failed',
  ERR_RESTORE_FAILED: 'Restore failed',
  ERR_INTERNAL: 'Server error',
};

/**
 * @param {unknown} err       Axios error (or anything thrown).
 * @param {(key: string) => string} t  Translator from AuthContext.
 * @param {string} [fallbackKey]       Translation key used as a last resort.
 */
export function apiErrorMessage(err, t, fallbackKey = 'Failed') {
  const data = err?.response?.data;
  const code = data?.code;

  if (code && CODE_KEYS[code]) {
    const translated = t(CODE_KEYS[code]);
    // For stock errors the server message carries the product name and
    // quantities, which is more useful than the generic sentence.
    if (code === 'ERR_INSUFFICIENT_STOCK' && data?.message) {
      return `${translated}: ${data.message.replace(/^Insufficient stock for /, '')}`;
    }
    return translated;
  }

  if (data?.message) return data.message;
  if (err?.message === 'Network Error') return t('Failed to load');
  return t(fallbackKey);
}

export default apiErrorMessage;
