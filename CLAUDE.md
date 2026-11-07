# jonas.bergmann-rowe.com

Jonas Bergmann-Rowe's academic website (they/them; publishes as "Jonas Bergmann", ORCID 0009-0007-9881-7893).
Every commit to `main` is deployed automatically by Vercel to https://jonas.bergmann-rowe.com — so a push is publishing.

- Content is Markdown with YAML front matter: `content/profile.md`, `content/publications/*.md`, `content/talks/*.md`, `content/posts/*.md` (blog; the Writing section and /blog/ only appear once a non-draft post exists).
  Copy an existing file as a template; the file name becomes the URL slug. Field names must match `.pages.yml`
  (the Pages CMS schema) so the CMS keeps working.
- Dates: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`. Set `draft: true` to hide an item.
- Publications with a `doi` get authors, ORCIDs and an APA citation from OpenAlex/doi.org at build time
  (cached in `data/openalex-cache.json` — commit cache changes). Without a DOI, list `authors` manually.
- Downloads go in `public/files/`, images in `public/images/`.
- `build.mjs` renders to `dist/`; `src/style.css` and `src/network.js` (D3 co-author network) are the design.
- Before committing, run `npm install && npm run build` and make sure it succeeds.
- Jonas is not a programmer: explain changes in plain language, and describe what will change on the live site before pushing.
