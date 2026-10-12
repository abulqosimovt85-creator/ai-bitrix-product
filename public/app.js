const $ = id => document.getElementById(id);
let meta = null;
let files = [];
let photos = [];
let selectedPhoto = -1;

function show(step) {
  for (const s of ['step1', 'step2', 'step3']) $(s).hidden = s !== step;
  window.scrollTo(0, 0);
}
function busy(on, text) {
  $('busy').hidden = !on;
  if (text) $('busyText').textContent = text;
}
function showError(el, msg) {
  $(el).textContent = msg || '';
  $(el).hidden = !msg;
}
async function api(url, opts = {}) {
  const res = await fetch(url, opts);
  if (res.status === 401) { location.href = '/login'; throw new Error('Войдите заново'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- step 1 ----------
function renderFiles() {
  $('fileList').innerHTML = files.map((f, i) =>
    `<li>${esc(f.name)} <small>${(f.size / 1024 / 1024).toFixed(1)} МБ</small> <button class="link" data-i="${i}">убрать</button></li>`).join('');
}
$('fileList').addEventListener('click', e => {
  if (e.target.dataset.i !== undefined) { files.splice(Number(e.target.dataset.i), 1); renderFiles(); }
});
$('files').addEventListener('change', e => { files.push(...e.target.files); e.target.value = ''; renderFiles(); });
const drop = $('drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { files.push(...e.dataTransfer.files); renderFiles(); });
// paste a screenshot straight into the page
document.addEventListener('paste', e => {
  if ($('step1').hidden) return;
  const imgs = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/'));
  if (imgs.length) { files.push(...imgs); renderFiles(); }
});

$('extractBtn').addEventListener('click', async () => {
  showError('err1');
  const url = $('url').value.trim();
  const text = $('text').value;
  if (!files.length && !url && !text.trim()) return showError('err1', 'Добавьте файл, ссылку или текст о товаре');
  const fd = new FormData();
  files.forEach(f => fd.append('files', f));
  fd.append('url', url);
  fd.append('text', text);
  busy(true, 'ИИ читает материалы… (до 1–2 минут)');
  try {
    if (!meta) meta = await api('/api/meta');
    const result = await api('/api/extract', { method: 'POST', body: fd });
    fillForm(result);
    show('step2');
    checkDuplicates();
  } catch (err) {
    showError('err1', err.message);
  } finally {
    busy(false);
  }
});

// ---------- step 2 ----------
function options(list, value, label, key = 'id') {
  return list.map(o => `<option value="${esc(o[key])}" ${String(o[key]) === String(value) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
}

function propInput(p, value) {
  const v = value ?? '';
  if (p.type === 'L') {
    return `<select data-prop="${p.id}"><option value="">—</option>${options(p.values, v, o => o.value)}</select>`;
  }
  if (p.userType === 'Date' || p.userType === 'DateTime') {
    return `<input data-prop="${p.id}" placeholder="ДД.ММ.ГГГГ" value="${esc(v)}">`;
  }
  if (p.type === 'N') return `<input data-prop="${p.id}" type="number" step="any" value="${esc(v)}">`;
  return `<input data-prop="${p.id}" value="${esc(v)}">`;
}

function fillForm({ draft, notes, photos: ph }) {
  $('name').value = draft.name;
  $('description').value = draft.description;
  $('price').value = draft.price ?? '';
  $('currency').innerHTML = meta.currencies.map(c => `<option ${c === draft.currencyId ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('vat').innerHTML = `<option value="">Без НДС</option>` + options(meta.vats, draft.vatId, v => v.name);
  $('measure').innerHTML = options(meta.measures, draft.measureId, m => m.name);
  $('section').innerHTML = `<option value="">— без раздела —</option>` + options(meta.sections, draft.sectionId, s => s.name);

  $('props').innerHTML = meta.properties
    .filter(p => p.type !== 'F' && p.type !== 'E')
    .map(p => `<label class="field">${esc(p.name)}${propInput(p, draft.properties[p.id])}</label>`).join('');

  showError('notes', notes ? 'Заметки ИИ: ' + notes : '');
  photos = ph || [];
  selectedPhoto = photos.length ? 0 : -1;
  $('photoFile').value = '';
  renderPhotos();
}

function renderPhotos() {
  $('photos').innerHTML = photos.length
    ? photos.map((p, i) => `<button type="button" class="photo ${i === selectedPhoto ? 'sel' : ''}" data-i="${i}" title="${esc(p.label)}"><img src="${esc(p.src)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.classList.add('broken')"></button>`).join('') +
      `<button type="button" class="photo none ${selectedPhoto === -1 ? 'sel' : ''}" data-i="-1">Без фото</button>`
    : '<p class="muted">Фото не найдено — загрузите своё ниже или создайте товар без фото.</p>';
}
$('photos').addEventListener('click', e => {
  const b = e.target.closest('.photo');
  if (!b) return;
  selectedPhoto = Number(b.dataset.i);
  $('photoFile').value = '';
  renderPhotos();
});
$('photoFile').addEventListener('change', () => { if ($('photoFile').files.length) { selectedPhoto = -1; renderPhotos(); } });

async function checkDuplicates() {
  showError('dupes');
  const name = $('name').value.trim();
  if (!name) return;
  try {
    const { matches } = await api('/api/check-name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    if (matches.length) showError('dupes', 'Похожие товары уже есть в каталоге: ' + matches.map(m => `${m.name} (ID ${m.id})`).join('; '));
  } catch { /* duplicate check is only a hint */ }
}
$('name').addEventListener('change', checkDuplicates);

$('backBtn').addEventListener('click', () => show('step1'));

$('createBtn').addEventListener('click', async () => {
  showError('err2');
  const properties = {};
  document.querySelectorAll('[data-prop]').forEach(el => { if (el.value.trim() !== '') properties[el.dataset.prop] = el.value.trim(); });
  const draft = {
    name: $('name').value.trim(),
    description: $('description').value.trim(),
    price: $('price').value === '' ? null : Number($('price').value),
    currencyId: $('currency').value,
    vatId: $('vat').value,
    measureId: $('measure').value,
    sectionId: $('section').value,
    properties,
  };
  if (!draft.name) return showError('err2', 'Укажите название товара');

  const fd = new FormData();
  fd.append('draft', JSON.stringify(draft));
  if ($('photoFile').files[0]) fd.append('photoFile', $('photoFile').files[0]);
  else if (selectedPhoto >= 0) {
    const p = photos[selectedPhoto];
    fd.append(p.kind === 'url' ? 'photoUrl' : 'photoData', p.src);
  }

  busy(true, 'Создаём товар в Bitrix24…');
  try {
    const r = await api('/api/create', { method: 'POST', body: fd });
    $('productLink').href = r.url;
    $('productLink').textContent = `Открыть товар в Bitrix24 (ID ${r.id})`;
    show('step3');
  } catch (err) {
    showError('err2', err.message);
  } finally {
    busy(false);
  }
});

$('againBtn').addEventListener('click', () => {
  files = []; renderFiles();
  $('url').value = ''; $('text').value = '';
  show('step1');
});
