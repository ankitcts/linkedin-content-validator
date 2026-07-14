#!/usr/bin/env node
// Packages the extension source (src/) into a versioned zip under dist/,
// with manifest.json at the archive root (as Chrome expects).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = process.env.VERSION ?? pkg.version;
const srcDir = 'src';
const outDir = 'dist';
const outFile = join(outDir, `${pkg.name}-${version}.zip`);

if (!existsSync(srcDir) || readdirSync(srcDir).length === 0) {
  console.error(`[package] ${srcDir}/ is empty — nothing to package yet.`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// Zip the *contents* of src/ so manifest.json sits at the archive root.
execFileSync('zip', ['-r', join(process.cwd(), outFile), '.', '-x', '.gitkeep'], {
  cwd: srcDir,
  stdio: 'inherit',
});

console.log(`[package] Wrote ${outFile}`);
