#!/usr/bin/env node
/**
 * IntelAGENT static site generator.
 *
 * Reads _content/<section>/<slug>.html, wraps each one in _build/layout.html,
 * and writes <url>/index.html into the repo root. Also rewrites sitemap.xml so
 * every page (hand-written and generated) is listed with a lastmod.
 *
 * No dependencies. Run it with `node _build/build.js`, or let _build/release.sh
 * do it. `--check` builds into memory and fails if what is on disk differs,
 * which is what the pre-commit hook uses.
 *
 * Content file format:
 *
 *   <!--meta
 *   { "url": "guides/my-page/", "title": "...", "description": "...", ... }
 *   -->
 *   <section class="section">...</section>
 *
 * Every key the meta block accepts is documented in _build/README.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = path.join(ROOT, '_content');
const LAYOUT = path.join(__dirname, 'layout.html');
const ORIGIN = 'https://www.intelagent.ca';

const CHECK_ONLY = process.argv.includes('--check');
const QUIET = process.argv.includes('--quiet');

/* Hand-written pages at the repo root. They are not generated, but the sitemap
   has to list them, so they live here with the priority they had before. */
const STATIC_PAGES = [
  { url: '', priority: '1.0', changefreq: 'monthly' },
  { url: 'mobile.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'web.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'departments-and-groups.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'clinics.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'emr-clinic.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'pricing.html', priority: '0.8', changefreq: 'monthly' },
  { url: 'referrals.html', priority: '0.7', changefreq: 'monthly' },
  { url: 'compare.html', priority: '0.6', changefreq: 'monthly' },
  { url: 'contact.html', priority: '0.7', changefreq: 'yearly' },
  { url: 'full-service-billing.html', priority: '0.9', changefreq: 'monthly' },
  { url: 'what-is-ohip-billing.html', priority: '0.7', changefreq: 'monthly' },
  { url: 'privacy.html', priority: '0.3', changefreq: 'yearly' },
  { url: 'terms.html', priority: '0.3', changefreq: 'yearly' },
];

const SECTION_LABELS = {
  guides: 'Guides',
  specialties: 'Specialties',
};

/* Sections whose landing page is a flat root page rather than <section>/index.html. */
const SECTION_URLS = {};

/* ------------------------------------------------------------------ helpers */

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/* Strip tags for use inside a JSON-LD string value. */
const plain = (s) =>
  String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

const absolute = (url) => (url ? `${ORIGIN}/${url}` : `${ORIGIN}/`);

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

function parseContentFile(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^﻿?\s*<!--meta\s*([\s\S]*?)-->\s*/);
  if (!match) {
    throw new Error(`${path.relative(ROOT, file)}: missing <!--meta ... --> block`);
  }
  let meta;
  try {
    meta = JSON.parse(match[1]);
  } catch (err) {
    throw new Error(`${path.relative(ROOT, file)}: meta block is not valid JSON — ${err.message}`);
  }
  for (const key of ['url', 'title', 'description', 'h1']) {
    if (!meta[key]) throw new Error(`${path.relative(ROOT, file)}: meta.${key} is required`);
  }
  if (!meta.url.endsWith('/')) {
    throw new Error(`${path.relative(ROOT, file)}: meta.url must end with "/" (got "${meta.url}")`);
  }
  return { file, meta, body: raw.slice(match[0].length) };
}

/* -------------------------------------------------------------- page pieces */

function breadcrumbTrail(meta) {
  const trail = [{ name: 'Home', url: '' }];
  const section = meta.url.split('/')[0];
  if (SECTION_LABELS[section] && meta.url !== `${section}/`) {
    trail.push({ name: SECTION_LABELS[section], url: SECTION_URLS[section] || `${section}/` });
  }
  if (Array.isArray(meta.breadcrumbExtra)) trail.push(...meta.breadcrumbExtra);
  trail.push({ name: meta.breadcrumb || meta.h1, url: meta.url });
  return trail;
}

function breadcrumbHtml(trail) {
  const items = trail.map((crumb, i) => {
    const last = i === trail.length - 1;
    const label = esc(plain(crumb.name));
    return last
      ? `          <li><span aria-current="page">${label}</span></li>`
      : `          <li><a href="/${crumb.url}">${label}</a></li>`;
  });
  return [
    '      <nav aria-label="Breadcrumb">',
    '        <ol class="crumbs">',
    ...items,
    '        </ol>',
    '      </nav>',
  ].join('\n');
}

function tocHtml(body) {
  const headings = [];
  const re = /<h2[^>]*\sid="([^"]+)"[^>]*>([\s\S]*?)<\/h2>/g;
  let m;
  while ((m = re.exec(body))) headings.push({ id: m[1], text: plain(m[2]) });
  if (headings.length < 3) return '';
  return [
    '        <aside class="doc-aside">',
    '          <div class="toc">',
    '            <p class="toc-label">On this page</p>',
    '            <ul>',
    ...headings.map((h) => `              <li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`),
    '            </ul>',
    '          </div>',
    '        </aside>',
  ].join('\n');
}

function jsonLdBlocks(meta, body, trail) {
  const blocks = [];
  const canonical = absolute(meta.url);

  blocks.push({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: plain(crumb.name),
      item: absolute(crumb.url),
    })),
  });

  const type = meta.schema || 'Article';
  if (type === 'Article') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: plain(meta.h1),
      description: meta.description,
      url: canonical,
      mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
      datePublished: meta.published,
      dateModified: meta.updated || meta.published,
      inLanguage: 'en-CA',
      author: { '@type': 'Organization', name: 'IntelAGENT', url: ORIGIN },
      publisher: {
        '@type': 'Organization',
        name: 'IntelAGENT',
        url: ORIGIN,
        logo: { '@type': 'ImageObject', url: `${ORIGIN}/img/intelagent_logo_written.svg` },
      },
      ...(meta.about ? { about: meta.about.map((n) => ({ '@type': 'Thing', name: n })) } : {}),
    });
  } else if (type === 'CollectionPage') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: plain(meta.h1),
      description: meta.description,
      url: canonical,
      inLanguage: 'en-CA',
      isPartOf: { '@type': 'WebSite', name: 'IntelAGENT', url: ORIGIN },
    });
  } else if (type === 'WebPage') {
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: plain(meta.h1),
      description: meta.description,
      url: canonical,
      inLanguage: 'en-CA',
      datePublished: meta.published,
      dateModified: meta.updated || meta.published,
    });
  }

  /* FAQPage only when the page really renders those questions. Rich results are
     not guaranteed and that is fine — the markup still describes the page. */
  if (Array.isArray(meta.faq) && meta.faq.length) {
    for (const item of meta.faq) {
      if (!body.includes(item.q)) {
        throw new Error(
          `${meta.url}: meta.faq question is not on the page, so FAQPage markup would be misleading — "${item.q}"`
        );
      }
    }
    blocks.push({
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: meta.faq.map((item) => ({
        '@type': 'Question',
        name: plain(item.q),
        acceptedAnswer: { '@type': 'Answer', text: plain(item.a) },
      })),
    });
  }

  if (Array.isArray(meta.extraSchema)) blocks.push(...meta.extraSchema);

  return blocks
    .map((b) => `    <script type="application/ld+json">\n${JSON.stringify(b, null, 4)
      .split('\n')
      .map((l) => `    ${l}`)
      .join('\n')}\n    </script>`)
    .join('\n');
}

function renderPage(page, layout) {
  const { meta, body } = page;
  const trail = breadcrumbTrail(meta);
  const aside = meta.toc === false ? '' : tocHtml(body);

  const header = [
    '  <section class="hero hero--sm">',
    '    <div class="container">',
    breadcrumbHtml(trail),
    `      <span class="eyebrow">${esc(meta.eyebrow || SECTION_LABELS[meta.url.split('/')[0]] || 'IntelAGENT')}</span>`,
    `      <h1 class="h1">${meta.h1}</h1>`,
    meta.lede ? `      <p class="lede" style="max-width:62ch">${meta.lede}</p>` : '',
    '    </div>',
    '  </section>',
  ]
    .filter(Boolean)
    .join('\n');

  const bylineBits = [];
  if (meta.published) {
    bylineBits.push(
      `<span>Published <time datetime="${esc(meta.published)}">${longDate(meta.published)}</time></span>`
    );
  }
  if (meta.updated && meta.updated !== meta.published) {
    bylineBits.push(
      `<span>Last reviewed <time datetime="${esc(meta.updated)}">${longDate(meta.updated)}</time></span>`
    );
  }
  if (meta.author) bylineBits.push(`<span>By <b>${esc(meta.author)}</b></span>`);
  if (meta.readingTime) bylineBits.push(`<span>${esc(meta.readingTime)}</span>`);

  const byline = bylineBits.length
    ? `        <div class="byline">${bylineBits.join('')}</div>\n`
    : '';

  const article = [
    '  <section class="section" style="padding-top:12px">',
    '    <div class="container">',
    aside ? '      <div class="doc">' : '      <div>',
    '        <article class="prose">',
    byline + body.trimEnd(),
    '        </article>',
    aside,
    '      </div>',
    '    </div>',
    '  </section>',
  ]
    .filter(Boolean)
    .join('\n');

  const cta = meta.cta === false ? '' : ctaHtml(meta);

  const html = layout
    .replace('{{TITLE}}', esc(meta.title))
    .replace(/\{\{DESCRIPTION\}\}/g, esc(meta.description))
    .replace(/\{\{CANONICAL\}\}/g, absolute(meta.url))
    .replace('{{OG_TYPE}}', meta.schema === 'Article' || !meta.schema ? 'article' : 'website')
    .replace(/\{\{OG_TITLE\}\}/g, esc(plain(meta.ogTitle || meta.h1)))
    .replace('{{JSONLD}}', jsonLdBlocks(meta, body, trail))
    .replace('{{BODY}}', [header, article, cta].filter(Boolean).join('\n\n'));

  if (html.includes('{{')) {
    const leftover = html.match(/\{\{[A-Z_]+\}\}/);
    throw new Error(`${meta.url}: layout placeholder left unreplaced — ${leftover && leftover[0]}`);
  }
  return html;
}

function ctaHtml(meta) {
  const heading = meta.ctaHeading || 'Try IntelAGENT free for three months';
  const text =
    meta.ctaText ||
    'Submit your first claim today. No credit card, no setup fee, and nothing to install &mdash; the trial runs on the same platform you would keep using.';
  return [
    '  <section class="section section--ink">',
    '    <div class="container center">',
    '      <span class="eyebrow eyebrow--on-ink">Get started</span>',
    `      <h2 class="h2" style="color:#fff">${heading}</h2>`,
    `      <p class="lede" style="color:rgba(255,255,255,0.72);max-width:54ch;margin-inline:auto">${text}</p>`,
    '      <div class="row" style="justify-content:center">',
    '        <a href="https://app.intelagent.ca/register" class="btn btn--brand btn--lg">Start free trial</a>',
    '        <a href="/contact.html" class="btn btn--on-ink btn--lg">Book a demo</a>',
    '      </div>',
    '    </div>',
    '  </section>',
  ].join('\n');
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/* ------------------------------------------------------------------ sitemap */

function buildSitemap(generated, today) {
  const rows = [];
  for (const p of STATIC_PAGES) {
    const file = path.join(ROOT, p.url || 'index.html');
    let lastmod = today;
    try {
      lastmod = fs.statSync(file).mtime.toISOString().slice(0, 10);
    } catch (_) {
      /* page missing on disk — the link check reports it */
    }
    rows.push({ loc: absolute(p.url), lastmod, priority: p.priority, changefreq: p.changefreq });
  }
  for (const page of generated) {
    rows.push({
      loc: absolute(page.meta.url),
      lastmod: page.meta.updated || page.meta.published || today,
      priority: page.meta.priority || '0.7',
      changefreq: page.meta.changefreq || 'monthly',
    });
  }
  const body = rows
    .map(
      (r) =>
        `  <url>\n    <loc>${r.loc}</loc>\n    <lastmod>${r.lastmod}</lastmod>\n` +
        `    <changefreq>${r.changefreq}</changefreq>\n    <priority>${r.priority}</priority>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generated by _build/build.js — do not edit by hand. -->\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

/* --------------------------------------------------------------------- main */

function main() {
  if (!fs.existsSync(CONTENT)) {
    console.error('no _content directory — nothing to build');
    process.exit(1);
  }
  const layout = fs.readFileSync(LAYOUT, 'utf8');
  const today = new Date().toISOString().slice(0, 10);

  const pages = walk(CONTENT).sort().map(parseContentFile);

  /* Uniqueness checks before anything is written. */
  const seen = new Map();
  for (const p of pages) {
    for (const [key, label] of [['url', 'url'], ['title', 'title'], ['description', 'description']]) {
      const k = `${key}:${p.meta[key]}`;
      if (seen.has(k)) {
        throw new Error(
          `duplicate ${label} between ${path.relative(ROOT, seen.get(k))} and ${path.relative(ROOT, p.file)}: "${p.meta[key]}"`
        );
      }
      seen.set(k, p.file);
    }
    if (p.meta.title.length > 65) {
      warn(`${p.meta.url}: title is ${p.meta.title.length} chars, Google truncates around 60`);
    }
    if (p.meta.description.length > 165) {
      warn(`${p.meta.url}: meta description is ${p.meta.description.length} chars, aim for under 160`);
    }
  }

  const outputs = new Map();
  for (const page of pages) {
    outputs.set(path.join(ROOT, page.meta.url, 'index.html'), renderPage(page, layout));
  }
  outputs.set(path.join(ROOT, 'sitemap.xml'), buildSitemap(pages, today));

  if (CHECK_ONLY) {
    const stale = [];
    for (const [file, html] of outputs) {
      let current = null;
      try {
        current = fs.readFileSync(file, 'utf8');
      } catch (_) {
        /* missing */
      }
      /* sitemap lastmod tracks file mtimes, so compare it loosely: only the
         url set matters for staleness, not the dates. */
      if (path.basename(file) === 'sitemap.xml') {
        const locs = (s) => (s || '').match(/<loc>[^<]*<\/loc>/g) || [];
        if (locs(current).join() !== locs(html).join()) stale.push(path.relative(ROOT, file));
      } else if (current !== html) {
        stale.push(path.relative(ROOT, file));
      }
    }
    if (stale.length) {
      console.error('Generated output is out of date. Run: node _build/build.js\n');
      for (const f of stale) console.error(`  stale  ${f}`);
      process.exit(1);
    }
    say(`up to date — ${pages.length} pages`);
    return;
  }

  let written = 0;
  for (const [file, html] of outputs) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (before !== html) written++;
    fs.writeFileSync(file, html);
    say(`  ${before === null ? 'new ' : before === html ? '    ' : 'upd '} ${path.relative(ROOT, file)}`);
  }
  say(`\n${pages.length} pages, ${written} file(s) changed`);

  const problems = checkLinks(pages);
  if (problems.length) {
    console.error('\nBroken internal links:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  say('internal links ok');
}

/* Every href="/..." on a generated page has to resolve to something on disk. */
function checkLinks(pages) {
  const problems = [];
  const files = new Set();
  for (const page of pages) files.add(`/${page.meta.url}`);

  const exists = (href) => {
    const clean = href.split('#')[0].split('?')[0];
    if (clean === '/' || clean === '') return true;
    if (files.has(clean)) return true;
    const rel = clean.replace(/^\//, '');
    return (
      fs.existsSync(path.join(ROOT, rel)) ||
      fs.existsSync(path.join(ROOT, rel, 'index.html'))
    );
  };

  for (const page of pages) {
    const html = fs.readFileSync(path.join(ROOT, page.meta.url, 'index.html'), 'utf8');
    const ids = new Set((html.match(/\sid="([^"]+)"/g) || []).map((s) => s.slice(5, -1)));
    for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
      const href = m[1];
      if (!exists(href)) problems.push(`${page.meta.url} -> ${href}`);
    }
    for (const m of html.matchAll(/href="(#[^"]+)"/g)) {
      const frag = m[1].slice(1);
      if (!ids.has(frag)) problems.push(`${page.meta.url} -> ${m[1]} (no such id on page)`);
    }
  }
  return problems;
}

function say(msg) {
  if (!QUIET) console.log(msg);
}
function warn(msg) {
  console.warn(`  warn  ${msg}`);
}

try {
  main();
} catch (err) {
  console.error(`\nbuild failed: ${err.message}`);
  process.exit(1);
}
