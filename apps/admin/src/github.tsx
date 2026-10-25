import { useMutation, useQuery } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useSearch } from "wouter-preact";
import {
  createManifestState,
  deleteGitHubApp,
  type GitHubApp,
  listGitHubApps,
  listInstallations,
} from "./api";
import { Failure } from "./notices";
import { ConfirmDelete, Step } from "./step";
import { ExternalIcon, Loading, PageHeader, PlusIcon, When } from "./ui";

export const GITHUB_APPS = ["github", "apps"];
const INSTALLATIONS = ["installations"];

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_MAX = 34;

const manifestFor = (name: string) => {
  const origin = window.location.origin;
  return {
    name,
    url: origin,
    redirect_url: `${origin}/api/github/apps/callback`,
    public: false,
    default_permissions: { issues: "write", metadata: "read" },
    default_events: [],
  };
};

const newAppUrl = (org: string, state: string): string => {
  const query = `state=${encodeURIComponent(state)}`;
  if (org === "") return `https://github.com/settings/apps/new?${query}`;
  return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?${query}`;
};

const installUrl = (slug: string): string =>
  `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;

const postToGitHub = (action: string, manifest: object) => {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = JSON.stringify(manifest);
  form.append(field);
  document.body.append(form);
  form.submit();
};

const defaultName = (owner: string): string =>
  (owner === "" ? "bugstack" : `bugstack-${owner}`).slice(0, NAME_MAX);

const CreateGitHubApp = ({ onClose }: { onClose: () => void }) => {
  const [owner, setOwner] = useState("");
  const [name, setName] = useState<string | null>(null);
  const appName = name ?? defaultName(owner.trim());
  const create = useMutation({
    mutationFn: async () => {
      const login = owner.trim();
      const chosen = appName.trim();
      if (login !== "" && !OWNER.test(login)) {
        throw new Error(`${login} is not a GitHub organization login`);
      }
      if (chosen === "") throw new Error("The app needs a name");
      if (chosen.length > NAME_MAX) {
        throw new Error(`${chosen} is longer than GitHub's ${NAME_MAX} characters`);
      }
      const { state } = await createManifestState();
      postToGitHub(newAppUrl(login, state), manifestFor(chosen));
    },
  });
  return (
    <Step
      title="Create a GitHub App"
      description="GitHub opens its app form already filled in, you confirm, and it sends you back here."
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Owner
          <input
            name="owner"
            autoComplete="off"
            placeholder="your personal account"
            value={owner}
            onInput={(event) => setOwner(event.currentTarget.value)}
          />
          <small>
            A GitHub organization, or empty for your personal account. GitHub App names are unique
            across all of GitHub, so pick an owner and a name once; one app serves every org you
            install it on.
          </small>
        </label>
        <label>
          Name
          <input
            name="name"
            class="mono"
            autoComplete="off"
            required
            maxLength={NAME_MAX}
            value={appName}
            onInput={(event) => setName(event.currentTarget.value)}
          />
        </label>
        {create.isError && <Failure what="Creating the GitHub App" error={create.error} />}
        <footer class="actions">
          <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
            {create.isPending ? "Opening GitHub…" : "Continue on GitHub"}
          </button>
          <button type="button" class="secondary outline" onClick={onClose}>
            Cancel
          </button>
        </footer>
      </form>
    </Step>
  );
};

const CreateButton = ({ first }: { first: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        class={first ? "with-icon" : "secondary with-icon"}
        onClick={() => setOpen(true)}
      >
        <PlusIcon />
        {first ? "Create GitHub App" : "Create another GitHub App"}
      </button>
      {open && <CreateGitHubApp onClose={() => setOpen(false)} />}
    </>
  );
};

const Installations = ({ app }: { app: GitHubApp }) => {
  const installations = useQuery({ queryKey: INSTALLATIONS, queryFn: listInstallations });
  if (installations.isPending) return <Loading what="installations" />;
  if (installations.isError) {
    return <Failure what="Loading the installations" error={installations.error} />;
  }
  const mine = installations.data.filter(
    (installation) => installation.githubAppId === app.githubAppId,
  );
  if (mine.length === 0) return <p class="installs-empty">Not installed anywhere yet</p>;
  return (
    <ul class="installs">
      {mine.map((installation) => (
        <li key={installation.installationId}>
          <span class="mono">{installation.account}</span>
          <span class="muted">#{installation.installationId}</span>
        </li>
      ))}
    </ul>
  );
};

const GitHubAppCard = ({ app }: { app: GitHubApp }) => (
  <article class="card">
    <header>
      <h3>
        <a href={app.htmlUrl} target="_blank" rel="noreferrer" class="with-icon">
          {app.name}
          <ExternalIcon />
        </a>
      </h3>
    </header>
    <ul class="meta">
      <li>
        <span class="meta-label">Owner</span>
        <span class="mono">{app.ownerLogin}</span>
      </li>
      <li>
        <span class="meta-label">Created</span>
        <When iso={app.createdAt} />
      </li>
    </ul>
    <h4 class="installs-title">Installed on</h4>
    <Installations app={app} />
    <footer class="card-actions">
      <a class="button with-icon" href={installUrl(app.slug)} target="_blank" rel="noreferrer">
        Install on another account
        <ExternalIcon />
      </a>
      <ConfirmDelete
        name={app.name}
        queryKey={GITHUB_APPS}
        remove={() => deleteGitHubApp(app.githubAppId)}
      />
    </footer>
  </article>
);

const Steps = () => (
  <article class="empty">
    <h3>No GitHub App yet</h3>
    <p>bugstack files issues through a GitHub App you own. Two steps:</p>
    <ol>
      <li>Create the app; GitHub asks you to confirm.</li>
      <li>Install it on each account whose repositories should receive issues.</li>
    </ol>
    <CreateButton first />
  </article>
);

export const GitHubApps = () => {
  const apps = useQuery({ queryKey: GITHUB_APPS, queryFn: listGitHubApps });
  const created = new URLSearchParams(useSearch()).get("created");
  return (
    <>
      <PageHeader
        title="GitHub Apps"
        description="The GitHub Apps bugstack files issues through, and where they are installed."
        action={apps.isSuccess && apps.data.length > 0 && <CreateButton first={false} />}
      />
      {created !== null && (
        <article class="callout callout-success" role="status">
          <header>
            <h3>Created {created}</h3>
          </header>
          <p>
            Install it on the accounts whose repositories receive issues, then pick the installation
            on each app.
          </p>
          <footer>
            <a class="button" href={installUrl(created)}>
              Install {created}
            </a>
          </footer>
        </article>
      )}
      {apps.isPending && <Loading what="GitHub Apps" />}
      {apps.isError && <Failure what="Loading the GitHub Apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && <Steps />}
      {apps.isSuccess && apps.data.length > 0 && (
        <div class="card-grid wide">
          {apps.data.map((app) => (
            <GitHubAppCard key={app.githubAppId} app={app} />
          ))}
        </div>
      )}
    </>
  );
};

export const NoGitHubApp = () => (
  <p class="field-note">
    No GitHub App yet. <Link href="/github">Create one</Link> and install it, then pick its
    installation here.
  </p>
);
