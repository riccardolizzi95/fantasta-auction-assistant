import Link from "next/link";
import DeleteLeague from "@/components/DeleteLeague";
import ResetAuction from "@/components/ResetAuction";
import PartecipantiLega from "@/components/PartecipantiLega";
import VociLega from "@/components/auction/VociLega";
import { Empty, Panel } from "@/components/ui";
import { startAuction, updateLeague, updateMyTeamName } from "@/app/actions";
import { loadLeague } from "@/lib/leagueData";
import { createClient } from "@/lib/supabase/server";
import { conConsigli, ETICHETTA_LIVELLO } from "@/lib/livelli";
import { ROLES, ROLE_LABEL } from "@/lib/fanta/types";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, participants, me, isOwner, livello } = await loadLeague(id);
  const consigli = conConsigli(livello);
  const supabase = await createClient();

  const [{ count: playerCount }, { count: eventCount }, { data: eventi }] = await Promise.all([
    supabase
      .from("players")
      .select("id", { count: "exact", head: true })
      .eq("season", league.season),
    supabase
      .from("auction_events")
      .select("id", { count: "exact", head: true })
      .eq("league_id", id),
    // Quanto ha gia' speso ognuno: e' il pavimento sotto cui i suoi crediti non
    // possono scendere, e va mostrato accanto al campo che li cambia.
    supabase.from("auction_events").select("participant_id, price").eq("league_id", id),
  ]);

  const spesoPer = new Map<string, number>();
  for (const e of eventi ?? []) {
    if (!e.participant_id) continue;
    spesoPer.set(e.participant_id, (spesoPer.get(e.participant_id) ?? 0) + (e.price ?? 0));
  }
  // Il pavimento dei crediti: sotto quella cifra la squadra che ha speso di piu'
  // si ritroverebbe con un residuo negativo.
  const spesoMax = Math.max(0, ...spesoPer.values());

  const rules = league.rules;
  const totalSlots = ROLES.reduce((a, r) => a + league.slots[r], 0);

  return (
    <main className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Impostazioni lega</h1>
            <p className="mt-0.5 text-sm text-[var(--text-faint)]">
              Le regole qui sotto cambiano direttamente i prezzi consigliati durante l&apos;asta.
            </p>
          </div>
          {league.status === "setup" && (
            <form action={startAuction.bind(null, id)}>
              <button className="btn btn-primary" type="submit" disabled={!playerCount || !me}>
                Avvia l&apos;asta →
              </button>
            </form>
          )}
        </div>

        {!playerCount && (
          <div className="panel border-[var(--warn)] p-4">
            <div className="text-sm font-semibold text-[var(--warn)]">
              Manca il listone {league.season}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-muted)]">
              Senza quotazioni e statistiche il software non può calcolare nessun prezzo. Carica il
              file ufficiale delle quotazioni di Fantacalcio.it dalla pagina Listone.
            </p>
            <Link href={`/lega/${id}/listone`} className="btn btn-sm mt-3">
              Vai al listone
            </Link>
          </div>
        )}

        {/* ------------------------------------------------ IL MIO POSTO */}
        {/* I crediti da qui sono spariti, ed e' il punto: sono una regola della
            lega, uguale per tutti, e si cambiano nelle regole. Prima ognuno
            poteva darsi il budget che voleva, che non e' un'asta. */}
        <Panel
          title="Il tuo posto in questa lega"
          subtitle={`Come ti chiami all'asta. I crediti sono quelli della lega: ${league.budget} per tutti.`}
        >
          {me ? (
            <form action={updateMyTeamName} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="league_id" value={id} />
              <input type="hidden" name="participant_id" value={me.id} />
              <div className="min-w-40 flex-1">
                <label htmlFor="pname">Il tuo nome squadra</label>
                <input id="pname" name="name" defaultValue={me.name} maxLength={40} />
              </div>
              <button className="btn" type="submit">
                Salva
              </button>
            </form>
          ) : (
            <Empty>Non sei ancora un partecipante di questa lega.</Empty>
          )}
        </Panel>

        {/* La strategia ha una pagina sua: si cambia durante l'asta, mentre le
            regole e gli account si toccano una volta e poi mai piu'. */}
        {consigli && (
          <Panel
            title="La tua strategia"
            subtitle="Personale e privata: si cambia anche a metà asta, e ha una pagina sua."
          >
            <Link href={`/lega/${id}/strategia`} className="btn btn-primary">
              Vai alla strategia →
            </Link>
          </Panel>
        )}

        {!consigli && (
          <Panel
            title={`Il tuo account: ${ETICHETTA_LIVELLO[livello]}`}
            subtitle="Segui l'asta, registri chi compra cosa e vedi lo storico di ogni giocatore."
          >
            <p className="text-xs leading-relaxed text-[var(--text-muted)]">
              I consigli sui prezzi — quanto vale un giocatore per la tua lega, fino a dove
              spingerti, che rosa ne verrebbe fuori e quale strategia conviene — sono la parte
              premium. Chiedi a chi amministra la lega di attivartela.
            </p>
          </Panel>
        )}

        {/* ------------------------------------------------ PARTECIPANTI */}
        <Panel
          title={`Partecipanti (${participants.length}/${league.n_participants})`}
          subtitle={
            isOwner
              ? "Servono tutti: sapere chi ha ancora crediti e slot liberi è metà del consiglio."
              : "Le squadre le gestisce chi ha creato la lega."
          }
        >
          <PartecipantiLega
            leagueId={id}
            meId={me?.id ?? null}
            isOwner={isOwner}
            inviteCode={league.invite_code}
            squadre={participants.map((p) => ({
              id: p.id,
              name: p.name,
              budget_total: p.budget_total,
              haAccount: !!p.user_id,
              speso: spesoPer.get(p.id) ?? 0,
            }))}
          />
        </Panel>

        {/* ------------------------------------------------ VOCI */}
        {/* Questo non e' un pannello di amministrazione, anche se sta fra due che
            lo sono: le impronte vocali vivono in questo browser e servono al
            microfono di questo dispositivo. Chi ascolta l'asta da un altro
            computer ha bisogno delle stesse voci registrate li', altrimenti il
            suo microfono sente rilanciare e non sa da chi. */}
        <Panel
          title="Le voci, su questo dispositivo"
          subtitle="Chi ha rilanciato, quando il banditore non lo dice. Da fare una volta, prima dell'asta, su ogni computer che seguirà l'asta."
        >
          <VociLega
            legaId={id}
            partecipanti={participants.map((p) => ({ id: p.id, name: p.name }))}
          />
        </Panel>

        {/* ------------------------------------------------ REGOLE */}
        <Panel
          title="Regole della lega"
          subtitle={isOwner ? undefined : "Solo chi ha creato la lega può modificarle."}
        >
          <fieldset disabled={!isOwner} className="space-y-5">
            <form action={updateLeague} className="space-y-5">
              <input type="hidden" name="league_id" value={id} />

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="lname">Nome</label>
                  <input id="lname" name="name" defaultValue={league.name} />
                </div>
                <div>
                  <label htmlFor="lbudget">Crediti a squadra</label>
                  <input
                    id="lbudget"
                    name="budget"
                    type="number"
                    min={Math.max(50, spesoMax)}
                    defaultValue={league.budget}
                  />
                  <p className="mt-1 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
                    {spesoMax > 0
                      ? `Valgono per tutte le squadre. Non si può scendere sotto ${spesoMax}: è quanto ha già speso chi ha speso di più.`
                      : "Valgono per tutte le squadre."}
                  </p>
                </div>
                <div>
                  <label htmlFor="lpart">Numero squadre</label>
                  <input
                    id="lpart"
                    name="n_participants"
                    type="number"
                    min={2}
                    max={20}
                    defaultValue={league.n_participants}
                  />
                </div>
              </div>

              <div className="rounded-md border border-[var(--border-strong)] p-3">
                <div className="label-xs mb-2">Quanto pagate i migliori</div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label htmlFor="ltop">Prezzi dei piu&apos; cari in un&apos;asta passata</label>
                    <input
                      id="ltop"
                      name="top_prices"
                      placeholder="280, 240, 210"
                      defaultValue={(league.top_prices?.prices ?? []).join(", ")}
                    />
                  </div>
                  <div>
                    <label htmlFor="ltopb">Crediti a squadra di allora</label>
                    <input
                      id="ltopb"
                      name="top_prices_budget"
                      type="number"
                      min={50}
                      defaultValue={league.top_prices?.budget ?? league.budget}
                    />
                  </div>
                </div>
                <p className="mt-2 text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
                  Due o tre nomi bastano: servono a capire <strong>quanto la tua lega concentra
                  i crediti sui migliori</strong>, e il resto della curva lo ricava il modello.
                  Senza, si usa il listino ufficiale — che pero&apos; e&apos; un prezziario e dice
                  quanto un giocatore <em>vale</em>, non quanto la gente <em>paga</em> quando c&apos;e&apos;
                  da alzare la mano. Sui dati veri la differenza e&apos; grossa: tarato sul listino il
                  piu&apos; caro valeva 141 crediti su 500, e nella tua asta Lautaro e&apos; andato a
                  240. Alzando i top, tutti gli altri scendono in automatico: i crediti in palio
                  sono sempre gli stessi, ed e&apos; li&apos; che si trovano gli affari.
                </p>
              </div>

              <div>
                <div className="label-xs mb-2">Composizione rosa ({totalSlots} giocatori)</div>
                <div className="grid grid-cols-4 gap-3">
                  {ROLES.map((r) => (
                    <div key={r}>
                      <label htmlFor={`slot_${r}`}>{ROLE_LABEL[r]}</label>
                      <input
                        id={`slot_${r}`}
                        name={`slot_${r}`}
                        type="number"
                        min={1}
                        max={15}
                        defaultValue={league.slots[r]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className="label-xs mb-2">Modificatori</div>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Toggle name="defense_modifier" label="Modificatore difesa" checked={rules.defense_modifier} />
                  <Toggle name="goalkeeper_modifier" label="Modificatore portiere" checked={rules.goalkeeper_modifier} />
                  <Toggle name="assist_enabled" label="Assist attivi" checked={rules.assist_enabled} />
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--text-faint)]">
                  Con il modificatore di difesa attivo la media voto di portiere e difensori vale
                  quanto i gol di un attaccante: il motore rivaluta automaticamente tutto il reparto.
                </p>
              </div>

              <div>
                <div className="label-xs mb-2">Bonus gol per ruolo</div>
                <div className="grid grid-cols-4 gap-3">
                  {ROLES.map((r) => (
                    <div key={r}>
                      <label htmlFor={`goal_${r}`}>{ROLE_LABEL[r]}</label>
                      <input
                        id={`goal_${r}`}
                        name={`goal_${r}`}
                        type="number"
                        step="0.5"
                        defaultValue={rules.goal_bonus[r]}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                <div>
                  <label htmlFor="assist_bonus">Assist</label>
                  <input id="assist_bonus" name="assist_bonus" type="number" step="0.5" defaultValue={rules.assist_bonus} />
                </div>
                <div>
                  <label htmlFor="yellow_card">Ammonizione</label>
                  <input id="yellow_card" name="yellow_card" type="number" step="0.5" defaultValue={rules.yellow_card} />
                </div>
                <div>
                  <label htmlFor="red_card">Espulsione</label>
                  <input id="red_card" name="red_card" type="number" step="0.5" defaultValue={rules.red_card} />
                </div>
                <div>
                  <label htmlFor="goal_conceded">Gol subito (P)</label>
                  <input id="goal_conceded" name="goal_conceded" type="number" step="0.5" defaultValue={rules.goal_conceded} />
                </div>
                <div>
                  <label htmlFor="clean_sheet_bonus">Imbattibilità (P)</label>
                  <input
                    id="clean_sheet_bonus"
                    name="clean_sheet_bonus"
                    type="number"
                    step="0.5"
                    defaultValue={rules.clean_sheet_bonus}
                  />
                </div>
              </div>

              <div className="w-56">
                <label htmlFor="auction_format">Formato asta</label>
                <select id="auction_format" name="auction_format" defaultValue={league.auction_format}>
                  <option value="chiamata">A chiamata libera</option>
                  <option value="ordine_ruolo">Per ruolo (P, D, C, A)</option>
                  <option value="random">Ordine casuale</option>
                </select>
              </div>

              {isOwner && (
                <button className="btn btn-primary" type="submit">
                  Salva regole
                </button>
              )}
            </form>
          </fieldset>
        </Panel>

        {/* Azzerare l'asta e cancellare la lega stanno vicini perche' sono
            entrambi irreversibili, ma sono cose molto diverse: il primo serve a
            provare, il secondo a smettere. */}
        {isOwner && <ResetAuction leagueId={id} events={eventCount ?? 0} />}

        {isOwner && (
          <DeleteLeague leagueId={id} leagueName={league.name} events={eventCount ?? 0} />
        )}
    </main>
  );
}

function Toggle({ name, label, checked }: { name: string; label: string; checked: boolean }) {
  return (
    <label className="panel-flat flex cursor-pointer items-center gap-2 px-3 py-2 normal-case tracking-normal text-[var(--text)]">
      <input
        type="checkbox"
        name={name}
        defaultChecked={checked}
        className="h-4 w-4 accent-[var(--accent)]"
        style={{ width: "auto" }}
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}
