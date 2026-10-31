# I dati

## Tabelle

Listone, statistiche, identita' e carriera sono **globali**: valgono per tutte le
leghe. Solo un amministratore li scrive.

| Tabella | Contiene |
|---|---|
| `players` | Il listone di una stagione. `is_active` distingue chi c'e' ancora |
| `player_stats` | I numeri, una riga per (giocatore, stagione, competizione, **squadra**) |
| `player_identities` | Chi e' davvero: nome completo, anno, nazionalita', debutto, id API |
| `player_career` | Il racconto: una riga per stagione, **anche senza numeri** |
| `player_insights` | Cache delle analisi qualitative (7 giorni) |
| `player_recovery` | Cosa ha gia' tentato ogni fonte su ogni giocatore, e com'e' andata |
| `app_state` | Quello che abbiamo imparato sulle fonti e non ha senso richiedere |
| `leagues`, `participants`, `league_members` | La lega e chi ci gioca |
| `auction_events` | Chi ha comprato chi e a quanto |
| `strategies`, `strategy_reviews`, `watchlist` | Privati del singolo partecipante |

### I campi che i file ufficiali non hanno

I file di Fantacalcio.it non riportano i **minuti giocati** — su nessuna delle
1592 righe importate — ne' il **rating**, ne' le partite **da titolare**. Sono
esattamente i tre campi che distinguono un titolare da una riserva con lo stesso
numero di presenze, cioe' la differenza che all'asta si paga.

L'archivio sportivo li ha, e li da' **una squadra e una stagione per volta**:
`/players?team=X&season=Y`, venti giocatori a pagina. Non per campionato, che
sarebbe l'idea ovvia: il piano gratuito accetta al massimo tre pagine — "Free
plans are limited to a maximum value of 3 for the Page parameter" — quindi il
campionato intero restituirebbe sessanta giocatori su mille. Una rosa invece sta
in due pagine, e venti squadre coprono la Serie A in una quarantina di chiamate.

L'abbinamento passa dall'**id dell'archivio**, non dai nomi: per id non si
sbaglia persona. Sulle righe che vengono dai file ufficiali non si sovrascrive
niente, si riempiono solo le colonne vuote.

**`lineups` va sempre letto con `lineups_matches`**, che sono le presenze secondo
la stessa fonte. I due conteggi non coincidono: i file di Fantacalcio.it contano
le partite in cui e' stato dato un voto, l'archivio conta le presenze, e su
Lautaro Martinez fanno 31 contro 32. Un rapporto ha senso solo fra numeri della
stessa fonte, quindi la titolarita' e' `lineups / lineups_matches` e mai
`lineups / matches`.

`npm run check:seasons` fa la spazzata; il piano gratuito copre dal 2022 al 2024.

### La carriera, dai fatti invece che dalla memoria

Il pezzo di archivio piu' fragile era proprio quello che serve di piu': **chi
arriva da fuori**. Per 170 giocatori del listone 2026/27 non esiste una riga dai
file ufficiali dell'anno scorso, e la loro carriera la scriveva un modello
linguistico a memoria.

Misurato contro Wikidata, che non stima ma cita (`npm run check:carriera`):

| | stagioni |
|---|---|
| stessa squadra | 36 |
| **eco della squadra di adesso** | **60** |
| nomi diversi, dubbio | 30 |
| stagioni che non avevamo | 85 |

Almeno il **48%** delle stagioni confrontabili era semplicemente la squadra di
adesso ripetuta all'indietro: Balerdi "alla Roma" nel 2023-24 quando era al
Marsiglia, Pedraza "alla Lazio" quando era al Villarreal, Romero "al Parma"
quando giocava all'Oriente Petrolero in Bolivia. E' il modo in cui un modello
sbaglia quando non sa: risponde la cosa piu' probabile, cioe' il club che gli
hai appena nominato.

**Wikidata** costa zero, non ha chiave e non ha quota, e una query copre tutto
il listone: ogni tesseramento e' una dichiarazione con club, date, se era un
prestito, e spesso presenze e gol — e dal club arrivano campionato e paese, che
e' quello che serve al convertitore. Le carriere citate hanno preso il posto di
quelle a memoria (211 righe), e con loro si sono corretti **19 campionati**
sbagliati nelle statistiche: dare la Serie A a chi giocava in Segunda gli
regalava mezzo punto di fantamedia.

Quanto copre, misurato: **121 giocatori su 170** senza riga ufficiale
(101 per nome, 20 abbinati dalle rose dei club di Serie A che Wikidata ha gia'),
per **310 righe** di carriera citate. I 49 che restano sono quasi tutti quelli di
cui il listone ha solo il cognome e l'archivio sportivo non ha dato un nome per
esteso: senza un nome non c'e' etichetta da cercare.

Wikidata porta anche **presenze e gol** del tesseramento, ma solo dove il
periodo copre una stagione sola quei numeri sono di quella stagione: sono 9
righe di storico, poche ma vere. Dove il periodo copre piu' anni restano fuori —
dividerli per il numero di stagioni sarebbe inventare.

Due limiti da sapere, perche' decidono come si usa:

- **Wikidata e' indietro di un mercato.** Chi si e' mosso a luglio spesso non
  c'e' ancora — Alhassane risulta ancora al Real Oviedo. Per questo la stagione
  in corso non si tocca: quella la sa il listone.
- **Le presenze valgono per tutto il periodo**, non per la stagione: "2024-2026
  Real Oviedo 52 presenze" non sono 26 all'anno. Dove il periodo copre piu' di
  una stagione, presenze e gol restano vuoti — la riga dice comunque la cosa
  che conta, cioe' **dove giocava**.

E un limite del piano gratuito dell'archivio sportivo, misurato: le stagioni
disponibili sono **2022, 2023 e 2024**. Per il 2025-26 di chi giocava all'estero
l'archivio non ha niente, e resta quello che trova il modello — adesso pero' con
il campionato controllato dalla carriera citata.

### La precedenza

`player_stats` porta **`source`** (`import`, `api`, `ai`, `manual`) e
**`source_detail`** con la provenienza: fornitore, modello, nome risolto, club,
fiducia, nota. La scheda giocatore la mostra.

## I file ufficiali

### Quali colonne scaricare

Il configuratore del sito fa scegliere **al massimo otto colonne**, e le legge
tutte l'importatore: `Sq` (squadra), `PV`, `MV`, `FM`, `Gf`, `Gs`, `Ass`, `Amm`,
`Esp`, `Rp` (rigori parati), e i rigori segnati/tirati sia come due colonne
separate (`R+`, `R-`) sia come una sola (`Rig`, nella forma "3/4").

La colonna che prima si buttava e adesso serve e' **`Sq`**: nel file delle
statistiche e' la squadra di *quella* stagione, cioe' l'unico posto in cui la
squadra del passato esiste senza chiederla a nessuno. Da qui finisce in
`player_stats.club`.

Con otto colonne per volta, due scaricate coprono tutto: la prima con
`Sq, PV, MV, FM, Gf, Ass, Amm, Esp`, la seconda con `Sq, PV, Gs, Rp, Rig` per i
portieri e i rigoristi. L'importatore le unisce sulla stessa riga.

Quello che i file non hanno **in nessuna configurazione** sono i **minuti** e il
**rating**: per quelli serve l'archivio sportivo, ed e' il motivo per cui la
spazzata delle stagioni esiste.


Dall'area download di Fantacalcio.it. Struttura reale, verificata: una riga di
titolo, poi le intestazioni.

**Quotazioni** — fogli `Tutti`, `Portieri`, ..., `Ceduti`. Colonne `Id`, `R`,
`RM`, `Nome`, `Squadra`, `Qt.A`, `Qt.I`, `Diff.`, `Qt.A M`, `Qt.I M`, `Diff.M`,
`FVM`, `FVM M`. 533 giocatori per il 2026-27.

**Statistiche** — colonne `Id`, `R`, `Rm`, `Nome`, `Squadra`, `Pv`, `Mv`, `Fm`,
`Gf`, `Gs`, `Rp`, `Rc`, `R+`, `R-`, `Ass`, `Amm`, `Esp`, `Au`.

L'import riconosce il tipo dal contenuto, ma **tipo e stagione si scelgono a
mano**: lasciar indovinare l'anno e' il modo piu' rapido per sovrascrivere
l'annata sbagliata senza accorgersene.

**Il listone e' l'elenco di chi c'e', non l'unione di tutto quello che e'
passato.** Importando le quotazioni, chi non compare piu' viene disattivato (non
cancellato: potrebbe essere in una rosa). Senza questo, un import del file
dell'anno prima lasciava 190 giocatori fantasma a falsare i calcoli.

Le statistiche si agganciano in tre passaggi: **Id ufficiale**, poi **nome +
squadra**, poi **nome da solo se non e' ambiguo**. Sui file veri l'abbinamento e'
al 100% per Id.

## Altri campionati

Chi arriva dall'estero o dalla Serie B non ha righe di Serie A. Stimarlo dalla
sola quotazione significa copiare il mercato **proprio dove il mercato sbaglia di
piu'**. Per questo `player_stats` porta la competizione, e la produzione viene
riportata alla scala della Serie A.

| Campionato | Resa | Fiducia |
|---|---|---|
| Serie A | 100% | 100% |
| Premier League, La Liga | 100% | 85% |
| Bundesliga | 92% | 85% |
| Ligue 1 | 90% | 80% |
| Champions League | 115% | 55% |
| Liga Portugal | 68% | 70% |
| Eredivisie, Championship | 62% | 70% |
| **Serie B** | **45%** | 75% |
| Coppe nazionali | 60% | 35% |
| non riconosciuto | 50% | 30% |

Due coefficienti perche' sono due cose diverse: la **resa** dice quanti di quei
gol si sarebbero visti in Serie A, la **fiducia** quanto e' solido il dato in se'
e sconta il peso del campione.

Il riconoscimento guarda **il paese per primo**: "Serie A" esiste in Italia e in
Brasile, e scambiarle vorrebbe dire trattare il Brasileirao come il nostro
campionato. Nazionali, giovanili e squadre riserve vengono **scartate**: sommarle
alla stagione gonfierebbe le presenze.

**La media voto non esiste fuori dall'Italia.** E' un'invenzione dei quotidiani
sportivi italiani. Quello che si trova e' un rating tipo Sofascore, media 6.8, che
viene riportato sulla scala italiana (media 6.0); da li' la fantamedia si
ricostruisce con i bonus standard. E' la stima piu' incerta che il software
produce, ed e' dichiarata come tale.

**Il portiere e' il caso difficile.** Quanti gol subira' dipende dalla difesa che
ha davanti, e quella non si trasferisce con lui. Dove il dato manca, i gol subiti
si stimano dalla forza della squadra **attuale**. Una fonte che restituisce zero
gol subiti non dice "imbattuto", dice "non lo so".

## Le fonti esterne

Il recupero e' un ciclo: un pulsante, lotti da venti, dal piu' quotato al meno
quotato. Dentro ogni lotto:

1. **Identificazione**, a gruppi di sei in parallelo. Il listone abbrevia i nomi:
   "Ramos G." e' Goncalo Ramos. Cercare "Ramos" su un archivio mondiale da' 250
   omonimi. La squadra pero' e' nel listone ed e' certa: il modello la usa come
   vincolo e cerca la rosa ufficiale del club. Ricostruisce nome completo, anno di
   nascita, nazionalita' e **la carriera stagione per stagione**, col debutto fra
   i professionisti.
2. **I due canali insieme, non in fila.** I colli di bottiglia sono indipendenti:
   l'archivio e' gratis ma contingentato al minuto, l'AI e' illimitata ma si paga.
   I piu' quotati vanno ad **API-Football** — la fonte migliore, e quando trova il
   giocatore **il suo nome corregge quello ipotizzato dall'AI** — e tutti gli
   altri all'**AI**, un giocatore per chiamata perche' la ricerca web restituisce
   pochi risultati per richiesta e divisi fra sei persone non bastano.

Nessun giocatore finisce in entrambi i canali nello stesso lotto: chi l'archivio
non trova passa all'AI al lotto dopo, con l'esito registrato in
`player_recovery`, invece di essere pagato due volte. Dopo due tentativi a vuoto
per canale si rinuncia: sono quasi sempre riserve da un credito che nessun
archivio ha mai visto giocare, e restano da inserire a mano.

### La precedenza fra fonti

Una scala sola, in `src/lib/fanta/reliability.ts`, usata sia per decidere chi
scrive sia per pesare nel motore. Prima erano due e non erano d'accordo.

| | livello | chi | |
|---|---|---|---|
| 4 | `import` | i file di Fantacalcio.it caricati dall'utente | la verita' |
| 3 | `api` | l'archivio sportivo, con riscontro sull'anno di nascita | |
| 2 | `manual` | inserito a mano nel pannello | |
| 1 | `ai` | ricostruito dal modello | plausibile, non verificato |

**Un dato piu' affidabile non viene mai sostituito da uno meno affidabile.** Pari
livello si', perche' una corsa dell'archivio piu' recente deve poter aggiornare
una piu' vecchia.

Non era cosi'. La protezione copriva solo i file ufficiali: bastava finche' le
fonti arrivavano nello stesso lotto, dove `preferBestSource` gia' decideva, ma
fra un lotto e l'altro non decideva nessuno e l'upsert faceva vincere l'ultimo
che scriveva. Nel database c'erano gia' due identita' verificate dall'archivio e
poi riscritte dal modello.

**La precedenza vale sul fatto, non sulla riga.** L'archivio restituisce nomi
abbreviati — `J. Stones`, `K. Koulierakis`, `T. Chalobah` — mentre il modello
restituisce `Arthur Theate` e `Giacomo Calo'`. Applicare la gerarchia alla riga
intera congelerebbe le abbreviazioni e butterebbe via il dato migliore. Quindi:

- **chi e'** (id dell'archivio, anno di nascita) lo decide la fonte migliore;
- **come si scrive** puo' migliorarlo il modello, ma solo espandendo: `J.` che
  diventa `John` passa, `Sergiusz` al posto di `Nick` no — e' un'altra persona;
- **i campi vuoti** li puo' riempire chiunque: riempire un buco non e'
  sovrascrivere.

`npm run check:conversion` verifica ognuno di questi casi.

### Perche' il ciclo sta nel browser

La scheda deve restare aperta, ma **il browser non tiene il segno**: e' il server
a scegliersi il lotto leggendo chi e' ancora scoperto e cosa hanno gia' tentato le
fonti. Ogni lotto scrive prima di rispondere, quindi chiudere la scheda perde il
lotto in corso e non il lavoro, e il giorno dopo si riprende da dove si era
arrivati. Il giorno in cui servisse un cron, sara' un chiamante in piu' dello
stesso endpoint invece di un secondo percorso da tenere allineato — che e'
esattamente il modo in cui un bug e' gia' arrivato in produzione con i test verdi.

### Quanto dura e quanto costa, misurato

`npm run check:recovery` guida il ciclo vero e riporta i numeri. Sulla produzione:

| Lotto | Durata | Risolti | Costo |
|---|---|---|---|
| 6 giocatori | 8,8 s | 3 | $0.030 |
| 20 giocatori | 24,7 s | 8 | $0.117 |
| 20 giocatori | 24,8 s | 10 | $0.146 |

Venti per lotto stanno al **41% dei 60 secondi** del piano Hobby. Il costo e'
circa **$0.0066 per giocatore lavorato**, cioe' un dollaro scarso per i 150 che
mancavano.

Il lotto non e' proporzionale al numero di giocatori: l'identificazione va a
gruppi di sei in parallelo e le statistiche a dodici per volta, quindi il tempo e'
quello di due o tre attese sovrapposte, non della loro somma.

### Limiti di API-Football, piano gratuito

- 100 chiamate al giorno, azzerate a mezzanotte UTC
- **10 al minuto**: e' questo che morde, non il totale. Il ciclo non aspetta il
  minuto: il lotto successivo lavora di sola AI mentre la quota si ricarica
- **al massimo tre pagine** per richiesta paginata, e **la stagione in corso non
  c'e'**: copre dal 2022 al 2024. Le squadre quindi si cercano per nome
  (`/teams?search=`), che non ha stagione — gli id non cambiano di anno in anno —
  e non per campionato e stagione, che darebbe la Serie A di due anni fa
- la ricerca per nome restituisce anche le **squadre femminili**, distinte solo
  da una "W" in coda: senza escluderle, "Roma" pesca "Roma W" e ventitre
  titolari risultano fuori rosa
- **serve una sola annata**, la penultima. L'ultima e' dichiarata da `/leagues` e
  poi risponde vuota. Il software se ne accorge e **se lo ricorda** in `app_state`:
  richiederla ogni lotto costava una chiamata a giro, cioe' un quarto della quota
  giornaliera per riavere una lista che cambia una volta l'anno
- un'annata si dichiara muta **solo se e' arrivata una risposta vuota davvero**,
  su almeno tre giocatori diversi. Prima ci finivano anche i rifiuti da limite al
  minuto, e bastavano due 429 perche' un'annata buona venisse saltata per tutta
  la corsa
- a quota finita **smette di rispondere anche a `/status`**: la quota esaurita si
  riconosce dal messaggio e si mostra come contatore a zero, non come guasto

### Costi AI, misurati

`npm run check:bench` gira lo stesso compito reale — identificare dieci
giocatori dal nome abbreviato — in configurazioni diverse, e riporta costo,
token, tempo e quanti ne azzecca. Due giri, sulla produzione:

| Configurazione | Costo | di cui ricerca | Trovati |
|---|---|---|---|
| senza ricerca web | $0.00153 | — | 6,5/10 |
| motore default ×10 | $0.00885 | $0.00700 | 4,5/10 |
| **exa ×10** (in uso) | **$0.00895** | $0.00700 | **8,5/10** |
| parallel ×5 | $0.00632 | $0.00500 | 5,0/10 |
| perplexity ×5 | $0.00659 | $0.00500 | 6,5/10 |
| llama-3.3-70b via Groq | $0.01254 | — | 5,0/10 (10/10 al primo giro) |
| gpt-oss-20b | $0.00796 | $0.00700 | JSON illeggibile, 41 s |
| claude-haiku-4.5 | $0.02173 | $0.00700 | 0/10 |

Tre cose che il progetto credeva e che la misura ha smentito:

- **La ricerca web non si fattura a risultato**, si fattura a richiesta:
  $0.00700 fissi, identici con cinque risultati e con dieci. Per mesi il codice
  ne ha chiesti due per risparmiare, pagando dieci prove e usandone due.
- **Il motore di default non e' `exa`**, e a parita' di prezzo trova la meta'.
  Chiederlo esplicitamente raddoppia i risultati e non costa niente.
- **Un modello piu' economico non fa risparmiare.** I token sono il 20% del
  conto e i modelli economici falliscono il compito: `gpt-oss-20b` non produce
  JSON valido, `haiku 4.5` costa 2,4 volte e non trova nessuno. Groq, su
  OpenRouter, e' il fornitore **piu' caro** di Llama 3.3 70B ($0.59/$0.79 per
  milione contro $0.10/$0.32 di DeepInfra): vende latenza, e la latenza qui non
  e' il vincolo.

La voce dominante resta **la ricerca web**, e l'unico modo di ridurla e' fare
meno chiamate — non farle costare meno.

### L'identita' e' incerta, e la fiducia dichiarata non lo dice

Il banco riporta anche dove le configurazioni non sono d'accordo, e su dieci
giocatori difficili se ne contraddicono nove:

```
Adzic      dejan / petar / nemanja / adrian / nikola      5 nomi su 5 giri
Zeballos   alan / exequiel / facundo / mateo
Sugawara   yukinari / kaito / riku
Daffara    andrea / alessandro / davide
Braganca   tiago / vitor hugo / vitor
Kvernadze  giorgi ×4                                      l'unico stabile
```

Concordano sul cognome — che pero' ce lo dava gia' il listone — e **inventano il
nome, dichiarando "fiducia alta" mentre lo fanno**. E' lo stesso difetto visto
su Woltemade e su Molina, adesso quantificato: l'autovalutazione del modello non
e' una verifica, e non va usata come tale.

Per questo la prossima fonte da aggiungere e' Wikidata: non per risparmiare, ma
perche' l'identita' e' il passo dove sbagliamo di piu' e l'unico dove esiste una
fonte gratuita e verificabile.

## Lo storico di carriera

`player_stats` tiene i numeri, `player_career` tiene il racconto **comprese le
stagioni senza numeri**. La differenza conta: un ventenne al secondo anno da
professionista non ha "dati mancanti" per il 2022-23, semplicemente non giocava
ancora. Trattare le due cose allo stesso modo penalizza i giovani e premia chi ha
una carriera lunga e mediocre.

Ogni stagione porta uno stato: `campionato`, `prestito`, `giovanili`,
`infortunio`, `fuori-rosa`, `non-professionista`, `sconosciuta`. La prima stagione
fra i professionisti e' segnata come debutto.

Esempio ricostruito:

```
Goncalo Ramos   2020-21 Benfica (debutto) · 2021-23 Benfica · 2023-26 Paris Saint-Germain
Woltemade       2020-21 Werder Brema giovanili (debutto) · 2021-22 Werder II · 2022-25 Bundesliga
```

**Attenzione**: la carriera e' contesto, non il dato su cui si calcola il prezzo.
Il modello riempie i buchi con quello che sembra plausibile e a volte sbaglia
(nella carriera di Woltemade il 2025-26 dice Juventus, ed e' falso). Per questo
ogni riga porta la fiducia dichiarata, e i numeri restano ancorati alle fonti
verificabili.
