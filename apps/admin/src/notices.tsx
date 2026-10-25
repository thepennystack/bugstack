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
    <p>
      Your Cloudflare Access session has ended, or the account you signed in with is not the
      bugstack admin. Sign in again to pick up where you left off.
    </p>
    <footer>
      <a class="button" href={window.location.href}>
        Sign in again
      </a>
    </footer>
  </article>
);

export const Failure = ({ what, error }: { what: string; error: unknown }) => {
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
