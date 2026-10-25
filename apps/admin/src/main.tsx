import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/preact-query";
import { render } from "preact";
import { Link, Route, Switch, useLocation } from "wouter-preact";
import { getHealth, getMe, isUnauthorized } from "./api";
import { AppList, AppPage, EditApp, NewApp } from "./apps";
import { GitHubInstallations } from "./github";
import { Failure, ISSUES, SignedOut } from "./notices";
import { Workspaces } from "./slack";
import { BrandMark, PageHeader, REPO } from "./ui";
import "@picocss/pico/css/pico.indigo.min.css";
import "./style.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) => !isUnauthorized(error) && failures < 2,
    },
  },
});

const NotFound = () => (
  <>
    <PageHeader title="Not found" description="No page lives at this address." />
    <p>
      <Link href="/">Back to the apps</Link>
    </p>
  </>
);

const NAV = [
  { href: "/", label: "Apps", active: (path: string) => path === "/" || path.startsWith("/apps") },
  { href: "/github", label: "GitHub", active: (path: string) => path.startsWith("/github") },
  { href: "/slack", label: "Slack", active: (path: string) => path.startsWith("/slack") },
];

const Identity = ({ email, pending }: { email: string | undefined; pending: boolean }) => {
  if (email === undefined) {
    return <span class="identity muted">{pending ? "Signing in…" : "Not signed in"}</span>;
  }
  return (
    <span class="identity" title={email}>
      <span class="avatar" aria-hidden="true">
        {email.slice(0, 1).toUpperCase()}
      </span>
      <span class="identity-email">{email}</span>
    </span>
  );
};

const TopNav = ({ email, pending }: { email: string | undefined; pending: boolean }) => {
  const [path] = useLocation();
  return (
    <header class="topbar">
      <nav class="container">
        <ul>
          <li>
            <Link href="/" class="brand">
              <BrandMark />
              <span>bugstack</span>
            </Link>
          </li>
        </ul>
        <ul class="nav-links">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link href={item.href} aria-current={item.active(path) ? "page" : undefined}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <ul>
          <li>
            <Identity email={email} pending={pending} />
          </li>
        </ul>
      </nav>
    </header>
  );
};

const Deployed = () => {
  const health = useQuery({ queryKey: ["health"], queryFn: getHealth, staleTime: Infinity });
  if (health.isPending) return <span>Reading the deployed commit…</span>;
  if (health.isError)
    return <span>The deployed commit is unknown: /v1/health did not answer.</span>;
  return (
    <span>
      Deployed{" "}
      <a href={`${REPO}/commit/${health.data.commit}`} target="_blank" rel="noreferrer">
        <code>{health.data.commit.slice(0, 7)}</code>
      </a>
    </span>
  );
};

const Footer = () => (
  <footer class="container site-footer">
    <Deployed />
    <span class="footer-links">
      <a href={REPO} target="_blank" rel="noreferrer">
        thepennystack/bugstack
      </a>
      <a href={ISSUES} target="_blank" rel="noreferrer">
        Report an issue
      </a>
    </span>
  </footer>
);

const Shell = () => {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  if (me.isError && isUnauthorized(me.error)) {
    return (
      <>
        <TopNav email={undefined} pending={false} />
        <main class="container">
          <SignedOut />
        </main>
        <Footer />
      </>
    );
  }
  return (
    <>
      <TopNav email={me.data?.email} pending={me.isPending} />
      <main class="container">
        {me.isError ? (
          <Failure what="Loading the signed-in identity" error={me.error} />
        ) : (
          <Switch>
            <Route path="/" component={AppList} />
            <Route path="/github" component={GitHubInstallations} />
            <Route path="/slack" component={Workspaces} />
            <Route path="/apps/new" component={NewApp} />
            <Route path="/apps/:appId/edit" component={EditApp} />
            <Route path="/apps/:appId" component={AppPage} />
            <Route component={NotFound} />
          </Switch>
        )}
      </main>
      <Footer />
    </>
  );
};

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element in index.html");
render(
  <QueryClientProvider client={queryClient}>
    <Shell />
  </QueryClientProvider>,
  root,
);
