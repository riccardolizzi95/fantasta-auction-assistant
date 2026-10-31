"use client";

import { useActionState } from "react";
import {
  adminCreateUser,
  adminSetLevel,
  adminSetPassword,
  changeOwnPassword,
  type AdminActionState,
} from "@/app/actions";
import { ETICHETTA_LIVELLO, livelloDa } from "@/lib/livelli";
import { Panel } from "@/components/ui";

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  is_premium: boolean;
  created_at: string;
};

function Feedback({ state }: { state: AdminActionState }) {
  if (!state) return null;
  if (state.error)
    return (
      <p className="mt-3 rounded-md border border-[#5a2a2c] bg-[#2a1618] px-3 py-2 text-xs text-[var(--danger)]">
        {state.error}
      </p>
    );
  return (
    <p className="mt-3 rounded-md border border-[var(--accent-dim)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-3 py-2 text-xs text-[var(--accent)]">
      {state.ok}
    </p>
  );
}

export default function AdminPanel({ users, myId }: { users: UserRow[]; myId: string }) {
  const [createState, createAction, creating] = useActionState(adminCreateUser, null);
  const [pwdState, pwdAction, savingPwd] = useActionState(adminSetPassword, null);
  const [lvlState, lvlAction, savingLvl] = useActionState(adminSetLevel, null);
  const [ownState, ownAction, savingOwn] = useActionState(changeOwnPassword, null);

  return (
    <div className="space-y-5">
      <Panel
        title="Cambia la tua password"
        subtitle="Se stai ancora usando quella temporanea, cambiala adesso."
      >
        <form action={ownAction} className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="own_pwd">Nuova password</label>
            <input
              id="own_pwd"
              name="password"
              type="password"
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="almeno 8 caratteri"
            />
          </div>
          <button className="btn btn-primary" disabled={savingOwn}>
            {savingOwn ? "Salvo…" : "Cambia password"}
          </button>
        </form>
        <Feedback state={ownState} />
      </Panel>

      <Panel
        title="Crea un account"
        subtitle="Non c'è registrazione pubblica: gli accessi li apri tu, uno per fantallenatore."
      >
        <form action={createAction} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required placeholder="amico@email.it" />
            </div>
            <div>
              <label htmlFor="display_name">Nome</label>
              <input id="display_name" name="display_name" placeholder="Come lo chiami" />
            </div>
            <div>
              <label htmlFor="password">Password iniziale</label>
              <input
                id="password"
                name="password"
                type="text"
                minLength={8}
                required
                placeholder="almeno 8 caratteri"
              />
            </div>
          </div>
          <div style={{ maxWidth: "22rem" }}>
            <label htmlFor="livello_nuovo">Livello</label>
            <select id="livello_nuovo" name="livello" defaultValue="base">
              <option value="base">Base — segue l&apos;asta, nessun consiglio</option>
              <option value="premium">Premium — vede prezzi, tetti e strategia</option>
              <option value="admin">Amministratore — premium, più account e listone</option>
            </select>
          </div>
          <button className="btn btn-primary" disabled={creating}>
            {creating ? "Creo…" : "Crea account"}
          </button>
        </form>
        <Feedback state={createState} />
      </Panel>

      <Panel title={`Account attivi (${users.length})`}>
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.id} className="panel-flat flex flex-wrap items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {u.display_name}
                  <span
                    className="chip ml-2"
                    style={
                      u.is_admin
                        ? { color: "var(--warn)", borderColor: "var(--warn)" }
                        : u.is_premium
                          ? { color: "var(--accent)", borderColor: "var(--accent-dim)" }
                          : undefined
                    }
                  >
                    {ETICHETTA_LIVELLO[livelloDa(u)].toLowerCase()}
                  </span>
                  {u.id === myId && (
                    <span
                      className="chip ml-2"
                      style={{ color: "var(--accent)", borderColor: "var(--accent-dim)" }}
                    >
                      tu
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-[var(--text-faint)]">{u.email}</span>
              </span>
              <form action={lvlAction} className="flex items-center gap-2">
                <input type="hidden" name="user_id" value={u.id} />
                <select
                  name="livello"
                  defaultValue={livelloDa(u)}
                  style={{ width: "9.5rem" }}
                  disabled={savingLvl}
                >
                  <option value="base">Base</option>
                  <option value="premium">Premium</option>
                  <option value="admin">Amministratore</option>
                </select>
                <button className="btn btn-sm" disabled={savingLvl}>
                  {savingLvl ? "…" : "Applica"}
                </button>
              </form>
              <form action={pwdAction} className="flex items-center gap-2">
                <input type="hidden" name="user_id" value={u.id} />
                <input
                  name="password"
                  type="text"
                  minLength={8}
                  placeholder="nuova password"
                  className="w-44"
                  style={{ width: "11rem" }}
                />
                <button className="btn btn-sm" disabled={savingPwd}>
                  Reimposta
                </button>
              </form>
            </div>
          ))}
        </div>
        <Feedback state={lvlState} />
        <Feedback state={pwdState} />
      </Panel>
    </div>
  );
}
