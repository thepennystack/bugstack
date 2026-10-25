import { useMutation, useQuery, useQueryClient } from "@tanstack/preact-query";
import { useState } from "preact/hooks";
import { Link } from "wouter-preact";
import {
  type App,
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  removeAppSlack,
  setAppSlack,
  type Workspace,
} from "./api";
import { Failure } from "./notices";

const WORKSPACES = ["slack", "workspaces"];

const NewWorkspace = () => {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [botToken, setBotToken] = useState("");
  const create = useMutation({
    mutationFn: () => createWorkspace({ name, botToken }),
    onSuccess: () => {
      setName("");
      setBotToken("");
      queryClient.invalidateQueries({ queryKey: WORKSPACES });
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
      <h3>Add a workspace</h3>
      <label>
        Name
        <input
          name="workspaceName"
          required
          maxLength={80}
          value={name}
          onInput={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <label>
        Bot token
        <input
          name="botToken"
          type="password"
          autoComplete="off"
          required
          placeholder="xoxb-…"
          value={botToken}
          onInput={(event) => setBotToken(event.currentTarget.value)}
        />
      </label>
      {create.isError && <Failure what="Adding the workspace" error={create.error} />}
      <button type="submit" disabled={create.isPending}>
        {create.isPending ? "Checking the token…" : "Add workspace"}
      </button>
    </form>
  );
};

const DeleteWorkspace = ({ workspace }: { workspace: Workspace }) => {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => deleteWorkspace(workspace.workspaceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: WORKSPACES }),
  });
  return (
    <>
      <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
        {remove.isPending ? "Deleting…" : "Delete"}
      </button>
      {remove.isError && <Failure what={`Deleting ${workspace.name}`} error={remove.error} />}
    </>
  );
};

export const Workspaces = () => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  return (
    <section>
      <h2>Slack workspaces</h2>
      <p>
        Create a Slack app with the bot scope <code>chat:write</code>, install it, paste its{" "}
        <code>xoxb-</code> token here, and <code>/invite @bugstack</code> in each channel.
      </p>
      {workspaces.isPending && <p>Loading Slack workspaces…</p>}
      {workspaces.isError && (
        <Failure what="Loading the Slack workspaces" error={workspaces.error} />
      )}
      {workspaces.isSuccess && workspaces.data.length === 0 && (
        <p>No Slack workspaces yet. Add one below to post reports to a channel.</p>
      )}
      {workspaces.isSuccess && workspaces.data.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Workspace id</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {workspaces.data.map((workspace) => (
              <tr key={workspace.workspaceId}>
                <td>{workspace.name}</td>
                <td>
                  <code>{workspace.workspaceId}</code>
                </td>
                <td>{workspace.createdAt}</td>
                <td>
                  <DeleteWorkspace workspace={workspace} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <NewWorkspace />
    </section>
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
      <p>
        {app.slack === null
          ? "Reports from this app go to GitHub only."
          : `Reports post to ${app.slack.channel} in ${current?.name ?? app.slack.workspaceId}.`}
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
                {workspace.name}
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
        <button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save Slack channel"}
        </button>
        {app.slack !== null && (
          <button type="button" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? "Removing…" : "Remove Slack"}
          </button>
        )}
      </form>
      {save.isError && <Failure what="Saving the Slack channel" error={save.error} />}
      {remove.isError && <Failure what="Removing the Slack channel" error={remove.error} />}
    </>
  );
};

export const AppSlack = ({ app }: { app: App }) => {
  const workspaces = useQuery({ queryKey: WORKSPACES, queryFn: listWorkspaces });
  if (workspaces.isPending) return <p>Loading Slack workspaces…</p>;
  if (workspaces.isError)
    return <Failure what="Loading the Slack workspaces" error={workspaces.error} />;
  if (workspaces.data.length === 0) {
    return (
      <p>
        No Slack workspaces yet. <Link href="/slack">Add one</Link> to post this app's reports to a
        channel.
      </p>
    );
  }
  return <SlackForm app={app} workspaces={workspaces.data} />;
};
