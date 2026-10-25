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
import { ConfirmDelete, Step } from "./step";
import { ExternalIcon, Loading, PageHeader, PlusIcon, When } from "./ui";

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

const CreateSlackApp = ({ onClose }: { onClose: () => void }) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("bugstack");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const create = useMutation({
    mutationFn: () =>
      createSlackApp({
        name: name.trim(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim(),
        signingSecret: "",
      }),
    onSuccess: () => {
      onClose();
      return queryClient.invalidateQueries({ queryKey: SLACK_APPS });
    },
  });
  return (
    <Step
      title="Create a Slack app"
      description="Slack hands you these two strings once; paste them here."
      onClose={onClose}
    >
      <ol class="how-to">
        <li>
          <a href={createSlackAppUrl()} target="_blank" rel="noreferrer" class="with-icon">
            Open Slack's app dialog
            <ExternalIcon />
          </a>{" "}
          with the manifest filled in, and create the app.
        </li>
        <li>
          Copy the client id and client secret from its <em>Basic Information</em> page.
        </li>
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label>
          Name
          <input
            name="slackAppName"
            autoComplete="off"
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
        {create.isError && <Failure what="Storing the Slack app" error={create.error} />}
        <footer class="actions">
          <button type="submit" aria-busy={create.isPending} disabled={create.isPending}>
            {create.isPending ? "Storing…" : "Store Slack app"}
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
        {first ? "Create a Slack app" : "Create another Slack app"}
      </button>
      {open && <CreateSlackApp onClose={() => setOpen(false)} />}
    </>
  );
};

const AppWorkspaces = ({ app }: { app: SlackApp }) => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  if (workspaces.isPending) return <Loading what="workspaces" />;
  if (workspaces.isError) {
    return <Failure what="Loading the Slack workspaces" error={workspaces.error} />;
  }
  const mine = workspaces.data.filter((workspace) => workspace.slackAppId === app.slackAppId);
  if (mine.length === 0) return <p class="installs-empty">Not in any workspace yet</p>;
  return (
    <ul class="installs">
      {mine.map((workspace) => (
        <li key={workspace.workspaceId}>
          <span class="installs-name">
            <strong>{workspace.teamName}</strong>
            <span class="muted">
              Installed <When iso={workspace.createdAt} />
            </span>
          </span>
          <ConfirmDelete
            label="Remove"
            name={workspace.teamName}
            queryKey={WORKSPACES}
            remove={() => deleteWorkspace(workspace.workspaceId)}
          />
        </li>
      ))}
    </ul>
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
        <span class="meta-label">Created</span>
        <When iso={app.createdAt} />
      </li>
    </ul>
    <h4 class="installs-title">Workspaces</h4>
    <AppWorkspaces app={app} />
    <footer class="card-actions">
      <a class="button" href={slackInstallUrl(app.slackAppId)}>
        Add to another workspace
      </a>
      <ConfirmDelete
        name={app.name}
        queryKey={SLACK_APPS}
        remove={() => deleteSlackApp(app.slackAppId)}
      />
    </footer>
  </article>
);

const Empty = () => (
  <article class="empty">
    <h3>No Slack app yet</h3>
    <p>bugstack posts a link to each new issue through a Slack app you own. Two steps:</p>
    <ol>
      <li>Create the app in Slack and paste its client id and secret here.</li>
      <li>Add it to each workspace, then pick a channel on an app.</li>
    </ol>
    <CreateButton first />
  </article>
);

export const Workspaces = () => {
  const apps = useQuery({ queryKey: SLACK_APPS, queryFn: listSlackApps });
  const installed = new URLSearchParams(useSearch()).get("installed");
  return (
    <>
      <PageHeader
        title="Slack"
        description="The Slack apps that post a link to each new issue, and the workspaces they are in."
        action={apps.isSuccess && apps.data.length > 0 && <CreateButton first={false} />}
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
      {apps.isPending && <Loading what="Slack apps" />}
      {apps.isError && <Failure what="Loading the Slack apps" error={apps.error} />}
      {apps.isSuccess && apps.data.length === 0 && <Empty />}
      {apps.isSuccess && apps.data.length > 0 && (
        <div class="card-grid">
          {apps.data.map((app) => (
            <SlackAppCard key={app.slackAppId} app={app} />
          ))}
        </div>
      )}
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
