/**
 * Dove stanno le impronte vocali: **solo su questo dispositivo**.
 *
 * Un'impronta vocale e' un dato personale di qualcun altro, raccolto in una
 * stanza per un pomeriggio. Non va su un server, non esce dal telefono di chi
 * la usa, e sparisce quando lui la cancella. Non e' nemmeno un sacrificio: serve
 * al dispositivo che ascolta, e a nessun altro.
 */
import { type Profilo } from "./voce";

const chiave = (legaId: string) => `fantasta:voci:${legaId}`;

/**
 * Una copia in memoria, perche' React possa leggerla senza effetti.
 *
 * `useSyncExternalStore` vuole che due letture di fila diano lo **stesso**
 * oggetto finche' niente e' cambiato: leggere e ripassare da JSON.parse ogni
 * volta creerebbe un array nuovo a ogni render e il componente si
 * ridisegnerebbe all'infinito.
 */
const inMemoria = new Map<string, Profilo[]>();
const ascoltatori = new Set<() => void>();
const nessuno: Profilo[] = [];

export function abbonatiAiProfili(fn: () => void): () => void {
  ascoltatori.add(fn);
  return () => {
    ascoltatori.delete(fn);
  };
}

/** Sul server non c'e' localStorage: si parte da vuoto e si legge a idratazione fatta. */
export function profiliInMemoria(legaId: string): Profilo[] {
  return inMemoria.get(legaId) ?? nessuno;
}

function aggiorna(legaId: string, profili: Profilo[]): Profilo[] {
  inMemoria.set(legaId, profili);
  for (const f of ascoltatori) f();
  return profili;
}

export function leggiProfili(legaId: string): Profilo[] {
  if (typeof window === "undefined") return nessuno;
  const gia = inMemoria.get(legaId);
  if (gia) return gia;
  try {
    const grezzo = window.localStorage.getItem(chiave(legaId));
    if (!grezzo) return aggiorna(legaId, []);
    const j: unknown = JSON.parse(grezzo);
    if (!Array.isArray(j)) return aggiorna(legaId, []);
    const buoni = j.filter(
      (x): x is Profilo =>
        typeof x === "object" &&
        x !== null &&
        typeof (x as Profilo).participantId === "string" &&
        Array.isArray((x as Profilo).impronta),
    );
    return aggiorna(legaId, buoni);
  } catch {
    // localStorage puo' non esserci (finestra anonima, impostazioni del browser):
    // e' una comodita' in piu', non qualcosa su cui reggersi.
    return aggiorna(legaId, []);
  }
}

export function salvaProfili(legaId: string, profili: Profilo[]): Profilo[] {
  try {
    window.localStorage.setItem(chiave(legaId), JSON.stringify(profili));
  } catch {
    /* niente da fare: si resta senza riconoscimento delle voci */
  }
  return aggiorna(legaId, profili);
}

export function salvaProfilo(legaId: string, p: Profilo): Profilo[] {
  const tutti = leggiProfili(legaId).filter((x) => x.participantId !== p.participantId);
  tutti.push(p);
  return salvaProfili(legaId, tutti);
}

export function cancellaProfilo(legaId: string, participantId: string): Profilo[] {
  return salvaProfili(
    legaId,
    leggiProfili(legaId).filter((x) => x.participantId !== participantId),
  );
}
