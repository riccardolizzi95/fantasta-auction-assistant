# FantAsta — assistente d'asta per il fantacalcio 2026/27

> **Documentazione**: [manuale operativo](../CLAUDE.md) ·
> [architettura](ARCHITETTURA.md) · [motore](MOTORE.md) ·
> [dati](DATI.md) · [decisioni](DECISIONI.md) ·
> [prossimi passi](PROSSIMI-PASSI.md)

Software di supporto all'asta: dice quanto vale davvero un giocatore **per la tua
lega e la tua strategia**, fino a dove conviene spingersi, e ricalibra il piano
mentre l'asta va avanti.

## Come funziona il consiglio

Il prezzo non esce da una tabella: viene ricostruito a ogni chiamata.

1. **Proiezione** — dalle statistiche delle ultime stagioni di Serie A (fino a
   tre concluse, piu' quella in corso se il campionato e' gia' partito) si
   stimano presenze, media voto e fantamedia attesa, riadattate ai bonus/malus
   della *tua* lega (se da' il gol del difensore a 4, il conto cambia). Chi ha
   giocato poco viene regredito verso la stima ricavata dalla quotazione, non
   verso la media di ruolo.
2. **Regressione verso la media** — anche una stagione intera misurata bene
   sovrastima il futuro: solo una parte dello scarto dalla media si ripete, e
   quanta dipende dal ruolo. Misurato sulla Serie A 2024-25 -> 2025-26: difensori
   **0.38**, centrocampisti **0.49**, attaccanti **0.56**. La fantamedia di un
   difensore e' per quasi due terzi rumore che non si ripete. Piu' stagioni si
   hanno, meno serve tirare verso la media (`npm run check:persistence`
   rimisura i coefficienti sui dati caricati).
3. **Valore sul rimpiazzo (VOR)** — quello che conta non e' quanto rende un
   giocatore, ma quanto rende *in piu'* di quello che prenderesti gratis al suo
   posto. Il rimpiazzo va cercato con la stessa metrica con cui poi lo si
   confronta — la fantamedia — e come media locale di qualche giocatore attorno
   alla soglia, non come singolo nome: uno solo e' rumore, e sposterebbe il
   prezzo di tutto il reparto.
4. **Dove mettere la soglia** — fra l'ultimo titolare e l'ultimo slot di
   panchina c'e' un abisso di prezzo: con la prima i crediti si concentrano su
   una sessantina di nomi, con la seconda si spalmano su tutti e il top player
   non vale niente. Quanto in mezzo stare e' una proprieta' del formato d'asta,
   non dei singoli giocatori: si legge dal listino ufficiale, allineando la
   concentrazione dei prezzi a quella del Fantavalore. E' l'unica cosa che il
   modello prende dal mercato; ordine e scostamenti restano suoi.
5. **Da punti a crediti** — la somma di tutti i vantaggi si spartisce i crediti
   della lega. Ne esce il prezzo di equilibrio, che per costruzione somma
   esattamente al budget complessivo.
6. **Modificatore di difesa** — se attivo, la media voto di portiere e difensori
   vale punti veri. Il vantaggio si misura contro la media voto del difensore
   gratuito, non contro gli altri titolari: alzare tutto il reparto insieme non
   deve annullare il beneficio.
7. **Mercato in tempo reale** — l'asta e' a somma zero. L'inflazione non e'
   "quanto si e' pagato finora" ma **quanti crediti restano rispetto al valore che
   resta**: se in apertura ci si svena sugli attaccanti, tutto il resto va
   automaticamente a sconto.
8. **Tetti d'offerta** — non serve mai offrire piu' di un credito sopra il massimo
   che un avversario *puo'* pagare, tenuto conto che deve completare la rosa.
9. **Ritaratura** — dopo ogni acquisto si simula come finirebbe l'asta seguendo
   ciascuna strategia, con i giocatori e i crediti che restano davvero. Se un'altra
   strategia rende sensibilmente di piu', il software lo dice e spiega perche'.

## Dati condivisi e chi puo' toccarli

Listone e statistiche sono **globali**: valgono per tutte le leghe, non per una.
Solo un amministratore puo' caricarli o cancellarli, dalla pagina Listone.

- **Statistiche**: si cancellano per stagione, e si ricaricano dal file. La
  stagione in corso conviene ricaricarla dopo ogni giornata.
- **Lega**: chi l'ha creata puo' cancellarla dalle impostazioni, riscrivendone il
  nome per conferma. Spariscono partecipanti, strategie e cronologia d'asta;
  listone e statistiche restano, perche' sono condivisi.
- **Listone**: si puo' cancellare **solo se nessuna asta ha registrato
  acquisti**. I giocatori sono referenziati dalle rose: toglierli sotto i piedi
  svuoterebbe le squadre. Ad asta iniziata si aggiorna ricaricando il file, che
  e' sicuro — chi non c'e' piu' viene disattivato e le rose restano intatte.

## Storico di carriera

`player_stats` contiene i numeri; `player_career` contiene il racconto, comprese
le stagioni senza numeri. La differenza conta: un ventenne al secondo anno da
professionista non ha "dati mancanti" per il 2022-23, semplicemente non giocava
ancora. Trattare le due cose allo stesso modo penalizza i giovani e premia chi ha
una carriera lunga e mediocre.

Ogni stagione porta uno **stato** — campionato, prestito, giovanili, infortunio,
fuori rosa, non ancora professionista, sconosciuta — e la prima stagione fra i
professionisti e' segnata come debutto. La scheda del giocatore mostra tutto in
fila, con la fantamedia in barra sulla stessa scala e i campionati esteri in
azzurro.

## Quale modello, e perche'

La scelta e' misurata, non presa dal listino prezzi: `npm run check:models` da'
lo stesso compito reale a piu' modelli — identificare sei giocatori dal nome
abbreviato del listone — e li confronta con una verita' nota.

| Modello | Giusti | Costo | Tempo | Formato |
|---|---|---|---|---|
| **google/gemini-2.5-flash-lite** (default) | 4/6 | $0.0079 | 4.2s | stabile |
| anthropic/claude-haiku-4.5 (ripiego) | 4/6 | $0.0163 | 7.2s | stabile |
| z-ai/glm-5.3-flash | 6/6, poi 0/6 | $0.0076 | 12-35s | instabile |
| deepseek/deepseek-v4-flash | 4/6 | $0.0076 | 17.0s | instabile |
| qwen/qwen3.5-flash | 0/6 | $0.0070 | 4.1s | instabile |

I modelli cinesi costano meno e a volte sono i migliori — GLM ha fatto 6 su 6
dove nessun altro arrivava a 5 — ma al giro successivo lo stesso modello tornava
illeggibile. In una catena automatica l'instabilita' costa piu' di quanto
risparmi, quindi il default e' quello stabile e c'e' un ripiego automatico:
se la risposta non si riesce a leggere, si riprova una volta con Haiku.

Da rilanciare quando escono modelli nuovi: la classifica cambia in fretta.

## Quanto costa l'AI, e perche'

La voce di spesa dominante non e' il modello: e' la **ricerca web**. OpenRouter la
fattura a risultato (~$0.02 l'uno) e la scorciatoia `:online` ne chiede cinque,
cioe' circa $0.10 a chiamata — otto volte il costo dei token. Per questo il
plugin viene chiesto esplicitamente e con due soli risultati, ed e' un
interruttore visibile invece di essere sempre acceso.

Costo di un'analisi giocatore, **misurato in produzione** su Haiku 4.5:

| | Costo reale |
|---|---|
| senza ricerca web | **$0.0020** |
| con ricerca web (2 risultati) | **$0.0113** |

Per confronto, la stessa analisi con Sonnet 4.5 e cinque risultati web costava
circa $0.14: dodici volte tanto. Il modello si cambia con `OPENROUTER_MODEL`
(`google/gemini-2.5-flash` e `google/gemini-2.5-flash-lite` costano ancora meno
sui token), ma sotto Haiku la differenza fra modelli si perde nel costo della
ricerca: la leva vera e' spegnere la ricerca, non scendere di modello.

La ricerca web pero' serve davvero — nella prova ha trovato un infortunio
muscolare di inizio settembre che nessuna statistica poteva contenere. Tenerla
accesa sui giocatori che contano e spenta sul resto e' il compromesso giusto.

Ogni risposta riporta il costo reale della chiamata (`usage.include`), mostrato
a schermo. Le analisi sono in cache sette giorni: rileggerle non costa nulla.

## Consumo delle fonti a pagamento

Il pannello "Giocatori senza storico di Serie A" mostra, per un amministratore:

- **API-Football**: chiamate usate e rimaste oggi, lette da `/status` (che non
  consuma quota), con la stima di quanti giocatori ci stanno ancora.
- **OpenRouter**: totale speso e credito residuo, da `/api/v1/credits`.
  Comprende anche le analisi qualitative chieste durante l'asta.

## Come si comporta sui dati veri

Con il listone 2026-27 (533 giocatori) e tre stagioni di statistiche, lega da 8
squadre e 500 crediti senza modificatori:

| Reparto | Quota di mercato | Consenso diffuso |
|---|---|---|
| Portieri | 6% | 5-8% |
| Difensori | 21% | 12-16% |
| Centrocampisti | 31% | 30-35% |
| Attaccanti | 42% | 45-50% |

I giocatori con un valore sopra il minimo sono circa 240, contro i 200 slot che
una lega da 8 squadre deve riempire: il modello non regala valore a chi non
finirebbe in nessuna rosa.

## Latenza

Le funzioni girano a **fra1**, accanto al database Supabase in `eu-central-1`
(`vercel.json`). Non e' un dettaglio: per impostazione predefinita finivano a
`iad1`, e ogni interrogazione al database attraversava l'Atlantico due volte —
circa 90 ms a giro, quattro o cinque giri per pagina.

Misurato in produzione, prima e dopo:

| Pagina | Prima | Dopo |
|---|---|---|
| home | 1237 ms | **267 ms** |
| asta | 1024 ms | **240 ms** |
| listone | 1175 ms | **218 ms** |
| impostazioni | 1359 ms | **307 ms** |

La regione da sola vale la maggior parte del guadagno. Il resto viene da tre
cose:

- `getUser()` era chiamato quattro o cinque volte per pagina fra proxy, header e
  caricamento della lega: ora e' memoizzato per richiesta con `cache()` di React;
- le query della lega partono insieme invece che in fila, e la strategia si
  aggancia al partecipante con una join invece di aspettare di sapere chi e'
  l'utente;
- intestazione e dati vivono nel **layout** della lega, che Next conserva fra le
  schede: passare da Asta a Rose a Listone non ricarica piu' niente. Prima ogni
  cambio scheda riscaricava 853 KB di statistiche; ora sono 619 KB una volta
  sola, perche' le colonne chieste sono solo quelle usate.

## Stack

- Next.js 16 (App Router) su Vercel
- Supabase: Postgres, autenticazione, RLS, realtime
- OpenRouter per l'analisi qualitativa (facoltativa)
- Motore di valutazione in TypeScript puro, eseguito nel browser: durante l'asta
  ogni ricalcolo e' istantaneo e non dipende dalla rete

## Variabili d'ambiente

| Nome | Serve a | Obbligatoria |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | endpoint del progetto | si |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chiave pubblica | si |
| `OPENROUTER_API_KEY` | analisi qualitativa AI | no |
| `OPENROUTER_MODEL` | modello usato (default `google/gemini-2.5-flash-lite`) | no |
| `OPENROUTER_FALLBACK_MODEL` | ripiego quando il formato non si legge | no |
| `APIFOOTBALL_KEY` | statistiche di altri campionati | no |
| `APIFOOTBALL_MODE` | `direct` (default, api-sports.io) o `rapidapi` | no |
| `SUPABASE_SERVICE_ROLE_KEY` | non necessaria: gli account si creano via RPC | no |

## Dati

Dall'area download di Fantacalcio.it, caricabili dalla pagina **Listone** con un
account amministratore:

- `Quotazioni_Fantacalcio_Stagione_2026_27.xlsx` — listone, ruoli, quotazioni, FVM.
  Definisce chi esiste: va caricato per primo.
- `Statistiche_Fantacalcio_Stagione_XXXX_XX.xlsx` — presenze, media voto, gol, assist.
  Se ne possono caricare **piu' d'una**: ogni stagione sta in un cassetto suo e
  non tocca le altre.

Nel form si sceglie esplicitamente il tipo di file e la stagione a cui
appartengono le statistiche: lasciare indovinare l'anno al software e' il modo
piu' rapido per sovrascrivere l'annata sbagliata senza accorgersene.

Le statistiche si agganciano al listone in tre passaggi: Id ufficiale di
Fantacalcio.it, poi nome + squadra, poi nome da solo se non e' ambiguo (serve per
chi ha cambiato squadra). L'esito dice quanti sono stati abbinati con quale
metodo e quali sono rimasti fuori.

### Peso delle stagioni

| Stagione | Peso |
|---|---|
| **in corso** (quella dell'asta) | parte quasi da zero e cresce con le giornate |
| l'ultima conclusa | 100% |
| quella prima | 55% |
| poi | 30% · 17% · 9% |
| oltre la quinta | non usate |

Il peso viene moltiplicato per le presenze effettive, quindi una stagione vecchia
giocata poco pesa pochissimo da sola. Vale la pena caricare tutte le annate che
si trovano: piu' campione c'e', meno il motore deve regredire verso la media.

**Asta a campionato iniziato.** Se esistono statistiche della stagione dell'asta,
il software se ne accorge e deduce da solo quante giornate si sono giocate (il
massimo delle presenze fra tutti i giocatori). Quei dati vengono trattati per
quello che sono:

- Sulla **fantamedia** contano `presenze x presenze/(presenze+6)`: alla seconda
  giornata vale lo 0.5, verso meta' girone comanda sul passato. Una doppietta
  all'esordio sposta la stima di due decimi, non di due punti — mentre gli altri
  all'asta la pagheranno tutta.
- Sulle **presenze attese** contano subito e molto: due giornate non dicono
  quanto rendera' in un anno, ma dicono benissimo se il posto da titolare ce l'ha
  adesso. Chi non compare affatto nel file di quest'anno viene penalizzato, con un
  po' di prudenza in meno (potrebbe mancare la riga, non il giocatore).

Conviene ricaricare il file della stagione in corso dopo ogni giornata.

### Chi l'anno scorso giocava altrove

Neopromossi, giovani e soprattutto chi arriva dall'estero o dalla Serie B non ha
righe di Serie A. Stimarli dalla sola quotazione significa copiare il mercato
proprio dove il mercato sbaglia di piu'. Per questo `player_stats` porta con se'
la **competizione**, e la produzione viene riportata alla scala della Serie A.

| Campionato | Resa | Fiducia |
|---|---|---|
| Serie A | 100% | 100% |
| Premier League, La Liga | 100% | 85% |
| Bundesliga | 92% | 85% |
| Ligue 1 | 90% | 80% |
| Champions League | 115% | 55% |
| Liga Portugal | 68% | 70% |
| Eredivisie, Championship | 62% | 70% |
| Serie B | 45% | 75% |
| MLS, Saudi Pro League | 52% | 45-55% |
| non riconosciuto | 50% | 30% |

La tabella completa sta in [`src/lib/fanta/competitions.ts`](../src/lib/fanta/competitions.ts).
Sono stime, non misure: il punto non e' azzeccare il decimale, e' non trattare
venti gol in Olanda come venti gol a Milano.

Due coefficienti distinti perche' sono due cose diverse:

- **resa**: quanti di quei gol e assist si sarebbero visti in Serie A;
- **fiducia**: quanto e' solido il dato in se'. Sconta il peso del campione, non
  la produzione.

**Il portiere e' il caso difficile.** Quanti gol subira' non dipende da lui ma
dalla difesa che ha davanti, e quella non si trasferisce con lui: chi arriva dal
Tottenham alla Juventus non porta con se' la difesa di prima. Dove il dato manca,
i gol subiti vengono stimati dalla forza della squadra **attuale** — fra 0.74 e
1.78 a partita, che sono il migliore e il peggiore misurati in Serie A. Una fonte
che restituisce zero gol subiti non sta dicendo "imbattuto", sta dicendo "non lo
so": darle retta regalerebbe mezzo punto di fantamedia su un ruolo dove l'intera
forbice ne vale poco piu' di uno.

**La media voto non esiste fuori dall'Italia.** E' un'invenzione dei quotidiani
sportivi italiani. Quello che si trova altrove e' un rating tipo SofaScore, su
scala 0-10 con media 6.8: viene riportato sulla scala italiana (media 6.0) e da
li' si ricostruisce la fantamedia con i bonus standard. E' la stima piu' incerta
che il software produce, ed e' dichiarata come tale nella scheda giocatore.

### Come si recuperano

Dalla pagina **Listone**, riquadro "Giocatori senza storico di Serie A",
ordinati per quotazione: i piu' costosi per primi.

1. **File ufficiale** — se hai un file di statistiche di un altro campionato, nel
   form di import scegli la competizione: vale per la Serie B come per il resto.
Da una fonte esterna vengono **scartate** le competizioni per nazionali,
giovanili e squadre riserve: non dicono niente su quanto rendera' in un
campionato di club, e sommarle alla stagione gonfierebbe le presenze. Le coppe
europee per club invece si tengono, e le coppe nazionali vengono riconosciute
come tali (resa 60%, fiducia 35%: si gioca contro squadre di categoria inferiore
e sono poche partite).

2. **API-Football** (`APIFOOTBALL_KEY`) — chiave gratuita da
   [dashboard.api-football.com/register](https://dashboard.api-football.com/register),
   senza carta di credito. Il piano gratuito da' 100 chiamate al giorno (azzerate
   a mezzanotte UTC) e ogni giocatore ne costa 3 (una ricerca + due stagioni):
   circa 30 giocatori al giorno. Si lavora a lotti; il pulsante "Prova la chiave"
   verifica la configurazione senza sprecare quota. La stessa API esiste anche su
   RapidAPI: in quel caso serve `APIFOOTBALL_MODE=rapidapi`.

   **Attenzione alla stagione piu' recente.** Il piano gratuito la dichiara fra
   quelle disponibili ma non ne serve le statistiche dei giocatori: verificato
   su un titolare di Serie A del 2025-26, che torna a mani vuote. L'app se ne
   accorge dopo due tentativi e smette di chiederla, altrimenti sarebbe una
   chiamata sprecata per ogni giocatore. In pratica dall'API arrivano le annate
   dalla penultima in giu': per chi arriva dall'estero vanno benissimo lo stesso,
   sono solo un anno piu' vecchie.
Nessuna di queste puo' sovrascrivere un dato caricato da file: il file ufficiale
e' il dato vero, API e AI sono ricostruzioni, e l'esito dice quante righe sono
state scartate per questo motivo.

3. **Ricerca AI** (`OPENROUTER_API_KEY`) — nessun limite giornaliero ma meno
   affidabile: le righe con `source = 'ai'` pesano il 35% in meno. Vale la pena
   ricontrollare i portieri: una fonte che non riporta i gol subiti lascerebbe
   credere a una stagione da imbattuto. Il convertitore se ne accorge e sostituisce
   la media di ruolo, ma un dato vero e' meglio di una stima.
4. **A mano** — per i pochi casi che contano davvero.

I conteggi diventano tassi per presenza e vengono mediati con peso *(peso della
stagione x presenze giocate)*. Chi ha tre annate solide risulta piu' affidabile
di chi ne ha una sola buona, senza che le stagioni vecchie schiaccino il
rendimento attuale. Per le **presenze attese** vale soprattutto l'ultima
stagione (72%), con un contributo delle precedenti (28%): serve a non condannare
chi ha saltato un anno per infortunio.

## Controlli

```bash
npm run typecheck          # tipi di app e script
npm run check:engine       # sanita' del motore su un listone sintetico a 3 stagioni
npm run check:import       # lettura dei file ufficiali e abbinamento al listone
npm run check:conversion   # coefficienti fra campionati e ricostruzione della fantamedia
npm run check:persistence  # rimisura quanto un anno predice il successivo, per ruolo
npm run check:real-import  # importa i file veri da ~/Downloads e stampa cosa ne esce
npm run check:endpoint     # chiama /api/import come il browser, sui file ufficiali
npm run check:models       # confronta i modelli sul compito reale, con una verita' nota
npm run check:integration  # end-to-end su database reale (auth, RLS, RPC, motore)
```

`check:integration` richiede `TEST_EMAIL` e `TEST_PASSWORD` di un account
amministratore e crea/rimuove dati su una stagione fittizia.

`check:endpoint` esiste per un motivo preciso: una volta l'import e' stato
verificato riscrivendone la logica in uno script invece di chiamare la route.
Nella copia il bersaglio dell'upsert era giusto, nella route no, e il bug e'
arrivato in produzione con tutti i test verdi. Un percorso riscritto non e' il
percorso vero. Punta in produzione, oppure passa `BASE_URL=http://localhost:3000`. Per non lasciare in
giro un account di servizio, conviene crearlo al momento e cancellarlo subito
dopo, dall'SQL editor di Supabase:

```sql
-- crea
do $$
declare v_id uuid := gen_random_uuid();
begin
  perform set_config('app.allow_signup', 'on', true);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
    'ci-runner@fantasta.local',
    extensions.crypt('<scegline-una>', extensions.gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"display_name":"Test runner"}'::jsonb,
    '', '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id,
    jsonb_build_object('sub', v_id::text, 'email', 'ci-runner@fantasta.local', 'email_verified', true),
    'email', now(), now(), now());
  update public.profiles set is_admin = true where id = v_id;
end $$;

-- cancella
delete from auth.users where email = 'ci-runner@fantasta.local';
```
