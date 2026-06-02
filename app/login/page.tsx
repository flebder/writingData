type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
};

function safeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  if (next.startsWith("/login") || next.startsWith("/api/login")) return "/";
  return next;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = (await searchParams) || {};
  const error = params.error;
  const next = safeNext(params.next);

  return (
    <main className="loginShell">
      <section className="loginCard" aria-labelledby="login-title">
        <div>
          <p className="loginKicker">Private notebook</p>
          <h1 id="login-title">Writing Journal</h1>
          <p className="loginCopy">Enter the password to continue.</p>
        </div>

        <form className="loginForm" action="/api/login" method="post">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
          {error === "invalid" ? <p className="loginError">That password did not open the journal.</p> : null}
          {error === "config" ? <p className="loginError">The journal password is not configured yet.</p> : null}
          <button className="loginButton" type="submit">Enter</button>
        </form>
      </section>
    </main>
  );
}
