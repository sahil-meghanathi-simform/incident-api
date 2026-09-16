/**
 * §2.6 step 1: copy src/contracts/** to contracts-dist/ and write a manifest with a
 * per-file SHA-256 hash plus a semver contractVersion. incident-web's
 * `contracts:sync` script copies from a sibling checkout of contracts-dist/ into its
 * own vendored src/api/contracts/; `contracts:check` recomputes hashes to fail CI on
 * drift. This is the whole mitigation for build-plan.md's "two repos invite contract
 * drift" risk (Q2).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_DIR = join(__dirname, '..', 'src', 'contracts');
const OUT_DIR = join(__dirname, '..', 'contracts-dist');
const CONTRACT_VERSION = '0.1.0'; // bump on any breaking shape change; matches http/router.ts

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function main(): void {
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const files = listFiles(SRC_DIR);
  const manifest: { contractVersion: string; files: Record<string, string> } = {
    contractVersion: CONTRACT_VERSION,
    files: {},
  };

  for (const file of files) {
    const rel = relative(SRC_DIR, file);
    const content = readFileSync(file);
    const hash = createHash('sha256').update(content).digest('hex');
    manifest.files[rel] = hash;

    const destPath = join(OUT_DIR, rel);
    mkdirSync(join(destPath, '..'), { recursive: true });
    writeFileSync(destPath, content);
  }

  writeFileSync(join(OUT_DIR, 'contracts.manifest.json'), JSON.stringify(manifest, null, 2));
  // eslint-disable-next-line no-console
  console.log(`exported ${files.length} contract file(s) → contracts-dist/ (version ${CONTRACT_VERSION})`);
}

main();
