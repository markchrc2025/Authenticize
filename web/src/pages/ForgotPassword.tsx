import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: "/reset-password" }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.message ?? "Could not send the reset email.");
      }
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the reset email.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="text-3xl">🔐</div>
          <h1 className="mt-2 text-xl font-semibold text-slate-100">Reset password</h1>
          <p className="mt-1 text-sm text-muted">
            We'll email you a link to set a new password.
          </p>
        </div>
        {sent ? (
          <div className="card p-6 text-center">
            <div className="text-2xl">📮</div>
            <p className="mt-3 text-sm text-slate-200">
              If an account exists for <span className="code">{email}</span>, a reset
              link is on its way. It expires in 1 hour.
            </p>
            <Link to="/login" className="btn-secondary mt-5 inline-flex">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form className="card space-y-4 p-6" onSubmit={submit}>
            <div>
              <label className="label" htmlFor="fp-email">
                Email
              </label>
              <input
                id="fp-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            {error && (
              <div className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
                {error}
              </div>
            )}
            <button className="btn-primary w-full" type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <p className="text-center text-xs">
              <Link to="/login" className="text-muted hover:text-slate-200">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
