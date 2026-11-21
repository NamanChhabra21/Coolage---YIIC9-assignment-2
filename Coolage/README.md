# Coolage

A multi-school management application with separate student, staff, and school-admin accounts.

**Project context:** Created for the YIIC9 challenge as an educational project submission. This repository is not presented as part of the author's professional development portfolio.

## Stack
- Cloudflare Workers (API and static assets)
- Cloudflare D1 (database)
- Vanilla HTML, CSS, JavaScript (frontend)

## Local setup
1. Install Node.js and run `npm ci`.
2. Configure your own Cloudflare D1 database in `wrangler.toml` if deploying to another account.
3. Run `npm run migrate:local` and `npm run dev` for local development.
4. Run `npm test` to execute the automated API tests.

## Deployment
Run `npm run migrate:remote` and `npm run deploy` after configuring Cloudflare credentials and the D1 database. The `public/config.js` file sets the public API origin for split frontend/API hosting; keep it empty or same-origin when frontend and API share one Worker.

## Security notes
- Never commit `.env`, `.dev.vars`, API tokens, passwords, onboarding SQL files, or actual student records.
- The test suite uses fictional sample accounts; do not use test credentials for real accounts.
- Before onboarding real schools or students, complete a privacy, access-control, and production-security review.
