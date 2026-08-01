import { spawn } from 'node:child_process';
import { GitWebUiError } from '@git-webui/shared';

export interface CommandRunnerOptions {
  cwd: string;
  args: readonly string[];
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  onOutput?: (stream: 'stdout' | 'stderr', chunk: string) => void;
}

export interface CommandResult {
  command: string;
  args: readonly string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  truncated: boolean;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export class CommandRunner {
  public async run(options: CommandRunnerOptions): Promise<CommandResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const command = 'git';
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const args = [...options.args];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;

    return await new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
        fail(new GitWebUiError('COMMAND_TIMEOUT', 'Git 操作超过允许的执行时间。', { timeoutMs }));
      }, timeoutMs);

      function cleanup(): void {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        options.signal?.removeEventListener('abort', abortChild);
      }

      function fail(error: Error): void {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      }

      function abortChild(): void {
        child.kill('SIGTERM');
        fail(new GitWebUiError('COMMAND_TIMEOUT', 'Git 操作已取消或超时。'));
      }

      const collect = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
        options.onOutput?.(stream, chunk.toString('utf8'));
        if (stream === 'stdout') {
          stdoutBytes += chunk.byteLength;
        } else {
          stderrBytes += chunk.byteLength;
        }
        const currentBytes = stream === 'stdout' ? stdoutBytes : stderrBytes;
        if (currentBytes > maxOutputBytes) {
          truncated = true;
          child.kill('SIGTERM');
          return;
        }
        chunks[stream].push(chunk);
      };

      child.stdout.on('data', (chunk: Buffer) => collect('stdout', chunk));
      child.stderr.on('data', (chunk: Buffer) => collect('stderr', chunk));
      child.once('error', (error) => fail(error));
      child.once('close', (exitCode) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        const result: CommandResult = {
          command,
          args,
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(chunks.stdout).toString('utf8'),
          stderr: Buffer.concat(chunks.stderr).toString('utf8'),
          stdoutBytes,
          stderrBytes,
          truncated,
        };
        if (truncated) {
          reject(
            new GitWebUiError('OUTPUT_LIMIT_EXCEEDED', 'Git 输出超过允许上限。', {
              maxOutputBytes,
              stdoutBytes,
              stderrBytes,
            }),
          );
          return;
        }
        resolve(result);
      });

      if (options.signal?.aborted) {
        abortChild();
      } else {
        options.signal?.addEventListener('abort', abortChild, { once: true });
      }
    });
  }
}

export const redactSensitiveText = (value: string): string =>
  value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(token|password|passwd|pat)(\s*[:=]\s*)([^\s,;]+)/gi, '$1$2[REDACTED]')
    .replace(/(https?:\/\/[^\s/@]+):([^\s/@]+)@/gi, '$1:[REDACTED]@');
