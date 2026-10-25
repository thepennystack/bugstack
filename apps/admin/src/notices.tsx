import { ApiError } from "./api";

const ISSUES = "https://github.com/thepennystack/bugstack/issues/new";

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
  <section class="notice" role="alert">
    <h2>Signed out</h2>
    <p>Your Cloudflare Access session has ended or does not belong to the bugstack admin.</p>
    <a class="button" href={window.location.href}>
      Sign in again
    </a>
  </section>
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
    <section class="notice" role="alert">
      <h2>{what} failed</h2>
      <p>
        <code>{detail}</code>
      </p>
      <p>{likelyFix(error)}</p>
      <a href={report.toString()} target="_blank" rel="noreferrer">
        Report an issue
      </a>
    </section>
  );
};
