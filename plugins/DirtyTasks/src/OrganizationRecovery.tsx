import { hub, PluginApi, React, ui } from "../../DirtyPlugins/src/shared/host";

export function OrganizationRecovery() {
  const mounted = React.useRef(true);
  const revision = React.useRef(0);
  const recovering = React.useRef(false);
  const [required, setRequired] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [checkError, setCheckError] = React.useState("");
  const refresh = React.useCallback(async () => {
    const request = ++revision.current;
    try {
      const result = await hub.runPluginOperation<{ required: boolean }>("dirtyTasks", {
        mode: "organizationRecoveryStatus",
      });
      if (!mounted.current || request !== revision.current) return;
      setRequired(result.required === true);
      setCheckError("");
    } catch {
      if (!mounted.current || request !== revision.current) return;
      setRequired(false);
      setCheckError("Could not check organization task status.");
    }
  }, []);
  React.useEffect(() => {
    const onFocus = () => void refresh();
    void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      revision.current++;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);
  const event = PluginApi.GQL.useJobsSubscribeSubscription().data?.jobsSubscribe;
  const job = event?.job;
  React.useEffect(() => {
    if (job?.description?.includes("DirtyTasks: organization:")) void refresh();
  }, [event?.type, job?.id, job?.status, job?.description, job?.startTime, refresh]);
  async function recover() {
    if (recovering.current) return;
    recovering.current = true;
    setBusy(true);
    setError("");
    try {
      await hub.runPluginOperation("dirtyTasks", { mode: "recoverOrganization" });
    } catch {
      if (mounted.current) setError("Recovery could not finish. Try again.");
    } finally {
      if (mounted.current) await refresh();
      recovering.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  if (checkError)
    return <ui.StateView title={checkError} actions={<ui.Button onClick={refresh}>Check again</ui.Button>} />;
  if (!required) return null;
  return (
    <ui.StateView
      className="dirty-tasks-recovery"
      role="alert"
      title="⚠ Organization task interrupted"
      detail={error || "An interrupted task is blocking file work. Recover it to allow tasks to run again."}
      actions={
        <ui.Button busy={busy} disabled={busy} onClick={recover}>
          Recover organization task
        </ui.Button>
      }
    />
  );
}
