import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';

describe('graceful shutdown', () => {
  it('exits 0 within 10 s on SIGTERM with an idle connection open', async () => {
    const port = 18080 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.once('exit', () => reject(new Error('server exited early')));
        child.stdout.on('data', (chunk: Buffer) => {
          if (chunk.toString().includes('listening')) resolve();
        });
      });

      const socket = net.connect(port, '127.0.0.1');
      await once(socket, 'connect');
      socket.write('GET /internal/healthz HTTP/1.1\r\nHost: x\r\n\r\n');
      await once(socket, 'data');

      const started = Date.now();
      child.kill('SIGTERM');
      const [code] = (await once(child, 'exit')) as [number | null];
      expect(code).toBe(0);
      expect(Date.now() - started).toBeLessThan(10_000);
      socket.destroy();
    } finally {
      child.kill('SIGKILL');
    }
  }, 20_000);
});
