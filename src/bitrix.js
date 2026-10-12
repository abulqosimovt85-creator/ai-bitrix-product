// Bitrix24 REST client over an incoming webhook (crm.product.* API).
const config = require('./config');

async function call(method, params = {}) {
  if (!config.bitrixWebhook) throw new Error('BITRIX_WEBHOOK_URL не настроен');
  const url = config.bitrixWebhook.replace(/\/?$/, '/') + method + '.json';
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`Bitrix24 ${method}: HTTP ${res.status}`);
  if (data.error) throw new Error(`Bitrix24 ${method}: ${data.error_description || data.error}`);
  return data;
}

// list methods return 50 items per page; follow `next` until done
async function list(method, params = {}) {
  const items = [];
  let start = 0;
  for (let page = 0; page < 40; page++) {
    const data = await call(method, { ...params, start });
    items.push(...(Array.isArray(data.result) ? data.result : Object.values(data.result || {})));
    if (data.next === undefined) break;
    start = data.next;
  }
  return items;
}

// Catalog metadata for the review form, cached for a few minutes
let metaCache = null;
let metaTime = 0;

async function getMeta(force = false) {
  if (!force && metaCache && Date.now() - metaTime < 5 * 60_000) return metaCache;
  const [properties, sections, measures, vats, currencies] = await Promise.all([
    list('crm.product.property.list', { order: { SORT: 'ASC' } }),
    list('crm.productsection.list', { order: { NAME: 'ASC' } }),
    list('crm.measure.list'),
    list('crm.vat.list'),
    list('crm.currency.list'),
  ]);
  metaCache = {
    properties: properties
      .filter(p => p.ACTIVE !== 'N')
      .map(p => ({
        id: String(p.ID),
        name: p.NAME,
        code: p.CODE || '',
        type: p.PROPERTY_TYPE,                 // S string, N number, L list, F file, E element link
        userType: p.USER_TYPE || '',            // e.g. Date, DateTime, HTML
        multiple: p.MULTIPLE === 'Y',
        values: p.VALUES ? Object.values(p.VALUES).map(v => ({ id: String(v.ID), value: v.VALUE })) : [],
      })),
    sections: sections.map(s => ({ id: String(s.ID), name: s.NAME })),
    measures: measures.map(m => ({ id: String(m.ID), code: String(m.CODE), name: m.SYMBOL_RUS || m.SYMBOL || m.MEASURE_TITLE, isDefault: m.IS_DEFAULT === 'Y' })),
    vats: vats.filter(v => v.ACTIVE !== 'N').map(v => ({ id: String(v.ID), name: v.NAME, rate: v.RATE === null || v.RATE === '' ? null : Number(v.RATE) })),
    currencies: currencies.map(c => c.CURRENCY),
  };
  metaTime = Date.now();
  return metaCache;
}

// The product photo property used by the CO template ({ProductsProductPropertyMorePhoto})
function photoProperty(meta) {
  return meta.properties.find(p => p.code === 'MORE_PHOTO') || meta.properties.find(p => p.type === 'F');
}

async function findByName(name) {
  if (!name) return [];
  const data = await call('crm.product.list', { filter: { '%NAME': name.trim() }, select: ['ID', 'NAME'] });
  return (data.result || []).slice(0, 5).map(p => ({ id: String(p.ID), name: p.NAME }));
}

// draft: { name, description, price, currencyId, vatId, measureId, sectionId, properties: {id: value} }
// photo: { name, base64 } | null
async function createProduct(draft, photo) {
  const meta = await getMeta();
  const fields = {
    NAME: draft.name,
    ACTIVE: 'Y',
    DESCRIPTION: draft.description || '',
    DESCRIPTION_TYPE: 'text',
    VAT_INCLUDED: 'N',
  };
  if (draft.price !== null && draft.price !== '' && !Number.isNaN(Number(draft.price))) fields.PRICE = Number(draft.price);
  if (draft.currencyId) fields.CURRENCY_ID = draft.currencyId;
  if (draft.vatId) fields.VAT_ID = draft.vatId;
  if (draft.measureId) fields.MEASURE = draft.measureId;
  if (draft.sectionId) fields.SECTION_ID = draft.sectionId;

  for (const [id, raw] of Object.entries(draft.properties || {})) {
    const prop = meta.properties.find(p => p.id === String(id));
    if (!prop || prop.type === 'F') continue;
    const value = typeof raw === 'string' ? raw.trim() : raw;
    if (value === '' || value === null || value === undefined) continue;
    fields['PROPERTY_' + prop.id] = prop.multiple ? [{ value }] : { value };
  }

  if (photo) {
    const file = { fileData: [photo.name, photo.base64] };
    fields.PREVIEW_PICTURE = file;
    fields.DETAIL_PICTURE = file;
    const photoProp = photoProperty(meta);
    if (photoProp) fields['PROPERTY_' + photoProp.id] = photoProp.multiple ? [{ value: file }] : { value: file };
  }

  const data = await call('crm.product.add', { fields });
  const id = String(data.result);
  const portal = new URL(config.bitrixWebhook).origin;
  return { id, url: `${portal}/crm/product/show/${id}/` };
}

module.exports = { call, getMeta, findByName, createProduct, photoProperty };
