import { captureUrl } from "../capture";
import { PluginApi, React } from "../runtime";
import type { ActionItem, MenuProps, NavProps, SelectorProps } from "../types";
import { withClass } from "../shared/values";
import { Glyph } from "./Controls";
export function NavAction(props: NavProps) {
  const LinkComponent = props.as || PluginApi.libraries.ReactRouterDOM.Link;
  return (
    <LinkComponent
      to={captureUrl(props.to)}
      exact={props.exact}
      title={props.label}
      aria-label={props.label}
      className={withClass("nav-utility dirty-ui-nav-action", props.className)}
      onClick={props.onClick}
    >
      {props.icon}
    </LinkComponent>
  );
}

export function StatisticSelector(props: SelectorProps) {
  const bootstrap = PluginApi.libraries.Bootstrap,
    Dropdown = bootstrap.Dropdown;
  const options = props.options || [];
  const selected = options.find(option => option.value === props.value);
  function select(value: string | null) {
    if (value && value !== props.value && props.onSelect) props.onSelect(value);
  }
  return (
    <Dropdown
      as={bootstrap.ButtonGroup}
      className={withClass("sort-by-select dirty-ui-statistic-selector", props.className)}
      onSelect={select}
    >
      <bootstrap.InputGroup.Prepend>
        <Dropdown.Toggle variant="secondary" id={props.id} aria-label={props.ariaLabel || "Statistic"}>
          {selected ? selected.label : props.value}
        </Dropdown.Toggle>
      </bootstrap.InputGroup.Prepend>
      <Dropdown.Menu className="bg-secondary text-white">
        {options.map(option => (
          <Dropdown.Item
            key={option.value}
            className="bg-secondary text-white"
            eventKey={option.value}
            active={props.value === option.value}
          >
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

export function ActionMenu(props: MenuProps) {
  const Dropdown = PluginApi.libraries.Bootstrap.Dropdown;
  const solidIcons = PluginApi.libraries.FontAwesomeSolid || {};
  const items = (props.items || []).filter((item): item is ActionItem => Boolean(item));
  function select(key: string | null) {
    const item = items[Number(key)];
    if (item && !item.disabled && item.onSelect) item.onSelect();
  }
  return (
    <Dropdown
      className={withClass(
        "dirty-ui-action-menu" + (props.label ? " dirty-ui-action-menu-labelled" : ""),
        props.className,
      )}
      onSelect={select}
    >
      <Dropdown.Toggle
        variant="secondary"
        id={props.id}
        className="dirty-ui-action-menu-toggle"
        aria-label={props.ariaLabel || "More actions"}
        title={props.ariaLabel || "More actions"}
      >
        {props.label || <Glyph icon={solidIcons.faEllipsisV || solidIcons.faEllipsisVertical} fallback="⋮" />}
      </Dropdown.Toggle>
      <Dropdown.Menu alignRight={true}>
        {items.map((item, index) =>
          item.header ? (
            <Dropdown.Header key={"header-" + index}>{item.header}</Dropdown.Header>
          ) : (
            <Dropdown.Item
              key={item.key || index}
              eventKey={String(index)}
              disabled={Boolean(item.disabled)}
              href={item.href}
              download={item.download ? "" : undefined}
              target={item.href ? "_blank" : undefined}
              rel={item.href ? "noreferrer" : undefined}
              className={item.tone === "danger" ? "dirty-ui-action-menu-danger" : undefined}
            >
              {item.label}
            </Dropdown.Item>
          ),
        )}
      </Dropdown.Menu>
    </Dropdown>
  );
}
