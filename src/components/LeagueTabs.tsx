"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { seg: "asta", label: "Asta" },
  { seg: "strategia", label: "Strategia" },
  { seg: "rose", label: "Rose" },
  { seg: "listone", label: "Listone" },
  { seg: "lista", label: "Lista" },
  { seg: "impostazioni", label: "Impostazioni" },
];

/**
 * La scheda attiva si ricava dall'indirizzo, non da una prop.
 *
 * Cosi' l'intestazione vive nel layout ed e' condivisa fra le pagine della lega:
 * cambiare scheda non ricarica ne' il server ne' il listone.
 */
export default function LeagueTabs({ leagueId }: { leagueId: string }) {
  const pathname = usePathname();
  const active = TABS.find((t) => pathname.endsWith(`/${t.seg}`))?.seg;

  return (
    /* Le schede scorrono dentro di se' quando la finestra si stringe, invece
       di spingere fuori il blocco a destra: `min-w-0` le lascia comprimere e
       `overflow-x-auto` da' loro una barra propria, corta, al posto di una
       barra lunga tutta la pagina. */
    <nav className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
      {TABS.map((t) => (
        <Link
          key={t.seg}
          href={`/lega/${leagueId}/${t.seg}`}
          prefetch
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
            active === t.seg
              ? "bg-[var(--bg-elevated)] text-[var(--text)]"
              : "text-[var(--text-faint)] hover:text-[var(--text)]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
