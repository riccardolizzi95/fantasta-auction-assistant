# Prossimi passi

Due lavori richiesti: il primo e' fatto e qui resta quello che ne e' rimasto
fuori, il secondo e' ancora tutto da fare.
Leggi prima [CLAUDE.md](../CLAUDE.md), [MOTORE.md](MOTORE.md) e [DATI.md](DATI.md).

---

## A. Un pulsante che risolve tutti i giocatori al buio — fatto

Il pulsante c'e' e lavora a lotti da venti, dal piu' quotato al meno quotato,
mostrando l'avanzamento e fermandosi a comando. Come funziona e quanto costa sta
in [DATI.md](DATI.md#le-fonti-esterne); qui restano solo le cose non fatte.

**La strada scelta e' stata la prima delle tre, il ciclo guidato dal browser**,
ma costruita in modo che la seconda costi poco: e' il server a scegliere il lotto,
quindi un cron sarebbe un chiamante in piu' dello stesso endpoint, non un secondo
percorso da tenere allineato. Finche' il recupero e' preparazione all'asta e dura
tre minuti, una scheda aperta e' un prezzo onesto; il giorno in cui dovesse girare
di notte, la coda su tabella si innesta senza spostare logica.

### Cosa e' venuto fuori misurando

- Venti giocatori per lotto stanno al **41% dei 60 secondi**. Il tempo non e'
  proporzionale ai giocatori: identificazione a gruppi di sei in parallelo e
  statistiche a dodici per volta, quindi contano due o tre attese sovrapposte.
- **Il tetto dei token dell'identificazione era troppo basso** e tagliava la
  risposta a meta' — sei giocatori persi per volta, con l'aria di essere colpa
  del modello. Adesso il budget segue la dimensione del gruppo, misurato sulle
  identita' vere.
- **`availableSeasons` costava una chiamata a lotto**: su ventisei lotti, un
  quarto della quota giornaliera per una lista che cambia una volta l'anno.
- Il piano gratuito **serve una sola annata**, non due: il costo per giocatore e'
  di due chiamate, non tre.

### Cosa resta

- **Altre fonti.** Il ciclo e' lo scheletro in cui si innestano, e ognuna allarga
  il budget giornaliero e permette il riscontro incrociato (punto B).
  - **Wikidata / Wikipedia** — gratuita, senza chiave, senza limiti pratici, e
    ottima proprio per l'**identita'**: data di nascita, nazionalita', squadre per
    anno. Renderebbe il primo passo quasi gratuito e piu' affidabile dell'AI,
    lasciando il modello ai casi difficili. **Da fare per prima**: e' anche il
    passo dove l'AI ha sbagliato di piu' (Woltemade battezzato "Sergiusz").
  - **Understat** — gratuita, prime cinque leghe europee, ha gli expected goals.
  - **football-data.org**, **Highlightly**, **TheStatsAPI** — piani gratuiti con
    quote proprie: ruotando i fornitori il tetto giornaliero si somma.

  Ogni nuova fonte va dietro l'interfaccia gia' esistente: produce righe
  `player_stats` con `source` e `source_detail`, la precedenza fra fonti la decide
  `preferBestSource` in `src/lib/fanta/externalStats.ts`, e il ramo nuovo si
  aggiunge accanto agli altri due in `apiLane`/`aiLane`.

- **I rinunciati.** Dopo due tentativi a vuoto per canale il ciclo smette e li
  conta. Sono quasi tutti riserve da un credito, ma nessuno li ha ancora guardati
  in faccia: varrebbe una lista dedicata, con l'inserimento manuale accanto.

- **Il contatore dell'archivio parte da zero ogni giorno anche se la giornata e'
  gia' stata spesa altrove.** Se ne accorge solo quando l'API rifiuta, e allora si
  porta al tetto. Va bene finche' il recupero e' l'unico a consumare quota.

---

## B. Rendere piu' certe le informazioni incerte

**Cosa serve.** Oggi ogni riga porta una fiducia dichiarata dal modello, che e'
un'autovalutazione: utile ma non una verifica. Serve un modo per **accertare**.

### Quello che gia' sappiamo che non va

- L'AI ha battezzato Woltemade "Sergiusz", poi "Niclas" dall'archivio: il nome
  giusto e' arrivato solo perche' l'API lo conosceva.
- Nella carriera di Woltemade il 2025-26 dice "Juventus, Serie A": falso, e'
  arrivato nel 2026-27. Il modello riempie i buchi con cio' che sembra plausibile.
- Su cognomi comuni la prima identificazione produceva nomi verosimili e sbagliati
  ("Nicolás Molina" invece di Nahuel).

### Tre livelli di verifica, dal piu' economico

**1. Coerenza interna** — gratis, va fatta comunque.
Regole che colgono le allucinazioni senza chiamare nessuno: gol ≤ presenze × 3,
minuti fra 45 e 95 per presenza, presenze ≤ giornate del campionato, rigori
segnati ≤ gol, un portiere con clean sheet > presenze. Una riga che le viola non
va scritta: e' inventata.

**2. Coerenza fra le nostre stesse fonti** — gratis.
La carriera dice "PSG 2024-25" e le statistiche dicono "Ligue 1 2024-25": si
tengono. Se le statistiche dicono "Premier League" mentre la carriera dice PSG,
qualcosa non torna e va segnalato. Stesso discorso fra anno di nascita e stagione
di debutto (un debutto a 14 anni non esiste).

**3. Riscontro fra fonti indipendenti** — costa, ma e' quello che da' certezza.
Due fonti che concordano valgono molto piu' di una fonte sicura di se'.
Combinazioni utili: Wikidata contro AI per l'identita'; API-Football contro AI per
i numeri; due modelli diversi sulla stessa domanda.

### Come rappresentarlo

Serve uno **stato di verifica** esplicito accanto alla fiducia dichiarata, per
esempio su `player_stats.source_detail` e su `player_identities`:

| Stato | Significato |
|---|---|
| `non-verificato` | una fonte sola, nessun riscontro |
| `coerente` | supera i controlli interni e non contraddice le altre nostre righe |
| `confermato` | due fonti indipendenti concordano |
| `contraddittorio` | due fonti dicono cose diverse: serve l'occhio umano |

E il peso nel motore dovrebbe seguirlo: oggi `SOURCE_TRUST` in
`src/lib/fanta/conversion.ts` sconta solo per fornitore (`ai` vale 0.65), e sarebbe
piu' giusto scontare per **stato di verifica**, che e' l'informazione vera.

### Cosa mostrare

Una coda di revisione per i `contraddittorio`: giocatore, cosa dice una fonte,
cosa dice l'altra, e i pulsanti per scegliere. Sono pochi casi, ma sono
esattamente quelli su cui il software rischia di far sbagliare l'asta — e trenta
secondi di controllo umano li chiudono.

---

## Come muoversi

Il progetto ha una regola che ha ripagato ogni volta: **misurare invece di
supporre**, e mettere la misura in uno script rilanciabile. Prima di cambiare una
costante o scegliere una fonte, si guarda cosa dicono i dati veri — il listone e'
caricato, gli script ci sono.

Prima di dire che qualcosa funziona, va **provato sul percorso vero**: un bug e'
arrivato in produzione con tutti i test verdi perche' lo script di verifica
riscriveva la logica della route invece di chiamarla.
