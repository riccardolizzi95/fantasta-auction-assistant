import * as XLSX from "xlsx";
import type { Role } from "./types";

export type ParsedPlayer = {
  external_id: number | null;
  name: string;
  team: string;
  role: Role;
  role_mantra: string[];
  quotation_initial: number | null;
  quotation_current: number | null;
  fvm: number | null;
};

/** "3/4" sono tre rigori segnati su quattro tirati: uno sbagliato. */
function rigoriDa(v: unknown): { segnati: number; sbagliati: number } {
  const m = String(v ?? "").match(/(\d+)\s*\/\s*(\d+)/);
  if (!m) return { segnati: 0, sbagliati: 0 };
  const segnati = Number(m[1]);
  const tirati = Number(m[2]);
  return { segnati, sbagliati: Math.max(0, tirati - segnati) };
}

/**
 * La stagione scritta nel nome del file.
 *
 * "Statistiche_Fantacalcio_Stagione_2026_27.xlsx" -> "2026-27".
 *
 * Il commento che stava nella route diceva il contrario — che indovinarla dal
 * nome fosse "il modo piu' rapido per sovrascrivere l'annata sbagliata senza
 * accorgersene" — e la realta' ha detto l'opposto: e' **chiederla** che ha
 * sovrascritto un'annata intera, perche' la tendina resta su quello che c'era
 * prima e nessuno la guarda. Il nome del file invece lo scrive il sito, non
 * una persona di fretta.
 */
export function stagioneDalNome(nome: string): string | null {
  const m = nome.match(/(20\d{2})[_\-. ]?(\d{2,4})/);
  if (!m) return null;
  const inizio = Number(m[1]);
  const coda = Number(m[2].length === 4 ? m[2].slice(2) : m[2]);
  // Deve essere la stagione dopo: "2026_27" si', "2026_31" e' un numero a caso.
  if ((inizio + 1) % 100 !== coda) return null;
  return `${inizio}-${String(coda).padStart(2, "0")}`;
}

export type ParsedStats = {
  external_id: number | null;
  name: string;
  team: string;
  role: Role;
  matches: number;
  avg_vote: number | null;
  avg_fantavote: number | null;
  goals: number;
  goals_conceded: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
  own_goals: number;
  pen_saved: number;
  pen_scored: number;
  pen_missed: number;
};

export type ImportKind = "quotazioni" | "statistiche";

export type ParseResult =
  | { kind: "quotazioni"; players: ParsedPlayer[]; headers: string[] }
  | { kind: "statistiche"; stats: ParsedStats[]; headers: string[] };

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[.\s_]/g, "");

const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const toInt = (v: unknown): number => Math.round(toNum(v) ?? 0);

const ROLE_SET = new Set(["P", "D", "C", "A"]);

function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    const found = Object.keys(row).find((rk) => norm(rk) === norm(k));
    if (found !== undefined && row[found] !== "") return row[found];
  }
  return undefined;
}

/**
 * I file ufficiali di Fantacalcio.it hanno una riga di titolo prima delle
 * intestazioni vere. Cerchiamo la prima riga che contiene "Nome" e "Squadra".
 */
function findHeaderRow(matrix: unknown[][]): number {
  for (let i = 0; i < Math.min(8, matrix.length); i++) {
    const cells = (matrix[i] ?? []).map(norm);
    if (cells.includes("nome") && (cells.includes("squadra") || cells.includes("team"))) return i;
  }
  return 0;
}

export function parseWorkbook(buffer: ArrayBuffer, forcedKind?: ImportKind): ParseResult {
  const wb = XLSX.read(buffer, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => /tutti/i.test(n)) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) throw new Error("Il file non contiene fogli leggibili.");

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" });
  const headerRow = findHeaderRow(matrix);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    range: headerRow,
    raw: true,
    defval: "",
  });
  const headers = (matrix[headerRow] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);

  const normalized = headers.map(norm);
  const looksLikeStats =
    normalized.includes("mv") || normalized.includes("fm") || normalized.includes("pv");
  const looksLikeQuot = normalized.some((h) => h.startsWith("qta") || h === "fvm");

  const kind: ImportKind =
    forcedKind ?? (looksLikeQuot && !looksLikeStats ? "quotazioni" : looksLikeStats ? "statistiche" : "quotazioni");

  if (kind === "quotazioni") {
    const players: ParsedPlayer[] = [];
    for (const row of rows) {
      const name = String(pick(row, ["Nome"]) ?? "").trim();
      const team = String(pick(row, ["Squadra", "Team"]) ?? "").trim();
      const role = String(pick(row, ["R", "Ruolo"]) ?? "").trim().toUpperCase();
      if (!name || !team || !ROLE_SET.has(role)) continue;
      players.push({
        external_id: toNum(pick(row, ["Id"])) ?? null,
        name,
        team,
        role: role as Role,
        role_mantra: String(pick(row, ["RM", "Rm"]) ?? "")
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean),
        quotation_initial: toNum(pick(row, ["Qt.I", "QtI"])),
        quotation_current: toNum(pick(row, ["Qt.A", "QtA"])),
        fvm: toNum(pick(row, ["FVM"])),
      });
    }
    if (players.length === 0)
      throw new Error(
        "Nessun giocatore riconosciuto. Attese le colonne Nome, Squadra, R e Qt.A del file ufficiale.",
      );
    return { kind: "quotazioni", players, headers };
  }

  const stats: ParsedStats[] = [];
  for (const row of rows) {
    const name = String(pick(row, ["Nome"]) ?? "").trim();
    const team = String(pick(row, ["Squadra", "Team"]) ?? "").trim();
    const role = String(pick(row, ["R", "Ruolo"]) ?? "").trim().toUpperCase();
    if (!name || !ROLE_SET.has(role)) continue;
    stats.push({
      external_id: toNum(pick(row, ["Id"])) ?? null,
      name,
      team,
      role: role as Role,
      matches: toInt(pick(row, ["Pv", "Partite"])),
      avg_vote: toNum(pick(row, ["Mv", "MediaVoto"])),
      avg_fantavote: toNum(pick(row, ["Fm", "Fantamedia"])),
      goals: toInt(pick(row, ["Gf"])),
      goals_conceded: toInt(pick(row, ["Gs"])),
      assists: toInt(pick(row, ["Ass", "Assist"])),
      yellow_cards: toInt(pick(row, ["Amm"])),
      red_cards: toInt(pick(row, ["Esp"])),
      own_goals: toInt(pick(row, ["Au"])),
      pen_saved: toInt(pick(row, ["Rp"])),
      // I rigori arrivano in due forme: due colonne separate, oppure una sola
      // scritta "segnati/tirati" — "3/4" vuol dire tre su quattro, quindi uno
      // sbagliato. Leggerne una sola delle due voleva dire buttare i rigori
      // ogni volta che il file veniva scaricato con l'altra.
      pen_scored: toInt(pick(row, ["R+", "Rmas", "Rpiu"])) || rigoriDa(pick(row, ["Rig"])).segnati,
      pen_missed: toInt(pick(row, ["R-", "Rmen", "Rmeno"])) || rigoriDa(pick(row, ["Rig"])).sbagliati,
    });
  }
  if (stats.length === 0)
    throw new Error(
      "Nessuna statistica riconosciuta. Attese le colonne Nome, R, Pv, Mv e Fm del file ufficiale.",
    );
  return { kind: "statistiche", stats, headers };
}

// ---------------------------------------------------------------------------
// Abbinamento statistiche -> listone
// ---------------------------------------------------------------------------

export type ListPlayer = { id: string; external_id: number | null; name: string; team: string };

export type MatchResult = {
  matches: { playerId: string; stats: ParsedStats }[];
  unmatched: string[];
  matchedBy: { id: number; nameTeam: number; name: number };
};

/**
 * I nomi fra i due file ufficiali non coincidono sempre al carattere: cambiano
 * accenti, punteggiatura e a volte la squadra dopo un trasferimento. Proviamo in
 * ordine: Id ufficiale, nome + squadra, nome da solo se non e' ambiguo.
 */
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchStatsToPlayers(stats: ParsedStats[], players: ListPlayer[]): MatchResult {
  const byExternal = new Map<number, string>();
  const byNameTeam = new Map<string, string>();
  const byName = new Map<string, string>();
  const nameCount = new Map<string, number>();

  for (const p of players) {
    if (p.external_id != null) byExternal.set(p.external_id, p.id);
    const n = normalizeName(p.name);
    byNameTeam.set(`${n}|${normalizeName(p.team)}`, p.id);
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
    byName.set(n, p.id);
  }

  const matches: { playerId: string; stats: ParsedStats }[] = [];
  const unmatched: string[] = [];
  const matchedBy = { id: 0, nameTeam: 0, name: 0 };

  for (const s of stats) {
    const n = normalizeName(s.name);
    let playerId: string | undefined;
    if (s.external_id != null && byExternal.has(s.external_id)) {
      playerId = byExternal.get(s.external_id);
      matchedBy.id++;
    } else if (byNameTeam.has(`${n}|${normalizeName(s.team)}`)) {
      playerId = byNameTeam.get(`${n}|${normalizeName(s.team)}`);
      matchedBy.nameTeam++;
    } else if (nameCount.get(n) === 1) {
      playerId = byName.get(n);
      matchedBy.name++;
    }
    if (!playerId) {
      unmatched.push(`${s.name} (${s.team})`);
      continue;
    }
    matches.push({ playerId, stats: s });
  }

  return { matches, unmatched, matchedBy };
}
