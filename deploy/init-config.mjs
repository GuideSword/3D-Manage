import { randomBytes } from 'node:crypto';
import { constants, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const templatePath = resolve(root, '.env.example');
const targetPath = resolve(process.cwd(), '.env');
const secret = () => randomBytes(36).toString('base64url');
const databaseSecret = () => randomBytes(30).toString('base64url');

try {
  const handle = await open(targetPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  const template = await readFile(templatePath, 'utf8');
  const generated = template
    .replace('CHANGE_ME_USE_LONG_RANDOM_DATABASE_PASSWORD', databaseSecret())
    .replace('CHANGE_ME_USE_32_RANDOM_CHARACTERS_MINIMUM', secret())
    .replace('CHANGE_ME_USE_ANOTHER_32_RANDOM_CHARACTERS', secret())
    .replace('CHANGE_ME_USE_A_SEPARATE_RANDOM_SETUP_TOKEN', secret());
  await handle.writeFile(generated, 'utf8');
  await handle.close();
  console.log(`Created ${targetPath}. Store this file in a restricted recovery bundle.`);
} catch (error) {
  if (error.code === 'EEXIST') {
    console.error(`Refusing to overwrite existing ${targetPath}`);
    process.exitCode = 2;
  } else {
    throw error;
  }
}
