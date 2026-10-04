// @ts-check
(function () {
  "use strict";
  var INSTANCE_KEY = "__dirtyPluginsReact";
  if (window[INSTANCE_KEY]) return;
  /** @param {HubReactDependencies} dependencies */
  function createReact(dependencies) {
    var useEffect = dependencies.useEffect;
    var useRef = dependencies.useRef;
    var html = dependencies.html;
    var PluginApi = dependencies.PluginApi;
    var FontAwesomeIcon = dependencies.FontAwesomeIcon;
    var React = dependencies.React;
    var Link = dependencies.Link;
    var hubApi = dependencies.hubApi;
    var toastContainer = null;

    function ensureToastContainer() {
      if (toastContainer && toastContainer.isConnected) return toastContainer;
      toastContainer = document.createElement("div");
      toastContainer.className = "dirty-ui-toast-container";
      toastContainer.setAttribute("aria-live", "polite");
      toastContainer.setAttribute("aria-atomic", "false");
      document.body.appendChild(toastContainer);
      return toastContainer;
    }

    function notify(message, options) {
      var settings = typeof options === "string" ? { tone: options } : (options || {});
      var tone = settings.tone || "success";
      var container = ensureToastContainer();
      var toast = document.createElement("div");
      toast.className = "dirty-ui-toast dirty-ui-tone-" + tone;
      toast.setAttribute("role", tone === "error" ? "alert" : "status");
      toast.textContent = message;
      container.appendChild(toast);
      window.setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
        if (container.childElementCount === 0 && container.parentNode) {
          container.parentNode.removeChild(container);
          if (toastContainer === container) toastContainer = null;
        }
      }, settings.duration || (tone === "error" ? 8000 : 5000));
      return toast;
    }

    function trapDialogTab(event, dialog) {
      if (event.key !== "Tab" || !dialog) return;
      var items = Array.prototype.slice.call(dialog.querySelectorAll('button, input, select, textarea, a[href], [tabindex="0"]'))
        .filter(function (item) { return !item.disabled && item.getClientRects().length; });
      if (!items.length) { event.preventDefault(); dialog.focus(); return; }
      var first = items[0], last = items[items.length - 1];
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    var bodyScrollLocks = 0;
    function lockBodyScroll() {
      if (!document.body || !document.body.classList) return function () {};
      bodyScrollLocks += 1;
      document.body.classList.add("dirty-ui-modal-open");
      var released = false;
      return function () {
        if (released) return;
        released = true;
        bodyScrollLocks = Math.max(0, bodyScrollLocks - 1);
        if (!bodyScrollLocks) document.body.classList.remove("dirty-ui-modal-open");
      };
    }

    var activeDialogs = [];
    function manageDialog(options) {
      var dialog = options && options.dialog;
      if (!dialog) return function () {};
      var opener = options.opener || document.activeElement;
      var unlockScroll = lockBodyScroll();
      var entry = { dialog: dialog };
      var released = false;
      activeDialogs.push(entry);

      function nativePopupIsActive() {
        if (!options.allowNativePopup || !document.querySelectorAll) return false;
        return Array.prototype.some.call(document.querySelectorAll('.modal.show, .dropdown-menu.show, [role="dialog"][aria-modal="true"]'), function (popup) {
          return popup !== dialog &&
            (popup.classList && popup.classList.contains("show") ||
              !dialog.contains(popup) && popup.contains(document.activeElement));
        });
      }
      function onKeydown(event) {
        if (activeDialogs[activeDialogs.length - 1] !== entry || nativePopupIsActive()) return;
        if (event.key === "Escape") {
          if (options.onClose) { event.preventDefault(); options.onClose(); }
        } else {
          trapDialogTab(event, dialog);
        }
      }

      if (document.addEventListener) document.addEventListener("keydown", onKeydown, true);
      var initial = options.initialFocus;
      if (typeof initial === "function") initial = initial();
      if (!initial && dialog.querySelector) initial = dialog.querySelector('button, input, select, textarea, a[href], [tabindex="0"]');
      if (initial && typeof initial.focus === "function") initial.focus();
      else if (typeof dialog.focus === "function") dialog.focus();
      return function () {
        if (released) return;
        released = true;
        if (document.removeEventListener) document.removeEventListener("keydown", onKeydown, true);
        var index = activeDialogs.indexOf(entry);
        if (index !== -1) activeDialogs.splice(index, 1);
        unlockScroll();
        if (opener && opener.isConnected !== false && typeof opener.focus === "function") opener.focus();
      };
    }

    var pageTitleOwners = [];

    function usePageTitle(pluginName, viewTitle) {
      useEffect(function () {
        var previousTitle = document.title;
        var title = (viewTitle ? viewTitle + " - " : "") + pluginName;
        var owner = { title: title, previousTitle: previousTitle };
        pageTitleOwners.push(owner);
        function updateTitle() {
          // Overlapping routes must not fight in a MutationObserver microtask
          // loop. Only the most recently mounted title effect may write.
          if (pageTitleOwners[pageTitleOwners.length - 1] === owner && document.title !== title) document.title = title;
        }
        updateTitle();
        // Native Stash lists can update their Helmet title after loading. Keep
        // the plugin page's title until its route unmounts.
        var observer = null;
        if (window.MutationObserver && document.head) {
          observer = new window.MutationObserver(updateTitle);
          observer.observe(document.head, { childList: true, subtree: true, characterData: true });
        }
        return function () {
          if (observer) observer.disconnect();
          var index = pageTitleOwners.indexOf(owner);
          if (index === -1) return;
          var wasActive = index === pageTitleOwners.length - 1;
          pageTitleOwners.splice(index, 1);
          // Preserve the original title when an older route unmounts first.
          if (pageTitleOwners[index]) pageTitleOwners[index].previousTitle = owner.previousTitle;
          if (wasActive && document.title === title) {
            var activeOwner = pageTitleOwners[pageTitleOwners.length - 1];
            document.title = activeOwner ? activeOwner.title : owner.previousTitle;
          }
        };
      }, [pluginName, viewTitle]);
    }

    function Dialog(props) {
      var dialog = useRef(null);
      useEffect(function () {
        if (props.open === false) return;
        return manageDialog({
          dialog: dialog.current,
          initialFocus: props.initialFocusRef && props.initialFocusRef.current,
          opener: props.openerRef && props.openerRef.current,
          onClose: props.onClose,
          allowNativePopup: props.allowNativePopup,
        });
      }, [props.open]);
      function closeFromBackdrop(event) {
        if (event.target === event.currentTarget && props.onClose) props.onClose();
      }
      var content = html`<div
        className=${props.backdropClassName || "dirty-ui-backdrop"}
        style=${props.open === false ? { display: "none" } : undefined}
        onMouseDown=${closeFromBackdrop}
      >
        ${props.backdrop}
        <section
          ref=${dialog}
          id=${props.id}
          className=${props.className || "dirty-ui-dialog"}
          role="dialog"
          aria-modal=${true}
          aria-label=${props.ariaLabel}
          aria-labelledby=${props.labelledBy}
          tabIndex=${-1}
        >${props.children}</section>
      </div>`;
      return PluginApi.ReactDOM && PluginApi.ReactDOM.createPortal
        ? PluginApi.ReactDOM.createPortal(content, document.body)
        : content;
    }

    function Glyph(props) {
      if (FontAwesomeIcon && props.icon) {
        return html`<${FontAwesomeIcon} icon=${props.icon} />`;
      }
      return html`<span aria-hidden="true">${props.fallback}</span>`;
    }

    function IconButton(props) {
      var className = "dirty-ui-icon-button" +
        (props.compact ? " dirty-ui-icon-button-compact" : "") +
        (props.tone === "danger" ? " dirty-ui-icon-button-danger" : "") +
        (props.tone === "primary" ? " dirty-ui-icon-button-primary" : "") +
        (props.className ? " " + props.className : "");
      return html`<button
        type="button"
        className=${className}
        aria-label=${props.ariaLabel}
        title=${props.ariaLabel}
        disabled=${Boolean(props.disabled || props.busy)}
        aria-busy=${props.busy ? "true" : undefined}
        aria-pressed=${props.pressed == null ? undefined : Boolean(props.pressed)}
        ref=${props.buttonRef}
        onClick=${props.onClick}
      ><${Glyph} icon=${props.icon} fallback=${props.fallback} /></button>`;
    }

    function StateView(props) {
      var className = "dirty-ui-state" +
        (props.className ? " " + props.className : "");
      return html`
        <div className=${className} role=${props.role} aria-live=${props.ariaLive}>
          <div className="dirty-ui-state-panel">
            <div className="dirty-ui-state-title">${props.title}</div>
            ${props.detail && html`<div className="dirty-ui-state-detail">${props.detail}</div>`}
            ${props.actions && html`<div className="dirty-ui-state-actions">${props.actions}</div>`}
          </div>
        </div>`;
    }

    function SettingsCard(props) {
      var plugin = props.plugin || {};
      var className = "card dirty-ui-panel dirty-plugins-card" +
        (props.className ? " " + props.className : "");
      var bodyClassName = "card-body" +
        (props.bodyClassName ? " " + props.bodyClassName : "");
      return html`
        <section className=${className}>
          <div className="card-header dirty-plugins-card-header">
            <div>
              <h2>${plugin.name}</h2>
              ${plugin.description && html`<p>${plugin.description}</p>`}
            </div>
            <div className="dirty-plugins-plugin-meta">
              ${plugin.version && html`<span>${"v" + plugin.version}</span>`}
              ${plugin.enabled === false && html`<span className="badge badge-secondary">Disabled</span>`}
            </div>
          </div>
          <div className=${bodyClassName}>${props.children}</div>
          ${props.footer}
        </section>`;
    }

    function SettingsSection(props) {
      var className = "dirty-ui-settings-section" +
        (props.className ? " " + props.className : "");
      return html`
        <section className=${className}>
          <div className="dirty-ui-settings-section-heading">
            <h3>${props.title}</h3>
            ${props.description && html`<p>${props.description}</p>`}
          </div>
          ${props.children}
        </section>`;
    }

    function SettingsToggle(props) {
      return html`
        <label className=${"dirty-ui-settings-toggle" + (props.className ? " " + props.className : "")}>
          <input
            checked=${Boolean(props.checked)}
            disabled=${Boolean(props.disabled)}
            onChange=${function (event) { props.onChange(event.target.checked); }}
            type="checkbox"
          />
          <span>${props.label}</span>
        </label>`;
    }

    function Button(props) {
      var tone = /^(primary|secondary|danger|light|dark|quiet)$/.test(props.tone || "")
        ? props.tone : "secondary";
      var className = "btn " + (tone === "quiet" ? "dirty-ui-control-quiet" : "btn-" + tone) +
        " dirty-ui-button dirty-ui-control" +
        (props.compact ? " dirty-ui-control-compact" : "") +
        (props.className ? " " + props.className : "");
      return html`<button
        type=${props.type || "button"}
        className=${className}
        disabled=${Boolean(props.disabled || props.busy)}
        aria-label=${props.ariaLabel}
        aria-busy=${props.busy ? "true" : undefined}
        aria-pressed=${props.pressed == null ? undefined : Boolean(props.pressed)}
        ref=${props.buttonRef}
        onClick=${props.onClick}
        title=${props.title}
      >${props.children}</button>`;
    }

    function Field(props) {
      var descriptionId = props.id + "-help";
      var errorId = props.id + "-error";
      var control = props.children;
      if (React.isValidElement(control)) {
        var existing = control.props["aria-describedby"];
        var describedBy = [existing, props.help && descriptionId, props.error && errorId]
          .filter(Boolean).join(" ") || undefined;
        control = React.cloneElement(control, {
          id: props.id,
          "aria-describedby": describedBy,
          "aria-invalid": props.error ? "true" : control.props["aria-invalid"],
        });
      }
      return html`
        <div className=${"dirty-ui-field" + (props.className ? " " + props.className : "")} id=${props.containerId}>
          <label htmlFor=${props.id}>${props.label}</label>
          ${props.action ? html`<div className="dirty-ui-field-control">${control}${props.action}</div>` : control}
          ${props.help && html`<p className="dirty-ui-field-help" id=${descriptionId}>${props.help}</p>`}
          ${props.error && html`<p className="dirty-ui-field-error" id=${errorId}>${props.error}</p>`}
        </div>`;
    }

    function SaveStatus(props) {
      if (!props.message) return null;
      var state = props.state || "saved";
      return html`<span
        className=${"dirty-ui-save-status" + (props.className ? " " + props.className : "")}
        data-state=${state}
        role=${state === "error" ? "alert" : "status"}
        aria-live=${state === "error" ? "assertive" : "polite"}
      >${props.message}</span>`;
    }

    function Pagination(props) {
      if (props.totalPages <= 1) return null;
      return html`
        <nav
          aria-label=${props.ariaLabel || "Pages"}
          className=${"dirty-ui-pagination" + (props.className ? " " + props.className : "")}
        >
          <${Button}
            compact=${true}
            disabled=${props.page <= 1}
            onClick=${function () { props.onPageChange(props.page - 1); }}
          >Previous<//>
          <span className="dirty-ui-pagination-summary">
            ${props.summary || "Page " + props.page + " of " + props.totalPages}
          </span>
          <${Button}
            compact=${true}
            disabled=${props.page >= props.totalPages}
            onClick=${function () { props.onPageChange(props.page + 1); }}
          >Next<//>
        </nav>`;
    }

    function Badge(props) {
      return html`<span
        className=${"dirty-ui-badge" + (props.className ? " " + props.className : "")}
        title=${props.title}
      >${props.children}</span>`;
    }

    function Metric(props) {
      return html`
        <div className=${"dirty-ui-metric" + (props.className ? " " + props.className : "")}>
          <span className="dirty-ui-metric-label">${props.label}</span>
          <strong className="dirty-ui-metric-value">${props.value}</strong>
          ${props.detail && html`<span className="dirty-ui-metric-detail">${props.detail}</span>`}
        </div>`;
    }

    function NavAction(props) {
      var LinkComponent = props.as || Link;
      return html`<${LinkComponent}
        to=${hubApi.captureUrl ? hubApi.captureUrl(props.to) : props.to}
        exact=${props.exact}
        title=${props.label}
        aria-label=${props.label}
        className=${"nav-utility dirty-ui-nav-action" + (props.className ? " " + props.className : "")}
        onClick=${props.onClick}
      >${props.icon}<//>`;
    }

    function StatisticSelector(props) {
      var bootstrap = PluginApi.libraries.Bootstrap;
      var Dropdown = bootstrap.Dropdown;
      var options = props.options || [];
      var selected = options.find(function (option) { return option.value === props.value; });
      function select(value) {
        if (value && value !== props.value && props.onSelect) props.onSelect(value);
      }
      return html`
        <${Dropdown}
          as=${bootstrap.ButtonGroup}
          className=${"sort-by-select dirty-ui-statistic-selector" + (props.className ? " " + props.className : "")}
          onSelect=${select}
        >
          <${bootstrap.InputGroup.Prepend}>
            <${Dropdown.Toggle} variant="secondary" id=${props.id} aria-label=${props.ariaLabel || "Statistic"}>
              ${selected ? selected.label : props.value}
            <//>
          <//>
          <${Dropdown.Menu} className="bg-secondary text-white">
            ${options.map(function (option) {
              return html`<${Dropdown.Item}
                key=${option.value}
                className="bg-secondary text-white"
                eventKey=${option.value}
                active=${props.value === option.value}
              >${option.label}<//>`;
            })}
          <//>
        <//>`;
    }

    // Overflow menu for secondary row actions. Items are {label, onSelect,
    // disabled, tone}, links {label, href, download}, or group {header}s;
    // falsy entries are skipped so callers can inline guards.
    function ActionMenu(props) {
      var bootstrap = PluginApi.libraries.Bootstrap;
      var Dropdown = bootstrap.Dropdown;
      var solidIcons = PluginApi.libraries.FontAwesomeSolid || {};
      var items = (props.items || []).filter(Boolean);
      function select(key) {
        var item = items[Number(key)];
        if (item && !item.disabled && item.onSelect) item.onSelect();
      }
      return html`
        <${Dropdown}
          className=${"dirty-ui-action-menu" + (props.label ? " dirty-ui-action-menu-labelled" : "") + (props.className ? " " + props.className : "")}
          onSelect=${select}
        >
          <${Dropdown.Toggle}
            variant="secondary"
            id=${props.id}
            className="dirty-ui-action-menu-toggle"
            aria-label=${props.ariaLabel || "More actions"}
            title=${props.ariaLabel || "More actions"}
          >${props.label || html`<${Glyph} icon=${solidIcons.faEllipsisV || solidIcons.faEllipsisVertical} fallback="⋮" />`}<//>
          <${Dropdown.Menu} alignRight=${true}>
            ${items.map(function (item, index) {
              if (item.header) return html`<${Dropdown.Header} key=${"header-" + index}>${item.header}<//>`;
              return html`<${Dropdown.Item}
                key=${item.key || index}
                eventKey=${String(index)}
                disabled=${Boolean(item.disabled)}
                href=${item.href}
                download=${item.download ? "" : undefined}
                target=${item.href ? "_blank" : undefined}
                rel=${item.href ? "noreferrer" : undefined}
                className=${item.tone === "danger" ? "dirty-ui-action-menu-danger" : undefined}
              >${item.label}<//>`;
            })}
          <//>
        <//>`;
    }

    return {
      notify: notify,
      trapDialogTab: trapDialogTab,
      lockBodyScroll: lockBodyScroll,
      manageDialog: manageDialog,
      ActionMenu: ActionMenu,
      Badge: Badge,
      Button: Button,
      Dialog: Dialog,
      Field: Field,
      Glyph: Glyph,
      IconButton: IconButton,
      Metric: Metric,
      NavAction: NavAction,
      Pagination: Pagination,
      SaveStatus: SaveStatus,
      SettingsCard: SettingsCard,
      SettingsSection: SettingsSection,
      SettingsToggle: SettingsToggle,
      StateView: StateView,
      StatisticSelector: StatisticSelector,
      usePageTitle: usePageTitle
    };
  }
  window[INSTANCE_KEY] = { createReact: createReact };
})();
