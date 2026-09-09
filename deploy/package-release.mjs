import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const backendPackage = JSON.parse(await readFile(join(root, 'backend/package.json'), 'utf8'));
const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
if (git.status !== 0) throw new Error('Unable to resolve Git commit');
const gitCommit = git.stdout.trim();
const outputRoot = join(root, '.tmp', 'release-package');
const stage = join(outputRoot, `3d-manage-${packageJson.version}`);
await rm(outputRoot, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

const excludedDirectories = new Set(['node_modules', 'data', 'uploads', 'runtime', '.backups', '.tmp', '.git']);
const excludedExtensions = new Set(['.log', '.pem', '.key', '.jks', '.p8', '.p12', '.mobileprovision']);
const isExcludedName = (name) =>
  excludedDirectories.has(name) ||
  (name.startsWith('.env') && name !== '.env.example') ||
  [...excludedExtensions].some((extension) => name.endsWith(extension));
const filter = (source) => !relative(root, source).split(/[\\/]/).some(isExcludedName);
for (const item of ['backend', 'deploy', 'docs', 'compose.yaml', 'compose.https.yaml', '.env.example', 'README.md']) {
  await cp(join(root, item), join(stage, item), { recursive: true, filter });
}

const assertSafeStage = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (isExcludedName(entry.name)) {
      throw new Error(`Unsafe release entry: ${relative(stage, join(directory, entry.name))}`);
    }
    if (entry.isDirectory()) await assertSafeStage(join(directory, entry.name));
  }
};
await assertSafeStage(stage);

const sha256 = async (file) => createHash('sha256').update(await readFile(file)).digest('hex');
const manifest = {
  generatedAt: new Date().toISOString(),
  gitCommit,
  client: {
    version: packageJson.version,
    androidPackage: 'com.anonymous.x3DManage',
    signingCertificateFingerprint: null,
    signingStatus: 'unverified-external-prerequisite',
  },
  backend: {
    version: backendPackage.version,
    imageTag: `3d-manage-backend:${backendPackage.version}`,
    imageDigest: null,
    imageStatus: 'source-build-not-published',
  },
  compatibility: { apiVersion: '1', storeSchemaVersion: 2, postgresMajor: 16 },
  supportedPlatforms: [{ os: 'linux', arch: 'x86_64', status: 'release-verification-required' }],
  files: {
    composeSha256: await sha256(join(stage, 'compose.yaml')),
    environmentTemplateSha256: await sha256(join(stage, '.env.example')),
  },
};
await writeFile(join(stage, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const archive = join(outputRoot, `3d-manage-${packageJson.version}.tar.gz`);
const tar = spawnSync('tar', ['-czf', archive, '-C', outputRoot, basename(stage)], { stdio: 'inherit' });
if (tar.status !== 0) throw new Error('Unable to create release archive');
manifest.archiveSha256 = await sha256(archive);
await writeFile(join(outputRoot, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ archive, sha256: manifest.archiveSha256, manifest: join(outputRoot, 'release-manifest.json') }, null, 2));
