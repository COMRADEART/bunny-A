// Export the schema runtime from the installed, lockfile-pinned dependency tree.
import { copyFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function packageHostRuntime(source, workspace, destination) {
  const lock = JSON.parse(readFileSync(join(source, 'package-lock.json'), 'utf8'));
  const origins = [], packages = [];
  for (const name of ['zod']) {
    const root = join(workspace, 'node_modules', name);
    const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const pinned = lock.packages[`node_modules/${name}`];
    if (!pinned?.integrity || metadata.name !== name || metadata.version !== pinned.version)
      throw new Error(`Host runtime does not match pinned lockfile: ${name}`);
    if (Object.keys(metadata.dependencies ?? {}).length) throw new Error(`Unqualified transitive Host dependencies: ${name}`);
    const visit = (folder, relative = '') => {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) throw new Error('Host runtime cannot contain links.');
        const path = `${relative}${entry.name}`;
        if (entry.isDirectory()) visit(join(folder, entry.name), `${path}/`);
        else {
          const target = `node_modules/${name}/${path}`;
          mkdirSync(join(destination, 'node_modules', name, relative), { recursive: true });
          copyFileSync(join(folder, entry.name), join(destination, target));
          origins.push({ path: target, origin: 'dependency', repoPath: null });
        }
      }
    };
    visit(root);
    packages.push({ name, version: metadata.version, integrity: pinned.integrity, license: metadata.license });
  }
  return { origins, packages };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(packageHostRuntime(...process.argv.slice(2))));
