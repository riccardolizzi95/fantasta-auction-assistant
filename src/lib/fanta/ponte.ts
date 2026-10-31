import type { Role } from "./types";

/**
 * Il ponte che guarda il tabellone.
 *
 * FantaAstaLive non ha API, e il suo database rifiuta chiunque non sia la sua
 * applicazione. Quello che pero' si puo' fare senza scavalcare niente e'
 * **leggere la pagina che l'utente ha gia' davanti**: un pezzo di codice che
 * gira in quella scheda, guarda cosa c'e' scritto e lo racconta a noi.
 *
 * Legge tutto **dalla pagina**, e nient'altro:
 *
 * - **chi e' sul piatto**: dalla figurina, che porta l'identificativo ufficiale
 *   nel nome del file (`.../card/6813.png` → Torriani). Esatto, non interpretato.
 * - **chi ha comprato**: dalle colonne delle squadre, trovate cercando a
 *   schermo il nome della squadra — che ci dice il nostro server, perche' di
 *   la' non si ricava da nessuna parte — e salendo finche' non compare anche
 *   il nome di un'altra squadra.
 *
 *   Il testo di una colonna e' `Giorgio | Gila | 35 | Theate | 400 | ...` e
 *   dopo i giocatori continua con i contatori dei reparti. **Dove finiscono i
 *   giocatori lo dice il nome, non il numero**: una riga di rosa ha una lettera
 *   nel nome e solo cifre nel prezzo. Fidarsi della barra dei contatori
 *   (`/6`) non bastava: in certe disposizioni la barra non c'e', e il lettore
 *   proseguiva dentro i contatori leggendo "giocatori" chiamati `0`, `2`, `4`.
 *
 * L'archivio locale e' stato provato due volte e scartate tutte e due: su una
 * scheda da spettatore le rose restano a zero e i nomi delle squadre sono
 * vuoti, perche' lo stato arriva dalla rete e non viene riscritto. Domani, se
 * conduce un altro, il ponte girera' proprio su una scheda da spettatore.
 *
 * Ogni giro confronta **tutta** la rosa con quello che ha gia' mandato: cosi'
 * acceso a meta' asta recupera da solo il pregresso, e due acquisti nello
 * stesso secondo non se ne perde uno. La squadra e' la posizione della colonna,
 * che e' l'ordine con cui il nostro file le ha scritte di la'.
 *
 * Verso FantaAstaLive non scrive **mai** niente: se smette di funzionare, il
 * tabellone non se ne accorge nemmeno.
 */

/**
 * L'unica pagina su cui il ponte ha senso.
 *
 * Un preferito si clicca su qualunque scheda, e capita di sbagliare mira: se
 * parte altrove non trova niente da leggere ma resta a chiamare la nostra API
 * ogni secondo, dentro una pagina che non c'entra. Meglio che si rifiuti.
 */
const OSPITE = "fanta-asta-live.fantacalcio.it";

/** Come FantaAstaLive chiama i reparti, e come li chiamiamo noi. */
export const ROLE_DA_ZONA: Record<string, Role> = {
  gk: "P",
  def: "D",
  mid: "C",
  atk: "A",
};

export type AcquistoPonte = {
  /** Il nome come lo scrive il tabellone: la nostra anagrafica e' la stessa. */
  nome?: string;
  /** L'identificativo ufficiale, quando si riesce a leggerlo. */
  ext?: number;
  /** Il numero che FantaAstaLive da' alla squadra: 0 e' la prima. */
  squadra: number;
  prezzo: number;
  /** Il reparto che si e' riempito di la', per la controprova. */
  zona?: string;
};

export type SegnalePonte = {
  token: string;
  /**
   * Cosa vede il ponte, quando non riesce a leggere.
   *
   * Non serve al funzionamento: serve a smettere di indovinare. Quando dalle
   * colonne non esce nessun giocatore, il ponte manda le prime righe di tutte
   * le regioni candidate e il server le deposita nella lega, dove si possono
   * guardare con calma.
   */
  diagnosi?: unknown;
  /**
   * Chi e' sul piatto adesso.
   *
   * Tre valori, e sono tre cose diverse: un numero e' "e' lui", `null`
   * **dichiarato** e' "il piatto e' vuoto", e **assente** e' "non ho niente da
   * dire". Confondere gli ultimi due e' costato caro in prova: il battito ogni
   * venti secondi mandava `null` senza volerlo, e cancellava il giocatore
   * chiamato mentre l'asta era in corso.
   */
  chiamato?: number | null;
  acquisti?: AcquistoPonte[];
  /**
   * Le rose intere, come stanno adesso sul tabellone.
   *
   * Non e' un elenco di novita': e' **come stanno le cose adesso**, e da qui
   * si riconosce tutto quello che di la' si fa a mano su una rosa gia' fatta.
   * Chi non c'e' piu' e' stato cancellato. Chi c'e' sotto un'altra squadra e'
   * stato spostato — un'aggiudicazione data alla persona sbagliata si
   * corregge cosi', e il ponte prima non se ne accorgeva: la vecchia
   * assegnazione restava da noi per sempre. Chi c'e' a un prezzo diverso e'
   * stato corretto nella cifra.
   *
   * Arriva solo quando il ponte ha trovato **tutte** le colonne e ci ha letto
   * qualcosa: una lettura parziale che sembrasse una rosa vuota cancellerebbe
   * un'asta intera, ed e' il danno peggiore che questo ponte potrebbe fare.
   */
  rose?: { nome: string; squadra: number; prezzo?: number }[];
  /**
   * I nomi delle squadre letti sul tabellone, quando qualcuno non torna.
   *
   * Le colonne si trovano cercando i nostri nomi, quindi una squadra che di
   * la' si chiama diversamente e' invisibile: non si trova la colonna, e non
   * si puo' nemmeno dire come si chiama. Questo elenco nasce da un ancoraggio
   * diverso — la riga "Budget" che chiude ogni rosa — e serve solo a
   * proporre l'aggancio: non muove niente da solo.
   *
   * Si calcola **solo** quando una colonna manca all'appello. A regola
   * funzionante non gira mai, e non puo' rompere un ponte che sta lavorando.
   */
  squadreViste?: string[];
};

/**
 * Dove finiscono i giocatori, in una colonna del tabellone.
 *
 * Il testo di una colonna continua, dopo le rose, con i contatori dei reparti.
 * Distinguerli dai numeri non basta: in certe disposizioni i contatori sono
 * `0` e `6` su righe separate, senza la barra, e il lettore proseguiva dentro
 * registrando "giocatori" chiamati `0`, `2`, `4` — sessantacinque per cinque
 * squadre. A dirlo e' la **forma**: una riga di rosa ha una lettera nel nome e
 * solo cifre nel prezzo.
 *
 * Le due regole stanno qui perche' finiscono sia nel preferito sia nel
 * controllo: se cambiano, cambiano in un posto solo.
 */
export const NOME_DI_ROSA = /[a-zA-Z]/;
export const FINE_ROSA = /^(Budget|Max)$/;
/**
 * La riga che chiude una colonna, e ce n'e' **una sola** per squadra.
 *
 * Serve a contare le colonne, e per contarle non va bene `FINE_ROSA`: il piede
 * di ogni colonna porta tutte e due le etichette — "500 Budget" e "476 Max" —
 * quindi contando quelle si contava due volte la stessa squadra, il blocco
 * sembrava contenerne due e veniva scartato. Misurato sul tabellone vero, non
 * dedotto: la prima versione di questa ricerca non trovava niente.
 */
export const CHIUSURA_ROSA = /^Budget$/;
export const PASTIGLIA = /^[PDCA]$/;
export const SOLO_CIFRE = /^[0-9]+$/;

/**
 * Le coppie giocatore-prezzo di una colonna.
 *
 * Non si puo' leggere a passo fisso: a seconda della disposizione una riga di
 * rosa e' `Gila | 35` oppure `D | Gila | 35`, con la pastiglia del ruolo
 * davanti. E dopo le rose il testo continua con i contatori dei reparti e col
 * budget, che sono numeri come i prezzi.
 *
 * Si legge quindi a stati: si tiene da parte l'ultimo nome visto e lo si
 * chiude quando arriva una riga di sole cifre. Una cifra senza un nome in
 * attesa e' un contatore e si ignora; una pastiglia di una lettera sola si
 * salta; `Budget` e `Max` chiudono la colonna, perche' li' i numeri sono del
 * bilancio e accoppiarli farebbe comparire in rosa un giocatore di nome
 * "Budget".
 */
export function coppieDiRosa(righe: string[], da: number) {
  const out: { nome: string; prezzo: number }[] = [];
  let atteso: string | null = null;
  for (let j = da; j < righe.length && out.length < 30; j++) {
    const r = righe[j];
    if (FINE_ROSA.test(r)) break;
    if (SOLO_CIFRE.test(r)) {
      if (atteso) {
        out.push({ nome: atteso, prezzo: parseInt(r, 10) || 0 });
        atteso = null;
      }
      continue;
    }
    if (PASTIGLIA.test(r)) continue;
    if (r.indexOf("Nessun calciatore") === 0) {
      atteso = null;
      continue;
    }
    if (!NOME_DI_ROSA.test(r)) {
      atteso = null;
      continue;
    }
    atteso = r;
  }
  return out;
}

/**
 * Il codice che gira nella pagina del tabellone.
 *
 * Esce di qui gia' cucito sulla lega: indirizzo, segreto e nient'altro. Si
 * installa come preferito e si clicca una volta, sulla scheda di
 * FantaAstaLive. Da li' in poi guarda ogni secondo e parla solo quando qualcosa
 * cambia davvero.
 */
export function codiceDelPonte(base: string, idLega: string, token: string): string {
  const url = `${base}/api/lega/${idLega}/fantaastalive/live`;
  return `(()=>{
if(location.hostname!==${JSON.stringify(OSPITE)}){alert('Questo e\\' il ponte di FantAsta: va acceso sulla scheda di FantaAstaLive, non qui.');return}
if(window.__fantastaPonte){alert('Il ponte e\\' gia\\' acceso su questa scheda.');return}
window.__fantastaPonte=1;
var URL_API=${JSON.stringify(url)},TOKEN=${JSON.stringify(token)},ACAPO=String.fromCharCode(10);
var vivo=true,ultimoChiamato=null,inviati={},totale=0,ultimoEvento='acceso',stato401=false,vuoti=0,piattoVuoto=false;
var colonne=null,prossimaCaccia=0,inCorso=false,nomiSquadre=[],ultimeRighe=[],letteQualcosa=false,prossimaDiagnosi=0,prossimoRiporto=0,prossimoBattito=0,firmaRose='',prossimeSquadre=0,ultimeSquadreViste='',quanteViste=-1;
var box=document.createElement('div');
box.style.cssText='position:fixed;z-index:2147483647;right:12px;bottom:12px;background:#111;color:#0f0;font:12px monospace;padding:8px 10px;border-radius:8px;opacity:.92;max-width:340px;cursor:pointer';
document.body.appendChild(box);
box.onclick=function(){vivo=false;box.textContent='ponte FantAsta: spento';setTimeout(function(){box.remove();window.__fantastaPonte=0},1500)};
function foglieCol(nome){
  var out=[],tutti=document.querySelectorAll('div,span,p,b,strong,h1,h2,h3,h4');
  for(var i=0;i<tutti.length&&out.length<8;i++){
    var f=tutti[i];
    if(!f.children.length&&(f.textContent||'').trim()===nome)out.push(f);
  }
  return out;
}
function risali(e,i){
  var p=e,col=null;
  for(var n=0;n<9&&p.parentElement;n++){
    p=p.parentElement;
    var t=p.innerText||'';
    var altrui=false;
    for(var k=0;k<nomiSquadre.length;k++){
      if(k!==i&&nomiSquadre[k]&&t.indexOf(nomiSquadre[k])>=0){altrui=true;break}
    }
    if(altrui)break;
    col=p;
  }
  return col;
}
function leggiCol(col,nome){
  var out=[];
  if(!col)return out;
  var righe=(col.innerText||'').split(ACAPO).map(function(x){return x.trim()}).filter(Boolean);
  var k=righe.indexOf(nome);
  if(k<0)return out;
  var atteso=null;
  for(var j=k+1;j<righe.length&&out.length<30;j++){
    var r=righe[j];
    if(${FINE_ROSA}.test(r))break;
    if(${SOLO_CIFRE}.test(r)){
      if(atteso){out.push({nome:atteso,prezzo:parseInt(r,10)||0});atteso=null}
      continue;
    }
    if(${PASTIGLIA}.test(r))continue;
    if(r.indexOf('Nessun calciatore')===0){atteso=null;continue}
    if(!${NOME_DI_ROSA}.test(r)){atteso=null;continue}
    atteso=r;
  }
  return out;
}
// Le squadre che stanno sul tabellone, comunque si chiamino.
//
// Due strade, e la prima e' quella che sappiamo gia' funzionare: le colonne
// trovate per i nostri nomi hanno un padre in comune - e' garantito da come
// risali() si ferma, cioe' appena l'antenato contiene il nome di un'altra
// squadra - e i suoi figli sono le colonne, **tutte**, anche quelle che non
// sapevamo di cercare. Il nome e' la prima riga buona di ogni figlio.
//
// La seconda parte dal basso: ogni colonna porta una riga "Budget", e da li'
// si risale. Serve solo quando nessuno dei nostri nomi combacia e quindi non
// c'e' nessuna colonna da cui partire.
//
// Si conta "Budget" e non FINE_ROSA: il piede di ogni colonna porta tutte e
// due le etichette - "500 Budget" e "476 Max" - e contandole entrambe ogni
// colonna sembrava contenere due squadre e veniva scartata. Misurato sul
// tabellone vero, dove la prima versione non trovava niente.
function nomeDiColonna(e){
  var righe=(e.innerText||'').split(ACAPO).map(function(x){return x.trim()}).filter(Boolean);
  var quante=0,nome=null;
  for(var q=0;q<righe.length;q++){
    var t=righe[q];
    if(${CHIUSURA_ROSA}.test(t))quante++;
    if(${FINE_ROSA}.test(t))continue;
    if(nome===null&&!${SOLO_CIFRE}.test(t)&&!${PASTIGLIA}.test(t)&&${NOME_DI_ROSA}.test(t))nome=t;
  }
  return quante===1?nome:null;
}
function squadreDaiFratelli(){
  var out=[];
  if(!colonne)return out;
  var padre=null;
  for(var i=0;i<colonne.length;i++){
    if(colonne[i]&&colonne[i].parentElement&&document.contains(colonne[i])){padre=colonne[i].parentElement;break}
  }
  if(!padre)return out;
  var figli=padre.children;
  for(var k=0;k<figli.length&&out.length<24;k++){
    var nome=nomeDiColonna(figli[k]);
    if(nome&&out.indexOf(nome)<0)out.push(nome);
  }
  return out;
}
function squadreDalBasso(){
  var out=[],tutti=document.querySelectorAll('div,span,p,b,strong,h1,h2,h3,h4,small,label,em,i,td,li');
  for(var i=0;i<tutti.length&&out.length<24;i++){
    var f=tutti[i];
    if(f.children.length)continue;
    if(!${CHIUSURA_ROSA}.test((f.textContent||'').trim()))continue;
    var p=f;
    for(var n=0;n<9&&p.parentElement;n++){
      p=p.parentElement;
      var nome=nomeDiColonna(p);
      if(nome){if(out.indexOf(nome)<0)out.push(nome);break}
      var righe=(p.innerText||'').split(ACAPO);
      var quante=0;
      for(var q=0;q<righe.length;q++)if(${CHIUSURA_ROSA}.test(righe[q].trim()))quante++;
      if(quante>1)break;
    }
  }
  return out;
}
function squadreDelTabellone(){
  var out=squadreDaiFratelli();
  return out.length?out:squadreDalBasso();
}
function cercaColonne(){
  var out=[];
  for(var i=0;i<nomiSquadre.length;i++){
    var nome=nomiSquadre[i],foglie=foglieCol(nome),meglio=null,quanti=-1;
    for(var f=0;f<foglie.length;f++){
      var cand=risali(foglie[f],i);
      if(!cand)continue;
      var letti=leggiCol(cand,nome).length;
      var vuota=(cand.innerText||'').indexOf('Nessun calciatore')>=0?1:0;
      var punti=letti*10+vuota;
      if(punti>quanti){quanti=punti;meglio=cand}
    }
    out.push(meglio);
  }
  return out;
}
function colonneOk(){
  if(!colonne||colonne.length!==nomiSquadre.length)return false;
  for(var i=0;i<colonne.length;i++)if(!colonne[i]||!document.contains(colonne[i]))return false;
  return true;
}
function roseDallaPagina(){
  var out=[];
  if(!nomiSquadre.length)return out;
  var scaduto=Date.now()>=prossimaCaccia;
  if((!colonneOk()||!letteQualcosa)&&scaduto){
    colonne=cercaColonne();
    prossimaCaccia=Date.now()+5000;
  }
  if(!colonne)return out;
  for(var c=0;c<colonne.length;c++){
    if(!colonne[c]||!document.contains(colonne[c]))continue;
    var righe=(colonne[c].innerText||'').split(ACAPO).map(function(x){return x.trim()}).filter(Boolean);
    ultimeRighe[c]=righe.slice(0,10);
    var dentro=leggiCol(colonne[c],nomiSquadre[c]);
    for(var d=0;d<dentro.length;d++)out.push({squadra:c,nome:dentro[d].nome,prezzo:dentro[d].prezzo});
  }
  letteQualcosa=out.length>0;
  return out;
}
// Se questa immagine e' davvero sullo schermo.
//
// A asta sospesa il tabellone toglie la card dalla vista ma lascia il nodo in
// pagina: senza questa prova il ponte continuava a leggere il giocatore di
// prima, e bastava una rotellata - che fa ridisegnare la pagina e sparire il
// nodo - perche' si sbloccasse da solo. Quel dettaglio, "con lo scroll passa",
// e' la firma di un nodo rimasto li'.
//
// Misurato in un browser vero, su tutti i modi di nascondere qualcosa:
// display:none, visibility:hidden, content-visibility:hidden e opacita' zero
// danno nascosta; un pannello a opacita' 0.92 e una card scrollata fuori dallo
// schermo restano visibili, e devono - altrimenti scorrere la pagina
// chiuderebbe la chiamata.
//
// Resta scoperto un solo modo: un pannello richiuso a height:0 con
// overflow:hidden, dove il nodo figlio conserva le sue misure. Risalire i
// genitori per accorgersene e' stato provato e buttato: su una pagina vera
// anche body puo' essere largo zero e ritagliare, e la regola dichiarava
// nascosta ogni card. Meglio un buco noto che un ponte cieco.
function inVista(e){
  var r=e.getBoundingClientRect();
  if(!r.width||!r.height)return false;
  try{if(e.checkVisibility)return e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})}catch(x){}
  return true;
}
function chiamato(){
  var imgs=document.images;
  for(var i=0;i<imgs.length;i++){
    var m=/\\/card\\/(\\d+)\\.png/.exec(imgs[i].src);
    if(m&&inVista(imgs[i]))return Number(m[1]);
  }
  return null;
}
function riporta(che){
  if(Date.now()<prossimoRiporto)return;
  prossimoRiporto=Date.now()+15000;
  try{
    fetch(URL_API,{method:'POST',headers:{'content-type':'text/plain'},
      body:JSON.stringify({token:TOKEN,diagnosi:che})});
  }catch(e){}
}
function giro(){
  if(!vivo||inCorso)return;
  inCorso=true;
  try{unGiro()}catch(e){
    ultimoEvento='errore: '+(e&&e.message||e);
    box.textContent='ponte: '+ultimoEvento;
    riporta({errore:String(e&&e.stack||e),quando:new Date().toISOString()});
  }
  inCorso=false;
}
function unGiro(){
  var rose=roseDallaPagina(),ora=chiamato();
  var nuovi=[];
  for(var i=0;i<rose.length;i++){
    var chiave=rose[i].squadra+'|'+rose[i].nome;
    if(!inviati[chiave]){inviati[chiave]=1;nuovi.push(rose[i])}
  }
  var mandaChiamato=(ora&&ora!==ultimoChiamato)?ora:null;
  if(ora){ultimoChiamato=ora;vuoti=0;piattoVuoto=false}
  else{
    vuoti++;
    if(vuoti===3&&ultimoChiamato!==null){mandaChiamato=null;piattoVuoto=true;ultimoChiamato=null}
  }
  var trovate=0;if(colonne)for(var q=0;q<colonne.length;q++)if(colonne[q])trovate++;
  var diagnosi=null;
  if(!rose.length&&nomiSquadre.length&&Date.now()>=prossimaDiagnosi){
    prossimaDiagnosi=Date.now()+15000;
    diagnosi={quando:new Date().toISOString(),squadre:nomiSquadre,lette:squadreDelTabellone(),regioni:[]};
    for(var t=0;t<nomiSquadre.length&&t<10;t++){
      var fo=foglieCol(nomiSquadre[t]);
      for(var y=0;y<fo.length&&y<4;y++){
        var cd=risali(fo[y],t);
        diagnosi.regioni.push({
          squadra:nomiSquadre[t],occorrenza:y,
          righe:cd?(cd.innerText||'').split(ACAPO).map(function(x){return x.trim()}).filter(Boolean).slice(0,16):null
        });
      }
    }
  }
  // Sempre, ogni venti secondi, non solo quando una nostra colonna manca.
  // Guardare solo le nostre era cieco per meta': con tre squadre da noi e
  // cinque di la' si trovavano tre colonne su tre, tutto sembrava a posto, e
  // le altre due non le cercava nessuno. Devono battere i nomi **e** il
  // numero, e il numero si sa solo contando quelle di la'.
  var viste=null;
  if(Date.now()>=prossimeSquadre){
    prossimeSquadre=Date.now()+15000;
    var lette=squadreDelTabellone();
    quanteViste=lette.length;
    if(lette.length&&lette.join('|')!==ultimeSquadreViste){ultimeSquadreViste=lette.join('|');viste=lette}
  }
  var stato=' ['+trovate+'/'+nomiSquadre.length+' colonne, '+rose.length+' in rosa'+(quanteViste>=0?', '+quanteViste+' squadre sul tabellone':'')+']';
  var spia=(trovate&&!rose.length&&ultimeRighe[0])?('  vedo: '+ultimeRighe[0].join(' | ')):'';
  box.textContent='ponte: '+ultimoEvento+(totale?'  ('+totale+' registrati)':'')+stato+spia;
  var battito=Date.now()>=prossimoBattito;
  var completo=trovate===nomiSquadre.length&&rose.length>0;
  // La firma delle rose: chi sta dove, e a quanto. Se cambia, di la' hanno
  // messo le mani su una rosa gia' fatta — cancellato, spostato, corretto un
  // prezzo — e la cosa va detta subito. Prima si aspettava il battito, fino a
  // venti secondi, e si vedeva.
  var firma=completo?rose.map(function(x){return x.squadra+'|'+x.nome+'|'+x.prezzo}).join(';'):'';
  var roseCambiate=completo&&firma!==firmaRose;
  if(!mandaChiamato&&!piattoVuoto&&!nuovi.length&&!roseCambiate&&!diagnosi&&!viste&&!battito&&nomiSquadre.length)return;
  prossimoBattito=Date.now()+20000;
  // Al battito partono comunque, anche identiche: e' la rete di sicurezza se
  // le due liste si fossero disallineate senza che di la' cambiasse niente.
  var mandaRose=completo&&(roseCambiate||battito);
  fetch(URL_API,{method:'POST',headers:{'content-type':'text/plain'},
    body:JSON.stringify({token:TOKEN,chiamato:piattoVuoto?null:(mandaChiamato||undefined),
      acquisti:nuovi,rose:mandaRose?rose:undefined,
      squadreViste:viste||undefined,
      diagnosi:diagnosi||undefined})})
   .then(function(r){stato401=(r.status===401);return r.json()})
   .then(function(j){
      if(stato401){
        vivo=false;
        box.textContent='ponte FantAsta: spento (segreto revocato)';
        setTimeout(function(){box.remove();window.__fantastaPonte=0},4000);
        return;
      }
      if(j.squadre&&j.squadre.length){
        if(j.squadre.join('|')!==nomiSquadre.join('|')){nomiSquadre=j.squadre;colonne=null;prossimaCaccia=0}
      }
      var m=[];
      if(j.chiamato)m.push('in asta: '+j.chiamato);
      if(j.registrati){totale+=j.registrati;m.push(j.registrati+' assegnati')}
      if(j.scartati&&j.scartati.length)m.push('!! '+j.scartati.join(' - '));
      if(j.error)m.push('errore: '+j.error);
      if(j.diagnosiRicevuta)m.push('diagnosi inviata');
      if(j.registrati)ultimoChiamato=null;
      if(j.rimossi)m.push(j.rimossi+' rimossi');
      if(j.spostati)m.push(j.spostati+' corretti');
      if(j.squadreViste)m.push('squadre lette: '+j.squadreViste);
      if(mandaRose)firmaRose=firma;
      piattoVuoto=false;
      ultimoEvento=m.length?m.join(' | '):'acceso';
   })
   .catch(function(e){
      ultimoEvento='non raggiungo FantAsta';
      riporta({errore:'consegna fallita: '+String(e&&e.message||e),acquisti:nuovi,quando:new Date().toISOString()});
      for(var i=0;i<nuovi.length;i++)delete inviati[nuovi[i].squadra+'|'+nuovi[i].nome];
   });
}
setInterval(giro,1000);giro();
})()`;
}

/**
 * Lo stesso codice, pronto da incollare nel campo indirizzo di un preferito.
 *
 * Un preferito e' **una riga sola**, e questo obbliga a togliere i commenti
 * prima di unirla: un `//` rimasto in mezzo commenterebbe via tutto quello che
 * segue, e il ponte si installerebbe muto senza dare segno di niente.
 * `npm run check:fantaastalive` lo verifica.
 */
export function preferitoDelPonte(base: string, idLega: string, token: string): string {
  const js = codiceDelPonte(base, idLega, token)
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r && !r.startsWith("//"))
    .join(" ");
  return "javascript:" + encodeURIComponent(js);
}
