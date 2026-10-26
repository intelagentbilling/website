# Website build

GitHub Pages serves this repo directly. There is no CI and no Jekyll. The 13 original
root pages (`index.html`, `pricing.html`, …) are hand-written and stay that way. Everything
under `/guides/`, `/compare/` and `/specialties/` is **generated** from `_content/` and must
not be edited in place — your edit will be overwritten on the next build.

## Commands

```bash
./_build/release.sh                     # build + verify, touches nothing in git
./_build/release.sh --publish -m "msg"  # build + verify, then commit and push to main
node _build/build.js                    # build only
node _build/build.js --check            # fail if output is stale (used by the pre-commit hook)
node _build/verify.js                   # QA the whole site, generated and hand-written
./_build/install-hooks.sh               # one-time: point git at _build/hooks
```

Run `./_build/install-hooks.sh` once per clone. It sets `core.hooksPath` so the pre-commit
hook blocks a commit whose generated pages do not match `_content/`.

## Adding a page

Create a file in `_content/<section>/<slug>.html`. The sections are `guides`, `compare` and
`specialties` — adding a new one means adding it to `SECTION_LABELS` in `build.js`.

The file starts with a meta block, then the page body as plain HTML starting at `<p>` or
`<h2>` — no `<html>`, `<head>`, nav or footer. Those come from `_build/layout.html`.

```html
<!--meta
{
  "url": "guides/my-new-guide/",
  "title": "My New Guide | IntelAGENT",
  "h1": "My new guide",
  "description": "Under 160 characters, ideally over 60.",
  "lede": "One or two sentences under the h1."
}
-->
        <p>Body starts here.</p>

        <h2 id="first">First section</h2>
```

Then `./_build/release.sh`. The page is written to `<url>/index.html` and added to
`sitemap.xml` automatically.

### Meta keys

Required:

| Key | Notes |
| --- | --- |
| `url` | Path without a leading slash, **must end in `/`**. Becomes `<url>/index.html`. |
| `title` | The `<title>`. Aim for 60 characters or fewer; a warning fires over 65. |
| `description` | The meta description. Aim for 60–160 characters. |
| `h1` | The single `<h1>`. Do not also put an `<h1>` in the body. |

Optional:

| Key | Default | Notes |
| --- | --- | --- |
| `lede` | — | Paragraph under the h1, styled `.lede`. |
| `breadcrumb` | the `h1` | Label for this page in the breadcrumb trail. |
| `eyebrow` | section label | Small label above the h1. |
| `published` | — | `YYYY-MM-DD`. Shows in the byline and feeds Article schema. |
| `updated` | `published` | `YYYY-MM-DD`. Also the sitemap `lastmod`. |
| `author` | IntelAGENT | Byline name. |
| `readingTime` | — | Free text, e.g. `6 min read`. |
| `schema` | `Article` | One of `Article`, `CollectionPage`, `WebPage`. |
| `about` | — | Array of strings, emitted as schema `about`. |
| `faq` | — | Array of `{q, a}`. Emits FAQPage schema. **Every `q` must appear verbatim in the body** or the build fails — Google requires the answer to be visible on the page. |
| `extraSchema` | — | Any extra JSON-LD object, emitted as its own script block. |
| `breadcrumbExtra` | — | Array of `{name, url}` inserted into the trail before this page. |
| `toc` | `true` | Sticky table of contents. Needs at least 3 `<h2 id>` headings or it is skipped. |
| `cta` | `true` | The dark call-to-action section at the foot of the page. |
| `ctaHeading`, `ctaText` | defaults | Override the CTA copy. |
| `ogTitle` | `title` | Open Graph title, if it should differ. |
| `priority`, `changefreq` | `0.7`, `monthly` | Sitemap hints. |

Writing conventions used throughout `_content/`:

- `<h2>` headings carry an `id`, because the table of contents is built from them.
- FAQ entries use `<details class="faq-item">` with the question in `<summary>`.
- Tables are wrapped in `<div class="tbl-wrap">` and need a `<caption>`.
- Every fee or figure taken from the Schedule of Benefits says "as of April 1, 2026" and
  links to the ministry page. Competitor figures carry the date they were checked.
- Nothing in `_content/` states a statistic we cannot point at a source for.

## What the build does

`build.js` reads `_content/**/*.html`, renders each through `_build/layout.html`, and writes
`<url>/index.html`. It also:

- emits breadcrumb HTML and `BreadcrumbList` JSON-LD;
- emits `Article` / `CollectionPage` / `WebPage` JSON-LD, plus `FAQPage` when `faq` is set;
- builds the table of contents from `<h2 id>`;
- sets the canonical URL from `url`;
- rewrites `sitemap.xml` — the 13 hand-written pages come from `STATIC_PAGES` in `build.js`,
  the rest from `_content/`;
- fails on a duplicate `url`, `title` or `description`, on an FAQ question missing from the
  body, and on a broken `/…` or `#…` link.

`verify.js` then checks the whole site: placeholders, titles, descriptions, canonicals, one
`<h1>` per page, heading order, JSON-LD validity, internal links, `<img alt>`, table captions,
sitemap coverage and the `robots.txt` sitemap line. Errors fail the release; warnings do not.

`/404.html`, `/onboarding.html` and `/app/*` are treated as utility pages and are exempt from
the description, canonical and h1 rules.

## Files

```
_build/layout.html        page shell (nav, footer, analytics, placeholders)
_build/build.js           generator
_build/verify.js          site-wide QA
_build/release.sh         build + verify (+ optional commit and push)
_build/install-hooks.sh   one-time hook setup
_build/hooks/pre-commit   blocks a commit with stale generated output
css/content.css           styles for generated pages only; additive to base.css and kit.css
_content/                 page sources
```

If you change the nav or footer, change it in **both** `_build/layout.html` and the 13
hand-written root pages, or the site will disagree with itself.
