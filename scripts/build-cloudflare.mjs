import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "cloudflare-dist");
const excludedNames = new Set([".git", "node_modules", "cloudflare-dist"]);
const textExtensions = new Set([".html", ".css", ".js", ".json", ".xml", ".txt", ".svg"]);

async function rmSafe(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
}

async function ensureDir(targetPath) {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
}

function rewriteText(content) {
  return content.replaceAll("/city/", "/");
}

async function copyTree(sourceDir, targetDir) {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    if (excludedNames.has(entry.name)) {
      continue;
    }

    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(targetPath, { recursive: true });
      await copyTree(sourcePath, targetPath);
      continue;
    }

    await ensureDir(targetPath);

    if (textExtensions.has(path.extname(entry.name))) {
      const content = await fs.readFile(sourcePath, "utf8");
      await fs.writeFile(targetPath, rewriteText(content), "utf8");
      continue;
    }

    await fs.copyFile(sourcePath, targetPath);
  }
}

await rmSafe(outputDir);
await fs.mkdir(outputDir, { recursive: true });
await copyTree(repoRoot, outputDir);
