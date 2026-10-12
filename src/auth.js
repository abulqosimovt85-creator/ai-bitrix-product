// Password login with an HMAC-signed cookie (no session storage needed).
const crypto = require('crypto');
const config = require('./config');

const COOKIE = 'lpa_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000;
const secret = config.sessionSecret || crypto.randomBytes(32).toString('hex'); // random secret = logins reset on restart

const sign = v => crypto.createHmac('sha256', secret).update(v).digest('hex');

function readCookie(req) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function isLoggedIn(req) {
  const c = readCookie(req);
  if (!c) return false;
  const [exp, sig] = c.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

function setSession(req, res) {
  const exp = String(Date.now() + MAX_AGE_MS);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_MS / 1000}${secure}`);
}

function clearSession(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// simple brute-force brake: 10 failed attempts per IP per 15 minutes
const failures = new Map();
function tooManyAttempts(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 15 * 60_000) return false;
  return f.count >= 10;
}
function recordFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 15 * 60_000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

function checkPassword(given) {
  if (!config.appPassword) return false;
  const a = crypto.createHash('sha256').update(String(given || '')).digest();
  const b = crypto.createHash('sha256').update(config.appPassword).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { isLoggedIn, setSession, clearSession, tooManyAttempts, recordFailure, checkPassword };
