# Decisioni, e cosa le ha giustificate

Ogni voce e' una scelta non ovvia, con la misura o il ragionamento che l'ha
determinata. Serve a non rifare gli stessi errori e a poter ridiscutere una
scelta sapendo su cosa poggiava.

## Motore

**Il rimpiazzo si cerca per fantamedia, non per punti stagionali.**
Ordinare per presenze × fantamedia e usare il risultato come soglia di fantamedia
mescola due scale. Effetto misurato: 435 giocatori su 533 risultavano sopra il
rimpiazzo e il budget si spalmava su tutti; Lautaro veniva prezzato 51 crediti
contro un listino di 127.

**Media locale invece del singolo giocatore alla soglia.**
Il difensore esattamente all'indice 29 aveva fantamedia 5.70 mentre i vicini
stavano a 6.04 e 6.09: un solo nome e' rumore, e spostava il prezzo di tutto il
reparto.

**La concentrazione dei prezzi si calibra sul listino ufficiale.**
Con il rimpiazzo all'ultimo titolare i venti piu' cari valevano 2161 crediti
contro i 1450 del listino; con l'ultimo panchinaro, 749. Quanto stare in mezzo e'
una proprieta' del formato d'asta, non dei giocatori, e il Fantavalore nasce dai
prezzi realmente pagati. E' l'unica cosa presa dal mercato.

**Regressione verso la media con coefficiente per ruolo.**
Misurata: difensori 0.38, centrocampisti 0.49, attaccanti 0.56. Senza,
i difensori risultavano al 29% del mercato e gli attaccanti al 24%; con, 21% e
42% contro un consenso di 12-16% e 45-50%.

**I livelli di riferimento erano sbagliati proprio sui portieri.**
Misurati: media voto 6.22 (avevo messo 5.90), fantamedia 5.11 (avevo messo 5.55).
Il portiere prende i voti piu' alti di tutti ma ha la fantamedia piu' bassa,
perche' ogni gol subito vale −1.

**Il modificatore si misura contro il difensore gratuito.**
Misurandolo contro gli altri titolari, alzare tutto il reparto insieme annullava
il vantaggio e il modificatore *abbassava* il valore dei difensori.

**L'inflazione e' a somma zero.**
Non "quanto si e' pagato finora" ma quanti crediti restano rispetto al valore che
resta. Se in apertura ci si svena sugli attaccanti, il resto va a sconto da solo:
e' la dinamica piu' sfruttabile di un'asta.

**Le strategie si confrontano sul guadagno sopra una rosa da un credito.**
Sui punti assoluti le sei strategie stavano in 0.6 punti su 78: il pavimento
comune nascondeva le differenze. Sul surplus la forbice diventa leggibile.

**La stagione in corso pesa poco sulla fantamedia e molto sulle presenze.**
Alla seconda giornata una fantamedia da 15 dice solo che ha segnato una doppietta;
ma due giornate dicono benissimo se il posto da titolare ce l'ha adesso.

## Dati

**Cinque stagioni invece di tre.** Piu' campione significa anche meno regressione
verso la media, quindi stime piu' nette.

**Il listone disattiva chi non c'e' piu'.** Un import del file dell'anno prima
aveva lasciato 190 giocatori fantasma nel database.

**Tipo di file e stagione si scelgono a mano.** Indovinare l'anno e' il modo piu'
rapido per sovrascrivere l'annata sbagliata senza accorgersene.

**Il paese si guarda prima del nome.** "Serie A" esiste in Italia e in Brasile.
Un alias "italia" faceva finire "Coppa Italia" sul campionato di Serie A.

**Una fonte migliore vince, non si somma.** Sommare i gol trovati dall'API a
quelli riportati dall'AI raddoppiava lo stesso giocatore.

**Il nome lo corregge l'archivio.** L'AI aveva battezzato Woltemade "Sergiusz";
API-Football dice "Niclas". L'AI propone, l'archivio verifica.

**Le stagioni si accettano in qualsiasi formato.** I modelli scrivono `2025/26`,
`2025-2026`, `2025`. Accettarne una sola faceva buttare via risposte corrette:
e' il motivo per cui la carriera tornava vuota.

## Modelli AI

**Scelti misurando** (`npm run check:models`), non dal listino prezzi:

| Modello | Giusti su 6 | Costo | Tempo | Formato |
|---|---|---|---|---|
| google/gemini-2.5-flash-lite | 4 | $0.0079 | 4.2s | stabile |
| anthropic/claude-haiku-4.5 | 4 | $0.0163 | 7.2s | stabile |
| z-ai/glm-5.3-flash | 6, poi 0 | $0.0076 | 12-35s | instabile |
| deepseek/deepseek-v4-flash | 4 | $0.0076 | 17.0s | instabile |
| qwen/qwen3.5-flash | 0 | $0.0070 | 4.1s | instabile |

I modelli cinesi costano un quarto e a volte sono i migliori — GLM ha fatto 6 su 6
dove nessun altro arrivava a 5 — ma al giro successivo tornano illeggibili. In una
catena automatica l'instabilita' costa piu' di quanto risparmi: default stabile,
con ripiego automatico su Haiku quando la risposta non si legge.

**Il formato si chiede come parametro, non a parole.** Con `response_format`
DeepSeek e' passato da 0/6 a 4/6.

**Identificazione e statistiche sono due passaggi separati**, e le statistiche si
chiedono un giocatore per chiamata: la ricerca web restituisce pochi risultati per
richiesta, e divisi fra sei persone non bastano a verificare niente. Il modello lo
diceva pure, nelle sue note.

**La spesa e' la ricerca web, non il modello.** Fatturata a risultato: la
scorciatoia `:online` ne chiede cinque, ~$0.10 a chiamata contro $0.012 di token.

## Infrastruttura

**Le funzioni girano a Francoforte.** Per impostazione predefinita finivano a
`iad1` mentre il database sta a `eu-central-1`: le pagine passavano da 1.0-1.4
secondi a 0.22-0.31.

**Niente registrazione pubblica, bloccata nel database.** La chiave anon viaggia
nel browser: nascondere il form non sarebbe servito a niente.

**Il test deve chiamare il percorso vero.** Un bug e' arrivato in produzione con
tutti i test verdi perche' lo script riscriveva la logica della route invece di
chiamarla, e nella copia il bersaglio dell'upsert era giusto.

**Il provider sta nel layout.** Next lo conserva fra le schede: durante un'asta,
dove si salta di continuo, e' la differenza piu' sensibile.


## La taratura sui prezzi di un'asta vera

I prezzi dell'asta 2025-26 di questa lega — otto squadre, 500 crediti a testa,
199 giocatori comprati per 3810 crediti — dicono che le ancore usate finora
(`280, 240`) erano troppo alte: il piu' caro e' andato a **181**, non a 280.

Rifacendo il listino con le ancore vere, due statistiche che la taratura **non**
insegue si allineano da sole:

| | il piu' caro | mediana | a 5 crediti o meno |
|---|---|---|---|
| ancore `280, 240` | 256 | 1 | 116 su 200 |
| ancore vere `181, 170, 153, 118, 117` | 205 | **8** | **88 su 200** |
| senza ancore (solo listino) | 156 | 12 | 46 su 200 |
| **l'asta vera** | **181** | **8** | **86 su 199** |

La bisezione insegue la somma dei piu' cari, quindi che il vertice si avvicini
non dimostra niente. Mediana e coda no: quelle escono da sole, e con le ancore
vere combaciano (8 contro 8, 88 contro 86). E' la prova che la **forma** della
curva e' giusta, non solo il suo punto piu' alto.

Con le ancore vecchie il software diceva 1 credito a meta' dei giocatori che il
mercato paga 8: chi lo avesse seguito avrebbe perso ogni giocatore di
centroclassifica.
