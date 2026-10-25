import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/preact-query";
import { type ComponentChildren, render } from "preact";
import { Link, Redirect, Route, Router, Switch, useLocation } from "wouter-preact";
import { getHealth, getMe, isUnauthorized, type Me, type OrgMembership, selectOrg } from "./api";
import { AppList, AppPage, EditApp, NewApp } from "./apps";
import { GitHubInstallations } from "./github";
import { Failure, ISSUES, NotAMember, SignedOut } from "./notices";
import { CreateOrg, Members, orgHome } from "./orgs";
import { Workspaces } from "./slack";
import { BrandMark, PageHeader, PlusIcon, REPO } from "./ui";
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
  { href: "/members", label: "Members", active: (path: string) => path.startsWith("/members") },
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

const OrgSwitcher = ({ current, orgs }: { current: OrgMembership; orgs: OrgMembership[] }) => {
  if (orgs.length < 2) {
    return (
      <span class="org-name" title={current.name}>
        {current.name}
      </span>
    );
  }
  return (
    <details class="dropdown org-switcher">
      <summary aria-label={`Organisation ${current.name}, switch`}>
        <span class="org-name">{current.name}</span>
      </summary>
      <ul>
        {orgs.map((org) => (
          <li key={org.orgId}>
            <a
              href={orgHome(org.orgId)}
              aria-current={org.orgId === current.orgId ? "true" : undefined}
            >
              {org.name}
            </a>
          </li>
        ))}
        <li>
          <a href="/orgs/new" class="with-icon">
            <PlusIcon />
            Create another
          </a>
        </li>
      </ul>
    </details>
  );
};

const NavLinks = () => {
  const [path] = useLocation();
  return (
    <ul class="nav-links">
      {NAV.map((item) => (
        <li key={item.href}>
          <Link href={item.href} aria-current={item.active(path) ? "page" : undefined}>
            {item.label}
          </Link>
        </li>
      ))}
    </ul>
  );
};

const TopNav = ({
  me,
  current,
  pending,
}: {
  me: Me | undefined;
  current: OrgMembership | undefined;
  pending: boolean;
}) => (
  <header class="topbar">
    <nav class="container">
      <ul class="brand-group">
        <li>
          <a href="/" class="brand">
            <BrandMark />
            <span>bugstack</span>
          </a>
        </li>
        {current !== undefined && me !== undefined && (
          <li class="org-item">
            <OrgSwitcher current={current} orgs={me.orgs} />
          </li>
        )}
      </ul>
      {current === undefined ? <ul class="nav-links" /> : <NavLinks />}
      <ul>
        <li>
          <Identity identity={me?.identity} pending={pending} />
        </li>
      </ul>
    </nav>
  </header>
);

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

const OrgRoutes = ({ org, identity }: { org: OrgMembership; identity: string }) => {
  const [path] = useLocation();
  if (path.startsWith("~") || path === "/") return <Redirect to="/apps" replace />;
  return (
    <Switch>
      <Route path="/apps" component={AppList} />
      <Route path="/github" component={GitHubInstallations} />
      <Route path="/slack" component={Workspaces} />
      <Route path="/members">
        <Members org={org} identity={identity} />
      </Route>
      <Route path="/apps/new" component={NewApp} />
      <Route path="/apps/:appId/edit" component={EditApp} />
      <Route path="/apps/:appId" component={AppPage} />
      <Route component={NotFound} />
    </Switch>
  );
};

const Frame = ({
  me,
  current,
  pending,
  children,
}: {
  me: Me | undefined;
  current?: OrgMembership;
  pending: boolean;
  children: ComponentChildren;
}) => (
  <>
    <TopNav me={me} current={current} pending={pending} />
    <main class="container">{children}</main>
    <Footer />
  </>
);

const ORG_PATH = /^\/orgs\/([^/]+)/;
const NEW_ORG = "/orgs/new";

const orgInPath = (path: string): string | undefined => {
  const named = path.match(ORG_PATH)?.[1];
  return named === undefined ? undefined : decodeURIComponent(named);
};

const Shell = () => {
  const [path] = useLocation();
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
  const [first] = me.data.orgs;
  if (path === NEW_ORG || path === `${NEW_ORG}/`) {
    return (
      <Frame me={me.data} pending={false}>
        <CreateOrg first={first} />
      </Frame>
    );
  }
  const named = orgInPath(path);
  if (named === undefined) {
    return <Redirect to={first === undefined ? NEW_ORG : orgHome(first.orgId)} replace />;
  }
  const org = me.data.orgs.find((each) => each.orgId === named);
  if (org === undefined) {
    return (
      <Frame me={me.data} pending={false}>
        <NotAMember />
      </Frame>
    );
  }
  selectOrg(org.orgId);
  return (
    <Router base={`/orgs/${encodeURIComponent(org.orgId)}`}>
      <Frame me={me.data} current={org} pending={false}>
        <OrgRoutes org={org} identity={me.data.identity} />
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
