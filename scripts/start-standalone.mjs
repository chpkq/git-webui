import { createReadStream, existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import process from 'node:process';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot =
  path.basename(scriptDirectory) === 'scripts'
    ? path.resolve(scriptDirectory, '..')
    : scriptDirectory;
const serverRoot = existsSync(path.join(packageRoot, 'server'))
  ? path.join(packageRoot, 'server')
  : path.join(packageRoot, 'apps', 'server');
const webRoot = existsSync(path.join(packageRoot, 'web'))
  ? path.join(packageRoot, 'web')
  : path.join(packageRoot, 'apps', 'web', 'dist');
const serverPort = Number(process.env.GIT_WEBUI_SERVER_PORT ?? '3001');
const webPort = Number(process.env.GIT_WEBUI_WEB_PORT ?? '9001');
const webHost = process.env.GIT_WEBUI_WEB_HOST ?? '0.0.0.0';
const serverHost = process.env.GIT_WEBUI_HOST ?? '127.0.0.1';
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

if (!loopbackHosts.has(webHost) && loopbackHosts.has(serverHost)) {
  console.warn(
    'Standalone WebUI 当前对外监听，但后端保持回环绑定；远程访问前请配置鉴权或使用 HTTPS 反向代理。',
  );
}

const serverProcess = spawn(process.execPath, [path.join(serverRoot, 'dist/index.js')], {
  cwd: serverRoot,
  env: {
    ...process.env,
    GIT_WEBUI_HOST: serverHost,
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

webServer.listen(webPort, webHost, () => {
  console.log(`Standalone WebUI: http://127.0.0.1:${webPort}`);
});

let shutdownStarted = false;

const closeWebServer = () =>
  new Promise((resolve) => {
    if (!webServer.listening) {
      resolve();
      return;
    }
    webServer.close(() => resolve());
  });

const stopServerProcess = () =>
  new Promise((resolve) => {
    if (serverProcess.exitCode !== null) {
      resolve();
      return;
    }

    const timer = setTimeout(resolve, 5000);
    serverProcess.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    serverProcess.kill('SIGTERM');
  });

const shutdown = async (signal = 'SIGTERM') => {
  if (shutdownStarted) return;
  shutdownStarted = true;

  await closeWebServer();
  await stopServerProcess();

  if (serverProcess.exitCode === null) {
    serverProcess.kill('SIGKILL');
  }

  if (signal === 'SIGINT' || signal === 'SIGTERM') process.exit(0);
};

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
serverProcess.once('error', (error) => {
  console.error(`后端服务启动失败：${error.message}`);
  void shutdown('SIGTERM');
});
serverProcess.once('exit', (code) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  void closeWebServer().finally(() => {
    process.exit(code ?? 1);
  });
});
webServer.once('error', (error) => {
  console.error(`Standalone WebUI 启动失败：${error.message}`);
  void shutdown('SIGTERM');
});
