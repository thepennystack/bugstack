import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useSearch } from "wouter-preact";
import { createManifestState, deleteGitHubApp, type GitHubApp, listGitHubApps } from "./api";
import { Failure } from "./notices";

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
    hook_attributes: { active: false },
    default_permissions: { issues: "write", metadata: "read" },
    default_events: [],
  };
};

const newAppUrl = (org: string, state: string): string => {
  const query = `state=${encodeURIComponent(state)}`;
  if (org === "") return `https://github.com/settings/apps/new?${query}`;
  return `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new?${query}`;
};

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
    <form
      class="form"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <h3>Create GitHub App</h3>
      <p>
        GitHub opens its app form filled in from a manifest, then sends you back here with the
        credentials. Leave the organization empty to create the app on your personal account.
      </p>
      <label>
        GitHub organization
        <input
          name="org"
          placeholder="personal account"
          value={org}
          onInput={(event) => setOrg(event.currentTarget.value)}
        />
      </label>
      <label>
        Name suffix
        <input
          name="suffix"
          maxLength={NAME_MAX - "bugstack".length}
          value={suffix}
          onInput={(event) => setSuffix(event.currentTarget.value)}
        />
      </label>
      <p>
        The app will be called <code>{name}</code>.
      </p>
      {create.isError && <Failure what="Creating the GitHub App" error={create.error} />}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? "Opening GitHub…" : "Create GitHub App"}
      </button>
    </form>
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
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
        {remove.isPending ? "Deleting…" : "Delete"}
      </button>
      {remove.isError && <Failure what={`Deleting ${app.name}`} error={remove.error} />}
    </>
  );
};

export const GitHubApps = () => {
  const apps = useQuery({ queryKey: GITHUB_APPS, queryFn: listGitHubApps });
  const created = new URLSearchParams(useSearch()).get("created");
  return (
    <section>
      <h2>GitHub Apps</h2>
      {created !== null && (
        <section class="notice" role="status">
          <h3>Created {created}</h3>
          <p>
            Install it on the accounts whose repositories receive issues, then pick the installation
            on each app.
          </p>
          <a
            class="button"
            href={`https://github.com/apps/${encodeURIComponent(created)}/installations/new`}
          >
            Install {created}
          </a>
        </section>
      )}
      {apps.isPending && <p>Loading GitHub Apps…</p>}
      {apps.isError && <Failure what="Loading the GitHub Apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && (
        <p>No GitHub App yet. Create one below to file reports as issues.</p>
      )}
      {apps.isSuccess && apps.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Slug</th>
              <th>Owner</th>
              <th>Install</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {apps.data.map((app) => (
              <tr key={app.githubAppId}>
                <td>
                  <a href={app.htmlUrl} target="_blank" rel="noreferrer">
                    {app.name}
                  </a>
                </td>
                <td>
                  <code>{app.slug}</code>
                </td>
                <td>{app.ownerLogin}</td>
                <td>
                  <a
                    href={`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install
                  </a>
                </td>
                <td>{app.createdAt}</td>
                <td>
                  <DeleteGitHubApp app={app} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <CreateGitHubApp />
    </section>
  );
};

export const NoGitHubApp = () => (
  <p>
    No GitHub App yet. <Link href="/github">Create one</Link> and install it, then pick its
    installation here.
  </p>
);
