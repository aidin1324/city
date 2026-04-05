import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputRoot = projectRoot;
const siteRoot = new URL("https://www.parisbyemily.com/");
const sitemapUrl = new URL("/sitemap.xml", siteRoot);
const startPages = ["https://www.parisbyemily.com/paris"];

const pageQueue = [...startPages];
const visitedPages = new Set();
const downloadedAssets = new Map();

const htmlExtensions = new Set([".html", ".htm"]);
const assetSelectors = [
  ["img", "src"],
  ["img", "srcset"],
  ["source", "src"],
  ["source", "srcset"],
  ["script", "src"],
  ["link", "href"],
  ["video", "src"],
  ["audio", "src"],
  ["iframe", "src"],
];
const removableScriptPatterns = [
  "googletagmanager.com",
  "google_tags_first_party",
  "gtag(",
  "GTM-KB3NHPJQ",
  "G-JKV8C4BK3C",
  "@finsweet/cookie-consent",
  "fs-cc.js",
  "/nvhc9u4gxsag",
];
const removableNodeSelectors = [".fs-cc_component"];

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function hasFileExtension(pathname) {
  return path.extname(pathname) !== "";
}

function normalizePagePath(url) {
  const pathname = url.pathname;
  if (pathname === "/") {
    return "/index.html";
  }

  if (pathname.endsWith("/")) {
    return `${pathname}index.html`;
  }

  if (hasFileExtension(pathname)) {
    return pathname;
  }

  return `${pathname}/index.html`;
}

function extensionFromContentType(contentType = "") {
  if (contentType.includes("css")) return ".css";
  if (contentType.includes("javascript")) return ".js";
  if (contentType.includes("json")) return ".json";
  if (contentType.includes("svg")) return ".svg";
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("jpeg")) return ".jpg";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("avif")) return ".avif";
  if (contentType.includes("woff2")) return ".woff2";
  if (contentType.includes("woff")) return ".woff";
  if (contentType.includes("ttf")) return ".ttf";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("mp4")) return ".mp4";
  if (contentType.includes("webm")) return ".webm";
  if (contentType.includes("ico")) return ".ico";
  return "";
}

function normalizeAssetPath(url, contentType = "") {
  const safeHost = url.host.replace(/[^a-zA-Z0-9.-]/g, "_");
  const pathname = url.pathname;
  let localPath = pathname.endsWith("/") ? `${pathname}index` : pathname;

  if (!path.extname(localPath)) {
    localPath += extensionFromContentType(contentType) || ".bin";
  }

  if (url.search) {
    const ext = path.extname(localPath);
    const suffix = `__${url.search.slice(1).replace(/[^a-zA-Z0-9.-]+/g, "_")}`;
    localPath = `${localPath.slice(0, -ext.length)}${suffix}${ext}`;
  }

  return path.posix.join("/assets", safeHost, localPath);
}

function publicUrlToFilePath(publicPath) {
  const relativePath = publicPath.replace(/^\/+/, "");
  const decodedPath = (() => {
    try {
      return decodeURIComponent(relativePath);
    } catch {
      return relativePath;
    }
  })();

  return path.join(outputRoot, decodedPath);
}

function shouldVisitPage(url) {
  return url.host === siteRoot.host && (url.pathname === "/city" || url.pathname.startsWith("/city/")) && !hasFileExtension(url.pathname);
}

function toAbsoluteUrl(rawValue, baseUrl) {
  if (!rawValue || rawValue.startsWith("data:") || rawValue.startsWith("blob:")) {
    return null;
  }

  if (rawValue.startsWith("#") || rawValue.startsWith("mailto:") || rawValue.startsWith("tel:") || rawValue.startsWith("javascript:")) {
    return null;
  }

  try {
    return new URL(rawValue, baseUrl);
  } catch {
    return null;
  }
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type") || "",
    body: await response.text(),
  };
}

async function loadParisPagesFromSitemap() {
  try {
    const { body } = await fetchText(sitemapUrl.href);
    const matches = [...body.matchAll(/<loc>(.*?)<\/loc>/g)];
    const sitemapPages = matches
      .map((match) => match[1]?.trim())
      .filter(Boolean)
      .filter((rawUrl) => {
        try {
          return shouldVisitPage(new URL(rawUrl));
        } catch {
          return false;
        }
      });

    for (const pageUrl of sitemapPages) {
      pageQueue.push(pageUrl);
    }
  } catch (error) {
    console.warn(`Failed to load sitemap ${sitemapUrl.href}: ${error.message}`);
  }
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return {
    contentType: response.headers.get("content-type") || "",
    body: Buffer.from(await response.arrayBuffer()),
  };
}

function collectCssUrls(content) {
  const urls = [];
  const regex = /url\((['"]?)(.*?)\1\)/g;
  let match;
  while ((match = regex.exec(content))) {
    urls.push(match[2]);
  }
  return urls;
}

function collectJsUrls(content) {
  return [...content.matchAll(/https?:\/\/[^"'`\s)\\]+/g)].map((match) => match[0]);
}

function collectJsAssetRefs(content) {
  const refs = new Set(collectJsUrls(content));
  const relativeAssetPattern = /["'`](\.{0,2}\/[^"'`\s)\\]+?\.(?:js|css|json|svg|png|jpe?g|webp|avif|gif|mp4|webm|woff2?|ttf|ico))["'`]/g;
  const bareChunkPattern = /["'`](webflow\.achunk\.[^"'`\s]+?\.js)["'`]/g;
  const webpackChunkMapPattern = /webflow\.achunk\."\+\(\{(.*?)\}\)\[e\]\+"\.js"/g;

  for (const match of content.matchAll(relativeAssetPattern)) {
    refs.add(match[1]);
  }

  for (const match of content.matchAll(bareChunkPattern)) {
    refs.add(match[1]);
  }

  for (const match of content.matchAll(webpackChunkMapPattern)) {
    const chunkMap = match[1];
    for (const chunkMatch of chunkMap.matchAll(/:"([a-f0-9]+)"/g)) {
      refs.add(`webflow.achunk.${chunkMatch[1]}.js`);
    }
  }

  return [...refs];
}

function isTemplateLikeRef(rawValue) {
  return rawValue.includes("${") || rawValue.includes("$%7B") || rawValue.includes("%7D");
}

function shouldDownloadUrl(url) {
  const allowedHosts = new Set([
    siteRoot.host,
    "cdn.prod.website-files.com",
    "d3e54v103j8qbb.cloudfront.net",
    "cdn.jsdelivr.net",
    "assets.slater.app",
  ]);

  if (!allowedHosts.has(url.host)) {
    return false;
  }

  if (isTemplateLikeRef(url.href)) {
    return false;
  }

  if (url.host !== siteRoot.host && !hasFileExtension(url.pathname)) {
    return false;
  }

  if (url.host === siteRoot.host && !hasFileExtension(url.pathname) && !url.pathname.startsWith("/city")) {
    return false;
  }

  return true;
}

async function rewriteCss(cssText, baseUrl) {
  let rewritten = cssText;
  const urls = collectCssUrls(cssText);

  for (const rawValue of urls) {
    if (isTemplateLikeRef(rawValue)) {
      continue;
    }

    const assetUrl = toAbsoluteUrl(rawValue, baseUrl);
    if (!assetUrl || !shouldDownloadUrl(assetUrl)) {
      continue;
    }

    let localPath;
    try {
      localPath = await downloadAsset(assetUrl);
    } catch {
      continue;
    }

    const escapedRaw = rawValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rewritten = rewritten.replace(new RegExp(`url\\((['"]?)${escapedRaw}\\1\\)`, "g"), `url("${localPath}")`);
  }

  return rewritten;
}

async function rewriteJs(scriptText, baseUrl) {
  let rewritten = scriptText;
  const urls = collectJsAssetRefs(scriptText);

  for (const rawValue of urls) {
    if (isTemplateLikeRef(rawValue)) {
      continue;
    }

    const assetUrl = toAbsoluteUrl(rawValue, baseUrl);
    if (!assetUrl || !shouldDownloadUrl(assetUrl)) {
      continue;
    }

    let localPath;
    try {
      localPath = await downloadAsset(assetUrl);
    } catch {
      continue;
    }

    rewritten = rewritten.split(rawValue).join(localPath);
  }

  return rewritten;
}

async function downloadAsset(url) {
  const cacheKey = url.href;
  if (downloadedAssets.has(cacheKey)) {
    return downloadedAssets.get(cacheKey);
  }

  const { contentType, body } = await fetchBinary(url.href);
  const publicPath = normalizeAssetPath(url, contentType);
  const filePath = publicUrlToFilePath(publicPath);

  if (contentType.includes("text/css")) {
    const cssText = body.toString("utf8");
    const rewrittenCss = await rewriteCss(cssText, url);
    await ensureDir(filePath);
    await fs.writeFile(filePath, rewrittenCss, "utf8");
    downloadedAssets.set(cacheKey, publicPath);
    return publicPath;
  }

  if (contentType.includes("javascript") || publicPath.endsWith(".js")) {
    const jsText = body.toString("utf8");
    const rewrittenJs = await rewriteJs(jsText, url);
    await ensureDir(filePath);
    await fs.writeFile(filePath, rewrittenJs, "utf8");
    downloadedAssets.set(cacheKey, publicPath);
    return publicPath;
  }

  await ensureDir(filePath);
  await fs.writeFile(filePath, body);
  downloadedAssets.set(cacheKey, publicPath);
  return publicPath;
}

function shouldRemoveScript({ src, inlineContent }) {
  return removableScriptPatterns.some((pattern) => src.includes(pattern) || inlineContent.includes(pattern));
}

async function rewriteHtml(html, pageUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  for (const selector of removableNodeSelectors) {
    $(selector).remove();
  }

  $("noscript").remove();

  const scriptElements = $("script").toArray();
  for (const element of scriptElements) {
    const src = $(element).attr("src") || "";
    const inlineContent = $(element).html() || "";

    if (shouldRemoveScript({ src, inlineContent })) {
      $(element).remove();
      continue;
    }

    if (!src && inlineContent) {
      $(element).html(await rewriteJs(inlineContent, pageUrl));
    }
  }

  for (const [selector, attribute] of assetSelectors) {
    $(selector).each((_, element) => {
      const value = $(element).attr(attribute);
      if (value) {
        $(element).attr(`data-pending-${attribute}`, value);
      }
    });
  }

  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    const absoluteUrl = toAbsoluteUrl(href, pageUrl);
    if (!absoluteUrl) {
      return;
    }

    if (shouldVisitPage(absoluteUrl)) {
      pageQueue.push(absoluteUrl.href);
      const localHref = absoluteUrl.pathname === "/city" ? "/city" : absoluteUrl.pathname.replace(/\/$/, "");
      $(element).attr("href", absoluteUrl.search ? `${localHref}${absoluteUrl.search}` : localHref);
    }
  });

  for (const [selector, attribute] of assetSelectors) {
    const elements = $(`${selector}[data-pending-${attribute}]`).toArray();
    for (const element of elements) {
      const originalValue = $(element).attr(`data-pending-${attribute}`);
      $(element).removeAttr(`data-pending-${attribute}`);
      if (!originalValue) {
        continue;
      }

      if (attribute === "srcset") {
        const candidates = originalValue
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean);

        const rewrittenCandidates = [];
        for (const candidate of candidates) {
          const match = candidate.match(/^(\S+)(?:\s+(.+))?$/);
          if (!match) {
            rewrittenCandidates.push(candidate);
            continue;
          }

          const [, assetRef, descriptor] = match;
          const absoluteUrl = toAbsoluteUrl(assetRef, pageUrl);
          if (!absoluteUrl || !shouldDownloadUrl(absoluteUrl)) {
            rewrittenCandidates.push(candidate);
            continue;
          }

          let localPath;
          try {
            localPath = await downloadAsset(absoluteUrl);
          } catch {
            rewrittenCandidates.push(candidate);
            continue;
          }

          rewrittenCandidates.push(descriptor ? `${localPath} ${descriptor}` : localPath);
        }

        $(element).attr(attribute, rewrittenCandidates.join(", "));
        continue;
      }

      const absoluteUrl = toAbsoluteUrl(originalValue, pageUrl);
      if (!absoluteUrl || !shouldDownloadUrl(absoluteUrl)) {
        continue;
      }

      const rel = ($(element).attr("rel") || "").toLowerCase();
      if (selector === "link" && (rel.includes("preconnect") || rel.includes("dns-prefetch"))) {
        $(element).remove();
        continue;
      }

      let localPath;
      try {
        localPath = await downloadAsset(absoluteUrl);
      } catch {
        continue;
      }

      $(element).attr(attribute, localPath);
      $(element).removeAttr("integrity");
      $(element).removeAttr("crossorigin");
    }
  }

  const styleNodes = $("style").toArray();
  for (const node of styleNodes) {
    const content = $(node).html();
    if (content) {
      $(node).html(await rewriteCss(content, pageUrl));
    }
  }

  const styledElements = $("[style]").toArray();
  for (const element of styledElements) {
    const styleValue = $(element).attr("style");
    if (styleValue) {
      $(element).attr("style", await rewriteCss(styleValue, pageUrl));
    }
  }

  return $.html();
}

async function savePage(url) {
  const normalizedPath = normalizePagePath(new URL(url));
  const filePath = publicUrlToFilePath(normalizedPath);
  const { body } = await fetchText(url);
  const rewritten = await rewriteHtml(body, url);
  await ensureDir(filePath);
  await fs.writeFile(filePath, rewritten, "utf8");
}

async function main() {
  await loadParisPagesFromSitemap();

  while (pageQueue.length > 0) {
    const pageUrl = pageQueue.shift();
    if (!pageUrl || visitedPages.has(pageUrl)) {
      continue;
    }

    visitedPages.add(pageUrl);
    await savePage(pageUrl);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
