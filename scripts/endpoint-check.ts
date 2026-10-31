/**
 * Chiama /api/import come lo chiama il browser: stessa sessione, stesso
 * multipart, stessi file ufficiali.
 *
 * Esiste perche' una volta ho verificato l'import riscrivendone la logica in uno
 * script invece di chiamare la route: lo script aveva il bersaglio dell'upsert
 * giusto, la route no, e il bug e' arrivato in produzione mentre tutti i test
 * erano verdi. Un percorso riscritto non e' il percorso vero.
 *
 * Uso:
 *   TEST_EMAIL=... TEST_PASSWORD=... npm run check:endpoint
 *   BASE_URL=http://localhost:3000 npm run check:endpoint   (contro il locale)
 */
import { readFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const REF = new URL(SUPA).hostname.split(".")[0];

async function main() {
  const auth = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: process.env.TEST_EMAIL, password: process.env.TEST_PASSWORD }),
  });
  const session = await auth.json();
  if (!auth.ok) throw new Error(`login: ${JSON.stringify(session)}`);

  // @supabase/ssr salva la sessione come cookie base64, spezzata in blocchi.
  const raw = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64");
  const name = `sb-${REF}-auth-token`;
  const CHUNK = 3180;
  const cookies: string[] = [];
  if (raw.length <= CHUNK) cookies.push(`${name}=${raw}`);
  else for (let i = 0, n = 0; i < raw.length; i += CHUNK, n++)
    cookies.push(`${name}.${n}=${raw.slice(i, i + CHUNK)}`);
  const cookie = cookies.join("; ");

  const cases = [
    { file: "Statistiche_Fantacalcio_Stagione_2025_26.xlsx", kind: "statistiche", stats_season: "2025-26", competition: "serie-a" },
    { file: "Statistiche_Fantacalcio_Stagione_2026_27.xlsx", kind: "auto", stats_season: "2026-27", competition: "serie-a" },
    { file: "Quotazioni_Fantacalcio_Stagione_2026_27.xlsx", kind: "quotazioni", stats_season: "2025-26", competition: "serie-a" },
  ];

  let failures = 0;
  for (const c of cases) {
    const path = `${process.env.HOME}/Downloads/${c.file}`;
    if (!existsSync(path)) {
      console.log(`\n--- ${c.file}: file assente, salto`);
      continue;
    }
    const fd = new FormData();
    const bytes = readFileSync(path);
    fd.append("file", new Blob([new Uint8Array(bytes)]), c.file);
    fd.append("season", "2026-27");
    fd.append("kind", c.kind);
    fd.append("stats_season", c.stats_season);
    fd.append("competition", c.competition);

    const res = await fetch(`${BASE}/api/import`, { method: "POST", headers: { cookie }, body: fd });
    const text = await res.text();
    const ok = res.ok;
    if (!ok) failures++;
    console.log(`\n  ${ok ? "ok  " : "FAIL"} ${c.file} (kind=${c.kind}) — http ${res.status}`);
    console.log(`       ${text.slice(0, 300)}`);
  }

  console.log(
    failures === 0 ? "\nL'ENDPOINT RISPONDE SU TUTTI I FILE\n" : `\n${failures} CHIAMATE FALLITE\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
