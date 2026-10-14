// Turns user input (PDF, web page, text, images) into text + image candidates for the AI.
const dns = require('dns').promises;
const net = require('net');
const cheerio = require('cheerio');
const pdfParse = require('pdf-parse/lib/pdf-parse.js'); // direct path avoids pdf-parse's debug self-test

const config = require('./config');
const MAX_DOWNLOAD = 8 * 1024 * 1024;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

// Only public http(s) addresses; re-checked on every redirect
async function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('Неверная ссылка'); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('Поддерживаются только ссылки http/https');
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error('Не удалось найти сайт: ' + u.hostname);
  if (addrs.some(a => isPrivateIp(a.address))) throw new Error('Эта ссылка недоступна');
  return u;
}

const CERT_ERRORS = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/;

async function safeFetch(raw, accept) {
  let url = raw;
  const badCertHosts = new Set();
  for (let i = 0; i < 5; i++) {
    const u = await assertPublicUrl(url);
    let res;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LabtecProductAI/1.0)', Accept: accept },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      const code = err.cause?.code || err.name || '';
      // Supplier sites often have a broken HTTPS certificate: read the public page over http instead
      if (u.protocol === 'https:' && CERT_ERRORS.test(code) && !badCertHosts.has(u.hostname)) {
        badCertHosts.add(u.hostname);
        url = 'http://' + u.host + u.pathname + u.search;
        continue;
      }
      if (CERT_ERRORS.test(code)) throw new Error(`У сайта ${u.hostname} неисправный сертификат безопасности. Скопируйте текст страницы или загрузите PDF/скриншот.`);
      if (code === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT') throw new Error(`Сайт ${u.hostname} не ответил вовремя. Скопируйте текст страницы или загрузите PDF/скриншот.`);
      throw new Error(`Не удалось открыть сайт ${u.hostname} (${code || err.message}). Скопируйте текст страницы или загрузите PDF/скриншот.`);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`Сайт ответил ошибкой ${res.status}`);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_DOWNLOAD) throw new Error('Файл по ссылке слишком большой');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_DOWNLOAD) throw new Error('Файл по ссылке слишком большой');
    return { buf, type: (res.headers.get('content-type') || '').toLowerCase(), finalUrl: u.toString() };
  }
  throw new Error('Слишком много перенаправлений');
}

async function pdfToText(buf) {
  const data = await pdfParse(buf);
  return (data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function htmlToSource(html, baseUrl) {
  const $ = cheerio.load(html);
  const abs = s => { try { return new URL(s, baseUrl).toString(); } catch { return null; } };
  const images = [];
  const addImg = (src, alt) => {
    const u = src && abs(src);
    if (!u || !/^https?:/.test(u) || /\.(svg|gif)(\?|$)/i.test(u) || /logo|icon|sprite|banner|flag/i.test(u)) return;
    if (!images.some(i => i.url === u)) images.push({ url: u, alt: (alt || '').trim().slice(0, 120) });
  };
  addImg($('meta[property="og:image"]').attr('content'), 'og:image');
  $('img').each((_, el) => addImg($(el).attr('data-src') || $(el).attr('src'), $(el).attr('alt')));
  $('script, style, noscript, nav, footer, header, iframe, svg, form').remove();
  const title = $('title').first().text().trim();
  const text = $('body').text().replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text, images: images.slice(0, 20) };
}

// files: multer files; returns { text, images: [{dataUrl}], imageUrls: [{url, alt}] }
async function buildSource({ files = [], url = '', text = '' }) {
  const parts = [];
  const images = [];
  let imageUrls = [];

  for (const f of files) {
    const type = (f.mimetype || '').toLowerCase();
    if (type === 'application/pdf' || /\.pdf$/i.test(f.originalname)) {
      const t = await pdfToText(f.buffer);
      if (t.length < 30) throw new Error(`В PDF «${f.originalname}» нет текста (скан). Загрузите его как фото/скриншот страниц.`);
      parts.push(`=== PDF: ${f.originalname} ===\n${t}`);
    } else if (/^image\/(png|jpe?g|webp)$/.test(type)) {
      images.push({ name: f.originalname, dataUrl: `data:${type};base64,${f.buffer.toString('base64')}` });
    } else if (/^text\//.test(type) || /\.(txt|csv)$/i.test(f.originalname)) {
      parts.push(`=== Файл: ${f.originalname} ===\n${f.buffer.toString('utf8')}`);
    } else {
      throw new Error(`Формат файла «${f.originalname}» не поддерживается (нужен PDF, JPG, PNG, WEBP или TXT)`);
    }
  }

  if (url) {
    const { buf, type, finalUrl } = await safeFetch(url, 'text/html,application/pdf,*/*');
    if (type.includes('pdf')) {
      parts.push(`=== PDF по ссылке: ${finalUrl} ===\n${await pdfToText(buf)}`);
    } else {
      const page = htmlToSource(buf.toString('utf8'), finalUrl);
      parts.push(`=== Страница: ${finalUrl} ===\nЗаголовок: ${page.title}\n${page.text}`);
      imageUrls = page.images;
    }
  }

  if (text && text.trim()) parts.push(`=== Текст от пользователя ===\n${text.trim()}`);

  let joined = parts.join('\n\n');
  const truncated = joined.length > config.maxSourceChars;
  if (truncated) joined = joined.slice(0, config.maxSourceChars) + '\n[...текст обрезан...]';
  if (!joined && !images.length) throw new Error('Добавьте файл, ссылку или текст о товаре');
  return { text: joined, images, imageUrls, truncated };
}

// Downloads a chosen product photo (from the page) for upload to Bitrix24
async function downloadImage(url) {
  const { buf, type } = await safeFetch(url, 'image/*');
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('jpeg') || type.includes('jpg') ? 'jpg' : null;
  if (!ext) throw new Error('По ссылке не изображение (JPG/PNG/WEBP)');
  return { name: `product.${ext}`, base64: buf.toString('base64') };
}

module.exports = { buildSource, downloadImage, isPrivateIp };
