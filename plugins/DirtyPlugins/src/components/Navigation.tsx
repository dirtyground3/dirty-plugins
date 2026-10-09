import { PluginApi, React, hubApi } from "../runtime";
import type { ActionItem, MenuProps, NavProps, SelectorProps } from "../types";
import { Glyph } from "./Controls";
export function NavAction(props: NavProps) {
  var LinkComponent = props.as || PluginApi.libraries.ReactRouterDOM.Link;
  return (<LinkComponent
    to={hubApi.captureUrl ? hubApi.captureUrl(props.to) : props.to}
    exact={props.exact}
    title={props.label}
    aria-label={props.label}
    className={"nav-utility dirty-ui-nav-action" + (props.className ? " " + props.className : "")}
    onClick={props.onClick}>
    {props.icon}
  </LinkComponent>);
}

export function StatisticSelector(props: SelectorProps) {
  var bootstrap = PluginApi.libraries.Bootstrap;
  var Dropdown = bootstrap.Dropdown;
  var options = props.options || [];
  var selected = options.find(function(option) { return option.value === props.value; });
  function select(value: string | null) {
    if (value && value !== props.value && props.onSelect) props.onSelect(value);
  }
  return (<Dropdown
    as={bootstrap.ButtonGroup}
    className={"sort-by-select dirty-ui-statistic-selector" + (props.className ? " " + props.className : "")}
    onSelect={select}>
    <bootstrap.InputGroup.Prepend>
      <Dropdown.Toggle
        variant="secondary"
        id={props.id}
        aria-label={props.ariaLabel || "Statistic"}>
        {selected ? selected.label : props.value}
      </Dropdown.Toggle>
    </bootstrap.InputGroup.Prepend>
    <Dropdown.Menu
      className="bg-secondary text-white">
      {options.map(function(option) {
        return (<Dropdown.Item
          key={option.value}
          className="bg-secondary text-white"
          eventKey={option.value}
          active={props.value === option.value}>
          {option.label}
        </Dropdown.Item>);
      })}
    </Dropdown.Menu>
  </Dropdown>);
}

export function ActionMenu(props: MenuProps) {
  var bootstrap = PluginApi.libraries.Bootstrap;
  var Dropdown = bootstrap.Dropdown;
  var solidIcons = PluginApi.libraries.FontAwesomeSolid || {};
  var items = (props.items || []).filter((item): item is ActionItem => Boolean(item));
  function select(key: string | null) {
    var item = items[Number(key)];
    if (item && !item.disabled && item.onSelect) item.onSelect();
  }
  return (<Dropdown
    className={"dirty-ui-action-menu" + (props.label ? " dirty-ui-action-menu-labelled" : "") + (props.className ? " " + props.className : "")}
    onSelect={select}>
    <Dropdown.Toggle
      variant="secondary"
      id={props.id}
      className="dirty-ui-action-menu-toggle"
      aria-label={props.ariaLabel || "More actions"}
      title={props.ariaLabel || "More actions"}>
      {props.label || (<Glyph
        icon={solidIcons.faEllipsisV || solidIcons.faEllipsisVertical}
        fallback="⋮">

      </Glyph>)}
    </Dropdown.Toggle>
    <Dropdown.Menu
      alignRight={true}>
      {items.map(function(item, index) {
        if (item.header) return (<Dropdown.Header
          key={"header-" + index}>
          {item.header}
        </Dropdown.Header>);
        return (<Dropdown.Item
          key={item.key || index}
          eventKey={String(index)}
          disabled={Boolean(item.disabled)}
          href={item.href}
          download={item.download ? "" : undefined}
          target={item.href ? "_blank" : undefined}
          rel={item.href ? "noreferrer" : undefined}
          className={item.tone === "danger" ? "dirty-ui-action-menu-danger" : undefined}>
          {item.label}
        </Dropdown.Item>);
      })}
    </Dropdown.Menu>
  </Dropdown>);
}
