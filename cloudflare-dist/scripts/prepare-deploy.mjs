import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const repoName = path.basename(repoRoot);
const excludedDirs = new Set([".git", "node_modules", "scripts"]);
const htmlAttributes = ["href", "src", "poster", "action"];
const badgeOverride = `
<style id="codex-static-badge-hide">
.buy-badge,
.w-webflow-badge,
a[href*="webflow.com"] .image-webflow,
a[href*="webflow.com"].w-webflow-badge {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
</style>
<script id="codex-static-badge-remove">
(() => {
  const selectors = [".buy-badge", ".w-webflow-badge"];
  const removeBadges = () => {
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => node.remove());
    }
  };

  removeBadges();
  document.addEventListener("DOMContentLoaded", removeBadges);
  window.addEventListener("load", removeBadges);
  new MutationObserver(removeBadges).observe(document.documentElement, { childList: true, subtree: true });
})();
</script>`;

const rootEntries = await fs.readdir(repoRoot, { withFileTypes: true });
const localPrefixes = rootEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((name) => !excludedDirs.has(name))
  .sort((left, right) => right.length - left.length);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shouldPrefixAbsolutePath(rawPath) {
  if (!rawPath.startsWith("/") || rawPath.startsWith("//")) {
    return false;
  }

  if (rawPath === "/") {
    return true;
  }

  if (rawPath === `/${repoName}` || rawPath.startsWith(`/${repoName}/`)) {
    return false;
  }

  if (rawPath === "/index.html") {
    return true;
  }

  return localPrefixes.some((prefix) => rawPath === `/${prefix}` || rawPath.startsWith(`/${prefix}/`));
}

function prefixAbsolutePath(rawPath) {
  if (rawPath === "/") {
    return `/${repoName}/`;
  }

  return `/${repoName}${rawPath}`;
}

function prefixLocalPathsInText(text) {
  let rewritten = text;

  for (const prefix of localPrefixes) {
    const pattern = new RegExp(`(^|[^A-Za-z0-9])\\/${escapeRegex(prefix)}(?=\\/|$|[?#"'\\s)])`, "g");
    rewritten = rewritten.replace(pattern, `$1/${repoName}/${prefix}`);
  }

  rewritten = rewritten.replace(/(^|[^A-Za-z0-9])\/index\.html(?=\/|$|[?#"'\s)])/g, `$1/${repoName}/index.html`);
  return rewritten;
}

function rewriteSrcset(value) {
  return value
    .split(",")
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return trimmed;
      }

      const match = trimmed.match(/^(\S+)(\s+.+)?$/);
      if (!match) {
        return trimmed;
      }

      const [, rawPath, descriptor = ""] = match;
      if (!shouldPrefixAbsolutePath(rawPath)) {
        return trimmed;
      }

      return `${prefixAbsolutePath(rawPath)}${descriptor}`;
    })
    .join(", ");
}

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

async function processHtml(filePath) {
  const original = await fs.readFile(filePath, "utf8");
  const $ = cheerio.load(original, { decodeEntities: false });

  $(".buy-badge, .w-webflow-badge").remove();

  for (const attribute of htmlAttributes) {
    $(`[${attribute}]`).each((_, element) => {
      const value = $(element).attr(attribute);
      if (!value || !shouldPrefixAbsolutePath(value)) {
        return;
      }

      $(element).attr(attribute, prefixAbsolutePath(value));
    });
  }

  $("[srcset]").each((_, element) => {
    const value = $(element).attr("srcset");
    if (!value) {
      return;
    }

    $(element).attr("srcset", rewriteSrcset(value));
  });

  $("script").each((_, element) => {
    const content = $(element).html();
    if (content) {
      $(element).html(prefixLocalPathsInText(content));
    }
  });

  $("style").each((_, element) => {
    const content = $(element).html();
    if (content) {
      $(element).html(prefixLocalPathsInText(content));
    }
  });

  if (!original.includes('id="codex-static-badge-hide"')) {
    $("head").append(badgeOverride);
  }

  const rewritten = prefixLocalPathsInText($.html());
  if (rewritten !== original) {
    await fs.writeFile(filePath, rewritten, "utf8");
  }
}

async function processText(filePath) {
  const original = await fs.readFile(filePath, "utf8");
  const rewritten = prefixLocalPathsInText(original);

  if (rewritten !== original) {
    await fs.writeFile(filePath, rewritten, "utf8");
  }
}

async function ensureRootRedirect() {
  const redirectHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=./paris/">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Redirecting…</title>
    <script>location.replace(new URL("./paris/", location.href));</script>
  </head>
  <body>
    <p>Redirecting to <a href="./paris/">Paris</a>…</p>
  </body>
</html>
`;

  await fs.writeFile(path.join(repoRoot, "index.html"), redirectHtml, "utf8");
}

const allFiles = await collectFiles(repoRoot);
for (const filePath of allFiles) {
  if (filePath.endsWith(".html")) {
    await processHtml(filePath);
    continue;
  }

  if (filePath.endsWith(".css") || filePath.endsWith(".js")) {
    await processText(filePath);
  }
}

await ensureRootRedirect();
