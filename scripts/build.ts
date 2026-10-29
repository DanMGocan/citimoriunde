import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { nativeWebEnvironment } from '../src/lib/config';
import { checkBuildArtifacts } from './check-build-artifacts';

// Next copies loaded .env files into standalone even when tracing excludes them.
// Runtime configuration is supplied by start.ts/the container environment.
// Remove only generated copies; never move or edit the protected source file.
const code = await new Promise<number>((done, reject) => {
  const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'build'], {
    stdio: 'inherit', env: nativeWebEnvironment(),
  });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
  child.once('error', () => reject(new Error('Production build could not start.')));
  child.once('close', result => done(result ?? 1));
});
for (const name of ['.env', '.env.production']) await rm(resolve('.next/standalone', name), { force: true });
process.exitCode = code === 0 && (await checkBuildArtifacts()).failures > 0 ? 1 : code;
