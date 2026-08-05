import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildServer } from './app.js';
import { readServerConfig } from './config.js';
import { loadProjectEnvironment } from './environment.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const loadedEnvironment = loadProjectEnvironment(process.env, projectRoot);
Object.assign(process.env, loadedEnvironment.environment);

const config = readServerConfig(loadedEnvironment.environment);
const app = await buildServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
