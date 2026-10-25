import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/preact-query";
import { type ComponentChildren, render } from "preact";
import { Link, Redirect, Route, Router, Switch, useLocation } from "wouter-preact";
import { getHealth, getMe, isUnauthorized, type Me, type OrgMembership, selectOrg } from "./api";
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
      <Link href="/apps">Back to the apps</Link>
    </p>
  </>
);

const NAV = [
  { href: "/apps", label: "Apps", active: (path: string) => path.startsWith("/apps") },
  { href: "/github", label: "GitHub", active: (path: string) => path.startsWith("/github") },
  { href: "/slack", label: "Slack", active: (path: string) => path.startsWith("/slack") },
];

const Identity = ({ identity, pending }: { identity: string | undefined; pending: boolean }) => {
  if (identity === undefined) {
    return <span class="identity muted">{pending ? "Signing in…" : "Not signed in"}</span>;
  }
  return (
    <span class="identity" title={identity}>
      <span class="avatar" aria-hidden="true">
        {identity.slice(0, 1).toUpperCase()}
      </span>
      <span class="identity-email">{identity}</span>
    </span>
  );
};

const TopNav = ({ identity, pending }: { identity: string | undefined; pending: boolean }) => {
  const [path] = useLocation();
  return (
    <header class="topbar">
      <nav class="container">
        <ul>
          <li>
            <Link href="/apps" class="brand">
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
            <Identity identity={identity} pending={pending} />
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

const NoOrganisation = () => (
  <article class="callout callout-warning" role="status">
    <header>
      <h2>No organisation yet</h2>
    </header>
    <p>
      You are signed in, but no bugstack organisation has added you. Ask an Owner to add your email
      address.
    </p>
  </article>
);

const OrgRoutes = () => {
  const [path] = useLocation();
  if (path.startsWith("~") || path === "/") return <Redirect to="/apps" replace />;
  return (
    <Switch>
      <Route path="/apps" component={AppList} />
      <Route path="/github" component={GitHubInstallations} />
      <Route path="/slack" component={Workspaces} />
      <Route path="/apps/new" component={NewApp} />
      <Route path="/apps/:appId/edit" component={EditApp} />
      <Route path="/apps/:appId" component={AppPage} />
      <Route component={NotFound} />
    </Switch>
  );
};

const Frame = ({
  me,
  pending,
  children,
}: {
  me: Me | undefined;
  pending: boolean;
  children: ComponentChildren;
}) => (
  <>
    <TopNav identity={me?.identity} pending={pending} />
    <main class="container">{children}</main>
    <Footer />
  </>
);

const ORG_PATH = /^\/orgs\/([^/]+)/;

const pickOrg = (orgs: OrgMembership[]): OrgMembership | undefined => {
  const named = window.location.pathname.match(ORG_PATH)?.[1];
  const wanted = named === undefined ? undefined : decodeURIComponent(named);
  return orgs.find((org) => org.orgId === wanted) ?? orgs[0];
};

const Shell = () => {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  if (me.isError && isUnauthorized(me.error)) {
    return (
      <Frame me={undefined} pending={false}>
        <SignedOut />
      </Frame>
    );
  }
  if (me.isError) {
    return (
      <Frame me={undefined} pending={false}>
        <Failure what="Loading the signed-in identity" error={me.error} />
      </Frame>
    );
  }
  if (me.isPending)
    return (
      <Frame me={undefined} pending={true}>
        {null}
      </Frame>
    );
  const org = pickOrg(me.data.orgs);
  if (org === undefined) {
    return (
      <Frame me={me.data} pending={false}>
        <NoOrganisation />
      </Frame>
    );
  }
  selectOrg(org.orgId);
  return (
    <Router base={`/orgs/${encodeURIComponent(org.orgId)}`}>
      <Frame me={me.data} pending={false}>
        <OrgRoutes />
      </Frame>
    </Router>
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
