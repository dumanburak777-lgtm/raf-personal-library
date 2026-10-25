const { app, BrowserWindow, ipcMain, session, shell, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const http = require('node:http');

app.setPath('userData', path.join(app.getPath('appData'), 'RAF'));

const CATEGORY_IDS = ['film', 'series', 'anime', 'donghua', 'manga', 'novel', 'book'];
const appData = () => path.join(app.getPath('userData'), 'RAFData');
const accountIndex = () => path.join(appData(), 'accounts.json');
let sessionUser = null;
const failedLogins = new Map();

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}
function derive(password, salt) {
  return crypto.scryptSync(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}
function verifier(key) {
  return crypto.createHmac('sha256', key).update('raf-local-account-check-v1').digest();
}
function accountDir(id) { return path.join(appData(), 'accounts', id); }
function seal(value, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), body: body.toString('base64') };
}
function unseal(record, key) {
  if (!record || record.v !== 1) throw new Error('Bu dosya biçimi tanınmıyor.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.body, 'base64')), decipher.final()]).toString('utf8'));
}
function currentKey() {
  if (!sessionUser) throw new Error('Önce yerel hesabınla giriş yap.');
  return sessionUser.key;
}
function userSafe(user) { return { id: user.id, email: user.email, name: user.name, googleLinked: !!user.googleSub }; }
function checkedForumOrigin(input) {
  let url;
  try { url = new URL(input); } catch { throw new Error('Forum adresi geçerli değil.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Forum adresi https:// ile başlamalı ve yalnızca alan adı içermeli.');
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) throw new Error('Güvenlik için yerel ağ adresleri desteklenmiyor.');
  return url.origin;
}
function forumCredential() {
  const f = path.join(accountDir(sessionUser.id), 'connections', 'discourse.enc');
  if (!fs.existsSync(f)) return null;
  return unseal(readJson(f, null), currentKey());
}
async function discourseRequest(route, options = {}) {
  const config = forumCredential();
  if (!config) throw new Error('Önce Discourse hesabını bağla.');
  if (!/^\/(topics\/private-messages\/|t\/\d+\.json$|posts\.json$|user-api-key\/revoke$)/.test(route)) throw new Error('Bu forum işlemi desteklenmiyor.');
  const response = await fetch(`${config.origin}${route}`, {
    method: options.method || 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Api-Key': config.apiKey, 'User-Api-Client-Id': 'app.raf.library' },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const body = await response.text();
  let data; try { data = body ? JSON.parse(body) : {}; } catch { data = {}; }
  if (!response.ok) throw new Error(data.errors?.join(' ') || `Forum yanıtı: ${response.status}`);
  return data;
}

ipcMain.handle('raf:discourse-connect', async (_event, input) => {
  currentKey();
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Bu işletim sisteminde güvenli yerel saklama hazır değil; forum bağlantısı kapalı kaldı.');
  const origin = checkedForumOrigin(input?.origin);
  const nonce = crypto.randomBytes(24).toString('hex');
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  const callback = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.close(); reject(new Error('Forum hesabı bağlama zaman aşımına uğradı.')); }, 180_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      if (u.pathname !== '/raf-discourse-callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end('<meta charset="utf-8"><title>RAF</title><p style="font:18px sans-serif">Forum onayı alındı. Bu pencereyi kapatıp RAF uygulamasına dönebilirsin.</p>');
      clearTimeout(timeout); server.close(); resolve(u);
    });
  });
  const params = new URLSearchParams({ application_name: 'RAF Desktop', client_id: 'app.raf.library', auth_redirect: `http://127.0.0.1:${port}/raf-discourse-callback`, nonce, scopes: 'read,write', public_key: publicKey, padding: 'oaep' });
  await shell.openExternal(`${origin}/user-api-key/new?${params}`);
  let responseUrl;
  try { responseUrl = await callback; } catch (e) { throw e; }
  const payload = responseUrl.searchParams.get('payload');
  if (!payload) throw new Error('Forum anahtarı alınamadı. Yetkiyi iptal etmiş olabilirsin.');
  let result;
  try { result = JSON.parse(crypto.privateDecrypt({ key: privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(payload, 'base64')).toString('utf8')); }
  catch { throw new Error('Forumdan gelen izin yanıtı doğrulanamadı.'); }
  if (result.nonce !== nonce || !result.key) throw new Error('Forum bağlantı doğrulaması başarısız.');
  const keyResponse = await fetch(`${origin}/session/current.json`, { headers: { 'Accept': 'application/json', 'User-Api-Key': result.key, 'User-Api-Client-Id': 'app.raf.library' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!keyResponse.ok) throw new Error('Forum hesabı doğrulanamadı.');
  const profile = await keyResponse.json();
  const record = { origin, apiKey: result.key, username: profile.current_user?.username || profile.username };
  if (!record.username) throw new Error('Forum kullanıcı adı alınamadı.');
  writeJsonAtomic(path.join(accountDir(sessionUser.id), 'connections', 'discourse.enc'), seal(record, currentKey()));
  return { origin, username: record.username };
});
ipcMain.handle('raf:discourse-status', () => { const c = forumCredential(); return c ? { origin: c.origin, username: c.username } : null; });
ipcMain.handle('raf:discourse-rooms', async () => {
  const c = forumCredential(); if (!c) return null;
  return discourseRequest(`/topics/private-messages/${encodeURIComponent(c.username)}.json`);
});
ipcMain.handle('raf:discourse-room', (_event, id) => {
  const roomId = Number(id); if (!Number.isSafeInteger(roomId) || roomId < 1) throw new Error('Sohbet odası tanınmıyor.');
  return discourseRequest(`/t/${roomId}.json`);
});
ipcMain.handle('raf:discourse-create-room', (_event, input) => {
  const recipients = String(input?.recipients || '').trim();
  const title = String(input?.title || '').trim().slice(0, 120);
  const body = String(input?.body || '').trim().slice(0, 20_000);
  if (!recipients || !title || !body) throw new Error('Oda adı, en az bir forum kullanıcı adı ve ilk mesaj gerekli.');
  return discourseRequest('/posts.json', { method: 'POST', body: { title, raw: body, target_recipients: recipients, archetype: 'private_message' } });
});
ipcMain.handle('raf:discourse-reply', (_event, input) => {
  const topicId = Number(input?.topicId); const body = String(input?.body || '').trim().slice(0, 20_000);
  if (!Number.isSafeInteger(topicId) || topicId < 1 || !body) throw new Error('Mesaj boş bırakılamaz.');
  return discourseRequest('/posts.json', { method: 'POST', body: { topic_id: topicId, raw: body } });
});
ipcMain.handle('raf:discourse-disconnect', async () => {
  const c = forumCredential(); if (!c) return true;
  try { await discourseRequest('/user-api-key/revoke', { method: 'POST', body: {} }); } finally { fs.rmSync(path.join(accountDir(sessionUser.id), 'connections', 'discourse.enc'), { force: true }); }
  return true;
});

ipcMain.handle('raf:register', (_event, input) => {
  const email = String(input?.email || '').trim().toLowerCase();
  const name = String(input?.name || '').trim().slice(0, 80);
  const password = String(input?.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Geçerli e-posta adresi yaz.');
  if (password.length < 12) throw new Error('Parolan en az 12 karakter olmalı.');
  const users = readJson(accountIndex(), []);
  if (users.some(user => user.email === email)) throw new Error('Bu e-posta ile yerel hesap zaten var.');
  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16);
  const key = derive(password, salt);
  const user = { id, email, name, salt: salt.toString('base64'), check: verifier(key).toString('base64'), createdAt: new Date().toISOString() };
  writeJsonAtomic(accountIndex(), [...users, user]);
  sessionUser = { ...userSafe(user), key };
  fs.mkdirSync(path.join(accountDir(id), 'library'), { recursive: true, mode: 0o700 });
  return userSafe(user);
});

ipcMain.handle('raf:login', (_event, input) => {
  const email = String(input?.email || '').trim().toLowerCase();
  const password = String(input?.password || '');
  const now = Date.now();
  const state = failedLogins.get(email) || { count: 0, since: now };
  if (now - state.since > 60_000) { state.count = 0; state.since = now; }
  if (state.count >= 5) throw new Error('Çok fazla deneme yapıldı. Bir dakika bekleyip yeniden dene.');
  const user = readJson(accountIndex(), []).find(item => item.email === email);
  if (user) {
    const key = derive(password, Buffer.from(user.salt, 'base64'));
    const actual = verifier(key), expected = Buffer.from(user.check, 'base64');
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
      failedLogins.delete(email);
      sessionUser = { ...userSafe(user), key };
      return userSafe(user);
    }
  }
  state.count += 1; failedLogins.set(email, state);
  throw new Error('E-posta veya parola eşleşmedi.');
});
ipcMain.handle('raf:google-login', async (_event, input) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Google hesabı için bu cihazın güvenli anahtar kasası hazır değil.');
  const clientId = String(input?.clientId || '').trim();
  if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Google OAuth masaüstü istemci kimliği geçerli değil. Google Cloud Console’dan Desktop app kimliği oluştur.');
  const state = crypto.randomBytes(24).toString('hex');
  const verifierCode = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifierCode).digest('base64url');
  const server = http.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port, redirectUri = `http://127.0.0.1:${port}/raf-google-callback`;
  const callback = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { server.close(); reject(new Error('Google oturum açma zaman aşımına uğradı.')); }, 180_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirectUri);
      if (u.pathname !== '/raf-google-callback') { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
      res.end('<meta charset="utf-8"><title>RAF</title><p style="font:18px sans-serif">Google hesabın doğrulandı. Bu pencereyi kapatıp RAF uygulamasına dönebilirsin.</p>');
      clearTimeout(timeout); server.close(); resolve(u);
    });
  });
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'online' });
  await shell.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  const response = await callback;
  if (response.searchParams.get('state') !== state) throw new Error('Google oturum yanıtının güvenlik doğrulaması başarısız.');
  if (response.searchParams.get('error')) throw new Error('Google oturum açma işlemi iptal edildi.');
  const code = response.searchParams.get('code'); if (!code) throw new Error('Google yetkilendirme kodu alınamadı.');
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, code, code_verifier: verifierCode, redirect_uri: redirectUri, grant_type: 'authorization_code' }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
  const tokens = await tokenRes.json(); if (!tokenRes.ok || !tokens.access_token) throw new Error('Google yetkilendirmesi tamamlanamadı. OAuth istemci türünü Desktop app olarak ayarla.');
  const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  const profile = await profileRes.json();
  if (!profileRes.ok || !profile.sub || profile.email_verified !== true || !/^\S+@\S+\.\S+$/.test(profile.email || '')) throw new Error('Google e-posta adresi doğrulanamadı.');
  const users = readJson(accountIndex(), []); let user = users.find(u => u.googleSub === profile.sub);
  if (user) {
    if (sessionUser && user.id !== sessionUser.id) throw new Error('Bu Google hesabı başka bir RAF hesabına bağlı.');
    if (!user.googleVaultKey) throw new Error('Bu Google hesabı için yerel kasa anahtarı yok.');
    const key = Buffer.from(safeStorage.decryptString(Buffer.from(user.googleVaultKey, 'base64')), 'base64');
    sessionUser = { ...userSafe(user), key, authMethod: 'google' };
    return userSafe(user);
  }
  if (sessionUser) {
    if (users.some(u => u.email === String(profile.email).toLowerCase() && u.id !== sessionUser.id)) throw new Error('Google e-posta adresi başka bir RAF hesabında kullanılıyor.');
    const linked = users.find(u => u.id === sessionUser.id);
    if (!linked || linked.googleSub) throw new Error('Bu yerel hesaba zaten bir Google hesabı bağlı.');
    linked.googleSub = profile.sub;
    linked.googleVaultKey = safeStorage.encryptString(sessionUser.key.toString('base64')).toString('base64');
    writeJsonAtomic(accountIndex(), users);
    sessionUser = { ...userSafe(linked), key: sessionUser.key, authMethod: 'google' };
    return userSafe(linked);
  }
  const email = String(profile.email).toLowerCase();
  if (users.some(u => u.email === email)) throw new Error('Bu e-posta yerel parolalı bir hesaba bağlı. Önce o hesaba giriş yap; hesapları otomatik birleştirmiyoruz.');
  const localPassword = String(input?.password || '');
  if (localPassword.length < 12) throw new Error('Yeni Google hesabı için çevrimdışı kasanı açacak en az 12 karakterli yerel parola da belirle.');
  const id = crypto.randomUUID(), salt = crypto.randomBytes(16), key = derive(localPassword, salt);
  user = { id, email, name: String(profile.name || '').slice(0, 80), googleSub: profile.sub, salt: salt.toString('base64'), check: verifier(key).toString('base64'), googleVaultKey: safeStorage.encryptString(key.toString('base64')).toString('base64'), createdAt: new Date().toISOString() };
  writeJsonAtomic(accountIndex(), [...users, user]);
  fs.mkdirSync(path.join(accountDir(id), 'library'), { recursive: true, mode: 0o700 });
  sessionUser = { ...userSafe(user), key, authMethod: 'google' };
  return userSafe(user);
});

ipcMain.handle('raf:session', () => sessionUser ? userSafe(sessionUser) : null);
ipcMain.handle('raf:logout', () => { if (sessionUser?.key) sessionUser.key.fill(0); sessionUser = null; return true; });
ipcMain.handle('raf:read-library', () => {
  const key = currentKey(); const id = sessionUser.id; const items = [];
  for (const category of CATEGORY_IDS) {
    const file = path.join(accountDir(id), 'library', category, 'records.enc');
    if (!fs.existsSync(file)) continue;
    try { items.push(...unseal(readJson(file, null), key)); }
    catch { throw new Error(`“${category}” klasöründeki arşiv açılamadı. Parolan doğru mu veya dosya bozulmuş olabilir mi?`); }
  }
  return items;
});
ipcMain.handle('raf:write-library', (_event, items) => {
  if (!Array.isArray(items) || items.length > 100_000) throw new Error('Arşiv biçimi geçerli değil.');
  const key = currentKey(); const id = sessionUser.id;
  for (const category of CATEGORY_IDS) {
    const records = items.filter(item => item && item.category === category);
    const file = path.join(accountDir(id), 'library', category, 'records.enc');
    writeJsonAtomic(file, seal(records, key));
  }
  return true;
});
ipcMain.handle('raf:export-library', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showSaveDialog({ defaultPath: 'raf-yedek.json', filters: [{ name: 'RAF yedeği', extensions: ['json'] }] });
  if (result.canceled || !result.filePath) return false;
  const items = [];
  for (const category of CATEGORY_IDS) {
    const file = path.join(accountDir(sessionUser.id), 'library', category, 'records.enc');
    if (fs.existsSync(file)) items.push(...unseal(readJson(file, null), currentKey()));
  }
  writeJsonAtomic(result.filePath, { format: 'raf-export-v1', items });
  return true;
});
ipcMain.handle('raf:import-library', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'RAF yedeği', extensions: ['json'] }] });
  if (result.canceled || !result.filePaths[0]) return null;
  const imported = readJson(result.filePaths[0], null);
  if (imported?.format !== 'raf-export-v1' || !Array.isArray(imported.items)) throw new Error('Bu dosya geçerli bir RAF yedeği değil.');
  return imported.items;
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 940, minWidth: 900, minHeight: 680, title: 'RAF',
    backgroundColor: '#0c1010', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\/(www\.kvkk\.gov\.tr|kvkk\.gov\.tr|commission\.europa\.eu)\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => { if (url !== `file://${path.join(__dirname, 'index.html')}`) event.preventDefault(); });
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  app.setAppUserModelId('app.raf.library');
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const local = details.url.startsWith('file://') || details.url.startsWith('devtools://');
    callback({ cancel: !local });
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (sessionUser?.key) sessionUser.key.fill(0); sessionUser = null; if (process.platform !== 'darwin') app.quit(); });
