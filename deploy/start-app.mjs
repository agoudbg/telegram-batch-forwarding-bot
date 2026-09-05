/* global clearTimeout, console, process, setTimeout */

import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

const FORCE_SHUTDOWN_MS = 10_000;
const envPath = path.join(process.cwd(), '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const webIndexPath = path.join(process.cwd(), 'apps/web/dist/index.html');
if (!existsSync(webIndexPath)) {
  console.error(`Web build not found at ${webIndexPath}; run pnpm build:deploy first.`);
  process.exit(1);
}

const childEnvironment = {
  ...process.env,
  INTERNAL_MEDIA_SECRET: process.env.INTERNAL_MEDIA_SECRET || randomBytes(32).toString('base64url'),
};
const serviceDefinitions = [
  ['server', 'apps/server/dist/main.js'],
  ['bot', 'apps/bot/dist/main.js'],
];

const services = serviceDefinitions.map(([name, entrypoint]) => ({
  name,
  process: spawn(process.execPath, [entrypoint], {
    env: childEnvironment,
    stdio: 'inherit',
  }),
}));

let remainingServices = services.length;
let isStopping = false;
let supervisorExitCode = 0;
let forceShutdownTimer;

for (const service of services) {
  service.process.once('error', (error) => {
    console.error(`[supervisor] Failed to start ${service.name}:`, error);
    beginShutdown(1, 'SIGTERM');
  });

  service.process.once('close', (code, signal) => {
    remainingServices -= 1;
    if (!isStopping) {
      console.error(
        `[supervisor] ${service.name} exited unexpectedly (${signal ?? `code ${code ?? 1}`}).`,
      );
      beginShutdown(code === 0 ? 1 : (code ?? 1), 'SIGTERM');
    }

    if (remainingServices === 0) finishShutdown();
  });
}

process.once('SIGINT', () => beginShutdown(0, 'SIGINT'));
process.once('SIGTERM', () => beginShutdown(0, 'SIGTERM'));

function beginShutdown(exitCode, signal) {
  if (isStopping) return;

  isStopping = true;
  supervisorExitCode = exitCode;
  for (const service of services) {
    if (service.process.exitCode === null && service.process.signalCode === null) {
      service.process.kill(signal);
    }
  }

  forceShutdownTimer = setTimeout(() => {
    for (const service of services) {
      if (service.process.exitCode === null && service.process.signalCode === null) {
        service.process.kill('SIGKILL');
      }
    }
  }, FORCE_SHUTDOWN_MS);
  forceShutdownTimer.unref();
}

function finishShutdown() {
  if (forceShutdownTimer) clearTimeout(forceShutdownTimer);
  process.exitCode = supervisorExitCode;
}
