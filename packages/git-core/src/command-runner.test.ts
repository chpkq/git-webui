import { describe, expect, it } from 'vitest';
import { CommandRunner, redactSensitiveText } from './command-runner.js';

describe('CommandRunner', () => {
  it('runs Git with independent arguments and captures output', async () => {
    const result = await new CommandRunner().run({
      cwd: process.cwd(),
      args: ['--version'],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^git version /);
    expect(result.args).toEqual(['--version']);
  });

  it('rejects output over the configured limit', async () => {
    await expect(
      new CommandRunner().run({
        cwd: process.cwd(),
        args: ['--version'],
        maxOutputBytes: 1,
      }),
    ).rejects.toMatchObject({ code: 'OUTPUT_LIMIT_EXCEEDED' });
  });

  it('returns a bounded truncated result when the caller opts in', async () => {
    const result = await new CommandRunner().run({
      cwd: process.cwd(),
      args: ['--version'],
      maxOutputBytes: 1,
      allowTruncated: true,
    });

    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBe(1);
    expect(result.stdoutBytes).toBeGreaterThan(1);
  });
});

describe('redactSensitiveText', () => {
  it('redacts credentials in logs and error messages', () => {
    expect(
      redactSensitiveText(
        'Authorization: Bearer secret token=abc password:pw https://user:pass@example.com/repo.git',
      ),
    ).toBe(
      'Authorization: [REDACTED] token=[REDACTED] password:[REDACTED] https://user:[REDACTED]@example.com/repo.git',
    );
  });
});
