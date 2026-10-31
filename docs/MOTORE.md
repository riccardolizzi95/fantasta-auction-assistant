# Il motore di valutazione

Il prezzo non esce da una tabella: viene ricostruito a ogni chiamata, per quella
lega e per quella strategia. Questo documento spiega ogni passaggio e **da dove
viene ogni numero**.

## 1. Proiezione

Dalle statistiche delle stagioni note si stimano presenze, media voto e
fantamedia attese.

**Le stagioni si fondono con peso decrescente** (`SEASON_WEIGHTS`): 100%, 55%,
30%, 17%, 9%. Il peso viene moltiplicato per le presenze effettive, quindi una
stagione vecchia giocata poco pesa pochissimo da sola. I conteggi diventano tassi
per presenza, mediati, e riportati sul campione complessivo.

**La stagione in corso e' un caso a parte.** Se il campionato e' gia' iniziato,
il software se ne accorge (deduce le giornate dal massimo delle presenze) e la
tratta diversamente dalle altre:

- sulla **fantamedia** pesa `presenze x presenze/(presenze+6)`: alla seconda
  giornata vale 0.5, verso meta' girone comanda sul passato. Una doppietta
  all'esordio sposta la stima di due decimi, non di due punti — mentre gli altri
  all'asta la pagheranno tutta;
- sulle **presenze attese** pesa subito e molto: due giornate non dicono quanto
  rendera' in un anno, ma dicono benissimo se il posto da titolare ce l'ha adesso.
  Chi non compare affatto nel file di quest'anno viene penalizzato, con un po' di
  prudenza in meno perche' potrebbe mancare la riga, non il giocatore.

**Chi non ha statistiche** viene stimato dal percentile della sua quotazione nel
ruolo, letto sulla distribuzione di chi i dati ce li ha, e tirato del 30% verso
la media perche' e' una stima.

## 2. Regressione verso la media

Anche una stagione intera misurata bene sovrastima il futuro: solo una parte
dello scarto dalla media si ripete. Quanta, dipende dal ruolo.

**Misurato sulla Serie A 2024-25 → 2025-26**, giocatori con almeno 20 presenze in
entrambe:

| Ruolo | Correlazione fantamedia | Casi |
|---|---|---|
| Difensori | **0.38** | 48 |
| Centrocampisti | **0.49** | 54 |
| Attaccanti | **0.56** | 16 |
| Portieri | campione troppo piccolo (10), si usa 0.35 | — |

La fantamedia di un difensore e' per quasi due terzi rumore che non si ripete.
Prenderla per buona significa pagare la fortuna dell'anno prima: prima di questa
correzione i difensori risultavano al 29% del mercato e gli attaccanti al 24%.

La regressione tiene conto di quante stagioni ci sono: con `k` stagioni
equivalenti nel campione, la correlazione effettiva e' `p / (p + (1-p)/k)`. Piu'
storico c'e', meno serve tirare verso la media.

`npm run check:persistence` rimisura i coefficienti sui dati caricati.

## 3. Livelli di riferimento

Misurati sui titolari (20+ presenze) di due stagioni:

| Ruolo | Media voto | Fantamedia | Casi |
|---|---|---|---|
| Portieri | **6.22** | **5.11** | 26 |
| Difensori | 5.98 | 6.07 | 143 |
| Centrocampisti | 6.05 | 6.36 | 158 |
| Attaccanti | 6.10 | 6.85 | 56 |

Il portiere e' il ruolo che sorprende: prende i voti piu' alti di tutti ma ha la
fantamedia piu' bassa, perche' ogni gol subito vale −1. I valori a occhio che
c'erano prima (5.90 e 5.55) sbagliavano di tre e quattro decimi proprio li'.

Gol subiti da un portiere titolare: **1.20 a partita** in media, fra 0.74 e 1.78.

## 4. Valore sul rimpiazzo

Quello che conta non e' quanto rende un giocatore, ma quanto rende **in piu' di
quello che prenderesti gratis** al suo posto.

Il rimpiazzo va cercato **con la stessa metrica con cui poi lo si confronta**.
Ordinare per punti stagionali (presenze × fantamedia) e usare il risultato come
soglia di *fantamedia* mescola due scale: cosi' al posto del rimpiazzo finiva un
giocatore da tante presenze e poca resa, e 435 giocatori su 533 risultavano
"sopra il rimpiazzo". Ora si ordina per fantamedia, si escludono i campioni sotto
le 19 presenze — il sostituto che trovi gratis e' uno che gioca — e si prende la
**media locale** di qualche giocatore attorno alla soglia: un solo nome e' rumore
e sposterebbe il prezzo di tutto il reparto.

```
vor = (presenze attese / 38) × [ max(0, fantamedia − rimpiazzo) + bonus modificatore ]
prezzo = 1 + vor × (crediti da spartire / somma di tutti i vor)
```

## 5. Dove mettere l'asticella

Fra "ultimo titolare" e "ultimo slot di panchina" c'e' un abisso: con la prima i
crediti si concentrano su una sessantina di nomi, con la seconda si spalmano su
tutti e il migliore non vale niente.

Quanto stare in mezzo **non e' una proprieta' dei giocatori ma del formato
d'asta**, e si cerca per bisezione. Il bersaglio pero' conta piu' del metodo.

**Il listino ufficiale e' il bersaglio sbagliato.** Il Fantavalore e' un
prezziario: dice quanto un giocatore *vale*, non quanto qualcuno alza la mano per
prenderlo. Misurato:

| | modello tarato sul listino | asta vera |
|---|---|---|
| il piu' caro, budget 500 | 141 | Lautaro Martinez **240**, David **280** |
| quota dei primi 20 | 33.5% | — |
| quota dei primi 20 nel listino | 29.4% | — |

Il 3.3% del primo giocatore contro il 3.2% del listino non e' una coincidenza: e'
la bisezione che fa il suo lavoro sul bersaglio sbagliato. Chi seguiva quei
prezzi perdeva tutti i top e restava con i crediti in mano.

**Il bersaglio giusto sono i prezzi di un'asta vera di quella lega.** Bastano due
o tre — si inseriscono nelle impostazioni — e la bisezione tara su quelli. Senza,
resta il listino, che e' meglio di niente. Sui dati reali, con 280 e 240 come
ancore: Lautaro passa da 141 a 229, Dimarco da 95 a 187, e il centesimo giocatore
scende da 5 a 1.

Quella seconda meta' e' automatica e conta quanto la prima: **i crediti in palio
sono sempre gli stessi**. Se i top costano il doppio, tutti gli altri costano
meno, ed e' li' che si trovano gli affari mentre gli avversari si svenano in
apertura.

Se nemmeno la concentrazione massima raggiunge le ancore, il modello si ferma li'
e non inventa: dira' meno del vero, ma quello che dice sta in piedi. Misurato, il
massimo che sa fare e' 229 su un budget di 500.

`npm run check:prices` mostra la curva, la confronta con il listino e con i
prezzi d'asta, e misura fin dove arriva la manopola.

**Attenzione a non contare due volte.** Un prezzo pagato contiene gia' la
pressione del mercato: Lautaro e' andato a 240 perche' tutti volevano un
attaccante e ce n'erano tre. Quando i valori sono tarati su prezzi veri, la
scarsita' (§7) si misura come **variazione** rispetto al mercato intatto —
all'apertura vale uno — invece che come livello assoluto. Senza questa
distinzione il prezzo giusto usciva a 381 su un giocatore costato 240.

## 6. Modificatore di difesa

Se attivo, la media voto di portiere e difensori vale punti veri: il modificatore
sposta circa 4 punti passando da 6.0 a 7.0 di media difesa, e la media e' fatta
su cinque giocatori, quindi il singolo ne muove 0.8 per punto di media voto.

**Il vantaggio va misurato contro il difensore che prenderesti gratis, non contro
gli altri titolari.** La prima versione faceva il contrario e il modificatore
*abbassava* il valore dei difensori: alzando tutto il reparto insieme, il
vantaggio relativo spariva.

Con i dati veri, accendendolo: difensori dal 20.6% al 24.9% del mercato, portieri
dal 5.9% all'8.9%, attaccanti dal 42.1% al 36.9%. Il listino ufficiale non lo sa —
e' calcolato per leghe senza modificatore — quindi in quelle leghe i difensori
bravi sembrano sempre sottovalutati. Lo sono, per te.

## 7. Il mercato, in tempo reale

**L'inflazione e' a somma zero.** I crediti in circolazione sono fissi e alla fine
vengono spesi tutti, quindi la domanda giusta non e' "quanto si e' pagato finora"
ma **quanti soldi restano rispetto al valore che resta**. Se in apertura ci si
svena sugli attaccanti, tutto il resto dell'asta va automaticamente a sconto: e'
li' che si vincono le aste.

Il singolo ruolo si scosta dalla media generale in proporzione a quanto e' stato
pagato, attenuato finche' gli acquisti registrati in quel ruolo sono pochi.

**Il tetto degli avversari**: non serve mai offrire piu' di un credito sopra il
massimo che un rivale *puo'* pagare, tenuto conto che deve completare la rosa.

**La scarsita'**: quante squadre cercano ancora un giocatore di quella fascia
contro quanti ne restano.

## 8. Il consiglio

```
prezzo giusto = valore base x moltiplicatore strategia x inflazione x scarsita'
apri a        = 85% del prezzo giusto
```

**Il tetto e' la parte che conta, e non e' una percentuale del prezzo giusto.**
Lo era: il 112%. Su un attaccante da 110 crediti voleva dire fermarsi a 123,
mentre in un'asta vera un top va a piu' del doppio. Non era una taratura
sbagliata, era la domanda sbagliata — **quanto conviene pagarlo non dipende da
quanto vale lui, dipende da cosa faresti dei crediti se lo perdessi**.

```
premio       = prezzo giusto - prezzo del miglior ricambio ancora libero
non superare = min( prezzo giusto + premio,
                    tetto del piano x (1 + premio/prezzo giusto),
                    crediti disponibili,
                    tetto dei rivali + 1 )
```

Se al suo posto ne resta uno quasi uguale, perderlo costa poco e il tetto resta
basso. Se non resta nessuno, il ripiego e' un giocatore da un credito, il premio
e' tutto il suo valore e il tetto sale a coprirlo. **Cosi' si muove da solo con
l'asta** invece di stare fermo. Anche il piano di spesa cede dove non ci sono
ricambi: e' li' che concentrare ha senso, ed e' esattamente il momento in cui un
tetto rigido fa perdere l'asta.

Misurato sul primo attaccante, budget 500:

| Strategia | ricambi liberi | ricambi finiti |
|---|---|---|
| equilibrata | 174 | **346** |
| attacco forte | 218 | **405** |

Il ripiego viene detto per nome, con il prezzo e con la differenza — "Malen
dovrebbe andare intorno a 294, rende quanto lui quando gioca ma ha sei presenze
attese in meno ed e' in una squadra piu' debole" — perche' sapere che ne esiste
uno piu' economico non serve se non si sa cosa si perde.

Quando la fascia si svuota il verdetto lo dichiara (`ULTIMO_DELLA_FASCIA`) e
suggerisce di spostare i crediti da un altro reparto se il tetto non basta.

**Prezzo giusto sopra il tetto non e' una contraddizione**: uno dice quanto vale,
l'altro quanto puoi impegnarci adesso senza restare scoperto dopo. Il consiglio
lo scrive, distinguendo "il piano ti ferma finche' ci sono ricambi" da "oltre non
puoi andare, i crediti vanno presi altrove".

## 9. Chi c'e' dall'altra parte

Il tetto del rivale entra nel consiglio in due modi opposti, e l'unico modo di
tenerli insieme e' sapere **quanto puo' arrivare davvero** chi lo vuole:

- **fin dove devi arrivare tu.** Un credito sopra il tetto del migliore fra loro
  basta a portarselo a casa: tutto quello che si offre oltre non compra niente
  che non fosse gia' comprato;
- **fin dove puoi spingerlo tu.** Un giocatore che non ti serve lo stai
  comprando due volte, una in crediti tuoi e una in crediti che togli a lui. Il
  rischio pero' e' preciso e va detto: **se molla, te lo ritrovi in rosa**.

Il tetto di un avversario non e' quanto ha in cassa. Uno che ha gia' due
attaccanti titolari non spende per il terzo quello che spenderebbe per il primo,
per quanto sia ricco:

```
tetto = min( massimo che puo' offrire,
             max( quanto il piano neutro gli concede su quel ruolo,
                  valore del giocatore x quanto ha gia' pagato sopra il valore ))
```

L'ultimo termine e' venuto da una misura scomoda. Un tetto calcolato **solo** sul
piano razionale sottostima gli avversari: fermandosi li' si perdono 0.2
punti/giornata e mezzo migliaio di crediti di giocatori che si volevano. Non e'
un errore di formula, e' che all'asta la gente non e' razionale — e questo si
vede, perche' l'ha appena fatto quindici volte davanti a te. Corretto con quanto
ciascuno ha gia' pagato in **questa** asta (tirato verso 1 finche' gli acquisti
sono pochi), fermarsi al tetto fa risparmiare ~50 crediti a testa senza perdere
un punto.

Sul rilancio la misura e' altrettanto chiara e va detta cosi' com'e': su
un'asta intera vale **+0.0 punti/giornata**. Scatta poche volte — mentre riempi
la rosa quasi tutto quello che valuti lo vuoi — e quando scatta sposta poco.
Per questo il software lo mostra come informazione con il rischio in chiaro, e
non come una spinta ad agire.

## 9b. Che il contesto comandi davvero

Un motore puo' vincere anche dando sempre lo stesso numero, se quel numero e'
buono. `npm run check:contesto` fa la domanda piu' esigente: **un acquisto
registrato fa divergere i consigli?**

La prima misura ha trovato tre ingredienti addormentati.

- **La domanda contava gli slot liberi, non il bisogno.** Con sei attaccanti da
  riempire lo slot libero ce l'hanno tutti fino alla fine, quindi la domanda
  restava incollata a sette e la scarsita' non si muoveva mai: dopo sei acquisti
  registrati cambiava in 1 caso su 15. Ora un avversario si contende un
  giocatore solo se **gli manca ancora uno di quella fascia** — quanti ne vuole
  ciascuno si ricava dalla fascia stessa (cinque giocatori e otto squadre: la
  maggior parte ne prende uno, e chi ce l'ha e' servito).
- **Il tetto dei rivali era il massimo che il piu' ricco poteva pagare**, e con
  otto squadre da cinquecento crediti bastava che una non avesse ancora speso
  perche' quel numero non vincolasse mai niente. Ora il tetto e' quello di chi
  quel giocatore lo vuole davvero, corretto con quanto ha gia' pagato sopra il
  valore in questa stessa asta — ed **entra nel tetto d'offerta**, non solo nel
  testo: non serve mai offrire piu' di un credito sopra di lui.

Dopo, sulla prova che conta — comprare i tre sostituti piu' vicini a lui:

| | prima | dopo |
|---|---|---|
| consigli che cambiano | — | **19 su 20** |
| spostamento del tetto | ~0 | **11 crediti in media** |

e in concreto: McTominay passa da "giusto 151, tetto 89" a "giusto 220, tetto
119" appena i tre centrocampisti piu' simili a lui spariscono dal listone.

Il tetto d'offerta ora e' quasi sempre legato al tetto degli avversari, quindi
si muove meno del prezzo giusto: e' voluto. Uno dice quanto vale, l'altro quanto
basta per prenderlo, e pagare piu' di quanto basta non compra niente. Che non
faccia perdere giocatori lo dice `check:asta`, dove la quota di margine
catturato sale dal 76% al **78%**.

## 10. Chi ha parlato

Il banditore non sempre dice a chi va, e i rilanci arrivano dalla stanza. La
catena e' quella classica del riconoscimento del parlante — pre-enfasi, banco di
filtri mel fra 300 e 3800 Hz, DCT — e l'impronta e' media e dispersione dei
dodici coefficienti. Nessun modello scaricato: gira su un telefono e non manda
la voce di nessuno da nessuna parte (le impronte restano in `localStorage`).

### Si legge un testo, e sempre lo stesso

L'impronta e' fatta su **cio' che si e' pronunciato**: chi all'iscrizione dice
due vocali ha mappato due vocali, e all'asta ne usa sette. E se ognuno dice una
frase diversa, una parte della distanza fra due impronte non e' la differenza
fra le due persone ma la differenza fra le due frasi.

Quindi si legge un testo unico (`src/lib/fanta/testoDaLeggere.ts`) che tocca
tutte le vocali, le occlusive sorde e sonore, le fricative, le affricate, le
nasali, la laterale, la palatale, la vibrante e le doppie — con dentro i numeri
e le parole dell'asta, che sono quelle che si diranno davvero. Misurato su otto
voci sintetiche, con le frasi di prova identiche fra i due modi (`npm run
check:voci`):

| iscrizione | riconosciuti | sbagliati | stacco fra la propria impronta e le altre |
|---|---|---|---|
| dicendo qualcosa | 79% | 3% | 0.863 |
| **leggendo lo stesso testo** | **84%** | **1%** | **0.916** |

Sapere che testo doveva leggere serve anche a controllarlo: il riconoscimento
del parlato del browser gira in parallelo e confronta. Non serve che la
trascrizione sia giusta — serve solo a distinguere "l'ha letto" da "ha
borbottato" o "il microfono non lo sente", e quella distinzione regge anche con
una trascrizione mediocre. Le due meta' della lettura restano separate, e quanto
si somigliano dice se quell'iscrizione vale qualcosa.

### Come regge, iscritti cosi'

320 prove per riga, su frasi che quella voce all'iscrizione non aveva detto:

| | riconosciuti | sbagliati | "non lo so" |
|---|---|---|---|
| stanza silenziosa | 85% | 1% | 14% |
| un po' di rumore | 85% | 1% | 14% |
| stanza rumorosa | 80% | 1% | 18% |
| stanza molto rumorosa | 61% | 3% | 36% |
| parla piu' piano | 85% | 1% | 14% |
| parla molto piu' forte | 85% | 1% | 14% |

Due cose che il numero ha deciso al posto dell'intuito:

- **Centrare sulle voci della lega.** Due voci diverse si somigliavano comunque
  allo 0.49 e una voce alla propria impronta allo 0.99: quasi tutto il coseno
  era occupato da cio' che le voci umane hanno in comune. Togliendo a ogni
  impronta la media di quelle iscritte, resta solo cio' che distingue una
  persona, e lo stacco passa da 0.508 a **0.91**.
- **L'asticella non e' una costante.** Dire "e' Marco e non Luca" e' facile se
  hanno voci diverse e impossibile se sono fratelli: lo stacco richiesto si
  calcola sulla **coppia in ballo**. Quello che non passa diventa "non lo so",
  che all'asta costa un tocco invece del budget di due squadre — ed e' per
  questo che nella tabella la colonna che conta e' quella degli sbagliati.

### Tre cose provate e buttate

Stanno scritte perche' valgono quanto quelle tenute, e perche' altrimenti
qualcuno le riprova.

- **Sottrazione spettrale del rumore** (stimarlo dalle pause e toglierlo prima
  del logaritmo): peggiora quasi tutto — in stanza molto rumorosa dall'88% al
  74%, e con voci simili gli errori dal 5% al 27%. Il lavoro lo fa gia' il
  centraggio: il rumore della stanza e' lo stesso per tutti, quindi finisce
  nella media e viene tolto li'. Sottrarlo di nuovo toglie anche il fondo
  spettrale di ciascuno, che invece **e'** informazione sul parlante.
- **Coefficienti delta**: nessun effetto. Le percentuali restano identiche in
  tutte e sei le condizioni — i delta sono un ordine di grandezza sotto le medie
  e dopo la normalizzazione pesano quasi zero.
- **Pretendere che il primo posto arrivi vicino a quanto una voce somiglia a se
  stessa**: dallo 0% all'80% della stabilita' gli errori restano all'8%, e sopra
  si perdono solo riconoscimenti giusti. I riconoscimenti sbagliati non sono
  quelli con un punteggio basso: sono quelli in cui due impronte sono davvero
  vicine, e quello lo intercetta gia' l'asticella sulla coppia.

Il banditore non va indicato: e' chi parla piu' di tutti, e si scopre da solo
dopo una ventina di interventi. L'ultima voce che non e' la sua e' chi ha alzato
la mano.

Quanto ci prende davvero non lo dice questo documento: dipende dalle voci vere e
dalla stanza vera, e lo misura l'app nelle impostazioni della lega.


## 11. Piu' microfoni nella stessa stanza

Se all'asta il software e' aperto su piu' computer, ognuno sta ascoltando la
stessa voce da un punto diverso: il banditore puo' essere limpido su un
portatile e impastato sull'altro, e chi rilancia seduto vicino a Marco e'
fortissimo sul computer di Marco. Sono **osservazioni indipendenti dello stesso
fatto**, ed e' la situazione in cui unirle vale piu' della somma.

Viaggia solo l'ipotesi gia' formata — "ho sentito Lautaro a 180, credo per
Marco" — su un canale di transito che non tocca il database: sono cose che
valgono pochi secondi, e quello che resta e' l'acquisto registrato, che passa
dalla sua strada. Le **impronte vocali non viaggiano**: sono dati personali, e
per giunta sono tarate sul microfono di quel dispositivo, quindi scambiarle
peggiorerebbe il riconoscimento invece di migliorarlo.

Ogni campo si decide in modo diverso, perche' i tre campi non hanno la stessa
natura: il **giocatore** a maggioranza pesata per quanto ciascuno era sicuro; il
**prezzo** al piu' alto fra chi concorda sul giocatore, perche' in un'asta il
prezzo puo' solo salire e chi ha sentito meno ha semplicemente perso un
rilancio; l'**acquirente** a maggioranza semplice.

Misurato su tre postazioni di qualita' diversa (`npm run check:ascolto`, la
prima e' la nostra):

| | da solo | fondendo |
|---|---|---|
| due computer, chiamata intera giusta | 52% | **61%** |
| tre computer | 52% | **65%** |
| quattro computer | 52% | **85%** |
| tre computer, ma la nostra postazione e' la peggiore | 6% | **65%** |

L'ultima riga e' la piu' interessante: un portatile messo male passa da inutile
a buono come il migliore della stanza.

Una cosa e' stata provata e buttata: pesare il voto sull'acquirente per **quanto
forte** ciascuno aveva sentito. Sembrava ovvio — chi era vicino a chi ha alzato
la mano ha visto la scena — ma misurato peggiorava, dall'81% al 74%, perche' un
microfono che sente forte e capisce male vince comunque il voto. Che il volume
dica qualcosa sulla verita' resta una supposizione, e non se ne tiene conto.


## 12. Tre cose misurate, e due venute al contrario

### I minuti giocati non prevedono le presenze

Una presenza non e' una titolarita', e trenta partite da trenta minuti non
valgono trenta da novanta: sembrava ovvio che i minuti dovessero entrare nella
proiezione. Misurato su 240 coppie di stagioni consecutive vere (`npm run
check:titolarita`), non e' cosi' — i minuti non aggiungono niente alle presenze
da sole (9.04 contro 9.03 di errore medio), e nemmeno le titolarita' vere, dove
le abbiamo (7.68 contro 7.70).

Guardando pero' lo scarto **col segno** e' saltato fuori qualcosa di piu' utile:
il correttivo sui minuti che c'era gia' nel motore, scelto a mano, spingeva
dalla parte sbagliata.

| minuti a partita, l'anno prima | presenze promesse in piu' del vero | presenze vere |
|---|---|---|
| meno di 30' | **-6.7** | 23.1 |
| fra 30' e 55' | +0.1 | 18.7 |
| fra 55' e 75' | +2.5 | 21.9 |
| piu' di 75' | **+3.2** | 23.5 |

Chi giocava meno di trenta minuti l'anno dopo fa 23 presenze, non meno: o si e'
guadagnato il posto o e' andato dove gioca. Tolto il correttivo, l'errore medio
scende da 8.98 a **8.71** e lo scarto sui titolari fissi si dimezza. Il
fenomeno vero e' la regressione verso la media, che qui gia' comanda: tirare
piu' forte (provato fino a 0.7) raddrizza i panchinari e storta tutti gli altri.

### I gol su rigore si ripetono piu' di quelli su azione

L'ipotesi era che una fantamedia gonfiata dai rigori fosse piu' fragile di una
fatta di gol su azione, e andasse scontata. E' l'opposto (`npm run
check:rigoristi`, 387 giocatori che segnavano):

| | l'anno prima | l'anno dopo | si ripete |
|---|---|---|---|
| gol su rigore | 179 | 108 | **60%** |
| gol su azione | 1788 | 822 | 46% |

E chi ne ha tirati almeno tre l'anno dopo ne tira 1.6 in media, contro 0.1 di
chi non ne ha tirato nessuno: sedici volte tanto.

Quindi niente sconto — e nemmeno un bonus, perche' i rigori dell'anno scorso
sono **gia' dentro** la sua fantamedia dell'anno scorso e sommarli li
conterebbe due volte. Quello che mancava era dirlo: la scheda ora scrive "Tira
lui i rigori: 6 su 7 della squadra nel 2025-26". Rigorista e' chi ne ha tirati
almeno due, segnati o sbagliati, e piu' di chiunque altro nella sua squadra:
uno solo puo' essere il rigore battuto perche' quel giorno il titolare non
c'era.

### Il nome per esteso era gia' nostro

Su 500 identita', 468 vengono dall'archivio e solo 150 avevano il nome per
esteso. Ma nome, cognome e data di nascita arrivano **nella stessa risposta**
che scarichiamo per le statistiche: finivano nel cestino. Salvarli costa zero
chiamate in piu'.

| | prima | dopo |
|---|---|---|
| nomi per esteso | 181 | **420** |
| anni di nascita | 228 | **419** |
| listone cercabile per nome di battesimo | 32% | **77%** |

Si riempiono solo i campi vuoti: quello che c'e' gia' viene da una fonte che
qualcuno ha scelto, e l'archivio non e' piu' affidabile di lei.


## 13. Quanto vale per te, non quanto vale

Il prezzo lo fa il mercato, e il motore lo calcola contro un rimpiazzo teorico
uguale per tutti. Ma quanto un giocatore ti serve dipende da cosa hai gia': il
quarto attaccante buono vale meno del primo perche' in campo ne schieri tre, e
il secondo portiere di una squadra non vale quasi niente perche' di portieri se
ne schiera uno.

`src/lib/fanta/formazione.ts` calcola i punti attesi della formazione che
scenderesti in campo — la stessa misura con cui `check:asta` decide chi ha
fatto l'asta migliore — e per differenza quanto un giocatore ci aggiunge.
Misurato sul caso limite:

| | punti a giornata aggiunti |
|---|---|
| un secondo portiere, in una rosa vuota | 0.12 |
| lo stesso, se hai gia' un titolare | **0.00** |

**Provato e buttato**: usare questa quota per abbassare il tetto d'offerta e la
priorita'. Su dieci aste simulate per parte i punti restano identici (73.1
contro 73.1) ma i crediti che avanzano passano da 4 a 29 — si perdono giocatori
senza guadagnarci niente. Il motivo e' che la rosa va riempita comunque: il
venticinquesimo giocatore non entra in formazione per definizione, e
strozzargli il prezzo fa comprare piu' tardi e peggio. Resta come informazione,
che e' vera e non la dice nessun prezzo di mercato: *"non entrerebbe in
formazione: hai gia' tre attaccanti migliori di lui"*.

### Le coppie: l'intuizione regge solo per i portieri

Sembrava che due giocatori dello stesso ruolo e della stessa squadra si
annullassero. Misurato (`npm run check:coppie`, titolarita' vere), i primi due
di un reparto sommano il 144-149% di una stagione: occupano **due posti
diversi**, perche' in campo una squadra schiera tre-quattro difensori e
quattro-cinque centrocampisti.

L'eccezione e' il portiere, dove il posto e' uno: **12 squadre su 15 hanno
avuto un solo portiere vero**, e comprare il secondo e' un posto di rosa
buttato. Casi di alternanza vera esistono anche altrove ma sono pochi (Atta e
Njie alla Fiorentina, 22 titolarita' in due su 38).

Attenzione a leggere quella tabella: le statistiche sono per giocatore e per
stagione, ma la squadra e' quella di **oggi**, quindi chi si e' trasferito
risulta accoppiato con i compagni nuovi. Il numero sul portiere resta valido
perche' e' un fatto del gioco, non del campione.

### Il blocco difensivo non esiste

L'idea piu' promettente sembrava questa: con il modificatore attivo, portiere e
difensori della stessa squadra condividono le giornate buone, quindi comprarli
insieme dovrebbe valere piu' della somma.

Non e' cosi', e il motivo e' che **il modificatore e' lineare** nell'intervallo
in cui si gioca. Sulla scala di Fantacalcio.it il bonus va da -1 con una media
di 5.5 a +3 con 6.5 e +5 con 7: quattro fantapunti per punto di media, senza
scalini. E una funzione lineare della media non guarda la varianza, quindi
niente correlazione da sfruttare. Misurato (`npm run check:coppie`), lo stesso
difensore da 6.5 di media voto vale:

| la tua difesa e' a | dopo di lui | quanto ti da' |
|---|---|---|
| 5.80 | 5.88 | +0.31 |
| 5.99 | 6.07 | +0.31 |
| 6.33 | 6.41 | +0.31 |

Identico. Il prezzo per giocatore — `0.8 punti per ogni punto di media voto
sopra il rimpiazzo` — era gia' giusto, e il riquadro "Bonus modificatore" nella
scheda dice gia' tutto. La forma sulla linea resta in
`src/lib/fanta/formazione.ts`, dove serve per la formazione attesa, ma nel
consiglio non aggiunge niente e non ci sta.

C'e' un'unica cosa che questa strada avrebbe potuto dare e che i dati non
permettono: la **correlazione fra compagni giornata per giornata**. Le
statistiche in archivio sono per stagione, quindi quella correlazione non si
puo' misurare — e senza misura non entra.

### I portieri, i gol subiti

Sono considerati, e senza contarli due volte. La fantamedia dei file ufficiali
li contiene gia' (-1 a gol subito), quindi il motore aggiunge solo la
**differenza** se questa lega usa una regola diversa dallo standard, e il
modificatore di difesa entra a parte come bonus sulla media voto rispetto al
difensore che prenderesti gratis.


## 14. Le coppe e i campionati stranieri

Nel fantacalcio contano solo le partite di Serie A, quindi sembra ovvio che
Champions e Coppa Italia non debbano entrare nel calcolo. C'e' anche un
dettaglio che le rende sospette: **nessuna riga fuori dalla Serie A ha la media
voto**. Portano solo gol, assist e cartellini, quindi entrano nei tassi per
presenza senza dire niente sul voto.

Misurato col motore vero (`npm run check:campionati`): storia fino al 2024-25 in
due versioni — con tutto e con la sola Serie A — e come bersaglio la fantamedia
di Serie A del 2025-26.

| gruppo | quanti | con tutto | solo Serie A |
|---|---|---|---|
| tutti | 291 | **0.301** | 0.308 |
| ha giocato altre competizioni | 170 | **0.281** | 0.288 |
| ...e aveva gia' la Serie A | 162 | **0.280** | 0.287 |
| ...e la Serie A non ce l'aveva | 8 | **0.299** | 0.317 |

Tenerle e' meglio, in tutti e quattro i gruppi, anche per chi la Serie A ce
l'aveva gia'. Su Berardi la stima con tutto dice 7.18 e quella con la sola Serie
A 7.55: ha fatto 7.19. Parte del guadagno non e' che la Champions parli della
Serie A, e' che piu' righe fanno un campione piu' grande e quindi meno rumore —
ma il verso e' quello, e non c'e' motivo di buttarle.

Quello che invece era sbagliato era l'**avviso a schermo**: compariva appena una
riga veniva da fuori, e su chi ha quattro stagioni di Serie A alle spalle diceva
"le statistiche vengono dalla Champions League", che e' falso. Ora dipende da
quanto pesano davvero: sotto il 15% delle presenze non compare, fra il 15 e il
60 dice quante sono, sopra il 60 resta l'avviso pieno per chi arriva
dall'estero.

### Le coppe non stancano (per quanto si riesce a vedere)

| partite di coppa nel 2024-25 | quanti | fantamedia 2024-25 -> 2025-26 |
|---|---|---|
| nessuna | 87 | 6.18 -> 6.20 (+0.02) |
| da 6 a 10 | 51 | 6.30 -> 6.23 (-0.07) |
| piu' di 10 | 25 | 6.27 -> **6.42 (+0.14)** |

Chi gioca piu' coppe migliora, non peggiora. Non e' nemmeno una smentita pulita:
chi gioca le coppe sta in una squadra piu' forte, e con **una sola** stagione di
dettaglio per competizione le due cose non si separano. Quindi il fatto si dice
nella scheda ("gioca anche le coppe europee: 12 partite in piu'"), il malus no.


## 15. Perche' ha saltato le partite

Le presenze dicono quante partite ha giocato, non perche' ha saltato le altre —
e all'asta la differenza fra "era rotto" e "l'allenatore ha scelto un altro" e'
quella fra un rischio che si ripete e una gerarchia che puo' essersi rovesciata
a luglio.

L'archivio tiene una riga per giocatore e per partita saltata, con il motivo, e
le manda **tutte insieme senza paginare**: 3036 righe per una stagione intera di
Serie A in una chiamata sola. E' il dato piu' economico che il progetto abbia mai
preso. Squalifiche, scelte tecniche e nazionali restano fuori dal conto degli
infortuni.

Sul listone di oggi: 189 giocatori con assenze registrate nel 2024-25, di cui
146 con infortuni veri.

**Non entra nel prezzo**, e la misura dice perche' (`npm run check:titolarita`):

| saltate per infortunio | quanti | presenze l'anno dopo | scarto del modello |
|---|---|---|---|
| nessuna | 41 | 26.9 | -0.1 |
| da 1 a 3 | 69 | 25.7 | -0.4 |
| da 4 a 8 | 39 | 20.9 | +1.6 |
| piu' di 8 | 17 | 21.6 | **-3.8** |

Chi si infortuna gioca meno — 26.9 contro 20.9 — ma il modello lo sa gia',
perche' quelle presenze basse le ha viste. E chi ne ha saltate piu' di otto
l'anno dopo ha giocato **piu'** di quanto il modello dicesse, non meno. Non c'e'
nessun malus da aggiungere.

Quello che cambia e' come si legge un numero basso, e sta nelle note della
scheda: *"Nel 2024-25 ha saltato 11 partite per infortunio (soprattutto Muscle
Injury): le presenze basse di quell'anno erano quello, non una scelta tecnica."*

### Chi e' infortunato adesso

Il piano gratuito dell'archivio si ferma al 2024: la stagione 2025 e la 2026
tornano zero righe **senza errore**, e cosi' anche `?date=oggi`. Provate e
scartate anche Understat (non incorpora piu' i dati nella pagina),
football-data.org (403 senza chiave, e il piano gratuito non da' comunque minuti
ne' infortuni), TheSportsDB (`strStatus` vale "Active" per tutti: significa "non
ritirato") e FBref (403).

Quindi lo stato fisico lo si chiede a un modello con la ricerca sul web, **una
squadra per volta**: la ricerca si paga a richiesta e non a risultato, quindi
"chi e' indisponibile nella Roma" costa quanto chiedere di un singolo giocatore
e copre venticinque nomi. Misurato: 4 squadre in ~14 secondi per $0.03, quindi
circa **$0.15** per tutta la Serie A.

Non entra nel prezzo. E' la fonte meno affidabile che abbiamo, e
un'informazione sbagliata che dimezza un tetto in silenzio sarebbe peggio di
nessuna informazione: sta fra i contro, con scritto di quanti giorni e' la
notizia.

**La prima versione non funzionava, e vale la pena dire perche'.** Allegava la
rosa e chiedeva di segnare chi non stava bene: e' tornato il Como **al completo**
segnato infortunato, ognuno con la stessa nota "non specificato", e il Cagliari
con otto identici "infortunio al ginocchio". Davanti a un elenco, un modello che
non ha trovato niente lo ricopia, perche' rispondere "non ho trovato niente"
sembra meno utile.

Ora la domanda e' aperta — *"chi e' indisponibile nel Como?"* — e i nomi si
agganciano dopo alla rosa, con la stessa ricerca del campo dell'asta. Piu' tre
reti, tutte da cose viste in quella prova: si butta la squadra intera se torna
piu' di mezza rosa segnata, se la stessa nota si ripete tre volte, o se la nota
dice di non sapere quale sia il problema. Dopo la correzione: 9 indisponibili su
8 squadre, con crociati, adduttori e collaterali al posto giusto.

## 16. Ricaricare i file il giorno dell'asta

Il giorno dell'asta si ricaricano il listone (nel frattempo sono arrivati
giocatori nuovi) e le statistiche della stagione in corso. Sono le due
operazioni piu' pericolose che il software fa, perche' toccano le stesse righe
su cui si e' accumulato tutto il resto.

`npm run check:aggiornamento` fotografa il database, chiama la route vera con i
file veri, e rifotografa. Misurato:

| | prima | dopo |
|---|---|---|
| identita' | 500 | 500 |
| nomi per esteso | 420 | 420 |
| assenze | 189 | 189 |
| carriera | 640 | 640 |
| minuti | 704 | 704 |
| titolarita' | 235 | 235 |
| statistiche recuperate dal modello | 190 | 190 |
| statistiche dell'archivio | 376 | 376 |

Niente si perde, perche' l'upsert non tocca le colonne che non manda e la
chiave dei giocatori e' `(stagione, id ufficiale)`: un giocatore che era gia'
li' mantiene il suo `id`, e con lui identita', storico, carriera e assenze.

Le due cose da sapere:

- **i giocatori nuovi arrivano al buio** — niente identita' ne' storico — e
  vanno recuperati con il pulsante del listone;
- **chi non e' piu' nel file viene disattivato, non cancellato**: i suoi dati
  restano dove sono, nel caso torni.


## 17. Cosa ti resta in mano, se lo prendi

Il tetto d'offerta risponde a *"quanto vale lui"*. All'asta la domanda vera e'
un'altra: **con questi crediti, e' meglio lui o quello che comprerei al suo
posto?** Prenderne uno da 300 con 302 in tasca e due slot vuoti non e' per forza
un errore — dipende da cosa restera' comprabile a un credito quando ci arrivi.

E quello non dipende dai giocatori rimasti: dipende da **quanti crediti restano
agli altri**. Se sono a secco, a un credito si portano a casa giocatori veri,
perche' nessuno puo' rilanciare; se sono ancora carichi, restano i fondi di
magazzino. E' la stessa cifra con due significati opposti.

`src/lib/fanta/piano.ts` mette i due percorsi uno accanto all'altro: riempie gli
slot che restano con quello che il budget permette, una volta prendendolo e una
volta no, e confronta i punti attesi della formazione. Il prezzo dei giocatori
rimasti non e' il loro valore ma **fin dove puo' arrivare chi li vuole** — il
tetto degli avversari, corretto con quanto hanno gia' pagato sopra il valore.

Misurato sullo scenario esatto (`npm run check:contesto`, sezione 6): 293
crediti, due slot, il primo attaccante del listone.

| | il migliore a 1 credito rende | prezzo di apertura consigliato |
|---|---|---|
| gli avversari hanno ancora i soldi | 6.12 | 85% del valore |
| gli avversari sono a secco | **6.89** | **1** |

Il numero che ne esce e' il **pareggio**: il prezzo a cui le due strade rendono
uguale. Sotto conviene prenderlo, sopra conviene il piano B — e il piano B ha un
nome e un prezzo, non e' un'astrazione: *"col resto prenderesti Santos A. a 1"*.

### Un passo piu' in la': non "cosa vorrei", ma "cosa mi lasceranno"

La prima versione del piano aveva un difetto da principiante: dava per scontato
di prendere quello che aveva pianificato. "Poi riempio i due slot a un credito"
e' un piano se nessuno puo' rilanciare, e un'illusione se tre avversari cercano
ancora quel ruolo e hanno i soldi.

Adesso ogni giocatore del piano porta con se' **quante probabilita' ci sono di
prenderlo davvero** — se in tre lo vogliono e possono pagarlo, tocca a te una
volta su quattro — e il valore di uno slot non e' quello del migliore della
lista ma quello che ci finisce dentro davvero, scendendo la lista finche' la
probabilita' si esaurisce:

```
resa dello slot = Σ  valore(j) x P(prendo j) x Π  (1 - P(prendo k))
                  j                            k<j
```

Cambia i numeri in modo onesto: il valore di uno slot da un credito passa da
6.12 a **5.71** con gli avversari carichi e da 6.89 a **6.20** con gli
avversari a secco. La distanza fra i due mercati resta — ed e' quella che conta
— ma sparisce l'ottimismo.

### Il pareggio come tetto: provato e buttato

Sulla carta e' il tetto detto nel modo giusto, e su dieci aste i punti salgono
appena (73.2 contro 73.1). Ma lascia **60 crediti su 500** in tasca.

Il motivo vale piu' della funzione: il pareggio confronta due strade, ma la
strada alternativa e' fatta di acquisti a loro volta limitati dal pareggio.
Applicato a ogni decisione il criterio si morde la coda e offre poco su tutto. E
soprattutto ignora che **i crediti non spesi valgono zero**: se non c'e' niente
di meglio da comprare, il prezzo giusto per quello che c'e' non e' uno, e' quello
che ti resta.

Limitandolo ai casi in cui dice qualcosa (pareggio > 1) il danno sparisce e non
resta nessun guadagno: 73.1 punti e 4 crediti, identico. Quindi resta
informazione, dove serve a chi decide, e non vincolo sul prezzo.

### Un buco trovato accanto

Con nessun avversario in grado di contenderlo — a fine asta capita: o hanno
finito i crediti o hanno il reparto pieno — il software apriva comunque
all'85% del valore. Su un giocatore da 378 vuol dire offrire 321 in un'asta che
si vincerebbe a **uno**, e proprio nel momento in cui quei crediti servono per
l'ultimo slot. Ora, quando non c'e' nessuno che possa rilanciare, il prezzo di
apertura e' 1 e la scheda lo dice.


## 18. La rosa che stai costruendo

Non e' una previsione dell'asta — nessuno sa chi verra' chiamato e quando — e'
la **fotografia del piano adesso**: quello che hai gia' in rosa, piu' quello che
con i crediti rimasti e i prezzi di adesso riusciresti a prendere, slot per
slot. E il "riusciresti" e' pesato: un obiettivo che in tre si contendono vale
un quarto di uno che nessuno vuole.

Serve a vedere due cose che nei consigli sui singoli giocatori non si vedono:
dove sei scoperto, e **come si muove il piano mentre l'asta va avanti**. Quando
un top va via a 250, la rosa possibile cambia, e il modo in cui cambia dice piu'
di venti prezzi.

Il mercato che vede e' lo stesso del consiglio sul singolo giocatore
(`mercatoCorrente` in `recommend.ts`): due viste che non concordano sull'asta
sarebbero peggio di una vista sola.

### Due difetti trovati costruendola

- **La seconda passata ricomprava i titolari.** Il riempimento fa due giri —
  prima i titolari mancanti, poi la panchina — e il secondo ripartiva
  dall'inizio della lista senza ricordarsi chi aveva gia' preso: nel pannello
  uscivano quattro difensori scritti due volte e il piano impegnava crediti gia'
  impegnati.
- **L'inflazione diceva -50% ad asta ferma.** Contava i crediti delle squadre
  **iscritte** contro i giocatori che serviranno a quelle **dichiarate**: una
  lega da otto con tre iscritti confrontava 1500 crediti con il valore di
  duecento giocatori, e il rapporto finiva sul fondo della forbice. Ora le
  squadre che ancora non si sono iscritte contano lo stesso — arrivano prima di
  cominciare — e a asta ferma l'inflazione e' 0%, come dev'essere.

### La strategia non arrivava fino al piano

Il pannello mostrava la stessa rosa per tutte e sei le strategie. Il motivo era
in una riga di `riempi`: il mercato veniva ordinato per rendimento atteso e
comprato dall'alto, e siccome gol e assist stanno in mezzo al campo,
centrocampisti e attaccanti si prendevano quasi tutti i crediti in ogni
scenario. Con 500 crediti a inizio asta:

| strategia | vuole D | spendeva D | vuole A | spendeva A |
|---|---|---|---|---|
| equilibrata | 16% | 3.6% | 44% | 54% |
| attacco forte | 12% | 1.6% | 55% | 60% |
| modificatore difesa | 27% | 5.2% | 33% | 47% |
| portiere top | 22% | 3.8% | 34% | 48% |

Scegliere "modificatore di difesa" dava la rosa di "attacco forte" con
ventisei crediti di difesa invece di otto: una differenza che non si vedeva.

Ora `quotePerRuolo` traduce la ripartizione della strategia in un tetto di
spesa per reparto — quello che la strategia assegna, meno quello che hai gia'
speso li' — e `riempi` lo rispetta. Il pavimento e' un credito per slot: una
quota non puo' mai scendere sotto il minimo che serve a riempire il reparto,
altrimenti il piano lascerebbe buchi per rispettare una percentuale.

Le passate diventano tre. Le prime due — titolari mancanti, poi panchina —
stanno dentro la quota; la terza spende il residuo ignorandola. Senza la terza
una strategia che tiene bassa una quota lascia crediti in mano, e **i crediti
non spesi valgono zero**.

Dopo, ogni strategia centra la sua ripartizione al punto percentuale, e i punti
attesi salgono in tutti e quattro gli scenari (70.09 -> 70.77, 69.86 -> 70.48,
70.11 -> 71.48, 70.07 -> 71.45): comprare dal rendimento piu' alto in giu' non
era nemmeno il piano migliore. Sull'asta simulata intera niente cambia (73.1
punti, 5 crediti avanzati, identico prima e dopo), ed e' atteso: `check:asta`
decide con `target` e `max`, e il pareggio non e' un tetto d'offerta. Lo misura
`npm run check:crediti`.

### Spendere tutto e restare senza rosa

Un'asta di prova e' finita con **un credito in mano e ventidue giocatori ancora
da comprare**. Il motore non aveva sbagliato: sul secondo e sul terzo acquisto
diceva gia' "max 1, solo se scende", e `maxBid` — i crediti meno uno per ogni
altro slot — segnava 241 e poi 109 contro i 133 e 130 registrati. A non
guardare quel numero era il riquadro che registra chi ha preso chi: accettava
qualunque cifra da chiunque.

`perchePrezzoImpossibile` (in `market.ts`) fa ora quel conto per la squadra
scelta, non solo per la propria: chi ha 131 crediti e 23 giocatori da comprare
non puo' offrirne piu' di 109. Torna una frase invece di un booleano, perche'
un limite di cui non si vede il conto sembra un capriccio. Il tasto si spegne e
basta: una rosa che non si puo' riempire non e' un fatto da annotare, e' un
errore di battitura. Per gli errori che passano lo stesso — il compratore
sbagliato, un 30 scritto 130 — c'e' la rettifica, qui sotto.

Il pannello della rosa, in quello stato, resta giusto vuoto: con un credito e
ventidue slot non c'e' niente da promettere.


### Rettificare un acquisto

All'asta si sbaglia a scrivere, e chi conduce e' quello che se ne accorge per
primo — spesso sulla rosa di un altro. Prima l'unico rimedio era cancellare, e
solo sulla propria rosa. Ora nella pagina **Rose** ogni acquisto ha una matita:
chi ha creato la lega la vede su tutte le rose, gli altri solo sulla propria.
Si cambia il prezzo, si sposta il giocatore a un'altra squadra, o si elimina.

La correzione passa dallo stesso controllo della registrazione, con una
differenza che conta: **spostare un giocatore si misura sulla cassa della
squadra di destinazione**, non su quella da cui viene, e correggere il prezzo
di un acquisto gia' registrato restituisce prima quello che c'era — altrimenti
abbassare un 236 sbagliato risulterebbe impossibile perche' i 236 sono ancora
contati.

Un dettaglio da sapere: sul database chiunque sia nella lega puo' scrivere
negli eventi d'asta, ed e' voluto — il registro e' condiviso e piu' dispositivi
registrano insieme. Il limite a chi ha creato la lega e' nell'interfaccia, per
non toccare per sbaglio la rosa di un altro, non una barriera di sicurezza.

### Correggere una squadra

Stessa idea un livello sopra: nelle impostazioni ogni squadra si rinomina e
cambia crediti sul posto, senza rifarla — rifarla vorrebbe dire perdere quello
che ha gia' comprato. Le sei squadre senza account le scrive a mano chi conduce,
di corsa, spesso pochi minuti prima di cominciare, e un nome storpiato o un
budget diverso dagli altri si correggono li'.

Il solo limite e' quello che regge i conti: **i crediti non possono scendere
sotto quello che quella squadra ha gia' speso**, o il residuo va sotto zero e
con lui l'inflazione, il tetto degli avversari e ogni consiglio. Il pavimento e'
scritto accanto al campo e ripetuto dal server, perche' l'attributo `min` di un
campo numerico e' un suggerimento, non una regola.

### Quanto lo vuoi non e' quanto serve

Un controllo di `check:engine` ha gridato al bug per settimane su una cosa che
funzionava. Chiedeva che il tetto d'offerta salisse del 30% quando i ricambi
finiscono, e ne trovava il 3%.

Sono due numeri diversi, e ora `breakdown` li espone tutti e due.
`substitutionCap` e' **quanto lo vuoi**: il prezzo giusto piu' quanto vale in
piu' del primo che lo sostituirebbe. Senza ricambi quel premio e' tutto il
giocatore, e infatti raddoppia (221 -> 489). `wantedCeiling` e' **quanto
serve**: un credito sopra chi lo vuole davvero, corretto con quanto ha gia'
pagato sopra valore.

Il secondo quasi non si muove (185 -> 191), e non perche' il motore sia pigro:
le stesse otto chiamate che tolgono i ricambi svuotano le tasche di chi
rilancia, ma quelle chiamate mostrano anche che quei rivali pagano sopra
valore. Meno crediti e piu' generosita' si annullano.

Quindi la prova giusta non e' che il tetto salga: e' che **la forbice si apra**
— quanto lo vuoi raddoppia, quanto serve resta dov'e'. Confondere i due costa
in due modi opposti: misurare il primo sul secondo fa gridare al bug quando non
c'e', e alzare il secondo per farlo somigliare al primo vuol dire pagare
crediti che nessuno ti stava chiedendo.


## 19. La scala dei prezzi

Il piano conosceva un totale per reparto e nient'altro. Quindi due strategie con
la stessa quota d'attacco davano **la stessa identica rosa**: cambiava quanto,
mai come. Scegliere "attacco corazzato" invece di "equilibrata" spostava qualche
credito e zero nomi.

Adesso ogni reparto ha una **scala**: quanto sul primo, quanto sul secondo,
quanto sul terzo. La forma la danno due cose che la strategia gia' diceva —
`topTargets`, quante punte di diamante vuoi li', e la quota del reparto — e si
puo' scrivere a mano, reparto per reparto, dalla pagina Strategia. Quando c'e'
scritta a mano, vince su tutto.

Misurato sul listone vero, a inizio asta, contando quanti nomi cambiano:

| confronto | nomi diversi |
|---|---|
| equilibrata vs attacco corazzato | 52% |
| equilibrata vs modificatore difesa | 44% |
| tetto 70 vs nessun tetto | 36% |
| tetto 70 vs tetto stretto 40 | 44% |

Prima erano tutti vicini a zero.

Tre cose imparate scrivendola, tutte pagate:

- **L'avanzo deve restare dentro il reparto.** Globale, faceva colare i crediti
  da un reparto all'altro: con la difesa che non trovava nessuno alla sua cifra,
  l'attacco finiva a 222 crediti su una quota di 165 — e la promessa "il piano
  segue la strategia" saltava. L'ha trovato `npm run check:crediti`.
- **Dentro un gradino non si paga per niente.** Prendere sempre il piu' caro che
  ci sta dentro costava punti: se a meta' prezzo c'e' uno che rende praticamente
  uguale, i crediti risparmiati valgono piu' del decimale di fantamedia.
- **I ricambi non vanno misurati sulla cassa che resta.** Legarli a quella
  faceva *scendere* il punteggio quando il piano spendeva di piu', che e'
  esattamente il contrario di quello che deve dire. Adesso il metro e' il prezzo
  di chi hai scelto.

Una nota onesta sui punti: il numero mostrato dal pannello non e' confrontabile
con quello di prima della scala, perche' anche il modo di contare i ricambi e'
cambiato. Quello che si puo' confrontare e' l'asta intera simulata, e li' non
si muove niente: `npm run check:asta` da' 73.1 punti prima e dopo. Il piano non
guida gli acquisti — quelli li decidono `target` e `max` — quindi la scala
cambia cosa il pannello ti propone, non quanto vinci seguendo il consiglio.

## 20. Il freno sul singolo giocatore

Il piano comprava dal rendimento piu' alto in giu' e non si fermava mai: sul
listone vero metteva 182 crediti su un nome e riempiva il resto a un credito —
**dodici giocatori su venticinque a un credito**, mediana 2, contro la mediana
di 8 dell'asta vera del 2025-26. Una rosa cosi' non somiglia a nessun mercato.

La cosa che non mi aspettavo e' che il freno **non costa punti: ne fa**.
Misurato a inizio asta, sul listone vero, con 500 crediti:

| tetto per giocatore | equilibrata | attacco forte | modificatore difesa |
|---|---|---|---|
| nessuno | 72.33 | 71.40 | 70.96 |
| 120 cr | 72.39 | 71.68 | 71.19 |
| **70 cr** | **72.83** | **71.85** | **71.30** |
| 50 cr | 72.82 | 71.54 | 71.47 |

Tutte e tre le strategie migliorano attorno al 14% del budget, e li' il piano
spende ancora tutti i 500 crediti. Sotto i 50 comincia a lasciarne in mano — e i
crediti non spesi valgono zero, quindi quei numeri non sono confrontabili.

Il motivo e' nel modo in cui si fanno i punti: la formazione titolare conta 3.6
difensori e 4.2 centrocampisti, e **una stella sola non li riempie**. Comprare
il piu' forte in assoluto massimizza il valore di uno slot, non quello della
formazione.

Il tetto e' un vincolo, non un criterio: si continua a comprare il migliore, ma
non quello che si mangia il reparto. Sta su `strategies.max_quota_giocatore`,
default 0.14, e si sposta dalla pagina Strategia — dove la tabella qui sopra e'
scritta accanto alle scelte, perche' chi la sposta sappia cosa gli costa.

### Quello che il piano non ha mai promesso

L'altra meta' del dubbio era: **il piano si aspetta di comprare giocatori forti
a un credito?** No, e non per fortuna. Il prezzo nel piano e'
`min(teorico, tetto+1)` dove `tetto` e' quanto puo' pagare chi lo vuole: vale 1
solo quando **nessun avversario ha uno slot libero in quel ruolo o i crediti per
rilanciare**. Misurato, i giocatori che il piano compra a un credito sono tutti
`fascia riempitivo` con valore 1 o 2. La regola che serviva c'era gia'; quello
che mancava era il freno sull'altro estremo.

## 21. La rosa decisa a mano

Un conto e' il consiglio, un conto e' quello che uno ha in testa. `roster_pins`
tiene i giocatori che hai messo tu nel piano, col prezzo che hai deciso tu:
entrano prima di ogni scelta del software, occupano slot e crediti, e il resto
della rosa si costruisce **intorno** a loro con quello che avanza.

Restano finche' non li togli — non li tocca un consiglio che cambia, non li
tocca una chiamata registrata da qualcun altro. Sono l'unico posto in cui il
software prende ordini invece di darli.

Vale soprattutto per chi non ha il premium: senza consigli, e' l'unico modo di
portare un piano all'asta. Ma serve anche al premium, per dire "questo lo voglio
comunque" e vedere che rosa ne viene fuori.

### Anche un piano deve poter essere eseguito

Le prime scelte a mano non guardavano il budget. Si poteva mettere Kean a 450
con 455 crediti residui e ventiquattro slot da riempire, e il pannello lo
accettava: mostrava una rosa da 480 crediti su 455 e nessuno diceva niente. Non
era una pianificazione, era un numero impossibile.

`perchePianoImpossibile` fa lo stesso conto che protegge la registrazione di un
acquisto, un livello prima: i crediti residui, meno quello che le altre scelte a
mano hanno gia' impegnato, meno un credito per ogni slot che resterebbe vuoto.
Con 455 crediti e ventitre' slot ancora liberi, il massimo su un giocatore e'
432, e il campo lo dice invece di lasciarti scrivere 450.

Accanto e' comparso il conto che mancava: **il valore della rosa intera** —
comprati, scelti a mano e proposti insieme — contro il budget di partenza.
Prima si vedeva solo quanto il piano impegnava sui crediti residui, e quando i
numeri non tornavano non si capiva da dove.


## 22. I crediti che avanzano comprano anche certezza

Un piano che si fermava a 492 su 500 non era prudente, era sbagliato: gli otto
crediti avanzati valgono zero a fine asta. E succedeva facilmente — bastava una
scelta a mano che spostava la scala, o un acquisto registrato a un prezzo
diverso da quello previsto.

La passata che spende il residuo ora confronta **due mosse**, non una:

- **salire di fascia**: al posto di quello che avevi in mente, uno che rende di
  piu' e costa quei crediti in piu';
- **comprare certezza**: lo stesso giocatore, offrendo sopra il tetto di uno o
  piu' avversari.

La seconda mancava del tutto, ed e' quella che si fa davvero all'asta. Il prezzo
di un obiettivo e' `min(teorico, tetto+1)` dove `tetto` e' il piu' alto fra i
rivali: e' quanto **basta** per prenderlo se nessuno si scalda. Ma i rivali sono
tanti, con tetti diversi, e la probabilita' e' `1/(1+contendenti)`. Adesso
`Comprabile` porta con se' **tutti** i tetti, non solo il massimo, e
`probabilitaA(c, prezzo)` dice quanti restano in gara a una data offerta.

Misurato sul listone vero, a inizio asta: Bremer costa 34 di mercato e il piano
lo prende al 25%; con i crediti avanzati offre **49** e la probabilita' va al
**100%**, perche' a quella cifra nessun avversario puo' seguirlo.

Le due strade si confrontano per **guadagno atteso per credito**, cosi' non sono
due regole separate che si contraddicono: la resa di uno slot e'
`p * expFM + (1-p) * ripiego`, e alzare `p` la sposta esattamente come sostituire
il giocatore. Con un portiere fissato a 100 il residuo va tutto in fascia
superiore e nessuna offerta supera il mercato; con lo stesso portiere a 30 ne
compra due di certezze. Non e' una regola scritta: e' il confronto che decide.

In questa passata la quota del reparto non vale piu'. Ha gia' governato tutta
l'allocazione, e quello che avanza deve poter andare dove rende — o resta dov'e',
cioe' in mano. `npm run check:crediti` verifica che le quattro strategie
arrivino comunque a 500 su 500 e restino dentro la loro ripartizione.


## 23. La probabilita' come la vede l'asta, non come la vede una divisione

La regola era `1 / (1 + contendenti)`: contava le teste degli avversari che
potevano permetterselo e divideva. Aveva due difetti, e il secondo era serio.

Il primo: **saltava a scatti**. 100%, 50%, 33%, 25% — fra 33 e 50 non c'era
niente, mentre la differenza fra due offerte di un credito e' continua.

Il secondo: dava **100% troppo facilmente**. Bastava superare il tetto
*previsto* di tutti — e quel tetto e' una nostra stima del loro piano di spesa,
non un muro. All'asta i piani si sfondano di continuo.

Adesso ogni avversario porta **due** numeri: `previsto`, fin dove il suo piano
lo porterebbe, e `possibile`, i crediti che ha davvero in cassa tenendo da parte
quelli per completare la rosa. Il primo e' una previsione, il secondo un muro —
e solo il muro puo' portare al 100%, insieme all'altro muro vero, cioe' non
avere piu' uno slot in quel ruolo.

Fra i due, la probabilita' che quell'avversario rilanci scende con una
logistica: al suo tetto previsto e' in equilibrio, sopra si tira indietro piano,
sotto e' quasi certo che rilanci. L'incertezza e' il 18% del tetto, cioe' chi ha
in mente 50 arriva a 60 una volta su quattro.

**Il conto e' su quanti restano in gara, non su chi vince.** Provata prima la
strada che sembra piu' rigorosa — moltiplicare le probabilita' di non essere
superati da nessuno — e a inizio asta dava il 2% su tutto: con sette rivali a
bilancio pieno, battere **tutti** su un giocatore preciso e' davvero
improbabile. Ma un piano non chiede quello. Chiede quanti dei suoi obiettivi
finiranno in rosa, e li' vale la divisione: se in tre lo vogliono, tocca a te
una volta su tre. Quindi si sommano i contendenti **a frazioni** e si divide.

Sul listone vero, a inizio asta, il piano mostra 13%, 25%, 36%, 44% — un
gradiente vero — e **nessun 100%**, perche' a bilanci pieni nessuno e' fuori
gioco davvero. I 100% torneranno a fine asta, quando gli altri avranno finito
crediti e slot, ed e' esattamente quando sono veri.

### Sceglie per resa dello slot, non per rendimento

Corollario diretto: fra due giocatori allo stesso prezzo, uno che rende poco
piu' ma che in quattro si contendono vale meno di uno appena sotto che nessuno
vuole — la meta' delle volte il primo non ce l'hai. Il gradino ora sceglie per
`p * rendimento + (1-p) * ripiego`, e siccome `p` si muove a ogni chiamata
registrata, il confronto **si rifa' da solo mentre l'asta va avanti**: un
giocatore che si libera perche' i suoi pretendenti hanno finito i crediti sale
in cima senza che nessuno glielo dica.

Una taratura pagata: la soglia sotto la quale due giocatori si considerano
equivalenti era 0.12, misurata sul rendimento puro. Sulla resa dello slot — che
e' una media pesata, quindi molto piu' compressa — quella soglia rendeva quasi
tutti equivalenti, il piano prendeva sempre il piu' economico e finiva col 56%
del budget in difesa. Sulla resa va a 0.03.

## 24. Capire il banditore con quello che gia' sappiamo

Il riconoscimento del parlato lo fa il browser. Quello che resta e' agganciare
la trascrizione — storpiata, perche' i nomi sono stranieri e la stanza urla — a
liste che conosciamo gia': 533 giocatori, otto squadre in asta, i numeri fino al
budget. Fin qui il confronto era **solo sul suono del cognome**, e su un
cognome solo il suono a volte non basta.

Nel listone 2026/27 ci sono tredici gruppi di omonimi veri. Non casi di scuola:
Martinez L. e Martinez Jo. sono **tutti e due dell'Inter**, Terracciano e
Terracciano F. tutti e due del Milan, e poi Thuram, Esposito, Pellegrini,
Stankovic, Rodriguez, Carboni, Colombo, Adams, Pessina, Rrahmani, Sulemana. Su
questi il confronto fra suoni non puo' decidere, per costruzione: i due suoni
sono identici.

**Squadra e ruolo insieme li sciolgono tutti e tredici.** Sono le due cose che
la frase quasi sempre contiene gia' — *"Thuram della Juve"*, *"il portiere
Martinez"* — e che non costano niente, perche' le abbiamo nel listone. Ora
entrano nel punteggio: la squadra detta pesa +0.35 e toglie 0.20 a chi non ci
gioca, il ruolo +0.15 e −0.12. In piu' entra quello che il suono non puo'
sapere: **chi e' gia' stato venduto** scende cosi' tanto da non poter piu'
vincere — il banditore non lo richiama — ma resta nell'elenco, perche' una
registrazione sbagliata si corregge.

Misurato su sette frasi che il suono da solo non puo' risolvere: **0 su 7 prima,
7 su 7 dopo** (`npm run check:voce`). E dove il rischio era di peggiorare le
cose, cioe' scambiare per squadra una parola qualunque, il riconoscimento della
squadra accetta **solo corrispondenze esatte**, piu' una manciata di soprannomi
che non possono voler dire altro (*juve*, *nerazzurri*, *viola*, *toro*): il
banditore dice "come" venti volte al minuto e "come" dista una lettera da
"Como".

### Cinque trascrizioni, non una

Il riconoscitore del browser restituisce piu' trascrizioni della stessa frase,
ordinate per quanto **suonano come una lingua** — e quello e' il criterio
sbagliato per chi deve agganciare un cognome turco: "Cala Nogli" e' italiano
piu' plausibile di "Calhanoglu", e vince quasi sempre. Chiedendone cinque e
provandole tutte contro il listone si fa la domanda giusta: *quale di queste,
agganciata ai 533 nomi, da' una chiamata vera?* Non costa niente — le
alternative il riconoscitore le ha gia' calcolate, e il confronto e' fra
stringhe.

### Il modello, e quanto costa

Quando il confronto locale non stacca — il primo e il secondo troppo vicini —
interviene un modello, `google/gemini-2.5-flash-lite`, a cui non si chiede di
trascrivere ne' di sapere chi gioca dove: gli si danno la frase e i candidati
gia' ristretti, e gli si chiede solo di scegliere. Ora ogni candidato gli arriva
con nome per esteso, ruolo e squadra, e con l'elenco di chi e' gia' stato
venduto.

Misurato sul percorso vero, in produzione, cinque frasi da asta:
**$0.000060 a chiamata**, fra 0.7 e 2.4 secondi. Seicento interpretazioni — piu'
di quante ne servano per un'asta intera — costano **tre centesimi e mezzo**. Col
credito OpenRouter residuo al 10 settembre 2026 ($3.40) sono cinquantaseimila
interpretazioni: la voce non e' la spesa di questo progetto, lo sono i recuperi
dati con la ricerca web, che costano $0.00700 l'uno — cento volte tanto.

E non e' nemmeno un requisito: c'e' un tetto di sei secondi, il fallimento non
e' un errore, e si torna a quello che aveva capito la macchina locale. Che ormai
su questi casi fa meglio: nella misura in produzione il modello, davanti a "il
portiere martinez", ha scelto l'attaccante.

## 25. Il tetto di un avversario e' del giocatore, non del suo portafogli

Il conto era rovesciato, e si vedeva a occhio nudo: il software diceva che
**Mario poteva arrivare a 97 su un riempitivo da un credito**. Non era
ottimismo, era una formula sbagliata:

```
tetto = min(cassa, max(budget del reparto, valore * generosita))
```

Quel `max` faceva del budget del reparto un **pavimento**: chiunque, su
chiunque, poteva arrivare a quanto gli restava per il ruolo. Ma il budget del
reparto non e' quanto vuole spendere su *questo* giocatore — e' il tetto di
quello che puo' spendere **in tutto**, un vincolo, non un'intenzione.

Adesso comanda il giocatore:

```
tetto = min(cassa, valore * inflazione del ruolo * generosita della squadra * 1.25)
```

dove `generosita` e' quanto quella squadra ha gia' pagato sopra i valori (una
squadra che ha speso il doppio del valore su tre giocatori lo rifara') e 1.25 e'
il margine di chi all'asta "lo voleva": sotto 1 nessuno rilancerebbe mai, sopra
1.5 chiunque pagherebbe il doppio di quanto pensa valga.

Misurato: sul top da 185 il tetto resta alto — **231**, cioe' sopra il suo
valore, che e' quello che succede davvero alle aste — e sul riempitivo da un
credito scende a **zero**, cioe' il riquadro "puoi farglielo pagare" sparisce.
Ed e' la risposta giusta: su un giocatore che nessuno vuole non puoi far
spendere niente a nessuno. Sulle dieci aste simulate i punti non si muovono
(73.1 prima, 73.1 dopo, `npm run check:asta`): il tetto sbagliato non faceva
perdere punti, faceva dire numeri assurdi — che all'asta e' peggio, perche' chi
legge smette di fidarsi anche di quelli giusti.

### Personalizzato su quello che ognuno ha gia' comprato

Di un avversario si sa una cosa sola, ed e' pubblica: **cosa ha comprato**. I
crediti che ha speso, gli slot che ha riempito, quanto ha pagato sopra i valori.
La sua strategia no — non la conosce nessuno, e leggerla sarebbe barare anche se
si potesse. Ma non serve: chi ha ancora tutti i titolari di un reparto da
prendere si scalda su quel reparto molto piu' di chi li ha gia'.

Nel tetto entra quindi anche il **bisogno**, calcolato solo da li': 1.25 quando
il reparto e' vuoto, 0.6 quando i titolari ci sono tutti. L'asimmetria e'
voluta: il ricambio lo prendi comunque, ma a un credito.

Misurato sullo stesso giocatore, un top da 185: il tetto piu' alto fra gli
avversari e' **289** con gli attacchi vuoti e **208** dopo che tutti i rivali
hanno riempito il reparto — a parita' di cassa, perche' nella misura comprano
riempitivi da due crediti. I punti delle dieci aste simulate restano 73.1.

### Solo su chi e' in asta adesso

"Puoi farglielo pagare" e' **una mossa**, non un'informazione: si fa mentre il
banditore conta, su quel giocatore li'. Su un giocatore qualsiasi che stavi
guardando era un numero da leggere per curiosita', e i numeri che non servono a
decidere niente tolgono spazio a quelli che servono. Adesso il riquadro compare
solo sulla scheda di chi e' sul piatto.

### I prezzi che metti tu non arrivano agli avversari

Detto esplicitamente, perche' e' una tentazione tecnica: nei tetti degli
avversari, nei loro prezzi e nelle probabilita' entra **solo quello che calcola
il modello**. I prezzi che fissi a mano sulla tua rosa cambiano il tuo piano e
nient'altro — se entrassero nel conto degli altri, il software giocherebbe con
le loro carte in mano e i numeri che ti restituisce non sarebbero piu' una
previsione, ma un riflesso di quello che hai deciso tu. Sulla scheda del
giocatore un prezzo tuo si vede (*"l'hai fissato tu a 150"*), e la ⓘ accanto
dice esattamente questo.
