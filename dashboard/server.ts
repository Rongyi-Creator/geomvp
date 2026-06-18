import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const PORT      = 3080;

// Load .env.local so env vars are available to spawned scripts
dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '.env.local'), override: true });

const TSX = path.join(ROOT, 'node_modules', '.bin', 'tsx');

type StepDef = {
  id: number;
  label: string;
  script: string;
  dir: string;
  getArgs: (url: string, client: string, scheme: string, scrapeMode?: string) => string[];
};

const TEMPLATE_STEPS: StepDef[] = [
  {
    id: 1, label: 'Check', dir: '',
    script: '01-check-compatibility.ts',
    getArgs: (url) => [url],
  },
  {
    id: 2, label: 'Scrape', dir: '',
    script: '02-scrape-site.ts',
    getArgs: (url, client, _scheme, scrapeMode) =>
      scrapeMode === 'manual' ? [url, client, '--manual'] : [url, client],
  },
  {
    id: 3, label: 'Structure', dir: '',
    script: '03-structure-content.ts',
    getArgs: (_, client) => [client],
  },
  {
    id: 4, label: 'Generate', dir: '',
    script: '04-generate-site.ts',
    getArgs: (_, client, scheme) => [client, '--scheme', scheme],
  },
  {
    id: 5, label: 'QA', dir: '',
    script: '05-quality-check.ts',
    getArgs: (_, client) => [client],
  },
];

const CLONE_STEPS: StepDef[] = [
  {
    id: 1, label: 'Clone', dir: 'clone/',
    script: '01-clone-site.ts',
    getArgs: (url, client) => [url, client],
  },
  {
    id: 2, label: 'Extract', dir: 'clone/',
    script: '02-extract-geo.ts',
    getArgs: (_, client) => [client],
  },
  {
    id: 3, label: 'Inject', dir: 'clone/',
    script: '03-inject-geo.ts',
    getArgs: (_, client) => [client],
  },
  {
    id: 4, label: 'QA', dir: 'clone/',
    script: '04-quality-check.ts',
    getArgs: (_, client) => [client],
  },
];

const PIPELINES: Record<string, StepDef[]> = {
  template: TEMPLATE_STEPS,
  clone: CLONE_STEPS,
};

const server = http.createServer((req, res) => {
  const parsed   = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const pathname = parsed.pathname;

  // ── Serve dashboard HTML ──────────────────────────────────────────────────
  if (pathname === '/' || pathname === '/index.html') {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // ── ENV status check (so the UI can warn if keys are missing) ────────────
  if (pathname === '/api/env') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      firecrawl:  !!process.env.FIRECRAWL_API_KEY,
      anthropic:  !!process.env.ANTHROPIC_API_KEY,
    }));
    return;
  }

  // ── SSE: run a single step ────────────────────────────────────────────────
  if (pathname === '/run') {
    const pipeline   = parsed.searchParams.get('pipeline') ?? 'template';
    const stepId     = parseInt(parsed.searchParams.get('step') ?? '0');
    const url        = parsed.searchParams.get('url')        ?? '';
    const client     = parsed.searchParams.get('client')     ?? '';
    const scheme     = parsed.searchParams.get('scheme')     ?? 'scheme-a';
    const scrapeMode = parsed.searchParams.get('scrapeMode') ?? 'auto';

    const steps = PIPELINES[pipeline];
    if (!steps) { res.writeHead(400); res.end('Unknown pipeline'); return; }

    const step = steps.find(s => s.id === stepId);
    if (!step) { res.writeHead(400); res.end('Unknown step'); return; }
    if (!url || !client) { res.writeHead(400); res.end('Missing url or client'); return; }

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const send = (data: object) => {
      try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ }
    };

    const args       = step.getArgs(url, client, scheme, scrapeMode);
    const scriptPath = path.join(ROOT, 'scripts', step.dir + step.script);
    const scriptDisplay = `scripts/${step.dir}${step.script}`;

    send({ type: 'start', step: stepId, label: step.label, cmd: `tsx ${scriptDisplay} ${args.join(' ')}` });

    const start = Date.now();
    const proc  = spawn(TSX, [scriptPath, ...args], {
      cwd: ROOT,
      env: { ...process.env },
    });

    proc.stdout.on('data', (d: Buffer) => send({ type: 'log', stream: 'stdout', text: d.toString() }));
    proc.stderr.on('data', (d: Buffer) => send({ type: 'log', stream: 'stderr', text: d.toString() }));

    proc.on('close', (code) => {
      const duration = Date.now() - start;
      send(code === 0
        ? { type: 'done',  exitCode: 0,    duration }
        : { type: 'error', exitCode: code, duration });
      res.end();
    });

    req.on('close', () => { try { proc.kill(); } catch { /* already dead */ } });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n  GEO Reforge Dashboard`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Ctrl+C to stop`);
});
