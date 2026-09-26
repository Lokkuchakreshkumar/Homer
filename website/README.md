# Homer website checks

The website is a static export with local fonts and assets. Run the checks from this directory:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:browser
npm run test:links
```

`npm run test:links` requires the exported site and checks internal files and fragments. External URLs are intentionally opt-in because the configured public Homer repository currently returns 404 while it may be private. Run the external check explicitly with:

```bash
npm run test:links:external
```

An external failure remains a real failure; the default check reports that external links were not requested rather than treating them as passing.

## Metadata and deployment policy

The static export emits no canonical or absolute social URLs when `NEXT_PUBLIC_SITE_URL` is absent. Production deployments must set `NEXT_PUBLIC_SITE_URL` to the public origin before building. Preview indexing is an explicit deployment choice: the preview host must decide whether to allow indexing or add a no-index policy. The repository does not choose a domain for either environment.
