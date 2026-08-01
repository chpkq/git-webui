import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { log } from 'node:console';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot =
  path.basename(scriptDirectory) === 'scripts'
    ? path.resolve(scriptDirectory, '..')
    : scriptDirectory;
const serverRoot = path.join(packageRoot, 'server');
const webRoot = path.join(packageRoot, 'web');
const serverPort = Number(process.env.GIT_WEBUI_SERVER_PORT ?? '3000');
const webPort = Number(process.env.GIT_WEBUI_WEB_PORT ?? '4173');
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const serverProcess = spawn(process.execPath, [path.join(serverRoot, 'dist/index.js')], {
  cwd: serverRoot,
  env: {
    ...process.env,
    GIT_WEBUI_HOST: '127.0.0.1',
    GIT_WEBUI_PORT: String(serverPort),
    GIT_WEBUI_DATABASE:
      process.env.GIT_WEBUI_DATABASE ?? path.join(packageRoot, 'data', 'git-webui.sqlite'),
  },
  stdio: 'inherit',
});

const proxyRequest = (request, response) => {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port: serverPort,
      method: request.method,
      path: request.url,
      headers: { ...request.headers, host: `127.0.0.1:${serverPort}` },
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    },
  );
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502);
    response.end('后端服务不可用。');
  });
  request.pipe(upstream);
};

const serveFile = async (request, response) => {
  let requestPath;
  try {
    requestPath = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
  } catch {
    response.writeHead(400);
    response.end('请求路径格式不正确。');
    return;
  }
  const relativePath = requestPath === '/' ? 'index.html' : requestPath.replace(/^\/+/, '');
  const candidate = path.resolve(webRoot, relativePath);
  const safeRoot = `${webRoot}${path.sep}`;
  const filePath = candidate.startsWith(safeRoot) ? candidate : path.join(webRoot, 'index.html');
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      'Content-Type': contentTypes[path.extname(filePath)] ?? 'application/octet-stream',
    });
    createReadStream(filePath).pipe(response);
  } catch {
    const index = await readFile(path.join(webRoot, 'index.html'));
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(index);
  }
};

const webServer = createServer((request, response) => {
  if (request.url?.startsWith('/api/') || request.url === '/health') {
    proxyRequest(request, response);
    return;
  }
  void serveFile(request, response);
});

webServer.listen(webPort, '127.0.0.1', () => {
  log(`Standalone WebUI: http://127.0.0.1:${webPort}`);
});

const shutdown = () => {
  webServer.close();
  serverProcess.kill('SIGTERM');
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
serverProcess.once('exit', (code) => {
  webServer.close();
  process.exitCode = code ?? 1;
});
