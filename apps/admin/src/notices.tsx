import { ApiError } from "./api";

export const ISSUES = "https://github.com/thepennystack/bugstack/issues/new";

const likelyFix = (error: unknown): string => {
  if (!(error instanceof ApiError)) return "Check your network connection, then reload the page.";
  if (error.status >= 500) return "The Worker failed; check its logs with wrangler tail.";
  if (error.status === 404) return "The admin app and the Worker are out of step; reload the page.";
  return "Reload the page; if it persists, report the issue.";
};

const describe = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  return String(error);
};

export const SignedOut = () => (
  <article class="callout callout-warning" role="alert">
    <header>
      <h2>You are signed out</h2>
    </header>
    <p>Your Cloudflare Access session has ended. Sign in again to pick up where you left off.</p>
    <footer>
      <a class="button" href={window.location.href}>
        Sign in again
      </a>
    </footer>
  </article>
);

export const isNotBootstrapped = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.status === 503 && error.body.reason === "NotBootstrapped";

export const NotBootstrapped = ({ error }: { error: ApiError }) => (
  <article class="callout callout-warning" role="status">
    <header>
      <h3>bugstack is not bootstrapped</h3>
    </header>
    <p>
      The Worker has no GitHub App or Slack app yet. On the machine that deploys bugstack, run{" "}
      <code class="mono">npm run bootstrap</code>, then reload this page.
    </p>
    <pre class="mono">{error.body.message}</pre>
  </article>
);

export const NotAMember = () => (
  <article class="callout callout-warning" role="status">
    <header>
      <h2>You are not in this organisation</h2>
    </header>
    <p>
      This address belongs to an organisation your account is not a member of. Ask one of its Owners
      to invite your email address, or go back to your own organisations.
    </p>
    <footer>
      <a class="button" href="/">
        Go to your organisations
      </a>
    </footer>
  </article>
);

const REFUSALS: Record<string, string> = {
  AlreadyMember: "Nothing changed: that address is already in this organisation.",
  LastOwner: "An organisation keeps at least one Owner: invite another Owner first.",
  NotAnOwner: "Ask an Owner of this organisation to do it.",
};

const refusalOf = (error: unknown): { error: ApiError; fix: string } | undefined => {
  if (!(error instanceof ApiError)) return undefined;
  const fix = REFUSALS[error.body.reason];
  if (fix === undefined) return undefined;
  return { error, fix };
};

export const Failure = ({ what, error }: { what: string; error: unknown }) => {
  if (isNotBootstrapped(error)) return <NotBootstrapped error={error} />;
  if (error instanceof ApiError && error.body.reason === "NotAMember") return <NotAMember />;
  const refusal = refusalOf(error);
  if (refusal !== undefined) {
    return (
      <article class="callout callout-warning" role="status">
        <header>
          <h3>{what} was refused</h3>
        </header>
        <p>{refusal.error.body.message}</p>
        <p class="field-note">{refusal.fix}</p>
      </article>
    );
  }
  const detail = describe(error);
  const report = new URL(ISSUES);
  report.searchParams.set("title", `Admin: ${what} failed`);
  report.searchParams.set(
    "body",
    `${what} failed.\n\n\`\`\`\n${detail}\n\`\`\`\n\nPage: ${window.location.href}\n`,
  );
  return (
    <article class="callout callout-error" role="alert">
      <header>
        <h2>{what} failed</h2>
      </header>
      <p>{likelyFix(error)}</p>
      <pre class="mono">{detail}</pre>
      <footer>
        <a
          class="button secondary outline"
          href={report.toString()}
          target="_blank"
          rel="noreferrer"
        >
          Report an issue
        </a>
      </footer>
    </article>
  );
};
