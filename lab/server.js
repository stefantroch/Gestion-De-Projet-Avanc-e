// Mini serveur : lance k6 (local ou Docker), suit le fichier JSON de métriques
// et diffuse des agrégats par seconde vers la page via Server-Sent Events.
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(__dirname, 'tmp');
const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '127.0.0.1'; // garde 127.0.0.1 : la page peut exécuter du code k6
const DIRS = ['demo', 'solutions', 'exercises'];
fs.mkdirSync(TMP, { recursive: true });

const hasK6 = !spawnSync('k6', ['version']).error;
const MODE = process.env.K6_MODE || (hasK6 ? 'local' : 'docker');
const BASE = process.env.BASE_URL ||
  (MODE === 'docker' ? 'http://host.docker.internal:3333' : 'http://localhost:3333');

let proc = null, clients = [], tailTimer = null, tickTimer = null;
const send = (ev, d) => clients.forEach(r => r.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`));
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

function start(code) {
  if (proc) return false;
  const script = path.join(TMP, 'live.js'), out = path.join(TMP, 'out.json');
  fs.writeFileSync(script, code);
  fs.writeFileSync(out, '');
  const args = ['run', '--quiet', '--no-color', '--out', 'json=' + rel(out), rel(script)];
  let cmd = 'k6', a = args, env = { ...process.env, BASE_URL: BASE };
  if (MODE === 'docker') {
    cmd = 'docker';
    a = ['run', '--rm', '--name', 'k6-live', '--add-host=host.docker.internal:host-gateway',
      '-v', ROOT + ':/work', '-w', '/work', '-e', 'BASE_URL=' + BASE, 'grafana/k6', ...args];
  }
  proc = spawn(cmd, a, { cwd: ROOT, env });
  proc.stdout.on('data', d => send('log', d.toString()));
  proc.stderr.on('data', d => send('log', d.toString()));
  proc.on('error', e => send('log', 'Erreur au lancement : ' + e.message + '\n'));

  let off = 0, buf = '', sec = 0;
  const fresh = () => ({ reqs: 0, lat: [], err: 0 });
  let acc = fresh(), vus = 0;
  const parse = line => {
    try {
      const o = JSON.parse(line);
      if (o.type !== 'Point') return;
      const v = o.data.value;
      if (o.metric === 'http_reqs') acc.reqs += v;
      else if (o.metric === 'http_req_duration') acc.lat.push(v);
      else if (o.metric === 'http_req_failed' && v) acc.err++;
      else if (o.metric === 'vus') vus = v;
    } catch (_) { /* ligne incomplète */ }
  };
  const read = () => {
    const size = fs.statSync(out).size;
    if (size <= off) return;
    const fd = fs.openSync(out, 'r'), b = Buffer.alloc(size - off);
    fs.readSync(fd, b, 0, b.length, off); fs.closeSync(fd); off = size;
    const lines = (buf + b.toString()).split('\n'); buf = lines.pop();
    lines.forEach(parse);
  };
  tailTimer = setInterval(read, 500);
  tickTimer = setInterval(() => {
    const l = acc.lat.sort((x, y) => x - y), n = l.length;
    send('tick', {
      t: ++sec, reqs: acc.reqs, vus, err: acc.err,
      avg: n ? l.reduce((s, x) => s + x, 0) / n : 0,
      p95: n ? l[Math.floor(0.95 * (n - 1))] : 0,
    });
    acc = fresh();
  }, 1000);
  proc.on('close', code => {
    read(); clearInterval(tailTimer); clearInterval(tickTimer);
    proc = null; send('done', { code });
  });
  return true;
}

function stop() {
  if (!proc) return;
  if (MODE === 'docker') spawnSync('docker', ['stop', 'k6-live']);
  else proc.kill();
}

const body = req => new Promise(res => {
  let s = ''; req.on('data', c => { if (s.length < 1e6) s += c; }); req.on('end', () => res(s));
});
const safe = f => {
  const [d, n] = (f || '').split('/');
  return DIRS.includes(d) && /^[\w.\- ]+\.js$/.test(n || '') ? path.join(ROOT, d, n) : null;
};

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
  }
  if (u.pathname === '/api/info') return res.end(JSON.stringify({ mode: MODE, base: BASE }));
  if (u.pathname === '/api/scripts') {
    const list = DIRS.flatMap(d => {
      try { return fs.readdirSync(path.join(ROOT, d)).filter(n => n.endsWith('.js')).map(n => d + '/' + n); }
      catch (_) { return []; }
    });
    return res.end(JSON.stringify(list));
  }
  if (u.pathname === '/api/script') {
    const f = safe(u.searchParams.get('f'));
    if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    return res.end(fs.readFileSync(f, 'utf8'));
  }
  if (u.pathname === '/api/run' && req.method === 'POST') {
    const ok = start(JSON.parse(await body(req)).code);
    res.writeHead(ok ? 200 : 409); return res.end();
  }
  if (u.pathname === '/api/stop' && req.method === 'POST') { stop(); return res.end(); }
  if (u.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('\n'); clients.push(res);
    req.on('close', () => { clients = clients.filter(c => c !== res); });
    return;
  }
  res.writeHead(404); res.end();
}).listen(PORT, HOST, () =>
  console.log(`Labo k6 : http://localhost:${PORT}  (mode ${MODE}, cible ${BASE})`));