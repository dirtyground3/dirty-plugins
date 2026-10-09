import { React, ui } from "../runtime";
import { bytes } from "../domain/rules";
import { hidden } from "./RuleField";
import type { ResultsProps } from "./Results";
export function OperationTable(props: Pick<ResultsProps, "record" | "capture" | "excluded" | "onExclude" | "onPage">) {
  const record = props.record;
  return (
    <React.Fragment>
      <div className="dirty-ui-table-wrap">
        <table className="dirty-ui-table dirty-compactor-table">
          <thead><tr>{["Scene", "Action", "Saving", "Status"].map(label => (<th key={label} scope="col">{label}</th>))}</tr></thead>
          <tbody>{(record.operations || []).map(op => {
            return (
              <tr key={op.id}>
                <td>
                  {props.onExclude && (<ui.SettingsToggle checked={(props.excluded || []).indexOf(op.sceneId) < 0} label={hidden("Include scene " + op.sceneId)} onChange={value => { props.onExclude!(op.sceneId, !value); }} />)}
                  <a href={"/scenes/" + op.sceneId}>{props.capture ? "Scene hidden" : op.title}</a>
                  <details>
                    <summary>File details</summary>
                    <span className="dirty-compactor-path">{props.capture ? "Path hidden" : op.source}</span>
                    {op.media && (<div>{op.media.width + " × " + op.media.height + " · " + (op.media.bitrate / 1e6).toFixed(2) + " Mbps"}</div>)}
                    {op.identity && (<div>{bytes(op.identity.size)}</div>)}
                    {op.destination && op.destination !== op.source && (<div className="dirty-compactor-path">{"→ " + (props.capture ? "Path hidden" : op.destination)}</div>)}
                  </details>
                </td>
                <td>{op.dimensions ? op.dimensions.join(" × ") + " · " + (op.crf != null ? "CRF " + op.crf + (op.vmaf ? " · VMAF " + op.vmaf : "") + " · ~" : op.rule.quality === "visual" ? "measured when run · typically ~" : "") +
                  (op.mbps || op.rule.mbps) + " Mbps" + (op.convert ? " (original bitrate)" : "") : (<span className="dirty-compactor-danger">Delete</span>)}<div className="dirty-compactor-muted">{op.rule.name}</div></td>
                <td>{bytes(op.actualSavings || op.savings)}</td>
                <td><ui.Badge>{op.status}</ui.Badge>{op.reason && (<div className="dirty-compactor-muted">{op.reason}</div>)}</td>
              </tr>);
          })}</tbody>
        </table>
      </div>
      <ui.Pagination page={record.page} totalPages={record.pages} onPageChange={props.onPage} ariaLabel="Operation pages" summary={"Page " + record.page + " of " + record.pages} />
    </React.Fragment>);
}
