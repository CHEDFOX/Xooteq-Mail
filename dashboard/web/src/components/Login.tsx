import { useState } from "react";
import { post } from "../api";
import { go } from "../router";
import { useApp } from "../store";
import { Button, Field, Input } from "../ui";
import { Wordmark } from "./Brand";

export function Login() {
  const { refreshMe } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post("/api/auth/login", { email, password });
      await refreshMe();
      go("/", true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <div className="login-art" aria-hidden>
        <div className="login-lines">
          {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.18}s` }} />)}
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <Wordmark />
        <h1>Every company's mail, in one place.</h1>
        <p className="login-sub">Sign in to read, answer and automate mail for all your domains.</p>
        <Field label="Email">
          <Input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" error={error || undefined}>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <Button variant="primary" size="lg" type="submit" busy={busy} className="login-btn">Sign in</Button>
        <p className="login-foot">Forgot it? On the server: <code>docker compose exec dashboard node server/cli.ts reset-password you@…</code></p>
      </form>
    </main>
  );
}
