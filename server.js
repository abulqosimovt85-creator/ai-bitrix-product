const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('./src/config');
const auth = require('./src/auth');
const bitrix = require('./src/bitrix');
const { buildSource, downloadImage } = require('./src/extract');
const { draftFromSource } = require('./src/ai');

const app = express();
app.set('trust proxy', 1); // Railway terminates HTTPS in front of the app
app.disable('x-powered-by');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 6, fieldSize: 25 * 1024 * 1024 }, // fieldSize: photo sent back as a data URL
});

// "1 200,50" / "1,200.50" / "1.200,50" / 1200.5 -> 1200.5
function parsePrice(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'));
  // a separator followed by exactly 1-2 digits at the end is the decimal point; all others are thousands separators
  if (lastSep >= 0 && s.length - lastSep - 1 <= 2) s = s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + s.slice(lastSep + 1);
  else s = s.replace(/[.,]/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const asyncRoute = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Ошибка' });
});

// ---------- login ----------
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'style.css'))); // needed by the login page
app.post('/login', express.urlencoded({ extended: false }), (req, res) => {
  if (auth.tooManyAttempts(req.ip)) return res.redirect('/login?e=locked');
  if (!auth.checkPassword(req.body.password)) {
    auth.recordFailure(req.ip);
    return res.redirect('/login?e=1');
  }
  auth.setSession(req, res);
  res.redirect('/');
});
app.post('/logout', (req, res) => { auth.clearSession(res); res.redirect('/login'); });
app.get('/health', (req, res) => res.json({ ok: true }));

app.use((req, res, next) => {
  if (auth.isLoggedIn(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Войдите заново' });
  res.redirect('/login');
});

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

// ---------- API ----------
app.get('/api/meta', asyncRoute(async (req, res) => {
  const meta = await bitrix.getMeta(req.query.refresh === '1');
  const photoProp = bitrix.photoProperty(meta);
  res.json({
    ...meta,
    photoPropertyId: photoProp ? photoProp.id : null,
    defaults: { vatRate: config.defaultVatRate, currency: config.defaultCurrency },
  });
}));

// Reads the source material and returns a draft for the review form
app.post('/api/extract', upload.array('files', 6), asyncRoute(async (req, res) => {
  const source = await buildSource({ files: req.files || [], url: (req.body.url || '').trim(), text: req.body.text || '' });
  const meta = await bitrix.getMeta();
  const ai = await draftFromSource(source, meta);

  // map names returned by the AI onto Bitrix24 ids
  const norm = s => String(s || '').trim().toLowerCase();
  const properties = {};
  for (const [name, value] of Object.entries(ai.properties || {})) {
    const prop = meta.properties.find(p => norm(p.name) === norm(name));
    if (!prop || prop.type === 'F' || value === null || value === '') continue;
    if (prop.type === 'L') {
      const opt = prop.values.find(v => norm(v.value) === norm(value));
      if (opt) properties[prop.id] = opt.id;
    } else {
      properties[prop.id] = String(value);
    }
  }
  const measure = meta.measures.find(m => norm(m.name).replace(/\.$/, '') === norm(ai.measure).replace(/\.$/, '')) ||
    meta.measures.find(m => m.code === '796') || meta.measures.find(m => m.isDefault);
  const currency = meta.currencies.includes(String(ai.currency || '').toUpperCase()) ? String(ai.currency).toUpperCase() : config.defaultCurrency;
  const vat = meta.vats.find(v => v.rate === config.defaultVatRate);

  res.json({
    draft: {
      name: ai.name || '',
      description: ai.description || '',
      price: parsePrice(ai.price),
      currencyId: currency,
      vatId: vat ? vat.id : '',
      measureId: measure ? measure.id : '',
      sectionId: '',
      properties,
    },
    notes: ai.notes || '',
    photos: [
      ...source.images.map(i => ({ kind: 'upload', src: i.dataUrl, label: i.name })),
      ...ai.image_urls.map(u => ({ kind: 'url', src: u, label: 'с сайта' })),
      ...source.imageUrls.filter(i => !ai.image_urls.includes(i.url)).slice(0, 8).map(i => ({ kind: 'url', src: i.url, label: i.alt || 'с сайта' })),
    ],
  });
}));

app.post('/api/check-name', express.json(), asyncRoute(async (req, res) => {
  res.json({ matches: await bitrix.findByName(req.body.name) });
}));

// Creates the product; photo comes as an uploaded file, a page URL, or a data URL from the upload
app.post('/api/create', upload.single('photoFile'), asyncRoute(async (req, res) => {
  const draft = JSON.parse(req.body.draft || '{}');
  if (!draft.name || !draft.name.trim()) throw new Error('Укажите название товара');
  let photo = null;
  if (req.file) {
    if (!/^image\/(png|jpe?g|webp)$/.test(req.file.mimetype)) throw new Error('Фото должно быть JPG, PNG или WEBP');
    photo = { name: req.file.originalname || 'product.jpg', base64: req.file.buffer.toString('base64') };
  } else if (req.body.photoUrl) {
    photo = await downloadImage(req.body.photoUrl);
  } else if (req.body.photoData) {
    const m = String(req.body.photoData).match(/^data:image\/(png|jpe?g|webp);base64,(.+)$/);
    if (!m) throw new Error('Неверный формат фото');
    photo = { name: `product.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, base64: m[2] };
  }
  res.json(await bitrix.createProduct(draft, photo));
}));

app.listen(config.port, () => {
  console.log(`LAB-TEC Product AI on http://localhost:${config.port}`);
  if (!config.appPassword) console.warn('WARNING: APP_PASSWORD is not set - nobody can log in.');
  if (!config.sessionSecret) console.warn('WARNING: SESSION_SECRET is not set - users are logged out on every restart.');
  if (!config.bitrixWebhook) console.warn('WARNING: BITRIX_WEBHOOK_URL is not set.');
  if (config.ai.mock) console.warn('MOCK_AI is on - the AI is not called.');
});
