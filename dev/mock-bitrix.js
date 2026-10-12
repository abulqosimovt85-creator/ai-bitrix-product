// Local stand-in for the Bitrix24 REST webhook, for testing without a real portal.
// Run: npm run mock-bitrix  ->  BITRIX_WEBHOOK_URL=http://localhost:4000/rest/1/test/
const express = require('express');
const app = express();
app.use(express.json({ limit: '50mb' }));

const properties = [
  { ID: 101, NAME: 'Номер запроса', CODE: 'REQUEST_NO', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 102, NAME: 'Номер КП', CODE: 'CO_NO', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 103, NAME: 'Дата', CODE: 'DATE', PROPERTY_TYPE: 'S', USER_TYPE: 'Date', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 104, NAME: 'Код ТН ВЭД', CODE: 'HS_CODE', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 105, NAME: 'Вес (кг)', CODE: 'WEIGHT', PROPERTY_TYPE: 'N', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 106, NAME: 'Объем (м3)', CODE: 'VOLUME', PROPERTY_TYPE: 'N', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 107, NAME: 'Срок гарантии', CODE: 'WARRANTY', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 108, NAME: 'Поставщик', CODE: 'SUPPLIER', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 109, NAME: 'Страна происхождения', CODE: 'COUNTRY', PROPERTY_TYPE: 'S', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 110, NAME: 'Условия поставки', CODE: 'INCOTERMS', PROPERTY_TYPE: 'L', MULTIPLE: 'N', ACTIVE: 'Y',
    VALUES: { 1: { ID: 1, VALUE: 'EXW' }, 2: { ID: 2, VALUE: 'FOB' }, 3: { ID: 3, VALUE: 'CIF' }, 4: { ID: 4, VALUE: 'DAP' } } },
  { ID: 111, NAME: 'Международная доставка', CODE: 'INTL_DELIVERY', PROPERTY_TYPE: 'N', MULTIPLE: 'N', ACTIVE: 'Y' },
  { ID: 112, NAME: 'Картинки', CODE: 'MORE_PHOTO', PROPERTY_TYPE: 'F', MULTIPLE: 'Y', ACTIVE: 'Y' },
];
const products = [{ ID: 31, NAME: 'KS 3000 i control IKA' }];
let nextId = 500;

const handlers = {
  'crm.product.property.list': () => properties,
  'crm.productsection.list': () => [{ ID: 1, NAME: 'Лабораторное оборудование' }, { ID: 2, NAME: 'Микроскопы' }],
  'crm.measure.list': () => [{ ID: 5, CODE: 796, SYMBOL_RUS: 'шт', IS_DEFAULT: 'Y' }, { ID: 6, CODE: 166, SYMBOL_RUS: 'кг', IS_DEFAULT: 'N' }],
  'crm.vat.list': () => [{ ID: 1, NAME: 'Без НДС', RATE: null, ACTIVE: 'Y' }, { ID: 3, NAME: 'НДС 12%', RATE: '12.00', ACTIVE: 'Y' }],
  'crm.currency.list': () => [{ CURRENCY: 'UZS' }, { CURRENCY: 'USD' }, { CURRENCY: 'EUR' }, { CURRENCY: 'RUB' }],
  'crm.product.list': body => {
    const q = String(body.filter?.['%NAME'] || '').toLowerCase();
    return products.filter(p => p.NAME.toLowerCase().includes(q));
  },
  'crm.product.add': body => {
    const f = body.fields || {};
    const summary = JSON.parse(JSON.stringify(f, (k, v) => (Array.isArray(v) && v.length === 2 && typeof v[1] === 'string' && v[1].length > 100 ? [v[0], `<base64 ${v[1].length} chars>`] : v)));
    console.log('crm.product.add', JSON.stringify(summary, null, 2));
    const id = nextId++;
    products.push({ ID: id, NAME: f.NAME });
    return id;
  },
};

app.post('/rest/:user/:token/:method', (req, res) => {
  const method = req.params.method.replace(/\.json$/, '');
  const h = handlers[method];
  if (!h) return res.json({ error: 'ERROR_METHOD_NOT_FOUND', error_description: `Method not found: ${method}` });
  res.json({ result: h(req.body), total: 0 });
});

app.listen(4000, () => console.log('Mock Bitrix24 on http://localhost:4000/rest/1/test/'));
