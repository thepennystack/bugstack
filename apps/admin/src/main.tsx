import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/preact-query";
import { render } from "preact";
import { Link, Route, Switch } from "wouter-preact";
import { getMe, isUnauthorized } from "./api";
import { AppList, AppPage, EditApp, NewApp } from "./apps";
import { Failure, SignedOut } from "./notices";
import { Workspaces } from "./slack";
import "./style.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failures, error) => !isUnauthorized(error) && failures < 2,
    },
  },
});

const NotFound = () => (
  <section>
    <h2>Not found</h2>
    <p>
      No page lives at this address. <Link href="/">Go home</Link>.
    </p>
  </section>
);

const Shell = () => {
  const me = useQuery({ queryKey: ["me"], queryFn: getMe });
  if (me.isError && isUnauthorized(me.error)) {
    return (
      <main>
        <SignedOut />
      </main>
    );
  }
  return (
    <>
      <header>
        <Link href="/" class="brand">
          bugstack
        </Link>
        <nav>
          <Link href="/">Apps</Link>
          <Link href="/slack">Slack</Link>
        </nav>
        <span class="identity">{me.data?.email ?? (me.isPending ? "Signing in…" : "")}</span>
      </header>
      <main>
        {me.isError ? (
          <Failure what="Loading the signed-in identity" error={me.error} />
        ) : (
          <Switch>
            <Route path="/" component={AppList} />
            <Route path="/slack" component={Workspaces} />
            <Route path="/apps/new" component={NewApp} />
            <Route path="/apps/:appId/edit" component={EditApp} />
            <Route path="/apps/:appId" component={AppPage} />
            <Route component={NotFound} />
          </Switch>
        )}
      </main>
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
