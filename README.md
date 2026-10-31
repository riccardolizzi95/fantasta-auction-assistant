# FantAsta — fantasy football auction assistant

A live assistant for the auction of an Italian fantasy-football league ("fantacalcio"). It tells
you what a player is really worth **for your league and your strategy**, how far it pays to bid,
and re-plans your roster while the auction is running — including listening to the auctioneer
and recognising who bought whom.

> The UI and the long documentation in `docs/` are in **Italian**; this README and `CLAUDE.md` are
> in English.

## What it does

- **Valuation engine** (pure TypeScript, runs in the browser so every recalculation during the
  auction is instant):
  1. **Projection** — expected appearances, average rating and fantasy average from up to three
     past Serie A seasons (plus the current one if already started), adapted to *your* league's
     bonus/malus rules; players with little playing time are regressed towards the estimate implied
     by their official price.
  2. **Regression to the mean** — only part of a player's deviation from average repeats, and how
     much depends on the role; the coefficients are measured on real seasons.
  3. **Value over replacement (VOR)** — what matters is how much more a player yields than the one
     you would get for free, given the league size and the roster slots.
  4. **Price curve** — values are turned into credits and calibrated so the shape of the curve
     matches real auctions (median and tail, not only the top price).
- **Live auction board**: current call, budget and roster constraints for every participant,
  "ideal roster" plan that adapts after each purchase, strategy presets and health checks.
- **Voice**: listens to the auctioneer, understands Italian numbers and mangled player names,
  can fuse what several devices hear.
- **Data import**: official Fantacalcio.it files (player list, prices, season stats), enriched
  with API-Football, Wikidata and an LLM (OpenRouter) for careers abroad, injuries and penalty takers.
- **Export** to the FantaAstaLive board format.
- **Multi-league, multi-user**: Supabase Auth, invite-only leagues, RLS on every table, private
  strategies per participant, admin-only global data.

## Stack

- Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4
- Supabase: Postgres, Auth, Row Level Security, Realtime, RPC functions
- OpenRouter (qualitative analysis, voice interpretation), API-Football, Wikidata
- Vercel (functions pinned to `fra1`)
- `tsx` scripts for measurements and end-to-end checks; SheetJS for Excel files

## Getting started

```bash
npm install
cp .env.example .env.local      # Supabase URL and anon key are required, the rest is optional
npm run dev                     # http://localhost:3000
```

Then, with an administrator account, load the official Fantacalcio.it files (player list first,
then one or more seasons of stats) from the **Listone** page. The player data are not included in
this repository: they come from those files and from the external sources above, fetched by the
app and by the scripts in `scripts/`.

The database schema is not versioned in this repository yet; the tables and their purpose are
described in [`docs/DATI.md`](docs/DATI.md) and [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md).

## Checks

There is no unit-test framework: verification is done by **measurement scripts** (`npm run
check:*`, 29 of them) that exercise the real code paths on synthetic or real data. Full list with
one line each in [`CLAUDE.md`](CLAUDE.md#checks).

```bash
npm run typecheck   # app + scripts
npm run lint        # zero warnings tolerated
npm run build
```

Runnable **without credentials** (pure engine, parsers, synthetic data):

```bash
npm run check:engine         # valuation engine on a synthetic 3-season list
npm run check:conversion     # coefficients between leagues, goalkeepers, external sources
npm run check:import         # parsing of the official file formats
npm run check:voce           # Italian numbers and mangled names from the auctioneer
npm run check:voci           # speaker recognition on synthetic voices (~2 minutes)
npm run check:crediti        # no purchase can leave a roster impossible to complete
npm run check:ascolto        # is merging what several devices hear worth it?
npm run check:fantaastalive  # export files re-read by the FantaAstaLive reader
```

The others need a Supabase project with data loaded (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) and an admin test account (`TEST_EMAIL`, `TEST_PASSWORD`); some
also call the running app (`BASE_URL`) or paid APIs. `CLAUDE.md` explains how to create and
delete the throwaway test account.

## Project structure

```
src/
  app/                 pages (league, auction, shortlist, player list, rosters, strategy, settings) and API routes
  components/          UI; auction/ holds the live board, player analysis, ideal roster, voice listening
  lib/fanta/           domain logic: valuation, recommend, piano (roster plan), conversion between leagues,
                       importer, identify, external sources, voice parsing, FantaAstaLive format
  lib/supabase/        server/client/admin clients
scripts/               29 check:* measurement scripts (tsx)
docs/                  overview, architecture, engine, data, decisions, next steps (Italian)
```

## How it was built with Claude Code

- **`CLAUDE.md` as the operating manual**: working rules, the full list of checks with what each
  one proves, how to get an authenticated session from a script, and a growing list of
  **"traps already hit"** (PostgREST schema cache and silent 1000-row limit, upsert column union,
  API quotas, Vercel time limits…), so the same mistake is never paid for twice.
- **"Measure, don't assume."** Every non-obvious constant in the engine comes from a measurement
  on real data, and the comment next to it says which. When a measurement contradicts the code,
  the measurement wins. The `check:*` scripts are those measurements, kept runnable.
- **"The real path, not a copy of it."** After a bug reached production with every check green —
  the script had re-implemented the route instead of calling it — checks call the real endpoints
  and the real parsers (e.g. `check:endpoint`, `check:fantaastalive` reads the export with the
  third-party reader's own logic).
- **Decisions with their evidence**: [`docs/DECISIONI.md`](docs/DECISIONI.md) records each choice
  together with the numbers that justified it (e.g. the price-curve calibration on a real auction:
  median 8 vs 8, tail 88 vs 86).
- **Safe testing**: no passwords typed into browser fields; authenticated paths are tested by
  building the session cookie via the API, with a throwaway admin account created in SQL and
  deleted right after.
