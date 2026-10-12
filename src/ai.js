// Asks an OpenAI-compatible chat model to turn the source material into a catalog draft.
const config = require('./config');

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
По материалам поставщика (PDF, страница сайта, текст или фото) подготовь карточку товара для каталога Bitrix24.

Верни ТОЛЬКО JSON такого вида:
{
  "name": "короткое название для каталога: модель и производитель, как у поставщика, например \\"KS 3000 i control IKA\\"",
  "description": "описание на русском языке",
  "price": число или null,
  "currency": "код валюты (USD, EUR, CNY, RUB, UZS) или null",
  "measure": "единица измерения, например \\"шт\\"",
  "properties": { "<точное название свойства из списка ниже>": "значение" },
  "image_urls": ["ссылки на фото самого товара из списка изображений страницы, лучшее первым"],
  "notes": "что не удалось найти или в чём ты не уверен (по-русски), иначе пустая строка"
}

Правила для "description" (так оно печатается в коммерческом предложении):
- Первая строка: полное название товара по-русски (что это за прибор) и модель, например "Шейкер-инкубатор KS 3000 i control".
- Вторая строка: "Модель: <модель>".
- Далее ключевые характеристики, каждая с новой строки в виде "Параметр: значение с единицами" (диапазоны, точность, мощность, питание, размеры, вес и т.п.), 5–15 строк, самое важное.
- Если указана комплектация, добавь строку "Комплектация:" и пункты, каждый с новой строки, начиная с "• ".
- Переводи на русский язык, единицы измерения в русской записи (мм, кг, Вт, В, Гц, об/мин, °C).
- Не придумывай характеристики, которых нет в материалах.

Свойства каталога (заполняй только те, что есть в материалах; остальные не включай):
${props || '(нет)'}

Цена: указывай только если цена этого товара явно есть в материалах. Код ТН ВЭД заполняй только если он указан в материалах; если хочешь подсказать вероятный код — напиши его в "notes", а не в свойства.`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  throw new Error('ИИ вернул ответ не в формате JSON. Попробуйте ещё раз.');
}

function mockDraft(source) {
  return {
    name: 'KS 3000 i control IKA',
    description: 'Шейкер-инкубатор KS 3000 i control\nМодель: KS 3000 i control\nДиапазон скорости: 10–500 об/мин\nДиапазон температуры: от +5 °C выше комнатной до +80 °C\nАмплитуда: 10 мм\nМакс. нагрузка: 7,5 кг\nПитание: 220–240 В, 50/60 Гц\nКомплектация:\n• Платформа AS 260.1\n• Руководство по эксплуатации',
    price: 1000000,
    currency: 'UZS',
    measure: 'шт',
    properties: { 'Поставщик': 'IKA-Werke GmbH', 'Страна происхождения': 'Germany', 'Вес (кг)': 36 },
    image_urls: source.imageUrls.slice(0, 1).map(i => i.url),
    notes: 'Тестовый режим (MOCK_AI): ИИ не вызывался.',
  };
}

async function draftFromSource(source, meta) {
  if (config.ai.mock) return mockDraft(source);
  const { baseUrl, apiKey, model } = config.ai;
  if (!baseUrl || !apiKey || !model) throw new Error('ИИ не настроен: заполните AI_BASE_URL, AI_API_KEY и AI_MODEL');
  if (source.images.length && !config.ai.vision) throw new Error('Выбранная модель ИИ не читает изображения. Используйте PDF, ссылку или текст.');

  let userText = 'Материалы о товаре:\n\n' + (source.text || '(только изображения)');
  if (source.imageUrls.length) {
    userText += '\n\nИзображения на странице (выбери фото самого товара для "image_urls"):\n' +
      source.imageUrls.map(i => `- ${i.url}${i.alt ? ` (alt: ${i.alt})` : ''}`).join('\n');
  }
  const content = [{ type: 'text', text: userText }, ...source.images.map(i => ({ type: 'image_url', image_url: { url: i.dataUrl } }))];

  const body = {
    model,
    temperature: 0.2,
    messages: [
      { role: 'system', content: buildPrompt(meta) },
      { role: 'user', content: source.images.length ? content : userText },
    ],
  };
  if (config.ai.jsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    const msg = data?.error?.message || data?.message || `HTTP ${res.status}`;
    throw new Error('Ошибка ИИ: ' + msg);
  }
  const draft = parseJson(data.choices?.[0]?.message?.content);
  // keep only image URLs that really came from the page (the model must not invent links)
  const allowed = new Set(source.imageUrls.map(i => i.url));
  draft.image_urls = (Array.isArray(draft.image_urls) ? draft.image_urls : []).filter(u => allowed.has(u));
  return draft;
}

module.exports = { draftFromSource, buildPrompt, parseJson };
