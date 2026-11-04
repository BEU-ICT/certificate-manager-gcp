// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkBundle, MAX_FIREBASE_GZIP_BYTES } from './check-bundle.mjs';

const firebase = { '_firebase-a.js': { file: 'assets/firebase-a.js', name: 'firebase' } };
const entry = (imports = [], dynamicImports = []) => ({
  file: 'assets/index.js',
  src: 'index.html',
  isEntry: true,
  imports,
  dynamicImports,
});
const lazy = (src, imports = [], dynamicImports = []) => ({
  file: `assets/${src}.js`,
  src,
  isDynamicEntry: true,
  imports,
  dynamicImports,
});

describe('check:bundle', () => {
  it('passes when only the admin and auth chunks load the SDK', () => {
    const manifest = {
      ...firebase,
      'index.html': entry([], ['src/admin/LoginPage.tsx', 'src/pages/LandingPage.tsx']),
      'src/admin/LoginPage.tsx': lazy('src/admin/LoginPage.tsx', ['_auth.js'], []),
      '_auth.js': { file: 'assets/auth.js', imports: [], dynamicImports: ['_firebase-a.js'] },
      'src/pages/LandingPage.tsx': lazy('src/pages/LandingPage.tsx'),
    };
    expect(checkBundle(manifest)).toEqual([]);
  });

  it('fails when the entry chunk imports the SDK statically', () => {
    const manifest = { ...firebase, 'index.html': entry(['_firebase-a.js']) };
    expect(checkBundle(manifest)).toEqual([
      'index.html statically imports the Firebase SDK (via index.html, _firebase-a.js)',
    ]);
  });

  it('fails when a public route reaches a chunk that loads the SDK', () => {
    const manifest = {
      ...firebase,
      'index.html': entry(),
      '_auth.js': { file: 'assets/auth.js', imports: [], dynamicImports: ['_firebase-a.js'] },
      'src/pages/LandingPage.tsx': lazy('src/pages/LandingPage.tsx', ['_auth.js']),
    };
    expect(checkBundle(manifest)).toEqual([
      'src/pages/LandingPage.tsx statically imports the Firebase SDK (via _auth.js)',
    ]);
  });

  it('fails when there is no SDK chunk at all', () => {
    expect(checkBundle({ 'index.html': entry() })).toHaveLength(1);
  });

  it('fails when the SDK chunk is over the gzip budget', () => {
    const manifest = { ...firebase, 'index.html': entry() };
    expect(checkBundle(manifest, () => MAX_FIREBASE_GZIP_BYTES + 1)[0]).toMatch(/over the 80 KB/);
    expect(checkBundle(manifest, () => MAX_FIREBASE_GZIP_BYTES)).toEqual([]);
  });
});
