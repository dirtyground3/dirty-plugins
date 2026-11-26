import { captureUrl } from "../capture";
import { PluginApi, React } from "../runtime";
import type { ActionItem, MenuProps, NavProps, SelectorProps } from "../types";
import { withClass } from "../shared/values";
import { Glyph } from "./Controls";
import type * as R from "react";
export { NavIcon } from "./NavIcon";
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

/** Link skips a prevented click: a plain click on the current page keeps the filters in its URL. */
function keepCurrentPage(event: R.MouseEvent) {
  if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) event.preventDefault();
}

export function StatisticSelector(props: SelectorProps) {
  const bootstrap = PluginApi.libraries.Bootstrap,
    Dropdown = bootstrap.Dropdown,
    Link = PluginApi.libraries.ReactRouterDOM.Link;
  const options = props.options || [];
  const selected = options.find(option => option.value === props.value);
  function select(value: string | null) {
    const option = options.find(option => option.value === value);
    if (option && !option.to && option.value !== props.value && props.onSelect) props.onSelect(option.value);
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
            as={option.to ? Link : undefined}
            to={option.to ? captureUrl(option.to) : undefined}
            onClick={option.to && props.value === option.value ? keepCurrentPage : undefined}
          >
            {option.label}
          </Dropdown.Item>
        ))}
      </Dropdown.Menu>
    </Dropdown>
  );
}

const present = (items: MenuProps["items"]) => (items || []).filter((item): item is ActionItem => Boolean(item));

export function ActionMenu(props: MenuProps) {
  const Dropdown = PluginApi.libraries.Bootstrap.Dropdown;
  const solidIcons = PluginApi.libraries.FontAwesomeSolid || {};
  const items = present(props.items);
  const [show, setShow] = React.useState(false);
  // The open submenu, by its item's index. It shows inside the menu, which may scroll, and folds up when the menu closes.
  const [expanded, setExpanded] = React.useState<number | null>(null);
  const toggle = (next: boolean) => {
    setShow(next);
    if (!next) setExpanded(null);
  };
  /** Closes the menu from content such as a picker, which is not chosen like an item. */
  const close = () => toggle(false);
  /** Keys are "index" for a top-level item and "index.subindex" for one in a submenu. */
  function select(key: string | null) {
    const [index, subindex] = String(key).split(".");
    const parent = items[Number(index)];
    const item = subindex === undefined ? parent : present(parent?.items)[Number(subindex)];
    if (item && !item.disabled && item.onSelect) item.onSelect();
  }
  /**
   * A closed submenu keeps its items laid out but out of sight and out of reach, so the menu, placed for its width
   * when it opens, keeps that width and never grows past the window's edge.
   */
  const entry = (item: ActionItem, key: string, nested: boolean, hidden = false) =>
    item.content ? (
      <div
        key={item.key || key}
        className={[
          "dirty-ui-action-menu-content",
          nested && "dirty-ui-action-menu-subitem",
          hidden && "dirty-ui-action-menu-subitem-hidden",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden={hidden || undefined}
      >
        {typeof item.content === "function" ? item.content(close) : item.content}
      </div>
    ) : item.header ? (
      <Dropdown.Header
        key={"header-" + key}
        className={hidden ? "dirty-ui-action-menu-subitem-hidden" : undefined}
        aria-hidden={hidden || undefined}
      >
        {item.header}
      </Dropdown.Header>
    ) : (
      <Dropdown.Item
        key={item.key || key}
        eventKey={key}
        disabled={Boolean(item.disabled) || hidden}
        aria-hidden={hidden || undefined}
        href={item.href}
        download={item.download ? "" : undefined}
        target={item.href ? "_blank" : undefined}
        rel={item.href ? "noreferrer" : undefined}
        className={
          [
            nested && "dirty-ui-action-menu-subitem",
            hidden && "dirty-ui-action-menu-subitem-hidden",
            item.tone === "danger" && "dirty-ui-action-menu-danger",
          ]
            .filter(Boolean)
            .join(" ") || undefined
        }
      >
        {item.label}
      </Dropdown.Item>
    );
  return (
    <Dropdown
      className={withClass(
        "dirty-ui-action-menu" + (props.label ? " dirty-ui-action-menu-labelled" : ""),
        props.className,
      )}
      show={show}
      onSelect={select}
      onToggle={toggle}
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
        {items.map((item, index) => {
          if (!item.items) return entry(item, String(index), false);
          const open = expanded === index;
          return (
            <React.Fragment key={item.key || index}>
              {/* A plain button, not a menu item: choosing it would close the menu. */}
              <button
                type="button"
                className="dropdown-item dirty-ui-action-menu-submenu"
                aria-expanded={open}
                disabled={Boolean(item.disabled)}
                onClick={() => setExpanded(open ? null : index)}
              >
                <span className="dirty-ui-action-menu-submenu-label">{item.label}</span>
                <span className="dirty-ui-action-menu-submenu-caret" aria-hidden="true">
                  <Glyph
                    icon={open ? solidIcons.faChevronDown : solidIcons.faChevronRight}
                    fallback={open ? "▾" : "▸"}
                  />
                </span>
              </button>
              {present(item.items).map((sub, subindex) => entry(sub, index + "." + subindex, true, !open))}
            </React.Fragment>
          );
        })}
      </Dropdown.Menu>
    </Dropdown>
  );
}
