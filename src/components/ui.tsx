import type { ReactNode } from "react";
import type { Role } from "@/lib/fanta/types";

const ROLE_COLOR: Record<Role, string> = {
  P: "var(--role-p)",
  D: "var(--role-d)",
  C: "var(--role-c)",
  A: "var(--role-a)",
};

export function RoleBadge({ role, size = "md" }: { role: Role; size?: "sm" | "md" }) {
  const color = ROLE_COLOR[role];
  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-bold ${
        size === "sm" ? "h-5 w-5 text-[0.62rem]" : "h-6 w-6 text-xs"
      }`}
      style={{ background: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
      title={role}
    >
      {role}
    </span>
  );
}

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-[var(--text-faint)]">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "var(--accent)"
      : tone === "warn"
        ? "var(--warn)"
        : tone === "bad"
          ? "var(--danger)"
          : "var(--text)";
  return (
    <div className="panel-flat px-3 py-2.5">
      <div className="label-xs">{label}</div>
      <div className="num mt-1 text-xl font-bold leading-none" style={{ color }}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[0.68rem] leading-snug text-[var(--text-faint)]">{hint}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-faint)]">
      {children}
    </div>
  );
}

export function Bar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-input)]">
      <div
        className="h-full rounded-full transition-all duration-300"
        style={{ width: `${pct}%`, background: color ?? "var(--accent)" }}
      />
    </div>
  );
}

/**
 * Un interruttore, non una spunta.
 *
 * La differenza non e' estetica: una casella dice "questa opzione e' vera", un
 * interruttore dice "questa parte e' accesa o spenta" — ed e' la seconda cosa
 * che serve quando accanto c'e' un blocco che compare e sparisce. Il pollice
 * che scorre e il colore che cambia sono l'unico modo di far capire, senza
 * scriverlo, che il click ha effetto su quello che sta sotto.
 */
export function Interruttore({
  acceso,
  onChange,
  titolo,
  sotto,
  name,
}: {
  acceso: boolean;
  onChange: (v: boolean) => void;
  titolo: ReactNode;
  sotto?: ReactNode;
  /** Se c'e', il valore viaggia anche nel form come "si" / "no". */
  name?: string;
}) {
  return (
    // Lo stile va in linea, non in una classe: la regola globale su `label`
    // (maiuscoletto spaziato, per le etichette dei campi) sta fuori da ogni
    // layer, e le dichiarazioni non stratificate battono le utility di
    // Tailwind qualunque sia la specificita'. Qui dentro ci sono frasi intere,
    // e in maiuscoletto diventano illeggibili.
    <label
      className="flex cursor-pointer select-none items-start gap-3"
      style={{
        textTransform: "none",
        letterSpacing: "normal",
        fontSize: "inherit",
        fontWeight: 400,
        color: "var(--text)",
        marginBottom: 0,
      }}
    >
      {name && <input type="hidden" name={name} value={acceso ? "si" : "no"} />}
      <span
        className="relative mt-0.5 inline-flex shrink-0 items-center rounded-full transition-colors duration-200"
        style={{
          width: "2.1rem",
          height: "1.2rem",
          background: acceso ? "var(--accent)" : "var(--border-strong)",
        }}
        onClick={(e) => {
          e.preventDefault();
          onChange(!acceso);
        }}
        role="switch"
        aria-checked={acceso}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === " " || e.key === "Enter") {
            e.preventDefault();
            onChange(!acceso);
          }
        }}
      >
        <span
          className="absolute rounded-full bg-white shadow transition-transform duration-200"
          style={{
            width: "0.9rem",
            height: "0.9rem",
            left: "0.15rem",
            transform: acceso ? "translateX(0.9rem)" : "translateX(0)",
          }}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium leading-tight">{titolo}</span>
        {sotto && (
          <span className="mt-0.5 block text-[0.68rem] leading-relaxed text-[var(--text-faint)]">
            {sotto}
          </span>
        )}
      </span>
    </label>
  );
}

/**
 * Un blocco che si apre e si chiude, non che si spegne e resta li'.
 *
 * Impallidire una sezione disattivata lascia sullo schermo lo spazio di
 * qualcosa che non serve. Chiusa, questa non occupa niente; e l'altezza si
 * anima, cosi' si capisce dove e' finita invece di vederla sparire di colpo.
 */
export function Fisarmonica({ aperta, children }: { aperta: boolean; children: ReactNode }) {
  return (
    <div
      className="grid transition-all duration-300 ease-out"
      style={{
        gridTemplateRows: aperta ? "1fr" : "0fr",
        opacity: aperta ? 1 : 0,
        marginTop: aperta ? "0.75rem" : "0",
      }}
      aria-hidden={!aperta}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}

/**
 * Le icone della rosa.
 *
 * Erano caratteri — ✎ ✕ ✓ — e a 10px un carattere e' un puntino grigio: si
 * capiva a fatica quale fosse quale. Questi sono tratti spessi, dimensionati
 * sul testo che li circonda, e prendono il colore da chi li contiene.
 */
/**
 * Uno spostamento: una freccia che passa da una parte all'altra.
 *
 * Serve a distinguere a colpo d'occhio, nei movimenti, la correzione di un
 * fatto gia' registrato da un acquisto nuovo.
 */
export function IconaSposta({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M3 8h13M12 4l4 4-4 4M21 16H8M12 12l-4 4 4 4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconaMatita({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 20h4L19 9a2.8 2.8 0 1 0-4-4L4 16v4Z"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconaCroce({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function IconaSpunta({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 12.5l5.5 5.5L20 7"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Riaprire: una freccia che torna indietro. */
export function IconaRiapri({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M4 10h9a5 5 0 1 1 0 10H8M4 10l4-4M4 10l4 4"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Un'informazione di servizio che non occupa una riga.
 *
 * Le spiegazioni "come funziona questa cosa" si leggono **una volta**, e poi
 * restano li' a mangiare spazio per tutta l'asta — quando lo spazio serve ai
 * numeri che cambiano. Qui diventano una ⓘ: chi non sa cosa sia una cosa ci
 * passa sopra, chi lo sa gia' vede solo un pallino grigio.
 *
 * Il testo sta anche in `title`, cosi' esiste per chi usa la tastiera e per
 * chi legge con uno screen reader, e non solo al passaggio del mouse.
 */
export function Aiuto({ children, largo = 16 }: { children: string; largo?: number }) {
  return (
    // Niente `title`: il suggerimento del sistema operativo compariva **insieme**
    // al nostro, sfalsato di qualche pixel, e due riquadri di testo sovrapposti
    // non si leggono ne' l'uno ne' l'altro. Per chi non usa il mouse resta
    // `aria-label`, che gli screen reader leggono e nessuno disegna.
    <span className="group relative inline-flex align-middle" tabIndex={0} aria-label={children}>
      <span
        className="inline-flex cursor-help items-center justify-center rounded-full border text-[0.58rem] font-bold leading-none"
        style={{
          width: "0.95rem",
          height: "0.95rem",
          borderColor: "var(--border-strong)",
          color: "var(--text-faint)",
        }}
        aria-hidden
      >
        i
      </span>
      <span
        /* `hidden` finche' non serve, non solo trasparente: un riquadro
           invisibile ma presente allarga comunque la pagina, ed e' cosi' che
           era comparsa la barra di scorrimento orizzontale. */
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 hidden -translate-x-1/2 rounded-md border px-2.5 py-1.5 text-[0.68rem] font-normal normal-case leading-relaxed tracking-normal shadow-lg group-hover:block group-focus:block"
        style={{
          width: `${largo}rem`,
          maxWidth: "80vw",
          borderColor: "var(--border-strong)",
          background: "var(--bg-elevated)",
          color: "var(--text-muted)",
        }}
      >
        {children}
      </span>
    </span>
  );
}

/**
 * La freccia di un blocco che si apre.
 *
 * Grande abbastanza da vedersi: il triangolino da sei pixel di prima si
 * distingueva a fatica dalla punteggiatura, e un blocco che si apre e non
 * sembra apribile e' un blocco che nessuno apre.
 */
export function IconaFreccia({ aperta, size = 16 }: { aperta: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{
        transform: aperta ? "rotate(90deg)" : "none",
        transition: "transform 200ms",
      }}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
