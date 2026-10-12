const bool = (v, def) => (v === undefined || v === '' ? def : /^(1|true|yes)$/i.test(v));

module.exports = {
  port: Number(process.env.PORT) || 3000,
  appPassword: process.env.APP_PASSWORD || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  bitrixWebhook: (process.env.BITRIX_WEBHOOK_URL || '').trim(),
  ai: {
    baseUrl: (process.env.AI_BASE_URL || '').trim().replace(/\/+$/, ''),
    apiKey: (process.env.AI_API_KEY || '').trim(),
    model: (process.env.AI_MODEL || '').trim(),
    jsonMode: bool(process.env.AI_JSON_MODE, true),
    vision: bool(process.env.AI_VISION, true),
    mock: bool(process.env.MOCK_AI, false),
  },
  defaultVatRate: Number(process.env.DEFAULT_VAT_RATE || 12),
  defaultCurrency: process.env.DEFAULT_CURRENCY || 'UZS',
};
