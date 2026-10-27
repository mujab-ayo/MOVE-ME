/**
 * MoveMe Admin Screen
 * Handles:
 * 1. Viewing drivers pending approval (GET /admin/drivers?status=pending)
 * 2. Enabling driver accounts (PATCH /admin/drivers/:id/enable)
 * 3. Loading messages, empty states, and action feedback
 */

import { api } from "./api.js";
import { el, showToast, formatUtcTime } from "./ui.js";

/**
 * Creates the collapsible "What can I do here?" box.
 */
function createWhatCanIDoBox() {
  return el(
    "details",
    { className: "what-can-i-do card" },
    el("summary", { className: "what-can-i-do-summary", text: "What can I do here?" }),
    el(
      "div",
      { className: "what-can-i-do-body" },
      el("p", {
        text: "Review and verify newly registered driver accounts awaiting administrative clearance. Enable verified drivers with a single click to grant them departure publishing privileges. Keep commuter operations safe and accountable across the platform.",
      })
    )
  );
}

/**
 * Renders the Admin screen.
 * @param {HTMLElement} container Parent main element
 * @param {Object} currentUser Currently authenticated user
 */
export function renderAdminScreen(container, currentUser) {
  container.replaceChildren();

  const adminWrapper = el("div", { className: "admin-screen-container" });

  // Screen Header
  const header = el(
    "div",
    { className: "screen-header card" },
    el("div", { className: "screen-title-row" },
      el("div", {},
        el("h2", { className: "screen-title", text: "Admin Console" }),
        el("p", {
          className: "screen-subtitle",
          text: `Signed in as ${currentUser.email} (${currentUser.role}).`,
        })
      ),
      el("button", {
        className: "btn btn-sm btn-outline",
        type: "button",
        text: "↻ Refresh",
        onclick: () => loadPendingDrivers(),
      })
    )
  );

  adminWrapper.appendChild(header);

  // Collapsible Help Box
  adminWrapper.appendChild(createWhatCanIDoBox());

  // Drivers Section Card
  const driversCard = el(
    "div",
    { className: "card admin-drivers-card" },
    el("div", { className: "card-header" },
      el("h3", { className: "card-title", text: "Pending Driver Approvals" }),
      el("p", {
        className: "card-subtitle",
        text: "Prospective drivers must be approved before they can publish departures.",
      })
    ),
    el("div", { id: "admin-drivers-list", className: "admin-drivers-list" })
  );

  adminWrapper.appendChild(driversCard);
  container.appendChild(adminWrapper);

  /**
   * Fetches pending drivers from GET /admin/drivers?status=pending
   */
  async function loadPendingDrivers() {
    const listEl = document.getElementById("admin-drivers-list");
    if (!listEl) return;

    listEl.replaceChildren(
      el("div", { className: "loading-state" },
        el("span", { className: "spinner-text", text: "Loading pending drivers..." })
      )
    );

    const { status, ok, data } = await api("GET", "/admin/drivers?status=pending");

    if (!ok) {
      const err = data?.error || "Failed to load pending drivers";
      showToast(err, "error", status);
      listEl.replaceChildren(
        el("div", { className: "empty-state-box error-state", text: `Error: ${err}` })
      );
      return;
    }

    const drivers = Array.isArray(data) ? data : [];

    if (drivers.length === 0) {
      listEl.replaceChildren(
        el("div", { className: "empty-state-box", text: "No drivers waiting for approval" })
      );
      return;
    }

    // Build Table of Pending Drivers
    const table = el("table", { className: "data-table admin-table" });
    const thead = el(
      "thead",
      {},
      el("tr", {},
        el("th", { text: "Driver Email" }),
        el("th", { text: "Registered At" }),
        el("th", { text: "Driver ID" }),
        el("th", { text: "Status" }),
        el("th", { text: "Action" })
      )
    );

    const tbody = el("tbody");

    for (const d of drivers) {
      const enableBtn = el("button", {
        className: "btn btn-sm btn-primary",
        type: "button",
        text: "Enable",
        onclick: async () => {
          enableBtn.disabled = true;
          enableBtn.textContent = "Enabling...";

          try {
            const res = await api("PATCH", `/admin/drivers/${d.id}/enable`, { enabled: true });
            if (!res.ok) {
              const errMsg = res.data?.error || "Failed to enable driver";
              showToast(errMsg, "error", res.status);
            } else {
              showToast(`Driver ${d.email} enabled successfully`, "success");
              await loadPendingDrivers();
            }
          } finally {
            enableBtn.disabled = false;
            enableBtn.textContent = "Enable";
          }
        },
      });

      const row = el(
        "tr",
        {},
        el("td", { className: "font-medium", text: d.email }),
        el("td", {}, formatUtcTime(d.created_at)),
        el("td", {}, el("code", { className: "id-code", text: d.id })),
        el("td", {},
          el("span", {
            className: "badge badge-status-amber",
            text: d.driver_enabled ? "ENABLED" : "PENDING",
          })
        ),
        el("td", { className: "action-cell" }, enableBtn)
      );

      tbody.appendChild(row);
    }

    table.appendChild(thead);
    table.appendChild(tbody);

    const responsiveWrap = el("div", { className: "table-responsive" }, table);
    listEl.replaceChildren(responsiveWrap);
  }

  // Initial load
  loadPendingDrivers();
}
