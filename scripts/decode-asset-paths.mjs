import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const excludedDirs = new Set([".git", "node_modules", "cloudflare-dist"]);

async function collectFiles(dirPath, bucket = []) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (excludedDirs.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, bucket);
      continue;
    }

    bucket.push(fullPath);
  }

  return bucket;
}

async function removeEmptyDirs(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const childPath = path.join(dirPath, entry.name);
    await removeEmptyDirs(childPath);
  }

  const remaining = await fs.readdir(dirPath);
  if (remaining.length === 0 && dirPath !== repoRoot) {
    await fs.rmdir(dirPath);
  }
}

const files = await collectFiles(repoRoot);
files.sort((left, right) => left.length - right.length);

for (const sourcePath of files) {
  const relativePath = path.relative(repoRoot, sourcePath);
  const decodedRelativePath = (() => {
    try {
      return decodeURIComponent(relativePath);
    } catch {
      return relativePath;
    }
  })();

  if (decodedRelativePath === relativePath) {
    continue;
  }

  const targetPath = path.join(repoRoot, decodedRelativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.rename(sourcePath, targetPath);
}

await removeEmptyDirs(repoRoot);
