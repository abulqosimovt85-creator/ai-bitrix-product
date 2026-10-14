# LAB-TEC · Товары из документов

Web app that creates products in the Bitrix24 catalog from supplier material:
PDF / datasheet, product web page link, pasted text, or photo / screenshot.

1. A salesperson adds the material and clicks **Распознать с помощью ИИ**.
2. The AI model finds every product in the material (up to 20, e.g. all models in a brochure) and for each
   writes the Russian description in the CO style (name line, `Модель: …`, specs line by line,
   `Комплектация:` with `•` items) and fills price, currency, unit and the catalog's custom properties.
3. **Grounding check** (`src/verify.js`): every number and model code the AI wrote must also appear in the
   source. Description lines, properties or prices that are not in the source are removed and listed on the
   product card, so nothing made up reaches the catalog. (Photo-only sources cannot be checked automatically —
   the card says so.)
4. The salesperson checks/edits each product card, picks photos, ticks the products to create and clicks
   **Создать выбранные**. Each product is created separately; failures can be fixed and retried.

The photo is saved to the product pictures **and** to the `MORE_PHOTO` property, which the
commercial-offer template prints in the «Примечания» column.

The review form is built from the portal's own catalog properties (`crm.product.property.list`),
so new properties added in Bitrix24 appear automatically.

## Settings (environment variables)

| Variable | Required | Meaning |
|---|---|---|
| `APP_PASSWORD` | yes | Password the team uses to log in |
| `SESSION_SECRET` | yes | Long random string for signing login cookies |
| `BITRIX_WEBHOOK_URL` | yes | Bitrix24 incoming webhook, e.g. `https://xxx.bitrix24.ru/rest/1/abc123/` |
| `AI_BASE_URL` | yes | OpenAI-compatible API base, e.g. `https://api.openai.com/v1` |
| `AI_API_KEY` | yes | API key of the AI provider |
| `AI_MODEL` | yes | Model name. Use a model that can read images if you want photo/screenshot input |
| `AI_JSON_MODE` | no | `true` (default). Set `false` if the provider rejects `response_format` |
| `AI_VISION` | no | `true` (default). Set `false` if the model cannot read images |
| `AI_MAX_TOKENS` | no | Max answer length; raise it (e.g. `8000`) if brochures with many products come back cut off |
| `MAX_SOURCE_CHARS` | no | How much source text is sent to the AI, default `40000`; lower it for providers with small limits |
| `DEFAULT_VAT_RATE` | no | Default VAT for new products, `12` |
| `DEFAULT_CURRENCY` | no | Used when the source has no currency, `UZS` |

Generate a `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Bitrix24 webhook

Bitrix24 → **Разработчикам** → **Другое** → **Входящий вебхук** → permissions **CRM (crm)** and
**Торговый каталог (catalog)** → save → copy the webhook URL.
The webhook acts with the rights of the user who created it, so create it as an administrator
(or a user allowed to add products). Keep the URL secret: anyone with it can change your CRM.

### AI provider

Any provider with an OpenAI-compatible `/chat/completions` endpoint works, for example:

| Provider | `AI_BASE_URL` |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| DeepSeek (text only → `AI_VISION=false`) | `https://api.deepseek.com/v1` |
| OpenRouter (many models) | `https://openrouter.ai/api/v1` |

## Deploy to Railway

1. Push this folder to a GitHub repository (the `.gitignore` keeps `.env` and `node_modules` out).
2. Railway → **New Project** → **Deploy from GitHub repo** → pick the repository.
   Railway detects Node.js and runs `npm start`; it sets `PORT` itself.
3. Service → **Variables** → add the variables from the table above.
4. Service → **Settings** → **Networking** → **Generate Domain** → open the URL and log in.

Health check endpoint: `/health`.

## Run locally

```bash
npm install
cp .env.example .env    # fill in the values
npm run dev             # http://localhost:3000
```

### Test without a real portal or AI key

```bash
npm run mock-bitrix                                  # fake Bitrix24 on :4000, prints what would be created
node --env-file=dev/test.env server.js               # app on :3000, password "test", AI mocked
node dev/test-ai.js                                  # checks the AI request/response handling
```

## Notes

- Scanned PDFs have no text layer; upload them as photos/screenshots of the pages instead.
- Some sites block automated downloads; then paste the page text or upload a PDF/screenshot.
- The AI may misread specs or prices: the review step is there so a person confirms every product.
- `Код ТН ВЭД` is filled only when it is in the source; a guessed code is shown in the AI notes instead.
