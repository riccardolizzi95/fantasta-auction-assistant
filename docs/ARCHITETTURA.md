# Architettura

## L'idea di fondo

Il motore di valutazione e' **TypeScript puro** e gira **nel browser**. Durante
un'asta ogni ricalcolo e' istantaneo e non dipende dalla rete: si registra un
acquisto e prezzi, inflazione, tetti d'offerta e giudizio sulla strategia si
aggiornano nello stesso istante. Il server serve per autenticazione, dati
condivisi e le chiamate alle fonti esterne.

```
  file ufficiali Fantacalcio.it ─┐
  API-Football ─────────────────-┼─→ Supabase (players, player_stats,
  OpenRouter (identita', stats) ─┘            player_identities, player_career)
                                                    │
                                                    ↓ una sola volta per sessione
                                        LeagueDataProvider (client)
                                                    │
                        ┌───────────────────────────┼───────────────────────────┐
                        ↓                           ↓                           ↓
                  buildValuations             buildMarketState            reviewStrategies
                  (prezzo di ogni             (crediti, slot,             (quale strategia
                   giocatore)                  inflazione, tetti)          conviene adesso)
                        └───────────────────────────┼───────────────────────────┘
                                                    ↓
                                              recommend()
                                    prezzo consigliato + motivazione
```

## Il motore, file per file

Tutto sotto `src/lib/fanta/`. Nessuna dipendenza da React o da Supabase: si
testa da riga di comando.

| File | Responsabilita' |
|---|---|
| `types.ts` | Tipi condivisi e **costanti misurate** (livelli di riferimento per ruolo, persistenza, pesi delle stagioni, titolari per ruolo) |
| `valuation.ts` | Da statistiche a prezzo: proiezione, regressione, VOR, calibrazione della concentrazione |
| `conversion.ts` | Statistiche di altri campionati riportate alla scala della Serie A |
| `competitions.ts` | Tabella dei campionati con resa e fiducia; riconoscimento del nome; cosa ignorare |
| `market.ts` | Stato dell'asta: crediti, slot, inflazione a somma zero, tetti d'offerta, scarsita' |
| `recommend.ts` | Il consiglio: prezzo di apertura, prezzo giusto, tetto, verdetto, pro e contro |
| `review.ts` | Simula come finirebbe l'asta con ciascuna strategia e propone il cambio |
| `strategies.ts` | Le sei strategie con la ripartizione del budget |
| `importer.ts` | Lettura dei file ufficiali e abbinamento al listone |
| `identify.ts` | Chi e' davvero un giocatore dal nome abbreviato, e la sua carriera |
| `apiFootball.ts` | Client di API-Football, con ricerca precisa e gestione dei limiti |
| `openrouter.ts` | Client AI con controllo dei costi e ripiego sul formato |
| `externalStats.ts` | Fusione delle righe duplicate e precedenza fra fonti |
| `recovery.ts` | Chi resta da recuperare, come dividere il lotto fra i canali, quali annate l'archivio serve davvero |

## Applicazione

```
src/app/
  page.tsx                    elenco leghe, creazione, ingresso con codice
  login/                      accesso (nessuna registrazione)
  admin/                      account e password, solo amministratori
  lega/[id]/
    layout.tsx                intestazione + LeagueDataProvider (conservato fra le schede)
    asta/                     la schermata operativa
    rose/                     rose di tutti, efficienza di spesa
    listone/                  dati caricati, import, recupero dei mancanti
    impostazioni/             regole, partecipanti, strategia, cancellazione
  api/
    import/                   file ufficiali
    external-stats/           identificazione e recupero da fonti esterne
    insight/                  analisi qualitativa di un giocatore
    usage/                    consumo di API-Football e OpenRouter
    model-bench/              confronto fra modelli AI
```

`LeagueDataProvider` sta **nel layout** e non nelle pagine: Next lo conserva
passando da una scheda all'altra dello stesso segmento, quindi listone e
statistiche si scaricano una volta sola. Durante un'asta, dove si salta di
continuo fra Asta, Rose e Listone, e' la differenza piu' sensibile.

## Autenticazione e permessi

Niente registrazione pubblica: un trigger su `auth.users` rifiuta gli inserimenti
che non passino da `admin_create_user`, che a sua volta vuole un profilo
amministratore. La chiave anon viaggia nel browser, quindi bloccare solo il form
non sarebbe servito a niente.

Le policy RLS in sintesi:

- `players`, `player_stats`, `player_career`, `player_identities`: **lettura per
  tutti gli autenticati**, scrittura solo agli amministratori. Sono dati globali:
  valgono per tutte le leghe.
- `leagues`, `participants`, `auction_events`: visibili e modificabili dai membri
  della lega. L'asta e' una lavagna condivisa.
- `strategies`, `strategy_reviews`, `watchlist`: **solo il diretto interessato**.
  La strategia e' privata anche da chi ha creato la lega.

Le funzioni di supporto (`is_league_member`, `owns_participant`, `is_admin`) sono
`security definer` per evitare la ricorsione fra policy.

## Prestazioni

Misurato in produzione: le pagine di lega stavano fra 1.0 e 1.4 secondi, ora fra
0.22 e 0.31. Da dove veniva:

1. **La regione.** Le funzioni giravano a `iad1` mentre il database sta a
   Francoforte: ogni interrogazione attraversava l'Atlantico, ~90 ms a giro,
   quattro o cinque giri per pagina. `vercel.json` le fissa a `fra1`.
2. `getUser()` era chiamato quattro o cinque volte per pagina. Ora e' memoizzato
   per richiesta con `cache()` di React (`getSessionUser`, `getProfile`).
3. Le query della lega partivano in fila. Ora insieme, con la strategia agganciata
   al partecipante tramite join invece di aspettare di sapere chi e' l'utente.
4. `player_stats(*)` portava anche `id`, `player_id` e `created_at` per ognuna
   delle 1600 righe: con le sole colonne usate, 438 ms e 853 KB diventano 146 ms
   e 619 KB.


## Tre livelli di utenza

`src/lib/livelli.ts` tiene l'unica definizione: `base`, `premium`, `admin`, e
un `conConsigli(livello)` che quasi tutti i moduli chiamano. Il livello nasce da
due booleani su `profiles` (`is_admin`, `is_premium`), viaggia dal server dentro
`loadLeague` e arriva ai componenti col `LeagueDataProvider`, come `isOwner`.

Il confine e' **fra fatto e giudizio**, non fra dato semplice e dato complesso.
"Ha segnato 12 gol" resta anche a chi non ha il premium, pure se sta in fondo a
tre query; "vale 94 crediti" sparisce, pure se e' un numero solo.

| | base | premium | admin |
|---|---|---|---|
| storico, carriera, fonti dei dati | si' | si' | si' |
| chi ha comprato chi, a quanto | si' | si' | si' |
| crediti, slot, massimo che puoi offrire | si' | si' | si' |
| registrare e rettificare | si' | si' | si' |
| prezzo giusto, tetto, verdetto, ripieghi | — | si' | si' |
| rosa che stai costruendo, pareggio, rilancio | — | si' | si' |
| valore e fascia nel listone, inflazione | — | si' | si' |
| scelta della strategia | — | si' | si' |
| contesto qualitativo (AI) | — | si' | si' |
| account, listone, spazzate | — | — | si' |

Un amministratore e' sempre premium: importa i prezzi, non avrebbe senso che non
li vedesse. E nessuno puo' togliere l'amministrazione a se stesso — chi lo
facesse non potrebbe piu' ridarsela. Le due regole stanno in `admin_set_level`,
nel database, non nel modulo.

### Il modello sta sul server

Per un po' non e' stato cosi': `buildValuations` girava nel browser, dentro
`LeagueDataProvider`. Funzionava e i numeri erano giusti, ma metteva due cose
nel posto sbagliato. Il modello — la parte che distingue questo software da un
foglio di calcolo — finiva nella memoria di chiunque aprisse la pagina. E il
livello dell'utenza diventava una tenda invece che un muro: nascondere i prezzi
nell'interfaccia non serve a niente se i prezzi sono comunque li' dietro.

Adesso il conto lo fa `GET /api/lega/[id]/valutazioni`, e per chi non ha il
premium **non viene chiamato affatto**. Non e' un filtro in uscita: quei numeri
non esistono, quindi non c'e' niente da dimenticarsi di togliere. La risposta
per un account base sono trentasette byte:

```json
{"livello":"base","valutazioni":null}
```

Cosa e' rimasto nel browser, e perche':

| | dove | perche' |
|---|---|---|
| `buildValuations` | server | e' il modello, e va protetto |
| listone e statistiche | client, da Supabase | sono fatti, li vedono tutti — e sono 1.9 MB, che non hanno motivo di passare da una funzione col tetto di 4.5 MB |
| `buildMarketState` | client | aritmetica su quello che e' gia' li', e deve reagire subito a ogni chiamata registrata |
| `recommend`, `rosaIdeale` | client | idem, e senza valutazioni non hanno nemmeno gli ingredienti |

Il conto dipende anche da **quante squadre ci sono e da quanti crediti hanno**,
non solo dal listone: per questo il client richiede le valutazioni quando un
partecipante cambia, ed e' un evento che capita qualche volta prima dell'asta e
mai durante.

`npm run check:livelli` tiene le due promesse separate: che spostare il conto
non abbia cambiato **un solo prezzo** (250 giocatori confrontati, scarto massimo
0.000000) e che a un account base la risposta arrivi `null` — non filtrata, non
azzerata. Chiama l'endpoint vero, non una sua copia.

**Quello che resta fuori dal muro.** Le statistiche storiche arrivano a tutti,
ed e' voluto: lo storico di un giocatore e' un fatto e la sua scheda lo mostra a
chiunque. Chi volesse potrebbe ricostruirsi un modello a partire da li' — ma
quello e' scrivere il software, non usarlo di nascosto. E il contesto
qualitativo, che costa soldi veri a ogni richiesta, e' bloccato anche
nell'endpoint (`/api/insight` risponde 403), non solo nel bottone.


## I crediti sono una regola, non una proprieta' della squadra

Per un po' ogni partecipante poteva darsi il budget che voleva: c'era un campo
"I tuoi crediti" nel proprio posto in lega, e chi amministrava poteva darne di
diversi a ognuno. Non e' un'asta — in un'asta i crediti sono uguali per tutti e
li decide chi fa le regole.

Adesso il campo esiste in un posto solo: **Regole della lega → Crediti a
squadra**. Da li' scendono su tutte le squadre nello stesso momento
(`updateLeague` allinea i partecipanti dopo aver scritto la lega), e chi non ha
creato la lega li vede e basta.

`participants.budget_total` resta la colonna che il motore legge — cambiarla
avrebbe voluto dire toccare mezzo motore per niente — ma non e' piu' un dato
indipendente: e' una copia della regola, tenuta allineata a ogni salvataggio.

Il pavimento e' lo stesso di sempre, spostato di un livello: **il budget non
puo' scendere sotto quello che ha gia' speso la squadra che ha speso di piu'**,
o i suoi crediti residui andrebbero negativi e con loro l'inflazione, il tetto
degli avversari e ogni consiglio. Il limite e' scritto sotto il campo, e il
server lo applica comunque — l'attributo `min` di un campo numerico e' un
suggerimento, non una regola.


## La lista dei chiamabili

Con la chiamata casuale, su cinquecentotrenta nomi meta' del pomeriggio se ne va
su giocatori che nessuno vuole. La lega decide prima un sottoinsieme — di solito
quanti bastano a riempire tutte le rose, piu' un margine — e da li' in poi il
software lavora **solo su quello**.

Sta in `league_shortlist`, una riga per (lega, giocatore). Vuota vuol dire
"tutti", ed e' il caso normale finche' nessuno ne definisce una.

Il giro e' fatto per essere discusso in otto davanti a un foglio, non dentro
l'applicazione:

1. `GET /api/lega/<id>/lista?formato=xlsx` scarica **la proposta del modello** —
   i migliori per ruolo, `slot x partecipanti x 1.35` — su due fogli: `Lista` con
   la proposta e `Tutti i giocatori` con il listone intero, per aggiungere
   qualcuno senza dover indovinare come si scrive.
2. Si corregge in Excel: `NO` nella colonna *In lista*, o la riga cancellata.
3. `POST` dello stesso file: **sostituisce** la lista, non la fonde — "aggiungi"
   lascerebbe dentro chi qualcuno aveva appena tolto. L'abbinamento passa
   dall'**Id ufficiale** che l'export porta con se', quindi un nome scritto
   storto non perde il giocatore.

La pagina `/lega/<id>/lista` la mostra a tutti i membri — e' l'accordo su cosa si
mette all'asta, e ognuno deve poterlo leggere per conto suo.

Cosa cambia quando c'e' una lista:

- il **piano** e i **ripieghi** vedono solo lei (`giocatoriInAsta` nel
  provider): contare su un ricambio che all'asta non verra' chiamato e' peggio
  che non contarci;
- la **chiamata** non si puo' aprire su chi e' fuori — il tasto lo dice invece
  di sparire;
- il **microfono** sceglie solo fra i chiamabili: agganciare un nome fuori lista
  vorrebbe dire aprire una chiamata che la lega ha deciso di non fare;
- la **ricerca** li trova lo stesso, con accanto "fuori lista". Cercare resta
  libero: e' chiamare che non lo e'.

## La chiamata in corso

Cercare un giocatore e' privato: ognuno guarda chi vuole, quando vuole, e il
software non gli strappa via la scheda. Ma **quale giocatore e' sul piatto in
questo momento** e' un fatto della lega, uno solo, e deve essere lo stesso su
tutti gli schermi — altrimenti chi registra guarda una scheda e chi rilancia
un'altra.

Sta su `leagues.current_player_id`. A dirlo e' chi conduce — un premium o un
amministratore — con il pulsante *"E' lui che stanno chiamando"* sulla scheda
del giocatore; su tutti gli altri schermi della lega quella scheda si apre da
sola, in tempo reale. Il microfono continua a proporre a chiunque: la proposta
e' di tutti, la conferma di chi ha in mano l'asta.

Le regole della lega le cambia solo chi l'ha creata, e questo non e' una regola:
e' lo stato dell'asta. Per questo passa da `set_current_player`, una porta
stretta che controlla di suo l'appartenenza alla lega e il livello, invece di
allargare i permessi sulla tabella `leagues`.

### A quanto siamo, e chi e' davanti

Sapere *chi* e' sul piatto non bastava. Durante una chiamata la cosa che cambia
di continuo e' **l'offerta**, ed e' l'unica informazione che tutti guardano nello
stesso momento — mentre viveva sui fogli di ognuno, e chi registrava alla fine
doveva ricordarsela.

`leagues.current_price` e `leagues.current_bidder` la tengono, `set_current_bid`
la scrive (premium o amministratore, come per il giocatore), e il realtime la
porta su tutti gli schermi. Chi conduce ha +1 / +5 / +10 e il menu di chi sta
offrendo; tutti gli altri vedono la cifra salire.

Tre cose che chiudono il cerchio:

- **Il modulo di registrazione parte da li'.** Se il giocatore selezionato e'
  quello in asta, prezzo e compratore arrivano dalla chiamata: chiuderla e' un
  click. Prima il prezzo partiva dal valore del modello — un numero che con
  quello che era appena successo in stanza non c'entrava niente.
- **Registrare chiude la chiamata per tutti.** Aprire una chiamata nuova azzera
  l'offerta: lasciarsi dietro il prezzo del giocatore precedente e' il modo piu'
  rapido di registrare una cifra sbagliata.
- **Riaprire e' da amministratore.** Chiuderla la chiude chi conduce; riaprirla
  no, perche' vuol dire cancellare un fatto registrato e rimettere la lega
  davanti a una decisione gia' presa. Il tasto sta negli ultimi movimenti,
  sulla scrivania e sul telefono.

### Il microfono conduce

Era l'anello che mancava: si sentiva un rilancio, lo si vedeva nel proprio
riquadro, e sugli altri schermi non succedeva niente — ognuno seguiva la stessa
asta su una pagina diversa. Adesso quello che il microfono riconosce **diventa
la chiamata di tutta la lega**: il giocatore apre la chiamata su tutti, ogni
rilancio sentito aggiorna la cifra su tutti.

Solo per chi puo' condurre, e solo quando qualcosa e' davvero cambiato — il
banditore parla in continuazione, e scrivere a ogni sillaba vorrebbe dire una
richiesta al secondo per niente.

**In fila, non insieme.** Aprire una chiamata azzera l'offerta, quindi se le due
scritture partono affiancate vince chi arriva ultima: si sentiva "Carnesecchi a
100 da Mario", partivano `set_current_player` e `set_current_bid` in
parallelo, e la barra restava a "— crediti" perche' l'azzeramento atterrava per
secondo. La prima deve finire prima che parta la seconda.

**La lega non era in ascolto.** `auction_events` e `participants` erano nella
pubblicazione realtime, `leagues` no — e nessuno se n'era accorto perche' finora
la lega non cambiava mai durante un'asta. Da quando ci vive la chiamata in
corso, invece, e' la tabella che cambia piu' spesso di tutte: senza quella riga
la barra si aggiornava solo su chi la scriveva, e gli altri vedevano l'asta di
dieci minuti prima finche' non ricaricavano.

Sotto il realtime c'e' una rete: finche' una chiamata e' aperta, la riga della
lega si rilegge ogni tre secondi, e tornando sulla scheda ci si riallinea
subito. Un socket cade — il portatile va in sospensione, il wifi della stanza fa
i capricci, il browser mette in pausa una scheda in secondo piano — e "si era
disconnesso e non me ne sono accorto" e' il modo peggiore di perdere una
chiamata. E' una riga sola, e quando non c'e' nessuna chiamata non fa niente.

**Il prezzo vale anche senza il nome.** Il caso e' comunissimo: la chiamata e'
gia' aperta, il banditore dice solo "centocinquanta", il microfono capisce la
cifra ma nessun nome. Prima quel prezzo restava nel riquadro delle correzioni e
sulla barra non arrivava — proprio quando l'unica cosa che serviva era quella
cifra. Adesso, se una chiamata e' aperta, il prezzo ci va comunque.

**Un posto solo, non due.** Il riquadro del microfono non ripete piu' niente
della chiamata: nome, quotazione e offerta stanno nella barra, e li' si
correggono. Del pannello che c'era prima — i tre campi *giocatore / prezzo / a
chi* da sistemare a mano — non e' rimasto niente, perche' erano gli stessi tre
campi della barra scritti una seconda volta, dieci centimetri piu' in basso.
Quello che resta e' un interruttore, la trascrizione di quello che sta sentendo
e l'ultima cosa capita: sta in colonna a destra, dove si accende una volta
all'inizio e non lo si tocca piu'.

### Il microfono ce l'hanno tutti, anche senza premium

Accendere l'ascolto non e' un privilegio: e' **mettere un orecchio in piu' nella
stanza**. Il telefono appoggiato in mezzo al tavolo sente il banditore, il
portatile dall'altra parte no, e un microfono in piu' in un punto diverso e'
esattamente cio' che trasforma mezza frase capita in una chiamata intera. Chi
non conduce non muove niente sugli schermi degli altri — il suo browser non
prova nemmeno a scrivere sulla lega — ma quello che sente viaggia sul canale
condiviso e si somma a quello degli altri.

Perche' funzionasse davvero sono cambiate due cose:

- **Il canale non dipende piu' dal proprio microfono.** Prima si apriva solo
  accendendo l'ascolto, quindi chi conduceva con il microfono spento non
  riceveva niente da nessuno. Ora e' aperto per tutti, sempre: ascoltare vuol
  dire *mandare*, non *ricevere*.
- **Se noi non abbiamo sentito niente, quello che ha sentito un altro diventa la
  nostra proposta.** La fusione a piu' voci copriva solo il caso in cui avessimo
  sentito anche noi — utile per completare, inutile per il caso vero, che e'
  proprio "qui non e' arrivato niente".

### Cinque trascrizioni invece di una

Il riconoscitore non produce una trascrizione: ne produce diverse, ordinate per
quanto **suonano come italiano**. E' il criterio sbagliato per noi: "Cala Nogli"
e' italiano piu' plausibile di "Calhanoglu", e vince quasi sempre. Ora si
chiedono cinque alternative e si prova ognuna contro il listone, tenendo quella
che aggancia un giocatore vero. Costa zero — sono confronti fra stringhe che il
riconoscitore ha gia' prodotto — e in una stanza rumorosa e' la differenza fra
riconoscere e non riconoscere.

### La chiamata confermata

Il nome sul piatto arriva quasi sempre dal microfono, e il microfono a volte
sbaglia. Finche' nessuno lo conferma resta un'ipotesi, e una parola sentita male
puo' ancora rimpiazzarlo. Chi conduce dice **"e' lui: confermo"** — un tasto
dentro la barra, sotto la cifra — e da quel momento `leagues.current_locked` e'
vero:

- il microfono puo' solo far salire la cifra, e un nome diverso lo *segnala*
  invece di sostituirlo (*«ho sentito Caprile, ma la chiamata e' confermata su
  Carnesecchi»*): puo' voler dire che il banditore e' andato avanti, ed e' chi
  conduce a doverlo decidere;
- `set_current_player` **rifiuta** un giocatore diverso finche' la conferma c'e'.
  Non e' solo un controllo nell'interfaccia: e' la porta che regge anche se una
  scheda vecchia, un altro dispositivo o una richiesta in ritardo prova a
  cambiarlo;
- per cambiarlo davvero c'e' *"non e' lui: cambia giocatore"*, che apre una
  ricerca dentro la barra. **La cifra e chi e' davanti restano dove sono**: il
  caso vero e' che il microfono abbia capito Carnesecchi mentre chiamavano
  Caprile, in stanza si e' gia' arrivati a quaranta, e ricominciare da zero
  butterebbe via l'unica cosa che era giusta. Sceglierlo a mano *e'* la
  conferma, quindi si riconferma da solo.

Aprire una chiamata azzera la conferma: ogni chiamata comincia da capo.

### Una sola chiamata alla volta

Il tasto *"e' lui che stanno chiamando"* sparisce quando una chiamata e' gia'
aperta, sulla scrivania come sul telefono: aprirne un'altra vorrebbe dire
cancellare dagli schermi di tutti un'asta ancora in corso. Prima si chiude
questa; e se e' solo il nome a essere sbagliato, si corregge dalla barra, dove
il prezzo raggiunto non va perso.

### Registrare e' chiudere

Il modulo *"com'e' finita"* non c'e' piu'. Chiedeva prezzo e acquirente in due
campi identici a quelli che stanno sulla barra, dieci centimetri piu' in basso:
due posti per la stessa cosa, cioe' un secondo posto in cui sbagliarla. Adesso
in fondo al blocco verde ci sono tre tasti — **aggiudica a X per N**, *non
venduto*, *annulla la chiamata* — e il primo dice ad alta voce quello che sta
per registrare. Il controllo sui crediti (`perchePrezzoImpossibile`) e' li'
dentro: se quella cifra lascerebbe l'acquirente senza i crediti per completare
la rosa, il tasto non si preme e la riga sotto spiega perche'.

Conseguenza voluta: **ogni acquisto passa da una chiamata**. Per registrare
qualcuno che nessuno ha chiamato — o per correggere un vecchio errore — si apre
la chiamata su di lui, o si riapre dagli ultimi movimenti, e si chiude come
tutte le altre.

### Come e' disposta la scrivania

La barra dell'asta e' **fissata in cima** e non scorre mai: e' l'unica cosa che
tutta la stanza guarda nello stesso momento, e perderla di vista scorrendo
vorrebbe dire non sapere piu' a quanto siamo. Subito sotto sta la scheda di chi
stanno chiamando — analisi, prezzi consigliati e il modulo per registrare
com'e' finita.

Piu' in basso c'e' la ricerca, e serve al caso opposto: quel giocatore non ti
interessa, e mentre gli altri se lo contendono tu studi il prossimo. Per questo
la chiamata non dirotta piu' la ricerca su di se' come faceva prima — le due
cose convivono, la chiamata in cima e chiunque tu voglia guardare piu' sotto.

La barra e la sua scheda sono **un blocco solo**: la barra e' `sticky` dentro la
colonna che scorre, non un riquadro fuori dallo scorrimento, cosi' il bordo fra
le due non si apre mai e la scheda le passa sotto. Il fondo e' opaco per lo
stesso motivo — un fondo translucido lascerebbe vedere il testo che scorre
sotto la cifra.

### La rotella scorre il centro, ovunque tu punti

Tre colonne che scorrono ognuna per conto suo hanno un difetto che si scopre
solo usandole: il puntatore sta quasi sempre fuori da quella che vuoi muovere, e
la rotella non fa niente — chi legge una scheda col mouse fermo sul riquadro dei
crediti crede che la pagina si sia bloccata. Adesso la regola e': se il
puntatore e' sopra una colonna laterale che **puo' ancora scorrere**, comanda
lei; altrimenti la rotella va al centro, che e' la colonna lunga.

### L'eco dell'asta

Quando cerchi un altro giocatore la barra dell'asta finisce fuori schermo, e per
sapere a quanto sono arrivati dovresti risalire. In cima alla colonna di destra,
sotto il microfono, compare allora un blocchetto con le tre cose che servono per
non perdere il filo — chi, quanto, di chi — e un click riporta su.

Che la barra sia uscita si misura a ogni scorrimento, con due rettangoli, **e
non con un `IntersectionObserver`**: quello consegna le sue misure solo quando la
pagina viene disegnata davvero, e una finestra in secondo piano resterebbe con
l'eco sbagliata. Sotto c'e' anche una controllata ogni mezzo secondo, perche' la
barra si sposta pure senza che nessuno scorra — una chiamata che si apre, una
scheda che si allunga quando arrivano le statistiche.

Una trappola che e' costata un'ora: l'effetto che attacca la misura dipendeva
dal giocatore in asta, e finche' il listone carica **le tre colonne non esistono
nel documento**. Quando comparivano davvero, l'effetto non si rifaceva piu' e il
riferimento restava vuoto. Ora la colonna centrale e' uno *stato*, non solo un
riferimento: nasce, e chi la deve misurare se ne accorge.

### Quando cominci a cercare, la ricerca sale in cima

Alla prima lettera la colonna centrale si porta la ricerca in alto: da li' in
poi lo schermo e' tutto per i risultati e per la scheda, e l'asta in corso vive
nell'eco a destra. Lo scorrimento e' secco e non animato — su un contenitore che
in quel momento cambia altezza quello morbido non parte proprio — e viene
ripetuto dopo un decimo di secondo per raccogliere l'assestamento del riquadro
che nel frattempo si e' riempito di risultati. In fondo alla colonna c'e'
un'altezza di schermo di spazio vuoto: senza, l'ultimo riquadro non potrebbe
mai arrivare in cima.

### Una chiamata alla volta, ma spostabile

Il tasto per aprire la chiamata non sparisce piu' quando ce n'e' gia' una:
sparire e' il modo peggiore di dire di no, e il caso vero esiste — il banditore
e' passato al prossimo e quella di prima nessuno l'ha chiusa. Diventa *"sposta
qui la chiamata"*, e serve un secondo click di conferma, perche' sostituirla
cancella dagli schermi di tutti un'asta in corso, prezzo compreso. Se e' solo il
nome a essere sbagliato, la strada giusta resta l'altra: correggerlo dalla
barra, dove la cifra raggiunta non si perde.

### Le informazioni di servizio stanno in una ⓘ

Le spiegazioni "come funziona questa cosa" si leggono una volta e poi restano
li' a mangiare spazio per tutta l'asta, proprio quando lo spazio serve ai numeri
che cambiano. Il componente `Aiuto` le mette in un pallino: chi non sa cosa sia
una cosa ci passa sopra, chi lo sa gia' vede solo una ⓘ grigia. Il testo sta
anche in `title`, quindi esiste anche per la tastiera e per chi legge con uno
screen reader.

### Dettagli che si notano solo usandolo

- **La riga fra la barra e la scheda.** Sono un blocco solo, ma un blocco con
  due parti: senza quella riga il nome grande e la scheda sembravano la stessa
  cosa.
- **Le colonne non ballano.** `scrollbar-gutter: stable` su tutte e tre:
  altrimenti una colonna si stringe di una quindicina di pixel nel momento in
  cui il contenuto diventa piu' alto dello schermo — e a destra il contenuto
  cambia da solo quando compare l'eco dell'asta.
- **"Come sta andando l'asta" nasce chiuso.** E' il contorno, non la decisione:
  aperto spingeva sotto il bordo dello schermo le cose che si guardano a ogni
  chiamata.
- **Lo storico e' tornato una tabella**, ma con le presenze disegnate e la
  fantamedia in evidenza. La versione a schede era leggibile e lunga il doppio;
  in un'asta lo spazio vale piu' dell'eleganza.
- **Scegliere chiude l'elenco.** Hai scelto quello: gli altri quattro non
  servono piu' e stavano solo spingendo la sua scheda piu' in basso. Una ✕
  accanto al filtro ripulisce testo, ruolo e scheda in un gesto solo.
- **I blocchi che si aprono si aprono davvero.** La freccia e' un'icona da
  sedici pixel che ruota, non un triangolino di punteggiatura, e il tasto e'
  tutta la riga — spaziatura compresa — cosi' non ci sono punti morti dove
  premi e non succede niente.
- **Un separatore fra le due meta' della colonna centrale.** Sopra l'asta di
  adesso, sotto quello che stai guardando tu: due cose diverse che scorrevano
  attaccate e a colpo d'occhio sembravano lo stesso blocco.
- **Le colonne della rosa stanno ferme.** Ogni riga ha sempre le stesse quattro
  caselle — nome, prezzo, probabilita', comandi — anche quando una e' vuota:
  prima chi era stato scelto a mano aveva una crocetta in piu' e spostava il
  prezzo rispetto alle righe sopra.

### Sul telefono restano tre cose

Crediti, chiamata in corso, e fin dove puoi spingerti: tre riquadri, nessuna
ricerca, nessun modulo da riempire. Il telefono non e' una scrivania piccola, e'
un altro mestiere — si tiene in una mano, si guarda per due secondi fra un
rilancio e l'altro — e tutto quello che non risponde a "quanto mi resta", "chi
stanno chiamando" e "quanto posso offrire" li' dentro ruba spazio alle tre cose
che contano. Registrare si fa dalla barra, che i tasti ce li ha gia'; e il
tasto dell'ascolto c'e', perche' il telefono e' quasi sempre il dispositivo piu'
vicino al banditore.
