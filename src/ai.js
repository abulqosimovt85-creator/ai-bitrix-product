// Asks an OpenAI-compatible chat model to turn the source material into catalog drafts (one per product).
const config = require('./config');

const MAX_PRODUCTS = 20;

function buildPrompt(meta) {
  const props = meta.properties
    .filter(p => p.type !== 'F')
    .map(p => {
      let kind = p.type === 'N' ? 'число' : p.userType.startsWith('Date') ? 'дата ДД.ММ.ГГГГ' : 'текст';
      if (p.type === 'L') kind = 'одно из: ' + p.values.map(v => `"${v.value}"`).join(', ');
      return `- "${p.name}" (${kind})`;
    })
    .join('\n');

  return `Ты помощник отдела продаж компании LAB-TEC (Узбекистан), которая поставляет лабораторное оборудование.
По материалам поставщика (PDF, страница сайта, текст или фото) подготовь карточки товаров для каталога Bitrix24.

ГЛАВНОЕ ПРАВИЛО: используй ТОЛЬКО информацию, которая есть в материалах.
- Ничего не добавляй из своих знаний о товаре, производителе или похожих моделях.
- Не вычисляй и не пересчитывай значения (не переводи дюймы в мм, фунты в кг и т.п.) — пиши числа так, как они даны в материалах.
- Если сведений нет — не заполняй поле. Пустое поле лучше выдуманного.
- Переводить текст на русский язык можно и нужно, но смысл и числа должны совпадать с материалами.

Если в материалах несколько товаров (разные модели, исполнения, артикулы) — верни КАЖДЫЙ отдельным элементом массива "products" (не больше ${MAX_PRODUCTS}). Не смешивай характеристики разных моделей. Аксессуары и расходники, описанные как отдельные позиции с собственным артикулом, — тоже отдельные товары.

Верни ТОЛЬКО JSON такого вида:
{
  "products": [
    {
      "name": "короткое название для каталога: модель и производитель, как в материалах, например \\"KS 3000 i control IKA\\"",
      "description": "описание на русском языке",
      "price": число или null,
      "currency": "код валюты (USD, EUR, CNY, RUB, UZS) или null",
      "measure": "единица измерения, например \\"шт\\"",
      "properties": { "<точное название свойства из списка ниже>": "значение" },
      "image_urls": ["ссылки на фото ЭТОГО товара из списка изображений страницы, лучшее первым"],
      "notes": "что не удалось найти или в чём ты не уверен для этого товара (по-русски), иначе пустая строка"
    }
  ],
  "notes": "общие замечания (по-русски), иначе пустая строка"
}

Правила для "description" (так оно печатается в коммерческом предложении):
- Первая строка: название товара по-русски (тип прибора так, как он назван в материалах) и модель, например "Шейкер-инкубатор KS 3000 i control".
- Вторая строка: "Модель: <модель>".
- Далее характеристики из материалов, каждая с новой строки в виде "Параметр: значение с единицами", самое важное, до 15 строк.
- Если в материалах указана комплектация, добавь строку "Комплектация:" и пункты, каждый с новой строки, начиная с "• ".
- Единицы измерения в русской записи (мм, кг, Вт, В, Гц, об/мин, °C), но сами числа — как в материалах.

Свойства каталога (заполняй только те, значения которых прямо указаны в материалах; остальные не включай):
${props || '(нет)'}

Цена: только если цена именно этого товара явно указана в материалах. Код ТН ВЭД: только если он указан в материалах; предположения о коде пиши в "notes", а не в свойства.`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('ИИ вернул ответ не в формате JSON (возможно, ответ обрезан из-за большого объёма). Попробуйте ещё раз или загрузите меньше страниц.');
}

function mockResult(source) {
  return {
    products: [
      {
        name: 'KS 3000 i control IKA',
        description: 'Шейкер-инкубатор KS 3000 i control\nМодель: KS 3000 i control\nДиапазон скорости: 10–500 об/мин\nАмплитуда: 10 мм\nМакс. нагрузка: 7,5 кг\nПитание: 220–240 В, 50/60 Гц\nКомплектация:\n• Платформа AS 260.1',
        price: 1000000, currency: 'UZS', measure: 'шт',
        properties: { 'Поставщик': 'IKA-Werke GmbH', 'Страна происхождения': 'Germany', 'Вес (кг)': 36 },
        image_urls: source.imageUrls.slice(0, 1).map(i => i.url),
        notes: '',
      },
      {
        name: 'KS 4000 i control IKA',
        description: 'Шейкер-инкубатор KS 4000 i control\nМодель: KS 4000 i control\nДиапазон скорости: 10–300 об/мин\nОбъём камеры: 999 л',
        price: null, currency: null, measure: 'шт',
        properties: { 'Поставщик': 'IKA-Werke GmbH' },
        image_urls: [],
        notes: '',
      },
    ],
    notes: 'Тестовый режим (MOCK_AI): ИИ не вызывался.',
  };
}

// Returns { products: [...], notes }
async function draftFromSource(source, meta) {
  let result;
  if (config.ai.mock) {
    result = mockResult(source);
  } else {
    const { baseUrl, apiKey, model } = config.ai;
    if (!baseUrl || !apiKey || !model) throw new Error('ИИ не настроен: заполните AI_BASE_URL, AI_API_KEY и AI_MODEL');
    if (source.images.length && !config.ai.vision) throw new Error('Выбранная модель ИИ не читает изображения. Используйте PDF, ссылку или текст.');

    let userText = 'Материалы:\n\n' + (source.text || '(только изображения)');
    if (source.imageUrls.length) {
      userText += '\n\nИзображения на странице (выбери фото товаров для "image_urls"):\n' +
        source.imageUrls.map(i => `- ${i.url}${i.alt ? ` (alt: ${i.alt})` : ''}`).join('\n');
    }
    const content = [{ type: 'text', text: userText }, ...source.images.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))];

    const body = {
      model,
      temperature: 0,
      messages: [
        { role: 'system', content: buildPrompt(meta) },
        { role: 'user', content: source.images.length ? content : userText },
      ],
    };
    if (config.ai.jsonMode) body.response_format = { type: 'json_object' };
    if (config.ai.maxTokens) body.max_tokens = config.ai.maxTokens;

    let res;
    try {
      res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      const code = err.cause?.code || err.name || err.message;
      if (code === 'TimeoutError') throw new Error('ИИ не ответил за 3 минуты. Попробуйте ещё раз или загрузите меньше страниц.');
      throw new Error(`Не удалось связаться с ИИ (${code}). Проверьте AI_BASE_URL.`);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) {
      const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
      throw new Error('Ошибка ИИ: ' + msg);
    }
    result = parseJson(data.choices?.[0]?.message?.content);
  }

  // accept the old single-product shape as well
  let products = Array.isArray(result.products) ? result.products : (result.name ? [result] : []);
  products = products.filter(p => p && (p.name || p.description)).slice(0, MAX_PRODUCTS);
  if (!products.length) throw new Error('ИИ не нашёл в материалах ни одного товара. ' + (result.notes || ''));

  // keep only image URLs that really came from the page (the model must not invent links)
  const allowed = new Set(source.imageUrls.map(i => i.url));
  for (const p of products) p.image_urls = (Array.isArray(p.image_urls) ? p.image_urls : []).filter(u => allowed.has(u));
  return { products, notes: result.products ? (result.notes || '') : '' };
}

module.exports = { draftFromSource, buildPrompt, parseJson, MAX_PRODUCTS };
