import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link, useSearch } from "wouter-preact";
import {
  type App,
  createSlackApp,
  deleteSlackApp,
  deleteWorkspace,
  listSlackApps,
  listWorkspaces,
  removeAppSlack,
  type SlackApp,
  setAppSlack,
  slackInstallUrl,
  type Workspace,
} from "./api";
import { Failure } from "./notices";
import { ExternalIcon, Loading, PageHeader, When } from "./ui";

const WORKSPACES = ["slack", "workspaces"];
const SLACK_APPS = ["slack", "apps"];

const manifestFor = (origin: string) => ({
  display_information: { name: "bugstack", description: "Bug reports filed as GitHub issues" },
  features: { bot_user: { display_name: "bugstack", always_online: false } },
  oauth_config: {
    redirect_urls: [`${origin}/api/slack/oauth/callback`],
    scopes: { bot: ["chat:write"] },
  },
});

const createSlackAppUrl = (): string =>
  `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(JSON.stringify(manifestFor(window.location.origin)))}`;

const CreateSlackApp = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("bugstack");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [signingSecret, setSigningSecret] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createSlackApp({
        name: name.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        signingSecret: signingSecret.trim(),
      }),
    onSuccess: () => {
      setClientId("");
      setClientSecret("");
      setSigningSecret("");
      queryClient.invalidateQueries({ queryKey: SLACK_APPS });
    },
  });
  return (
    <article class="form-card">
      <header>
        <h3>Create a Slack app</h3>
        <p class="muted">
          Slack does not hand the app back like GitHub does, so paste its client id and secret once.
        </p>
      </header>
      <ol class="how-to">
        <li>
          <a href={createSlackAppUrl()} target="_blank" rel="noreferrer" class="button with-icon">
            Create a Slack app
            <ExternalIcon />
          </a>
        </li>
        <li>
          Copy the client id and client secret from its <em>Basic Information</em> page into this
          form.
        </li>
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <div class="grid">
          <label>
            Name
            <input
              name="slackAppName"
              required
              maxLength={80}
              value={name}
              onInput={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label>
            Client id
            <input
              name="clientId"
              class="mono"
              autoComplete="off"
              required
              maxLength={255}
              placeholder="1234567890.1234567890"
              value={clientId}
              onInput={(event) => setClientId(event.currentTarget.value)}
            />
          </label>
          <label>
            Client secret
            <input
              name="clientSecret"
              type="password"
              class="mono"
              autoComplete="off"
              required
              maxLength={255}
              value={clientSecret}
              onInput={(event) => setClientSecret(event.currentTarget.value)}
            />
          </label>
          <label>
            Signing secret
            <input
              name="signingSecret"
              type="password"
              class="mono"
              autoComplete="off"
              maxLength={255}
              placeholder="optional"
              value={signingSecret}
              onInput={(event) => setSigningSecret(event.currentTarget.value)}
            />
          </label>
        </div>
        {create.isError && <Failure what="Storing the Slack app" error={create.error} />}
        <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
          {create.isPending ? "Storing…" : "Store Slack app"}
        </button>
      </form>
    </article>
  );
};

const DeleteButton = ({
  label,
  what,
  queryKey,
  remove: removeFn,
}: {
  label: string;
  what: string;
  queryKey: string[];
  remove: () => Promise<undefined>;
}) => {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: removeFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
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
        {remove.isPending ? "Deleting…" : label}
      </button>
      {remove.isError && <Failure what={what} error={remove.error} />}
    </>
  );
};

const SlackAppCard = ({ app }: { app: SlackApp }) => (
  <article class="card">
    <header>
      <h3>{app.name}</h3>
    </header>
    <ul class="meta">
      <li>
        <span class="meta-label">Client id</span>
        <span class="mono">{app.clientId}</span>
      </li>
      <li>
        <span class="meta-label">Stored</span>
        <When iso={app.createdAt} />
      </li>
    </ul>
    <footer class="card-actions">
      <a class="button small" href={slackInstallUrl(app.slackAppId)}>
        Add to Slack
      </a>
      <DeleteButton
        label="Delete"
        what={`Deleting ${app.name}`}
        queryKey={SLACK_APPS}
        remove={() => deleteSlackApp(app.slackAppId)}
      />
    </footer>
  </article>
);

const SlackApps = () => {
  const apps = useQuery({ queryKey: SLACK_APPS, queryFn: listSlackApps });
  return (
    <section>
      <h2>Add to Slack</h2>
      {apps.isPending && <Loading what="Slack apps" />}
      {apps.isError && <Failure what="Loading the Slack apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && (
        <p class="empty-line">No Slack app stored yet. Create one above.</p>
      )}
      {apps.isSuccess && apps.data.length > 0 && (
        <div class="card-grid">
          {apps.data.map((app) => (
            <SlackAppCard key={app.slackAppId} app={app} />
          ))}
        </div>
      )}
    </section>
  );
};

const WorkspaceCard = ({ workspace }: { workspace: Workspace }) => (
  <article class="card">
    <header>
      <h3>{workspace.teamName}</h3>
    </header>
    <ul class="meta">
      <li>
        <span class="meta-label">Slack app</span>
        <span>{workspace.slackAppName}</span>
      </li>
      <li>
        <span class="meta-label">Installed</span>
        <When iso={workspace.createdAt} />
      </li>
    </ul>
    <footer class="card-actions">
      <DeleteButton
        label="Delete"
        what={`Deleting ${workspace.teamName}`}
        queryKey={WORKSPACES}
        remove={() => deleteWorkspace(workspace.workspaceId)}
      />
    </footer>
  </article>
);

const WorkspaceList = () => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  return (
    <section>
      <h2>Workspaces</h2>
      {workspaces.isPending && <Loading what="Slack workspaces" />}
      {workspaces.isError && (
        <Failure what="Loading the Slack workspaces" error={workspaces.error} />
      )}
      {workspaces.isSuccess && workspaces.data.length === 0 && (
        <p class="empty-line">
          No Slack workspaces yet. Press Add to Slack, then pick a channel on an app.
        </p>
      )}
      {workspaces.isSuccess && workspaces.data.length > 0 && (
        <div class="card-grid">
          {workspaces.data.map((workspace) => (
            <WorkspaceCard key={workspace.workspaceId} workspace={workspace} />
          ))}
        </div>
      )}
    </section>
  );
};

export const Workspaces = () => {
  const installed = new URLSearchParams(useSearch()).get("installed");
  return (
    <>
      <PageHeader
        title="Slack"
        description="Workspaces whose channels can get a link to each new issue."
      />
      {installed !== null && (
        <article class="callout callout-success" role="status">
          <header>
            <h3>Installed in {installed}</h3>
          </header>
          <p>
            Run <code class="mono">/invite @bugstack</code> in each channel an app posts to, then
            pick the channel on the app.
          </p>
        </article>
      )}
      <CreateSlackApp />
      <SlackApps />
      <WorkspaceList />
    </>
  );
};

const SlackForm = ({ app, workspaces }: { app: App; workspaces: Workspace[] }) => {
  const queryClient = useQueryClient();
  const [workspaceId, setWorkspaceId] = useState(app.slack?.workspaceId ?? "");
  const [channel, setChannel] = useState(app.slack?.channel ?? "");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["app", app.appId] });
  const save = useMutation({
    mutationFn: () => setAppSlack(app.appId, { workspaceId, channel }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: () => removeAppSlack(app.appId),
    onSuccess: () => {
      setWorkspaceId("");
      setChannel("");
      return refresh();
    },
  });
  const current = workspaces.find((workspace) => workspace.workspaceId === app.slack?.workspaceId);
  return (
    <>
      <p class="field-note">
        {app.slack === null
          ? "Reports from this app go to GitHub only."
          : `Reports post to ${app.slack.channel} in ${current?.teamName ?? app.slack.workspaceId}.`}
      </p>
      <form
        class="inline-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Slack workspace
          <select
            name="workspaceId"
            required
            value={workspaceId}
            onChange={(event) => setWorkspaceId(event.currentTarget.value)}
          >
            <option value="">Choose a workspace</option>
            {workspaces.map((workspace) => (
              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                {workspace.teamName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Channel
          <input
            name="channel"
            required
            maxLength={80}
            placeholder="bugs"
            value={channel}
            onInput={(event) => setChannel(event.currentTarget.value)}
          />
        </label>
        <div class="actions">
          <button type="submit" aria-busy={save.isPending} disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save Slack channel"}
          </button>
          {app.slack !== null && (
            <button
              type="button"
              class="secondary outline"
              aria-busy={remove.isPending}
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              {remove.isPending ? "Removing…" : "Remove Slack"}
            </button>
          )}
        </div>
      </form>
      {save.isError && <Failure what="Saving the Slack channel" error={save.error} />}
      {remove.isError && <Failure what="Removing the Slack channel" error={remove.error} />}
    </>
  );
};

export const AppSlack = ({ app }: { app: App }) => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  if (workspaces.isPending) return <Loading what="Slack workspaces" />;
  if (workspaces.isError)
    return <Failure what="Loading the Slack workspaces" error={workspaces.error} />;
  if (workspaces.data.length === 0) {
    return (
      <p class="empty-line">
        No Slack workspaces yet. <Link href="/slack">Add bugstack to Slack</Link> to post this app's
        reports to a channel.
      </p>
    );
  }
  return <SlackForm app={app} workspaces={workspaces.data} />;
};
