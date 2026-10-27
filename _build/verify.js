#!/usr/bin/env node
/**
 * Checks the built site. Runs over every .html file in the repo — generated and
 * hand-written — and reports anything that would hurt in search or break for a
 * reader. Exits non-zero if it finds an error, which is what stops a release.
 *
 *   node _build/verify.js
 *
 * Errors fail the release. Warnings are printed and do not.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://www.intelagent.ca';
const SKIP_DIRS = new Set(['.git', '_build', '_content', 'img', 'fonts', 'css', 'node_modules']);

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

function htmlFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      htmlFiles(path.join(dir, entry.name), acc);
    } else if (entry.name.endsWith('.html')) {
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

/* A repo path -> the URL path it is served at. */
function servedAs(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

const files = htmlFiles(ROOT).map((f) => path.relative(ROOT, f)).sort();
const served = new Set(files.map(servedAs));
const titles = new Map();
const descriptions = new Map();

for (const rel of files) {
  const html = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const url = servedAs(rel);
  const isUtility = /^\/(404\.html|onboarding\.html|app\/)/.test(url);

  /* ---- leftover template placeholders ---- */
  const leftover = html.match(/\{\{[A-Z_]+\}\}/);
  if (leftover) err(rel, `unreplaced placeholder ${leftover[0]}`);

  /* ---- title ---- */
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  if (!title) err(rel, 'no <title>');
  else {
    if (titles.has(title)) err(rel, `duplicate <title> with ${titles.get(title)}`);
    else titles.set(title, rel);
    if (title.length > 65 && !isUtility) warn(rel, `<title> is ${title.length} chars`);
  }

  /* ---- meta description ---- */
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [])[1];
  if (!desc) {
    if (!isUtility) err(rel, 'no meta description');
  } else {
    if (descriptions.has(desc)) err(rel, `duplicate meta description with ${descriptions.get(desc)}`);
    else descriptions.set(desc, rel);
    if (desc.length > 165 && !isUtility) warn(rel, `meta description is ${desc.length} chars`);
    if (desc.length < 60 && !isUtility) warn(rel, `meta description is only ${desc.length} chars`);
  }

  /* ---- canonical ---- */
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/) || [])[1];
  if (!canonical) {
    if (!isUtility) err(rel, 'no canonical link');
  } else if (!isUtility) {
    /* Utility pages may point elsewhere on purpose — onboarding.html canonicalises
       to the docs site, which is deliberate. */
    const expected = `${ORIGIN}${url}`;
    if (canonical !== expected) err(rel, `canonical is ${canonical}, expected ${expected}`);
  }

  /* ---- headings ---- */
  const h1s = html.match(/<h1[\s>]/g) || [];
  if (!isUtility) {
    if (h1s.length === 0) err(rel, 'no <h1>');
    if (h1s.length > 1) err(rel, `${h1s.length} <h1> elements, expected exactly 1`);
  }

  /* ---- heading order: no h3 before the first h2, no h4 before the first h3 ---- */
  const order = [...html.matchAll(/<h([2-4])[\s>]/g)].map((m) => Number(m[1]));
  let deepest = 1;
  for (const level of order) {
    if (level > deepest + 1) {
      warn(rel, `heading jumps from h${deepest} to h${level}`);
      break;
    }
    deepest = Math.max(deepest, level);
  }

  /* ---- JSON-LD parses ---- */
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (!parsed['@type']) err(rel, 'JSON-LD block has no @type');
    } catch (e) {
      err(rel, `JSON-LD does not parse — ${e.message}`);
    }
  }

  /* ---- internal links resolve ---- */
  for (const m of html.matchAll(/href="([^"#?][^"]*)"/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|tel:|data:|\/\/)/.test(href)) continue;
    const clean = href.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = clean.startsWith('/')
      ? path.join(ROOT, clean)
      : path.resolve(path.join(ROOT, path.dirname(rel)), clean);
    if (!fs.existsSync(target) && !fs.existsSync(path.join(target, 'index.html'))) {
      err(rel, `broken link -> ${href}`);
    }
  }

  /* ---- images have alt text ---- */
  for (const m of html.matchAll(/<img\b([^>]*)>/g)) {
    if (!/\salt=/.test(m[1])) err(rel, `<img> without alt: ${m[0].slice(0, 90)}`);
  }

  /* ---- no fabricated review markup ---- */
  if (/"aggregateRating"/.test(html)) {
    warn(rel, 'has aggregateRating markup — Google requires this to come from real, visible reviews');
  }

  /* ---- tables need a caption or an aria-label for screen readers ---- */
  for (const m of html.matchAll(/<table\b([^>]*)>([\s\S]{0,400})/g)) {
    const hasLabel = /aria-label=|aria-labelledby=/.test(m[1]) || /<caption/.test(m[2]);
    if (!hasLabel) warn(rel, '<table> with no caption or aria-label');
  }
}

/* ---- sitemap covers every public page, and lists nothing missing ---- */
const sitemapPath = path.join(ROOT, 'sitemap.xml');
if (!fs.existsSync(sitemapPath)) {
  errors.push('sitemap.xml: missing');
} else {
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const listed = new Set(locs.map((l) => l.replace(ORIGIN, '') || '/'));

  for (const loc of locs) {
    if (!loc.startsWith(ORIGIN)) errors.push(`sitemap.xml: ${loc} is not on ${ORIGIN}`);
    const p = loc.replace(ORIGIN, '') || '/';
    if (!served.has(p)) errors.push(`sitemap.xml: lists ${p} but no such page exists`);
  }
  if (new Set(locs).size !== locs.length) errors.push('sitemap.xml: duplicate <loc> entries');

  for (const url of served) {
    const isUtility = /^\/(404\.html|onboarding\.html|app\/)/.test(url);
    if (!isUtility && !listed.has(url)) warnings.push(`sitemap.xml: does not list ${url}`);
  }
}

/* ---- robots.txt points at the sitemap ---- */
const robotsPath = path.join(ROOT, 'robots.txt');
if (!fs.existsSync(robotsPath)) {
  errors.push('robots.txt: missing');
} else {
  const robots = fs.readFileSync(robotsPath, 'utf8');
  if (!robots.includes(`${ORIGIN}/sitemap.xml`)) {
    errors.push('robots.txt: no Sitemap: line pointing at the sitemap');
  }
}

/* --------------------------------------------------------------- reporting */

console.log(`checked ${files.length} html files`);
for (const w of warnings) console.log(`  warn   ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  error  ${e}`);
  process.exit(1);
}
console.log(`ok — 0 errors, ${warnings.length} warning(s)`);
