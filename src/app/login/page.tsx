"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(
        error.message === "Invalid login credentials"
          ? "Email o password non corretti."
          : error.message,
      );
      setLoading(false);
      return;
    }
    router.push(params.get("next") || "/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="panel w-full max-w-sm p-6">
      <div className="mb-6">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-2xl">⚽</span>
          <h1 className="text-lg font-bold tracking-tight">FantAsta</h1>
        </div>
        <p className="text-xs text-[var(--text-faint)]">
          Assistente d&apos;asta per il fantacalcio 2026/27
        </p>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="tu@email.it"
          />
        </div>
        <div>
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-[#5a2a2c] bg-[#2a1618] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      )}

      <button type="submit" disabled={loading} className="btn btn-primary mt-5 w-full">
        {loading ? "Accesso in corso…" : "Entra"}
      </button>

      <p className="mt-4 text-center text-[0.7rem] leading-relaxed text-[var(--text-faint)]">
        Non c&apos;è registrazione: gli account vengono creati dall&apos;amministratore della lega.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
