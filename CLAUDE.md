# FantAsta — operating manual

Auction assistant for fantasy football (Italian "fantacalcio"), 2026/27 season. Next.js 16 on
Vercel, Supabase for database and authentication, OpenRouter and API-Football as external sources.

Documentation (in Italian): [overview](docs/PANORAMICA.md) · [architecture](docs/ARCHITETTURA.md) ·
[engine](docs/MOTORE.md) · [data](docs/DATI.md) · [decisions](docs/DECISIONI.md) ·
[next steps](docs/PROSSIMI-PASSI.md).

Deploy check: Vercel reports the deployment state on the commit, so the quickest check is the
commit status on GitHub:

```bash
gh api repos/<owner>/<repo>/commits/$(git rev-parse HEAD)/status --jq '.state'
```

## Working rules

**Measure, don't assume.** Every non-obvious constant in this project comes from a measurement
on real data, and the comment next to it says which one. If a new number is needed, measure it
and document it; if a measurement contradicts the code, the measurement wins. The `check:*`
scripts exist for this.

**The real path, not a copy of it.** A bug reached production with every test green because the
check script re-implemented the route's logic instead of calling it. `npm run check:endpoint`
calls the real endpoint.

**No passwords typed into browser fields.** To exercise authenticated paths, build the session
cookie through the API (see below) or use a script.

## Checks

```bash
npm run typecheck          # types of app and scripts (includes .tsx)
npm run lint               # eslint, zero warnings tolerated
npm run build              # production build

npm run check:engine       # engine on a synthetic 3-season player list + a season-already-started scenario
npm run check:conversion   # coefficients between leagues, goalkeepers, external sources
npm run check:import       # reading the official files and matching them to the player list
npm run check:integration  # end-to-end on the real database (auth, RLS, RPC, engine)
npm run check:endpoint     # calls /api/import like the browser does, on the real files
npm run check:recovery     # drives the real recovery loop and measures batch duration
npm run check:persistence  # re-measures persistence and reference levels per role
npm run check:bench        # compares models, providers and search engines on the real task
npm run check:wikidata     # how much of the player list Wikidata covers, and with which filter (free)
npm run check:rosters      # identifies the whole player list from official rosters (20 calls)
npm run check:seasons      # minutes, rating and starts from one season (~40 calls)
npm run check:prices       # the price curve: concentration, cap, comparison with the official list
npm run check:voce         # understanding the auctioneer: Italian numbers and mangled names
npm run check:asta         # a whole simulated auction: does the advice actually win?
npm run check:voci         # the chain that recognises who is speaking, on synthetic voices
npm run check:ricerca      # how many keystrokes to reach the right player, on the real list
npm run check:contesto     # does the advice really change when the auction changes?
npm run check:crediti      # no purchase leaves the roster impossible, and the plan follows the strategy
npm run check:livelli      # prices are computed on the server and never reach the base tier (real endpoint)
npm run check:ascolto      # is merging what several computers hear worth it?
npm run check:titolarita   # do minutes played predict next year's appearances?
npm run check:rigoristi    # who takes penalties, and how much that repeats
npm run check:coppie       # do two players of the same role and team cancel each other out?
npm run check:campionati   # do cups and foreign leagues help or ruin the estimate?
npm run check:aggiornamento # reloading the official files loses nothing (real path)
npm run check:ancore       # how the price list changes with the calibration on real prices
npm run check:real-import  # imports the files from ~/Downloads and prints the prices per role
npm run check:fantaastalive # the files for the Fantacalcio.it auction board, re-read by their own reader
npm run check:carriera     # careers of players coming from abroad: how wrong they were (--scrivi fixes them)
```

Scripts that touch the database need `TEST_EMAIL` and `TEST_PASSWORD` of an administrator, plus
the variables in `.env.local`:

```bash
set -a && source .env.local && set +a
TEST_EMAIL='ci-runner@fantasta.local' TEST_PASSWORD='...' npm run check:integration
```

`check:livelli` also calls the application, so it needs a running server:

```bash
BASE_URL=http://localhost:3000 TEST_EMAIL='ci-runner@fantasta.local' TEST_PASSWORD='...' npm run check:livelli
```

### Throwaway service account

Public sign-up is blocked by a trigger on `auth.users`, so the test account is created in SQL
and **deleted right afterwards**: it is an administrator and must not be left around.

```sql
do $$
declare v_id uuid := gen_random_uuid();
begin
  delete from auth.users where email = 'ci-runner@fantasta.local';
  perform set_config('app.allow_signup', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'ci-runner@fantasta.local',
    extensions.crypt('<a random password>', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{"display_name":"Test runner"}'::jsonb,
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', 'ci-runner@fantasta.local', 'email_verified', true),
    'email', now(), now(), now());
  update public.profiles set is_admin = true where id = v_id;
end $$;

-- at the end, always:
delete from auth.users where email like '%@fantasta.local';
```

`confirmation_token` and its sibling columns must be set to an empty string: if they stay NULL,
login fails with "Database error querying schema".

### Calling an authenticated endpoint from a script

`@supabase/ssr` keeps the session in a cookie `sb-<ref>-auth-token` whose value is
`base64-<session json>`, split into 3180-character chunks (`.0`, `.1`, ...). See
`scripts/endpoint-check.ts` for the implementation.

## Traps already hit

- **PostgREST caches the schema.** After a migration with new columns or constraints you need
  `notify pgrst, 'reload schema';`, otherwise the app answers "there is no unique or exclusion
  constraint matching the ON CONFLICT specification" for a constraint that exists in the database.
- **OpenRouter web search is billed per request, not per result**: a flat $0.00700 with `exa`,
  the same with five results or ten. Asking for fewer saves nothing. The engine must be named:
  the default one finds half as much for the same price.
- **Node 20 has no native WebSocket.** Scripts using `@supabase/supabase-js` must do
  `globalThis.WebSocket ??= require("ws")`.
- **Vercel Hobby caps functions at 60 seconds**, whatever `maxDuration` says. Long operations must
  be split into batches.
- **API-Football free plan**: 100 calls a day *and* 10 a minute. The per-minute limit is the one
  that really bites. The most recent season is not available, even if `/leagues` says it is — and
  once the daily quota is gone the counter stops answering too, so an exhausted quota must be
  recognised from the message, not waited for from the number.
- **The real keys live only in Vercel's Production environment.** Neither the local server nor
  preview deployments can call OpenRouter or API-Football: a measurement on the real path needs
  production.
- **PostgREST, in an upsert with objects that have different keys, takes the union of the columns
  and sets the missing ones to NULL.** Sending complete and partial rows together wipes the fields
  absent from the partial ones. Every row of an upsert must be built with the same set of columns,
  starting from the values already present.
- **PostgREST returns a thousand rows at a time and does not say so.** Reading the 1600 rows of
  `player_stats` in one go loses 621 of them, and their players look like they have no history.
  Either paginate or read them nested under `players`.
- **FantaAstaLive reads only `.csv`, never `.xlsx`.** The Fantacalcio.it auction board has only two
  entry points, both headerless text files with fixed-position columns: the player list
  (22 columns) and the rosters (blocks opened by `$,$,$`). The official files are Excel sheets and
  cannot be loaded, not even renamed. The formats live in `src/lib/fanta/fantaastalive.ts`, read
  from their bundle; if they change, `npm run check:fantaastalive` fails and the transcription has
  to be redone.
- Do not pass the commit message with `-m` if it contains apostrophes: write it to a file and use `-F`.
