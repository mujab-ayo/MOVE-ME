/**
 * MoveMe Driver Screen
 * Handles:
 * 1. Vehicles (list owned vehicles, add vehicle form, waiting for approval banner)
 * 2. Publish departure (route, vehicle, mode, departure time with shortcuts, overlap handling)
 * 3. My departures (lifecycle transitions: arrive, depart, complete, cancel with refund summary)
 */

import { api } from "./api.js";
import { el, showToast, formatMoney, formatUtcTime } from "./ui.js";

// Driver portal state
let activeDriverTab = "vehicles"; // "vehicles" | "publish" | "departures"
let isDriverWaitingApproval = false;
let cachedDriverVehicles = [];
let cachedDriverRoutes = [];

/**
 * Returns tomorrow at 09:00 in local YYYY-MM-DDTHH:mm format.
 */
function getTomorrowNineAmString() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
}

/**
 * Returns current time + 10 minutes in local YYYY-MM-DDTHH:mm format.
 */
function getInTenMinutesString() {
  const inTen = new Date(Date.now() + 10 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${inTen.getFullYear()}-${pad(inTen.getMonth() + 1)}-${pad(inTen.getDate())}T${pad(inTen.getHours())}:${pad(inTen.getMinutes())}`;
}

/**
 * Main entry point: Renders the Driver Portal into container.
 */
export async function renderDriverScreen(container, user) {
  try {
    // Check if session previously flagged waiting for approval
    if (user?.id && sessionStorage.getItem(`driver_waiting_${user.id}`) === "true") {
      isDriverWaitingApproval = true;
    }

    container.replaceChildren();

    const wrapper = el("div", { className: "driver-portal" });

    // Waiting for admin approval banner (if flagged)
    if (isDriverWaitingApproval) {
      wrapper.appendChild(createApprovalBanner());
    }

    // Collapsible Help Box
    const whatCanIDo = el(
      "details",
      { className: "what-can-i-do card" },
      el("summary", { className: "what-can-i-do-summary", text: "What can I do here?" }),
      el(
        "div",
        { className: "what-can-i-do-body" },
        el("p", {
          text: "Register your vehicles and manage your commuter fleet. Once enabled by an administrator, publish SOLO or POOLED departures on active routes. Track seat reservations, update trip status as you arrive, depart, and complete trips, or cancel departures with automated passenger refunds.",
        })
      )
    );
    wrapper.appendChild(whatCanIDo);

    // Sub-navigation tabs
    const tabNav = el("div", { className: "driver-tabs-nav", role: "tablist" });

    const tabs = [
      { id: "vehicles", label: "Vehicles" },
      { id: "publish", label: "Publish" },
      { id: "departures", label: "My departures" },
    ];

    tabs.forEach((tab) => {
      const btn = el("button", {
        id: `driver-tab-btn-${tab.id}`,
        className: `driver-tab-btn ${activeDriverTab === tab.id ? "active" : ""}`,
        type: "button",
        role: "tab",
        text: tab.label,
        onclick: () => {
          activeDriverTab = tab.id;
          updateActiveTabUI();
        },
      });
      tabNav.appendChild(btn);
    });

    wrapper.appendChild(tabNav);

    // Tab content area
    const contentArea = el("div", { id: "driver-tab-content", className: "driver-tab-content" });
    wrapper.appendChild(contentArea);
    container.appendChild(wrapper);

    renderTabContent();

    function updateActiveTabUI() {
      tabs.forEach((t) => {
        const b = document.getElementById(`driver-tab-btn-${t.id}`);
        if (b) {
          b.classList.toggle("active", activeDriverTab === t.id);
        }
      });
      renderTabContent();
    }
  } catch (err) {
    console.error("Error rendering driver screen:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading driver portal: ${err.message || String(err)}` })
    );
  }
}

/**
 * Switch driver tab programmatically.
 */
function switchDriverTab(tabId) {
  activeDriverTab = tabId;
  const tabs = ["vehicles", "publish", "departures"];
  tabs.forEach((t) => {
    const b = document.getElementById(`driver-tab-btn-${t}`);
    if (b) {
      b.classList.toggle("active", activeDriverTab === t);
    }
  });
  renderTabContent();
}

/**
 * Banner shown when driver is waiting for admin approval.
 */
function createApprovalBanner() {
  return el(
    "div",
    { className: "banner banner-warning driver-approval-banner" },
    el("div", { className: "banner-content" },
      el("span", { className: "banner-icon", text: "⏳" }),
      el("div", { className: "banner-text" },
        el("strong", { text: "Waiting for admin approval" }),
        el("p", {
          text: "Your driver account is pending verification by an administrator. You can register your vehicles now, but publishing departures will be enabled once approved.",
        })
      )
    )
  );
}

/**
 * Sets the driver waiting approval state and updates UI.
 */
function markDriverWaitingApproval(userTokenSub) {
  isDriverWaitingApproval = true;
  if (userTokenSub) {
    sessionStorage.setItem(`driver_waiting_${userTokenSub}`, "true");
  }
  const portal = document.querySelector(".driver-portal");
  if (portal && !portal.querySelector(".driver-approval-banner")) {
    portal.prepend(createApprovalBanner());
  }
}

/**
 * Renders active driver tab.
 */
function renderTabContent() {
  const content = document.getElementById("driver-tab-content");
  if (!content) return;
  content.replaceChildren();

  try {
    switch (activeDriverTab) {
      case "vehicles":
        renderVehiclesTab(content);
        break;
      case "publish":
        renderPublishTab(content);
        break;
      case "departures":
        renderDeparturesTab(content);
        break;
    }
  } catch (err) {
    console.error(`Error rendering driver tab ${activeDriverTab}:`, err);
    showToast(err.message || String(err), "error");
    content.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading tab: ${err.message || String(err)}` })
    );
  }
}

/* ==========================================================================
   TAB 1: VEHICLES
   ========================================================================== */

async function renderVehiclesTab(container) {
  try {
    container.replaceChildren();
    const card = el("div", { className: "card driver-panel" });

  const header = el("div", { className: "panel-header-row" },
    el("h3", { className: "panel-title", text: "Registered Vehicles" }),
    el("button", {
      type: "button",
      className: "btn btn-outline btn-sm",
      text: "Refresh",
      onclick: () => loadVehiclesTable(tableArea),
    })
  );
  card.appendChild(header);

  // Table area
  const tableArea = el("div", { id: "driver-vehicles-table-area", className: "table-responsive-wrapper" });
  card.appendChild(tableArea);

  // Add Vehicle Form Card
  const formCard = el("div", { className: "add-vehicle-section" },
    el("h4", { className: "section-subheading", text: "Register a New Vehicle" })
  );

  const form = el("form", { className: "form-group-stack add-vehicle-form" });

  const regInput = el("input", {
    id: "veh-reg",
    type: "text",
    className: "form-input",
    placeholder: "e.g. LND-123-AB",
    required: "true",
  });

  const makeModelInput = el("input", {
    id: "veh-make-model",
    type: "text",
    className: "form-input",
    placeholder: "e.g. Toyota Corolla 2021",
    required: "true",
  });

  const colourInput = el("input", {
    id: "veh-colour",
    type: "text",
    className: "form-input",
    placeholder: "e.g. Silver",
    required: "true",
  });

  const seatsInput = el("input", {
    id: "veh-seats",
    type: "number",
    className: "form-input",
    placeholder: "e.g. 4",
    min: "1",
    max: "100",
    value: "4",
    required: "true",
  });

  const submitBtn = el("button", {
    type: "submit",
    className: "btn btn-primary",
    text: "Register Vehicle",
  });

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "veh-reg", className: "form-label", text: "Registration Number *" }),
      regInput
    )
  );

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "veh-make-model", className: "form-label", text: "Make and Model *" }),
      makeModelInput
    )
  );

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "veh-colour", className: "form-label", text: "Colour *" }),
      colourInput
    )
  );

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "veh-seats", className: "form-label", text: "Passenger Seat Capacity *" }),
      seatsInput
    )
  );

  form.appendChild(submitBtn);

  form.onsubmit = async (e) => {
    e.preventDefault();
    const registrationIdentifier = regInput.value.trim();
    const makeModel = makeModelInput.value.trim();
    const colour = colourInput.value.trim();
    const seatCapacity = parseInt(seatsInput.value, 10);

    if (!registrationIdentifier || !makeModel || !colour || isNaN(seatCapacity) || seatCapacity < 1) {
      showToast("Please fill in all vehicle fields with valid values", "error");
      return;
    }

    // Combine make/model and colour into description to match schema { description, registrationIdentifier, seatCapacity }
    const description = `${makeModel}, ${colour}`;

    submitBtn.disabled = true;
    submitBtn.textContent = "Registering...";

    try {
      const { status, ok, data } = await api("POST", "/drivers/me/vehicles", {
        description,
        registrationIdentifier,
        seatCapacity,
      });

      if (!ok) {
        const errorMsg = data?.error || "Failed to register vehicle";
        showToast(errorMsg, "error", status);
        return;
      }

      showToast("Vehicle registered successfully", "success");
      regInput.value = "";
      makeModelInput.value = "";
      colourInput.value = "";
      seatsInput.value = "4";

      // Reload vehicles table
      await loadVehiclesTable(tableArea);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Register Vehicle";
    }
  };

  formCard.appendChild(form);
  card.appendChild(formCard);

  container.appendChild(card);

  await loadVehiclesTable(tableArea);
  } catch (err) {
    console.error("Error rendering vehicles tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading vehicles: ${err.message || String(err)}` })
    );
  }
}

/**
 * Loads vehicles from GET /drivers/me/vehicles and renders a table:
 * (registration, make and model, colour, seats, active).
 */
async function loadVehiclesTable(container) {
  try {
    container.replaceChildren(el("div", { className: "loading-text", text: "Loading vehicles..." }));

  const { status, ok, data } = await api("GET", "/drivers/me/vehicles");
  if (!ok) {
    const errorMsg = data?.error || "Failed to fetch vehicles";
    showToast(errorMsg, "error", status);
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
    );
    return;
  }

  const vehicles = Array.isArray(data) ? data : [];
  cachedDriverVehicles = vehicles;

  if (vehicles.length === 0) {
    container.replaceChildren(
      el("div", { className: "empty-state-box", text: "No vehicles registered yet. Add one below." })
    );
    return;
  }

  // Render Table
  const table = el("table", { className: "vehicles-table" });

  const thead = el("thead", {},
    el("tr", {},
      el("th", { text: "Registration" }),
      el("th", { text: "Make and Model" }),
      el("th", { text: "Colour" }),
      el("th", { text: "Seats" }),
      el("th", { text: "Active" })
    )
  );
  table.appendChild(thead);

  const tbody = el("tbody", {});

  vehicles.forEach((v) => {
    // In database/backend, vehicle has single description field: "Toyota Corolla, silver"
    const desc = v.description || "";
    let makeModel = desc;
    let colour = "—";

    if (desc.includes(",")) {
      const parts = desc.split(",");
      makeModel = parts[0].trim();
      colour = parts.slice(1).join(",").trim();
    }

    const tr = el("tr", {},
      el("td", {},
        el("strong", { className: "reg-code", text: v.registration_identifier })
      ),
      el("td", { text: makeModel }),
      el("td", { text: colour }),
      el("td", { text: String(v.seat_capacity) }),
      el("td", {},
        el("span", {
          className: `badge ${v.active ? "badge-status-ok" : "badge-status-err"}`,
          text: v.active ? "Active" : "Inactive",
        })
      )
    );
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  container.replaceChildren(table);
  } catch (err) {
    console.error("Error loading vehicles table:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error: ${err.message || String(err)}` })
    );
  }
}

/* ==========================================================================
   TAB 2: PUBLISH DEPARTURE
   ========================================================================== */

async function renderPublishTab(container) {
  try {
    container.replaceChildren();
    const card = el("div", { className: "card driver-panel" });
  card.appendChild(el("h3", { className: "panel-title", text: "Publish a Scheduled Departure" }));

  // Form
  const form = el("form", { className: "publish-form", onsubmit: (e) => e.preventDefault() });

  // 1. Route Dropdown
  const routeSelect = el("select", {
    id: "pub-route-select",
    className: "form-input",
    required: "true",
  });
  routeSelect.appendChild(el("option", { value: "", text: "Loading active routes..." }));

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "pub-route-select", className: "form-label", text: "Route *" }),
      routeSelect
    )
  );

  // 2. Vehicle Dropdown
  const vehicleSelect = el("select", {
    id: "pub-vehicle-select",
    className: "form-input",
    required: "true",
  });
  vehicleSelect.appendChild(el("option", { value: "", text: "Loading your vehicles..." }));

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "pub-vehicle-select", className: "form-label", text: "Vehicle *" }),
      vehicleSelect
    )
  );

  // 3. Mode: SOLO or POOLED
  const modeSelect = el("select", {
    id: "pub-mode-select",
    className: "form-input",
  });
  modeSelect.appendChild(el("option", { value: "POOLED", text: "POOLED (Multiple passenger seats)" }));
  modeSelect.appendChild(el("option", { value: "SOLO", text: "SOLO (Private passenger trip)" }));

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "pub-mode-select", className: "form-label", text: "Ride Mode *" }),
      modeSelect
    )
  );

  // 4. Departure Time + Shortcut Buttons
  const datetimeInput = el("input", {
    id: "pub-datetime-input",
    type: "datetime-local",
    className: "form-input",
    value: getTomorrowNineAmString(),
    required: "true",
  });

  const shortcutsRow = el("div", { className: "timing-shortcuts-row" },
    el("span", { className: "shortcuts-label", text: "Shortcuts:" }),
    el("button", {
      type: "button",
      className: "btn btn-xs btn-outline",
      text: "Tomorrow 09:00",
      onclick: () => {
        datetimeInput.value = getTomorrowNineAmString();
      },
    }),
    el("button", {
      type: "button",
      className: "btn btn-xs btn-outline",
      text: "In 10 minutes",
      onclick: () => {
        datetimeInput.value = getInTenMinutesString();
      },
    })
  );

  form.appendChild(
    el("div", { className: "form-field" },
      el("label", { for: "pub-datetime-input", className: "form-label", text: "Departure Time (Local) *" }),
      datetimeInput,
      shortcutsRow
    )
  );

  // Result display box
  const resultBox = el("div", { id: "pub-result-box", className: "publish-result-box" });

  // Submit button
  const publishBtn = el("button", {
    type: "submit",
    className: "btn btn-primary btn-publish",
    text: "Publish Departure",
  });

  form.appendChild(publishBtn);
  card.appendChild(form);
  card.appendChild(resultBox);

  container.appendChild(card);

  // Load dropdown data
  loadPublishFormData(routeSelect, vehicleSelect);

  // Submit handler
  publishBtn.onclick = async (e) => {
    e.preventDefault();
    const routeId = routeSelect.value;
    const vehicleId = vehicleSelect.value;
    const mode = modeSelect.value;
    const dtVal = datetimeInput.value;

    if (!routeId) {
      showToast("Please select a route", "error");
      return;
    }
    if (!vehicleId) {
      showToast("Please select a vehicle", "error");
      return;
    }
    if (!dtVal) {
      showToast("Please select a departure date and time", "error");
      return;
    }

    const departureTime = new Date(dtVal).toISOString();

    publishBtn.disabled = true;
    publishBtn.textContent = "Publishing...";
    resultBox.replaceChildren(el("div", { className: "loading-text", text: "Validating and publishing departure..." }));

    try {
      const { status, ok, data } = await api("POST", "/departures", {
        routeId,
        vehicleId,
        mode,
        departureTime,
      });

      if (!ok) {
        const errorMsg = data?.error || "Failed to publish departure";
        showToast(errorMsg, "error", status);

        // Check if refused because driver not enabled: status 403
        if (status === 403 && /driver is not enabled/i.test(errorMsg)) {
          markDriverWaitingApproval();
          resultBox.replaceChildren(
            el("div", { className: "alert alert-warning" },
              el("strong", { text: "Waiting for admin approval" }),
              el("p", { text: errorMsg })
            )
          );
          return;
        }

        // Show 409 overlap message clearly
        if (status === 409) {
          resultBox.replaceChildren(
            el("div", { className: "alert alert-danger" },
              el("strong", { text: "Overlapping Departure Conflict [409]" }),
              el("p", { text: errorMsg })
            )
          );
          return;
        }

        resultBox.replaceChildren(
          el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
        );
        return;
      }

      // Success: show new departure's time and fare
      showToast("Departure published successfully!", "success");

      resultBox.replaceChildren(
        el("div", { className: "alert alert-success" },
          el("strong", { text: "Departure Published Successfully!" }),
          el("div", { className: "pub-success-details" },
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Departure ID:" }),
              el("code", { text: data.departureId })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Departure Time:" }),
              formatUtcTime(departureTime)
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Fare Amount:" }),
              el("strong", { className: "fare-val", text: formatMoney(data.fareAmount) })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Capacity:" }),
              el("span", { text: `${data.capacity} seat(s)` })
            )
          ),
          el("button", {
            type: "button",
            className: "btn btn-primary btn-sm",
            text: "View in My Departures",
            onclick: () => switchDriverTab("departures"),
          })
        )
      );
    } finally {
      publishBtn.disabled = false;
      publishBtn.textContent = "Publish Departure";
    }
  };
  } catch (err) {
    console.error("Error rendering publish tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading publish tab: ${err.message || String(err)}` })
    );
  }
}

/**
 * Loads route and vehicle dropdowns for the publish form.
 */
async function loadPublishFormData(routeSelect, vehicleSelect) {
  // Routes
  if (cachedDriverRoutes.length === 0) {
    const { ok, data } = await api("GET", "/routes");
    if (ok && Array.isArray(data)) {
      cachedDriverRoutes = data;
    }
  }

  routeSelect.replaceChildren();
  routeSelect.appendChild(el("option", { value: "", text: "-- Select Route (pickup to drop-off) --" }));
  cachedDriverRoutes.forEach((r) => {
    routeSelect.appendChild(
      el("option", {
        value: r.id,
        text: `${r.pickup_point} to ${r.dropoff_point}`,
      })
    );
  });

  // Vehicles
  const { ok: vOk, data: vData } = await api("GET", "/drivers/me/vehicles");
  vehicleSelect.replaceChildren();

  if (vOk && Array.isArray(vData) && vData.length > 0) {
    cachedDriverVehicles = vData;
    vehicleSelect.appendChild(el("option", { value: "", text: "-- Select Vehicle --" }));
    vData
      .filter((v) => v.active)
      .forEach((v) => {
        vehicleSelect.appendChild(
          el("option", {
            value: v.id,
            text: `${v.registration_identifier} (${v.description}) - ${v.seat_capacity} seats`,
          })
        );
      });
  } else {
    vehicleSelect.appendChild(
      el("option", { value: "", text: "No active vehicles found. Please add a vehicle first." })
    );
  }
}

/* ==========================================================================
   TAB 3: MY DEPARTURES
   ========================================================================== */

async function renderDeparturesTab(container) {
  try {
    container.replaceChildren();
    const card = el("div", { className: "card driver-panel" });

    const header = el("div", { className: "panel-header-row" },
      el("h3", { className: "panel-title", text: "My Departures" }),
      el("button", {
        type: "button",
        className: "btn btn-outline btn-sm",
        text: "Refresh",
        onclick: () => loadDriverDepartures(listArea),
      })
    );
    card.appendChild(header);

    const listArea = el("div", { id: "driver-departures-list-area", className: "driver-departures-list-area" });
    card.appendChild(listArea);
    container.appendChild(card);

    await loadDriverDepartures(listArea);
  } catch (err) {
    console.error("Error rendering departures tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading departures: ${err.message || String(err)}` })
    );
  }
}

/**
 * Loads driver departures from GET /drivers/me/departures (ordered soonest first).
 */
async function loadDriverDepartures(container) {
  try {
    container.replaceChildren(el("div", { className: "loading-text", text: "Loading departures..." }));

    const { status, ok, data } = await api("GET", "/drivers/me/departures");
    if (!ok) {
      const errorMsg = data?.error || "Failed to load departures";
      showToast(errorMsg, "error", status);
      container.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    const departures = Array.isArray(data) ? data : [];

    if (departures.length === 0) {
      container.replaceChildren(
        el("div", { className: "empty-state-box", text: "No departures published yet." })
      );
      return;
    }

    container.replaceChildren();
    const list = el("div", { className: "driver-departures-list" });

    departures.forEach((dep) => {
      const depCard = createDriverDepartureCard(dep, container);
      list.appendChild(depCard);
    });

    container.appendChild(list);
  } catch (err) {
    console.error("Error loading driver departures:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading departures: ${err.message || String(err)}` })
    );
  }
}

/**
 * Creates individual departure card with status badge, capacity/reservations,
 * and status-specific action buttons:
 * - SCHEDULED: "I have arrived" and "Cancel departure"
 * - ARRIVED: "Start trip" and "Cancel departure"
 * - IN_PROGRESS: "Complete trip"
 * - COMPLETED / CANCELLED: no buttons
 */
function createDriverDepartureCard(dep, listContainer) {
  const depTime = dep.departure_time || dep.departureTime;
  const pickup = dep.pickup_point || dep.pickupPoint || "Pickup point";
  const dropoff = dep.dropoff_point || dep.dropoffPoint || "Drop-off point";
  const status = dep.status;
  const mode = dep.mode || "POOLED";
  const capacity = dep.capacity;
  const avail = dep.available_capacity ?? dep.availableCapacity ?? 0;
  const confirmed = dep.confirmed_reservations ?? dep.confirmedReservations ?? 0;
  const pending = dep.pending_reservations ?? dep.pendingReservations ?? 0;
  const vehReg = dep.vehicle_registration || "";
  const vehDesc = dep.vehicle_description || "";

  const card = el("div", { className: "driver-dep-card card" });

  // Header: Time and Mode
  const topHeader = el("div", { className: "driver-dep-header" },
    el("div", { className: "driver-time-info" },
      el("span", { className: "label-caption", text: "Departure Time" }),
      formatUtcTime(depTime, { className: "dep-time-val" })
    ),
    el("div", { className: "driver-badges-row" },
      el("span", { className: `badge badge-mode badge-${mode.toLowerCase()}`, text: mode }),
      el("span", { className: `badge badge-dep-status badge-status-${status.toLowerCase()}`, text: status })
    )
  );
  card.appendChild(topHeader);

  // Route
  const routeBox = el("div", { className: "departure-route-info" },
    el("div", { className: "route-stop" },
      el("span", { className: "pickup-dot", text: "●" }),
      el("span", { className: "stop-name", text: pickup })
    ),
    el("div", { className: "route-line" }),
    el("div", { className: "route-stop" },
      el("span", { className: "dropoff-dot", text: "■" }),
      el("span", { className: "stop-name", text: dropoff })
    )
  );
  card.appendChild(routeBox);

  // Meta stats: capacity, seats left, reservations
  const statsRow = el("div", { className: "dep-stats-row" },
    el("div", { className: "stat-item" },
      el("span", { className: "stat-label", text: "Capacity:" }),
      el("strong", { text: `${capacity} seats` })
    ),
    el("div", { className: "stat-item" },
      el("span", { className: "stat-label", text: "Seats left:" }),
      el("strong", { className: "seats-left-val", text: String(avail) })
    ),
    el("div", { className: "stat-item" },
      el("span", { className: "stat-label", text: "Confirmed:" }),
      el("strong", { text: String(confirmed) })
    ),
    el("div", { className: "stat-item" },
      el("span", { className: "stat-label", text: "Pending:" }),
      el("strong", { text: String(pending) })
    )
  );
  card.appendChild(statsRow);

  // Vehicle info
  if (vehReg || vehDesc) {
    card.appendChild(
      el("div", { className: "dep-vehicle-caption" },
        el("span", { className: "label-caption", text: "Vehicle: " }),
        el("span", { text: `${vehReg} ${vehDesc ? `(${vehDesc})` : ""}` })
      )
    );
  }

  // Cancel summary placeholder inside card
  const actionFeedbackArea = el("div", { className: "card-action-feedback" });
  card.appendChild(actionFeedbackArea);

  // Action Buttons depending on status
  const actionsRow = el("div", { className: "dep-actions-row" });

  if (status === "SCHEDULED") {
    // Button: "I have arrived" -> POST /departures/:id/arrive
    const arriveBtn = el("button", {
      type: "button",
      className: "btn btn-primary btn-sm btn-arrive",
      text: "I have arrived",
      onclick: () => handleDepartureArrive(dep.id, arriveBtn, listContainer, actionFeedbackArea),
    });

    // Button: "Cancel departure" -> POST /departures/:id/cancel
    const cancelBtn = el("button", {
      type: "button",
      className: "btn btn-outline btn-sm btn-cancel-dep",
      text: "Cancel departure",
      onclick: () => handleCancelDeparture(dep.id, cancelBtn, listContainer, actionFeedbackArea),
    });

    actionsRow.appendChild(arriveBtn);
    actionsRow.appendChild(cancelBtn);
  } else if (status === "ARRIVED") {
    // Button: "Start trip" -> POST /departures/:id/depart
    const departBtn = el("button", {
      type: "button",
      className: "btn btn-primary btn-sm btn-depart",
      text: "Start trip",
      onclick: () => handleDepartureDepart(dep.id, departBtn, listContainer, actionFeedbackArea),
    });

    // Button: "Cancel departure" -> POST /departures/:id/cancel
    const cancelBtn = el("button", {
      type: "button",
      className: "btn btn-outline btn-sm btn-cancel-dep",
      text: "Cancel departure",
      onclick: () => handleCancelDeparture(dep.id, cancelBtn, listContainer, actionFeedbackArea),
    });

    actionsRow.appendChild(departBtn);
    actionsRow.appendChild(cancelBtn);
  } else if (status === "IN_PROGRESS") {
    // Button: "Complete trip" -> POST /departures/:id/complete
    const completeBtn = el("button", {
      type: "button",
      className: "btn btn-primary btn-sm btn-complete",
      text: "Complete trip",
      onclick: () => handleDepartureComplete(dep.id, completeBtn, listContainer, actionFeedbackArea),
    });

    actionsRow.appendChild(completeBtn);
  }

  // COMPLETED or CANCELLED: no buttons rendered
  if (actionsRow.children.length > 0) {
    card.appendChild(actionsRow);
  }

  return card;
}

/**
 * Handles driver arrival: POST /departures/:id/arrive
 */
async function handleDepartureArrive(departureId, btnEl, listContainer, feedbackArea) {
  btnEl.disabled = true;
  btnEl.textContent = "Updating...";

  try {
    const { status, ok, data } = await api("POST", `/departures/${departureId}/arrive`);
    if (!ok) {
      const errorMsg = data?.error || "Arrival update failed";
      showToast(errorMsg, "error", status);
      feedbackArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    showToast("Vehicle arrival recorded", "success");
    await loadDriverDepartures(listContainer);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = "I have arrived";
  }
}

/**
 * Handles driver trip start: POST /departures/:id/depart
 */
async function handleDepartureDepart(departureId, btnEl, listContainer, feedbackArea) {
  btnEl.disabled = true;
  btnEl.textContent = "Starting trip...";

  try {
    const { status, ok, data } = await api("POST", `/departures/${departureId}/depart`);
    if (!ok) {
      const errorMsg = data?.error || "Failed to start trip";
      showToast(errorMsg, "error", status);
      feedbackArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    showToast("Trip started: now in progress", "success");
    await loadDriverDepartures(listContainer);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = "Start trip";
  }
}

/**
 * Handles driver trip completion: POST /departures/:id/complete
 */
async function handleDepartureComplete(departureId, btnEl, listContainer, feedbackArea) {
  btnEl.disabled = true;
  btnEl.textContent = "Completing...";

  try {
    const { status, ok, data } = await api("POST", `/departures/${departureId}/complete`);
    if (!ok) {
      const errorMsg = data?.error || "Failed to complete trip";
      showToast(errorMsg, "error", status);
      feedbackArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    showToast("Trip marked completed successfully", "success");
    await loadDriverDepartures(listContainer);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = "Complete trip";
  }
}

/**
 * Handles driver departure cancellation: asks confirmation ("Passengers will be refunded and notified")
 * then calls POST /departures/:id/cancel and shows cancellation summary.
 */
async function handleCancelDeparture(departureId, btnEl, listContainer, feedbackArea) {
  const confirmed = confirm(
    "Passengers will be refunded and notified. Are you sure you want to cancel this departure?"
  );
  if (!confirmed) return;

  btnEl.disabled = true;
  btnEl.textContent = "Cancelling...";

  try {
    const { status, ok, data } = await api("POST", `/departures/${departureId}/cancel`);
    if (!ok) {
      const errorMsg = data?.error || "Failed to cancel departure";
      showToast(errorMsg, "error", status);
      feedbackArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    const cancelledCount = data.cancelledReservations ?? 0;
    const refunds = Array.isArray(data.refunds) ? data.refunds : [];

    let totalRefundAmount = 0;
    refunds.forEach((r) => {
      totalRefundAmount += parseFloat(r.amount || 0);
    });

    showToast(`Departure cancelled: ${cancelledCount} reservation(s) refunded`, "success");

    feedbackArea.replaceChildren(
      el("div", { className: "alert alert-info cancellation-summary-box" },
        el("strong", { text: "Cancellation Summary" }),
        el("p", {
          text: `Cancelled ${cancelledCount} reservation(s). Total refunds issued: ${formatMoney(totalRefundAmount)}. Notifications dispatched to passengers.`,
        })
      )
    );

    // Refresh list after short delay so driver sees feedback summary
    setTimeout(() => {
      loadDriverDepartures(listContainer);
    }, 1500);
  } finally {
    btnEl.disabled = false;
    btnEl.textContent = "Cancel departure";
  }
}
