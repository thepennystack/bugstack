import { useMutation, useQuery } from "@tanstack/preact-query";
import { Link } from "wouter-preact";
import { listInstallations, startGitHubInstall } from "./api";
import { Failure, isNotBootstrapped } from "./notices";
import { ExternalIcon, Loading, PageHeader } from "./ui";

export const INSTALLATIONS = ["github", "installations"];
const InstallCard = () => {
  const install = useMutation({
    mutationFn: startGitHubInstall,
    onSuccess: ({ url }) => window.location.assign(url),
  });
  return (
    <article class="card">
      <header>
        <h3>Install bugstack on a GitHub account</h3>
      </header>
      <p>
        Install the bugstack GitHub App on each account whose repositories receive issues, and grant
        it those repositories. Then pick the installation on each app.
      </p>
      {install.isError && <Failure what="Starting the GitHub install" error={install.error} />}
      <footer class="card-actions">
        <button
          type="button"
          class="with-icon"
          aria-busy={install.isPending || install.isSuccess}
          disabled={install.isPending || install.isSuccess}
          onClick={() => install.mutate()}
        >
          Install on GitHub
          <ExternalIcon />
        </button>
      </footer>
    </article>
  );
};

const InstallationsCard = () => {
  const installations = useQuery({
    queryKey: INSTALLATIONS,
    queryFn: listInstallations,
    retry: false,
  });
  return (
    <article class="card">
      <header>
        <h3>Installed on</h3>
      </header>
      {installations.isPending && <Loading what="installations" />}
      {installations.isError && isNotBootstrapped(installations.error) && (
        <p class="installs-empty">None until bugstack is bootstrapped</p>
      )}
      {installations.isError && !isNotBootstrapped(installations.error) && (
        <Failure what="Loading the installations" error={installations.error} />
      )}
      {installations.isSuccess && installations.data.length === 0 && (
        <p class="installs-empty">Not installed anywhere yet</p>
      )}
      {installations.isSuccess && installations.data.length > 0 && (
        <ul class="installs">
          {installations.data.map((installation) => (
            <li key={installation.installationId}>
              <span class="mono">{installation.account}</span>
              <span class="muted">#{installation.installationId}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};

export const GitHubInstallations = () => (
  <>
    <PageHeader title="GitHub" description="The GitHub accounts bugstack files issues into." />
    <div class="card-grid wide">
      <InstallCard />
      <InstallationsCard />
    </div>
  </>
);

export const NoInstallation = () => (
  <p class="field-note">
    bugstack is not installed on any GitHub account yet. <Link href="/github">Install it</Link>,
    then pick its installation here.
  </p>
);
