/* global console, process */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const rootDirectory = process.cwd();
const envPath = path.join(rootDirectory, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const publicOrigin = process.env.PUBLIC_ORIGIN?.trim();
if (!publicOrigin) {
  console.error('PUBLIC_ORIGIN must be set in .env before building the deployment.');
  process.exit(1);
}

const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

try {
  await run(pnpmCommand, ['build']);
  await run(npmCommand, ['--prefix', 'apps/web', 'run', 'build:share'], {
    env: { ...process.env, BASE_URL: publicOrigin },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDirectory,
      env: options.env ?? process.env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code ?? 1}`}`),
      );
    });
  });
}
