import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'node_modules', 'hermes-compiler', 'hermesc');
const destinationDir = path.join(root, 'node_modules', 'react-native', 'sdks', 'hermesc');

if (!fs.existsSync(sourceDir)) {
  throw new Error(`Hermes compiler package was not found at ${sourceDir}`);
}

fs.mkdirSync(path.dirname(destinationDir), { recursive: true });
fs.rmSync(destinationDir, { recursive: true, force: true });
fs.cpSync(sourceDir, destinationDir, { recursive: true });

for (const relativePath of [
  path.join('linux64-bin', 'hermesc'),
  path.join('osx-bin', 'hermesc'),
  path.join('win64-bin', 'hermesc.exe'),
]) {
  const binaryPath = path.join(destinationDir, relativePath);
  if (fs.existsSync(binaryPath)) {
    fs.chmodSync(binaryPath, 0o755);
  }
}

console.log(`Prepared Hermes compiler at ${destinationDir}`);
