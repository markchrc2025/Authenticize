import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConnectionDetails } from "../components/ConnectionDetails.tsx";
import { PageHeader } from "../components/Layout.tsx";
import { Modal, Spinner, useToast } from "../components/ui.tsx";
import { api, type AppUser, type OAuthApp } from "../lib/api.ts";
import { connectionInfo } from "../lib/snippets.ts";

const METHOD_LABELS: Record<string, string> = {
  email: "Email & password",
  passkey: "Passkeys",
  google: "Google",
  microsoft: "Microsoft",
  apple: "Apple",
  github: "GitHub",
};

/**
 * Per-app sign-in method selection (Firebase-style). Toggles which providers
 * this app offers on the Authenticize login page. `methods: null` from the API
 * means the app has no override yet and uses everything available.
 */
function SignInMethodsCard({ clientId }: { clientId: string }) {
  const toast = useToast();
  const [available, setAvailable] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [usingDefault, setUsingDefault] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .signInMethods(clientId)
      .then(({ methods, available }) => {
        setAvailable(available);
        setSelected(new Set(methods ?? available));
        setUsingDefault(methods === null);
      })
      .catch(() => setAvailable([]));
  }, [clientId]);

  const toggle = (m: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
    setDirty(true);
    setUsingDefault(false);
  };

  const save = async () => {
    if (selected.size === 0) {
      toast.push("error", "Enable at least one sign-in method");
      return;
    }
    setBusy(true);
    try {
      const { methods } = await api.setSignInMethods(clientId, [...selected]);
      setSelected(new Set(methods));
      setUsingDefault(false);
      setDirty(false);
      toast.push("success", "Sign-in methods updated");
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-200">Sign-in methods</h2>
        {dirty && (
          <button className="btn-primary px-3 py-1 text-xs" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      <p className="hint mb-4">
        Which options this app shows on the Authenticize login page.
        {usingDefault && " Using every available method (default)."}
      </p>
      {available === null ? (
        <Spinner />
      ) : available.length === 0 ? (
        <p className="text-sm text-muted">No sign-in methods are configured on the platform.</p>
      ) : (
        <ul className="space-y-3">
          {available.map((m) => {
            const on = selected.has(m);
            return (
              <li key={m} className="flex items-center justify-between">
                <span className="text-sm text-slate-200">{METHOD_LABELS[m] ?? m}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={METHOD_LABELS[m] ?? m}
                  onClick={() => toggle(m)}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    on ? "bg-brand" : "bg-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      on ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function AppDetailPage() {
  const { clientId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [app, setApp] = useState<OAuthApp | null>(null);
  const [appUsers, setAppUsers] = useState<AppUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rotated, setRotated] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [redirects, setRedirects] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () =>
    api
      .listApps()
      .then((r) => {
        const found = r.apps.find((a) => a.clientId === clientId) ?? null;
        setApp(found);
        if (found) setRedirects(found.redirectUris.join("\n"));
        if (!found) setError("Application not found.");
      })
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
    api
      .appUsers(clientId)
      .then((r) => setAppUsers(r.users))
      .catch(() => setAppUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const toggleDisabled = async () => {
    if (!app) return;
    setBusy(true);
    try {
      await api.setAppDisabled(app.clientId, !app.disabled);
      toast.push("success", app.disabled ? "Application enabled" : "Application disabled");
      await load();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const saveRedirects = async () => {
    if (!app) return;
    const redirect_uris = redirects
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (redirect_uris.length === 0) {
      toast.push("error", "At least one redirect URI is required");
      return;
    }
    setBusy(true);
    try {
      await api.updateApp(app.clientId, { redirect_uris });
      toast.push("success", "Redirect URIs updated");
      setEditing(false);
      await load();
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const rotate = async () => {
    if (!app) return;
    setBusy(true);
    try {
      const res = await api.rotateSecret(app.clientId);
      setRotated(res.client_secret ?? null);
      toast.push("success", "Client secret rotated");
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!app) return;
    setBusy(true);
    try {
      await api.deleteApp(app.clientId);
      toast.push("success", "Application deleted");
      navigate("/apps");
    } catch (e) {
      toast.push("error", e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  };

  if (error) {
    return (
      <>
        <PageHeader title="Application" />
        <div className="card border-red-900/60 p-4 text-sm text-red-300">{error}</div>
        <button className="btn-secondary mt-4" onClick={() => navigate("/apps")}>
          ← Back to applications
        </button>
      </>
    );
  }
  if (!app) return <Spinner />;

  const info = connectionInfo(window.location.origin, app);

  return (
    <>
      <button
        className="mb-4 text-sm text-muted hover:text-slate-200"
        onClick={() => navigate("/apps")}
      >
        ← Applications
      </button>
      <PageHeader
        title={app.name ?? app.clientId}
        description={app.disabled ? "This application is disabled." : undefined}
        action={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={toggleDisabled} disabled={busy}>
              {app.disabled ? "Enable" : "Disable"}
            </button>
            <button
              className="btn-danger"
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        }
      />

      <div className="space-y-6">
        <div className="card flex flex-wrap items-center gap-x-8 gap-y-2 p-5">
          <div>
            <div className="text-2xl font-semibold text-slate-100">{app.userCount}</div>
            <div className="text-xs text-muted">
              unique user{app.userCount === 1 ? "" : "s"} signed in via this app
            </div>
          </div>
          <div>
            <div className="text-sm text-slate-200">
              {app.lastUsedAt ? new Date(app.lastUsedAt).toLocaleString() : "never"}
            </div>
            <div className="text-xs text-muted">last sign-in</div>
          </div>
          <div>
            <span className={app.disabled ? "badge-red" : "badge-green"}>
              {app.disabled ? "SSO disabled" : "SSO active"}
            </span>
          </div>
        </div>

        <SignInMethodsCard clientId={app.clientId} />

        <div className="card p-5">
          <h2 className="mb-1 text-sm font-semibold text-slate-200">Signed-in users</h2>
          <p className="hint mb-4">
            Identities that have authenticated through this application. Whether they
            are <em>authorized</em> inside the app is the app's own decision.
          </p>
          {!appUsers ? (
            <Spinner />
          ) : appUsers.length === 0 ? (
            <p className="text-sm text-muted">No sign-ins yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {appUsers.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-slate-100">{u.email}</div>
                    <div className="truncate text-xs text-muted">{u.name}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xs text-slate-200">
                      {new Date(u.lastSignInAt).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted">
                      last sign-in · {u.signInCount} total
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Redirect URIs</h2>
            {!editing ? (
              <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setEditing(true)}>
                Edit
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  className="btn-ghost px-2 py-1 text-xs"
                  onClick={() => {
                    setEditing(false);
                    setRedirects(app.redirectUris.join("\n"));
                  }}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary px-2 py-1 text-xs"
                  onClick={saveRedirects}
                  disabled={busy}
                >
                  Save
                </button>
              </div>
            )}
          </div>
          {editing ? (
            <textarea
              className="input min-h-[72px] font-mono text-xs"
              value={redirects}
              onChange={(e) => setRedirects(e.target.value)}
            />
          ) : (
            <ul className="space-y-1">
              {app.redirectUris.map((u) => (
                <li key={u} className="font-mono text-xs text-slate-200">
                  {u}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">Client secret</h2>
              <p className="hint">
                {info.isPublic
                  ? "Public client — authenticates with PKCE, no secret."
                  : "Rotating invalidates the old secret immediately."}
              </p>
            </div>
            {!info.isPublic && (
              <button className="btn-secondary" onClick={rotate} disabled={busy}>
                Rotate secret
              </button>
            )}
          </div>
          {rotated && (
            <div className="space-y-2">
              <div className="rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm text-brand">
                New client secret — copy it now, it won't be shown again.
              </div>
              <code className="block overflow-x-auto rounded-md border border-border bg-bg px-3 py-2 font-mono text-xs text-slate-100">
                {rotated}
              </code>
            </div>
          )}
        </div>

        <div className="card p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-200">
            Connection details
          </h2>
          <ConnectionDetails info={info} />
        </div>
      </div>

      {confirmDelete && (
        <Modal title="Delete application?" onClose={() => setConfirmDelete(false)}>
          <p className="text-sm text-slate-300">
            This permanently deletes <span className="code">{app.name ?? app.clientId}</span>.
            Any app using these credentials will stop being able to sign users in.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button className="btn-danger" onClick={remove} disabled={busy}>
              {busy ? "Deleting…" : "Delete application"}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
