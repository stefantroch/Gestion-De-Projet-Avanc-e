// Mini serveur de démo : lance un script k6 de demo/, lit sa sortie JSON
// et envoie des agrégats seconde par seconde à la page (Server-Sent Events).
// Aucune dépendance npm : uniquement Node.js et le binaire k6.
const http = require('http'), fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 4000;
const DEMO_DIR = process.env.DEMO_DIR || path.join(__dirname, '..', 'demo');
const BASE_URL = process.env.BASE_URL || 'http://localhost:3333';
const OUT = path.join(os.tmpdir(), 'k6-metrics.json');

let run = null;       // test en cours : { name, proc }
let clients = [];     // navigateurs connectés au flux SSE
let history = [];     // événements du dernier test, rejoués si on recharge la page
const write = (c, event, data) => c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
const send = (event, data) => {
  if (event === 'start') history = [];
  history.push([event, data]);
  clients.forEach(c => write(c, event, data));
};

// Liste des scripts : un bouton par fichier .js, titre lu dans les commentaires "// @title" et "// @desc"
function scripts() {
  return fs.readdirSync(DEMO_DIR).filter(f => f.endsWith('.js')).sort().map(file => {
    const src = fs.readFileSync(path.join(DEMO_DIR, file), 'utf8');
    const tag = t => (src.match(new RegExp(`^//\\s*@${t}\\s+(.+)$`, 'm')) || [])[1] || '';
    return { file, title: tag('title') || file, desc: tag('desc') };
  });
}

function start(file) {
  fs.writeFileSync(OUT, '');
  const proc = spawn('k6', ['run', '--quiet', '--no-color', '--out', `json=${OUT}`,
    '--system-tags=status', path.join(DEMO_DIR, file)], { env: { ...process.env, BASE_URL } });
  run = { name: file, proc };
  send('start', { file });
  proc.stdout.on('data', d => send('log', d.toString()));
  proc.stderr.on('data', d => send('log', d.toString()));
  proc.on('error', e => send('log', `Impossible de lancer k6 : ${e.message}\n`));

  // Les points k6 sont regroupés par seconde (horodatage du point).
  // Une seconde n'est envoyée qu'une fois complète, avec ~2 s de décalage.
  const buckets = new Map();
  let first = null, last = null, sent = null, vus = 0, offset = 0, rest = '';
  const bucket = s => buckets.get(s) || buckets.set(s, { reqs: 0, dur: [], fail: 0, n: 0, vus: null }).get(s);

  const read = () => {
    const size = fs.statSync(OUT).size;
    if (size <= offset) return;
    const buf = Buffer.alloc(size - offset), fd = fs.openSync(OUT, 'r');
    fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd); offset = size;
    const lines = (rest + buf.toString()).split('\n'); rest = lines.pop();
    for (const line of lines) {
      let p; try { p = JSON.parse(line); } catch { continue; }
      if (p.type !== 'Point') continue;
      const s = Math.floor(Date.parse(p.data.time) / 1000), b = bucket(s), v = p.data.value;
      if (first === null || s < first) first = s;
      if (last === null || s > last) last = s;
      if (p.metric === 'http_reqs') b.reqs += v;
      else if (p.metric === 'http_req_duration') b.dur.push(v);
      else if (p.metric === 'http_req_failed') { b.fail += v; b.n++; }
      else if (p.metric === 'vus') b.vus = v;
    }
  };

  const flush = upTo => {
    for (let s = sent === null ? first : sent + 1; first !== null && s <= upTo; s++) {
      const b = buckets.get(s) || { reqs: 0, dur: [], fail: 0, n: 0, vus: null };
      if (b.vus !== null) vus = b.vus;
      const d = b.dur.sort((x, y) => x - y);
      send('tick', {
        t: s - first, vus, reqs: b.reqs,
        avg: d.length ? d.reduce((a, x) => a + x, 0) / d.length : null, // null = aucune requête cette seconde
        p95: d.length ? d[Math.ceil(0.95 * d.length) - 1] : null,
        errors: b.n ? b.fail / b.n : 0, failed: b.fail,
      });
      buckets.delete(s); sent = s;
    }
  };

  const timer = setInterval(() => { read(); if (last !== null) flush(last - 2); }, 1000);
  proc.on('close', code => {
    clearInterval(timer); read(); if (last !== null) flush(last);
    run = null; send('done', { file, code });
  });
}

const json = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
};

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = url.searchParams.get('file');
  const known = () => scripts().some(s => s.file === file); // n'accepte que les fichiers de demo/

  if (url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }
  if (url.pathname === '/api/scripts') return json(res, scripts());
  if (url.pathname === '/api/source') {
    if (!known()) return json(res, { error: 'script inconnu' }, 404);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(DEMO_DIR, file), 'utf8'));
  }
  if (url.pathname === '/api/run' && req.method === 'POST') {
    if (run) return json(res, { error: 'un test tourne déjà' }, 409);
    if (!known()) return json(res, { error: 'script inconnu' }, 404);
    start(file); return json(res, { ok: true });
  }
  if (url.pathname === '/api/stop' && req.method === 'POST') {
    if (run) run.proc.kill('SIGINT'); // comme Ctrl+C : k6 s'arrête proprement et affiche son résumé
    return json(res, { ok: true });
  }
  if (url.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    write(res, 'hello', { target: BASE_URL });
    history.forEach(([event, data]) => write(res, event, data));
    clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, () => console.log(`Dashboard k6 : http://localhost:${PORT}  (cible : ${BASE_URL})`));
