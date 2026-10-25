import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useSearch } from "wouter-preact";
import { createManifestState, deleteGitHubApp, type GitHubApp, listGitHubApps } from "./api";
import { Failure } from "./notices";
import { ExternalIcon, Loading, PageHeader, When } from "./ui";

export const GITHUB_APPS = ["github", "apps"];

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME_MAX = 34;

const randomSuffix = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
};

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

const CreateGitHubApp = () => {
  const [org, setOrg] = useState("");
  const [suffix, setSuffix] = useState(randomSuffix);
  const name = `bugstack${suffix.trim()}`;
  const create = useMutation({
    mutationFn: async () => {
      const owner = org.trim();
      if (owner !== "" && !OWNER.test(owner)) {
        throw new Error(`${owner} is not a GitHub organization login`);
      }
      if (name.length > NAME_MAX) {
        throw new Error(`${name} is longer than GitHub's ${NAME_MAX} characters`);
      }
      const { state } = await createManifestState();
      postToGitHub(newAppUrl(owner, state), manifestFor(name));
    },
  });
  return (
    <article class="form-card">
      <header>
        <h3>Create GitHub App</h3>
        <p class="muted">
          GitHub opens its app form already filled in, you confirm, and it sends you back here with
          the app's credentials.
        </p>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div class="grid">
          <label>
            GitHub organization
            <input
              name="org"
              placeholder="personal account"
              value={org}
              onInput={(event) => setOrg(event.currentTarget.value)}
            />
            <small>Leave empty to create the app on your personal account.</small>
          </label>
          <label>
            Name suffix
            <input
              name="suffix"
              class="mono"
              maxLength={NAME_MAX - "bugstack".length}
              value={suffix}
              onInput={(event) => setSuffix(event.currentTarget.value)}
            />
            <small>
              The app will be called <code class="mono">{name}</code>.
            </small>
          </label>
        </div>
        {create.isError && <Failure what="Creating the GitHub App" error={create.error} />}
        <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
          {create.isPending ? "Opening GitHub…" : "Create GitHub App"}
        </button>
      </form>
    </article>
  );
};

const DeleteGitHubApp = ({ app }: { app: GitHubApp }) => {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteGitHubApp(app.githubAppId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: GITHUB_APPS }),
  });
  return (
    <>
      <button
        type="button"
        class="secondary outline small"
        aria-busy={remove.isPending}
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
      >
        {remove.isPending ? "Deleting…" : "Delete"}
      </button>
      {remove.isError && <Failure what={`Deleting ${app.name}`} error={remove.error} />}
    </>
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
        <span class="meta-label">Slug</span>
        <span class="mono">{app.slug}</span>
      </li>
      <li>
        <span class="meta-label">Created</span>
        <When iso={app.createdAt} />
      </li>
    </ul>
    <footer class="card-actions">
      <a class="button small" href={installUrl(app.slug)} target="_blank" rel="noreferrer">
        Install
      </a>
      <DeleteGitHubApp app={app} />
    </footer>
  </article>
);

const Steps = () => (
  <article class="empty">
    <h3>No GitHub App yet</h3>
    <p>bugstack files issues through a GitHub App you own. Two steps:</p>
    <ol>
      <li>Create the app with the form below; GitHub asks you to confirm.</li>
      <li>
        Install it on each account whose repositories should receive issues, then pick the
        installation on an app.
      </li>
    </ol>
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
        <div class="card-grid">
          {apps.data.map((app) => (
            <GitHubAppCard key={app.githubAppId} app={app} />
          ))}
        </div>
      )}
      <CreateGitHubApp />
    </>
  );
};

export const NoGitHubApp = () => (
  <p class="field-note">
    No GitHub App yet. <Link href="/github">Create one</Link> and install it, then pick its
    installation here.
  </p>
);
