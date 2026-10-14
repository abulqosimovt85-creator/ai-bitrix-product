const $ = id => document.getElementById(id);
let meta = null;
let files = [];
// one entry per product found: { draft, notes, warnings, photos, selectedPhoto, photoFile, include, status, result }
let items = [];

function show(step) {
  for (const s of ['step1', 'step2']) $(s).hidden = s !== step;
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
  busy(true, 'ИИ читает материалы… (до 1–3 минут)');
  try {
    if (!meta) meta = await api('/api/meta');
    const result = await api('/api/extract', { method: 'POST', body: fd });
    loadItems(result);
    show('step2');
    items.forEach((_, i) => checkDuplicates(i));
  } catch (err) {
    showError('err1', err.message);
  } finally {
    busy(false);
  }
});

// ---------- step 2 ----------
function loadItems(result) {
  items = result.items.map(it => {
    const own = it.photoUrls.map(u => ({ kind: 'url', src: u, label: 'с сайта' }));
    const rest = result.pagePhotos.filter(p => !it.photoUrls.includes(p.src));
    const photos = [...own, ...result.uploads, ...rest];
    return { ...it, photos, selectedPhoto: own.length || result.uploads.length ? 0 : -1, photoFile: null, include: true, status: '', result: null, dupes: [] };
  });
  const global = [];
  if (result.truncated) global.push('Материалы слишком большие — ИИ прочитал только начало. Если каких-то товаров не хватает, загрузите остальные страницы отдельно.');
  if (result.notes) global.push('Заметки ИИ: ' + result.notes);
  showError('globalNotes', global.join('\n'));
  $('selectAll').checked = true;
  renderItems();
}

function options(list, value, label, key = 'id') {
  return list.map(o => `<option value="${esc(o[key])}" ${String(o[key]) === String(value) ? 'selected' : ''}>${esc(label(o))}</option>`).join('');
}

function propInput(i, p, value) {
  const v = value ?? '';
  const attrs = `data-i="${i}" data-prop="${p.id}"`;
  if (p.type === 'L') return `<select ${attrs}><option value="">—</option>${options(p.values, v, o => o.value)}</select>`;
  if (p.userType === 'Date' || p.userType === 'DateTime') return `<input ${attrs} placeholder="ДД.ММ.ГГГГ" value="${esc(v)}">`;
  if (p.type === 'N') return `<input ${attrs} type="number" step="any" value="${esc(v)}">`;
  return `<input ${attrs} value="${esc(v)}">`;
}

function photosHtml(i) {
  const it = items[i];
  const tiles = it.photos.map((p, k) =>
    `<button type="button" class="photo ${k === it.selectedPhoto && !it.photoFile ? 'sel' : ''}" data-i="${i}" data-k="${k}" title="${esc(p.label)}"><img src="${esc(p.src)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.classList.add('broken')"></button>`).join('');
  return tiles + `<button type="button" class="photo none ${it.selectedPhoto === -1 && !it.photoFile ? 'sel' : ''}" data-i="${i}" data-k="-1">Без фото</button>`;
}

function itemHtml(it, i) {
  const d = it.draft;
  const done = it.status === 'done';
  const warn = [...it.warnings, ...(it.notes ? ['Заметки ИИ: ' + it.notes] : []), ...(it.dupes.length ? ['Похожие товары уже есть в каталоге: ' + it.dupes.map(m => `${m.name} (ID ${m.id})`).join('; ')] : [])];
  return `
  <article class="card item ${done ? 'done' : ''}" data-i="${i}">
    <header class="item-head">
      <label class="check"><input type="checkbox" class="include" data-i="${i}" ${it.include && !done ? 'checked' : ''} ${done ? 'disabled' : ''}>
        <strong>Товар ${i + 1}:</strong> <span class="item-name">${esc(d.name) || '(без названия)'}</span></label>
      ${done ? `<a class="badge ok" href="${esc(it.result.url)}" target="_blank" rel="noopener">создан · ID ${esc(it.result.id)}</a>` : ''}
      ${it.status === 'error' ? `<span class="badge err">ошибка</span>` : ''}
    </header>
    ${it.status === 'error' ? `<p class="error">${esc(it.result)}</p>` : ''}
    ${warn.length ? `<p class="warn">${warn.map(esc).join('\n')}</p>` : ''}
    <fieldset ${done ? 'disabled' : ''}>
      <div class="grid">
        <label class="field wide">Название *<input data-i="${i}" data-f="name" value="${esc(d.name)}"></label>
        <label class="field wide">Описание (печатается в КП под названием)<textarea data-i="${i}" data-f="description" rows="10">${esc(d.description)}</textarea></label>
        <label class="field">Цена<input data-i="${i}" data-f="price" type="number" step="0.01" min="0" value="${esc(d.price ?? '')}"></label>
        <label class="field">Валюта<select data-i="${i}" data-f="currencyId">${meta.currencies.map(c => `<option ${c === d.currencyId ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
        <label class="field">НДС<select data-i="${i}" data-f="vatId"><option value="">Без НДС</option>${options(meta.vats, d.vatId, v => v.name)}</select></label>
        <label class="field">Единица измерения<select data-i="${i}" data-f="measureId">${options(meta.measures, d.measureId, m => m.name)}</select></label>
        <label class="field wide">Раздел каталога<select data-i="${i}" data-f="sectionId"><option value="">— без раздела —</option>${options(meta.sections, d.sectionId, s => s.name)}</select></label>
      </div>
      <details>
        <summary>Свойства</summary>
        <div class="grid">${meta.properties.filter(p => p.type !== 'F' && p.type !== 'E')
          .map(p => `<label class="field">${esc(p.name)}${propInput(i, p, d.properties[p.id])}</label>`).join('')}</div>
      </details>
      <h3>Фото товара</h3>
      <div class="photos" data-photos="${i}">${photosHtml(i)}</div>
      <label class="field">Или загрузите своё фото<input type="file" class="photoFile" data-i="${i}" accept="image/png,image/jpeg,image/webp"></label>
    </fieldset>
  </article>`;
}

function renderItems() {
  $('items').innerHTML = items.map(itemHtml).join('');
  updateCount();
}

function updateCount() {
  const pending = items.filter(it => it.status !== 'done');
  const selected = pending.filter(it => it.include).length;
  const doneCount = items.length - pending.length;
  $('countInfo').textContent = `Найдено товаров: ${items.length}` + (doneCount ? ` · создано: ${doneCount}` : '');
  $('createBtn').textContent = selected ? `Создать выбранные (${selected})` : 'Создать выбранные';
  $('createBtn').disabled = !selected;
}

// keep the in-memory drafts in sync with the form
$('items').addEventListener('input', e => {
  const el = e.target;
  const i = Number(el.dataset.i);
  if (Number.isNaN(i) || !items[i]) return;
  const d = items[i].draft;
  if (el.dataset.f) {
    d[el.dataset.f] = el.dataset.f === 'price' ? (el.value === '' ? null : Number(el.value)) : el.value;
    if (el.dataset.f === 'name') el.closest('.item').querySelector('.item-name').textContent = el.value || '(без названия)';
  } else if (el.dataset.prop) {
    if (el.value.trim() === '') delete d.properties[el.dataset.prop];
    else d.properties[el.dataset.prop] = el.value.trim();
  }
});
$('items').addEventListener('change', e => {
  const el = e.target;
  const i = Number(el.dataset.i);
  if (el.classList.contains('include')) { items[i].include = el.checked; updateCount(); }
  if (el.classList.contains('photoFile')) {
    items[i].photoFile = el.files[0] || null;
    el.closest('.item').querySelector('[data-photos]').innerHTML = photosHtml(i);
  }
  if (el.dataset.f === 'name') checkDuplicates(i);
});
$('items').addEventListener('click', e => {
  const b = e.target.closest('.photo');
  if (!b) return;
  const i = Number(b.dataset.i);
  items[i].selectedPhoto = Number(b.dataset.k);
  items[i].photoFile = null;
  const card = b.closest('.item');
  card.querySelector('.photoFile').value = '';
  card.querySelector('[data-photos]').innerHTML = photosHtml(i);
});
$('selectAll').addEventListener('change', e => {
  items.forEach(it => { if (it.status !== 'done') it.include = e.target.checked; });
  document.querySelectorAll('.include:not(:disabled)').forEach(c => { c.checked = e.target.checked; });
  updateCount();
});

async function checkDuplicates(i) {
  const name = (items[i].draft.name || '').trim();
  if (!name) return;
  try {
    const { matches } = await api('/api/check-name', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    items[i].dupes = matches;
    const card = document.querySelector(`.item[data-i="${i}"]`);
    if (card) { card.outerHTML = itemHtml(items[i], i); }
  } catch { /* duplicate check is only a hint */ }
}

$('backBtn').addEventListener('click', () => {
  if (items.some(it => it.status !== 'done' && it.include) && !confirm('Несозданные товары будут потеряны. Продолжить?')) return;
  files = []; renderFiles();
  $('url').value = ''; $('text').value = '';
  show('step1');
});

async function createOne(it) {
  const draft = { ...it.draft, name: (it.draft.name || '').trim(), description: (it.draft.description || '').trim() };
  if (!draft.name) throw new Error('Укажите название товара');
  const fd = new FormData();
  fd.append('draft', JSON.stringify(draft));
  if (it.photoFile) fd.append('photoFile', it.photoFile);
  else if (it.selectedPhoto >= 0) {
    const p = it.photos[it.selectedPhoto];
    fd.append(p.kind === 'url' ? 'photoUrl' : 'photoData', p.src);
  }
  return api('/api/create', { method: 'POST', body: fd });
}

$('createBtn').addEventListener('click', async () => {
  showError('err2');
  const queue = items.map((it, i) => i).filter(i => items[i].include && items[i].status !== 'done');
  if (!queue.length) return;
  let ok = 0;
  for (const [n, i] of queue.entries()) {
    busy(true, `Создаём товар ${n + 1} из ${queue.length}…`);
    try {
      items[i].result = await createOne(items[i]);
      items[i].status = 'done';
      ok++;
    } catch (err) {
      items[i].status = 'error';
      items[i].result = err.message;
    }
  }
  busy(false);
  renderItems();
  const failed = queue.length - ok;
  if (failed) showError('err2', `Создано: ${ok}, с ошибкой: ${failed}. Исправьте отмеченные товары и нажмите ещё раз.`);
  window.scrollTo(0, 0);
});
