import { buildServer } from './app.js';
import { readServerConfig } from './config.js';

const config = readServerConfig();
const app = await buildServer(config);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
