import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as ports from '../../src/ports/index.js';

const portsDir = new URL('../../src/ports/', import.meta.url);

describe('ports', () => {
  it('export the typed email errors from the index', () => {
    expect(new ports.TransientEmailError('x')).toBeInstanceOf(Error);
    expect(new ports.QuotaExceededError('x').name).toBe('QuotaExceededError');
  });

  it('do not mention a vendor in names or types', () => {
    const vendor = /gcp|google|firestore|firebase|cloud ?tasks|gcs|gmail|brevo/i;
    for (const file of readdirSync(portsDir).filter((f) => f.endsWith('.ts'))) {
      const code = readFileSync(new URL(file, portsDir), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/*'))
        .join('\n');
      expect(code, file).not.toMatch(vendor);
    }
  });

  it('import only ports and shared modules', () => {
    for (const file of readdirSync(portsDir).filter((f) => f.endsWith('.ts'))) {
      const imports = [
        ...readFileSync(new URL(file, portsDir), 'utf8').matchAll(/from '([^']+)'/g),
      ];
      for (const [, spec] of imports) {
        expect(spec, file).toMatch(/^\.\/|^\.\.\/shared\//);
      }
    }
  });
});
