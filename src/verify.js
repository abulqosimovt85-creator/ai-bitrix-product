// Grounding check: every number and model code the AI wrote must also appear in the source material.
// Translation changes the words, but numbers and Latin model codes survive translation unchanged,
// so they are what we can verify. Anything not found in the source is removed and reported.

// Two readings of a comma between digits: decimal ("7,5" -> 7.5) or thousands ("1,200.50" -> 1200.50).
// A value counts as found if it matches the source under either reading.
function normalize(s, commaIsThousands = false) {
  let t = String(s).replace(/(\d)[\s  ](?=\d{3}(?!\d))/g, '$1'); // "1 200" -> "1200"
  if (commaIsThousands) t = t.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  return t.replace(/(\d),(\d)/g, '$1.$2').toLowerCase();
}

const NUM = /\d+(?:\.\d+)?/g;
// model/article codes: letters and digits mixed, e.g. GT-N19A-1, KS3000, AS260.1
const CODE = /\b(?=[a-z0-9.\-]*[a-z])(?=[a-z0-9.\-]*\d)[a-z0-9][a-z0-9.\-]*[a-z0-9]\b/g;

function canonNum(n) {
  const v = Number(n);
  return Number.isFinite(v) ? String(v) : n;
}

function makeChecker(sourceText) {
  const readings = [normalize(sourceText), normalize(sourceText, true)];
  const srcNums = new Set(readings.flatMap(r => (r.match(NUM) || []).map(canonNum)));
  const srcCompact = readings.map(r => r.replace(/[\s\-]/g, '')).join('\n');
  const missingFor = t => {
    const missing = [];
    for (const n of t.match(NUM) || []) if (!srcNums.has(canonNum(n))) missing.push(n);
    for (const c of t.match(CODE) || []) if (!srcCompact.includes(c.replace(/[\s\-]/g, ''))) missing.push(c);
    return [...new Set(missing)];
  };
  // returns the values from `text` that are not present in the source (under the best-matching reading)
  return text => {
    const a = missingFor(normalize(text));
    if (!a.length) return a;
    const b = missingFor(normalize(text, true));
    return b.length < a.length ? b : a;
  };
}

// Mutates the product (removes unverified data) and returns human-readable warnings
function verifyProduct(product, sourceText, meta) {
  const warnings = [];
  if (!sourceText || sourceText.trim().length < 30) {
    warnings.push('Источник — только изображения: данные нельзя сверить автоматически, проверьте каждое значение вручную.');
    return warnings;
  }
  const missingIn = makeChecker(sourceText);

  const lines = String(product.description || '').split('\n');
  const kept = [];
  for (const line of lines) {
    const miss = missingIn(line);
    if (miss.length) warnings.push(`Убрана строка описания «${line.trim()}» — нет в источнике: ${miss.join(', ')}`);
    else kept.push(line);
  }
  product.description = kept.join('\n').trim();

  for (const [name, value] of Object.entries(product.properties || {})) {
    if (value === null || value === undefined || value === '') continue;
    const prop = meta.properties.find(p => p.name.trim().toLowerCase() === String(name).trim().toLowerCase());
    if (prop && prop.type === 'L') continue; // list values are matched against Bitrix24 options instead
    const miss = missingIn(String(value));
    if (miss.length) {
      warnings.push(`Убрано свойство «${name}: ${value}» — нет в источнике: ${miss.join(', ')}`);
      delete product.properties[name];
    }
  }

  if (product.price !== null && product.price !== undefined && product.price !== '') {
    const miss = missingIn(String(product.price));
    if (miss.length) {
      warnings.push(`Убрана цена ${product.price} — её нет в источнике`);
      product.price = null;
    }
  }

  const nameMiss = missingIn(product.name || '');
  if (nameMiss.length) warnings.push(`Проверьте название: в источнике не найдено ${nameMiss.join(', ')}`);

  return warnings;
}

module.exports = { verifyProduct, makeChecker };
