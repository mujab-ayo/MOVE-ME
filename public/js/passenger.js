/**
 * MoveMe Passenger Screen
 * Handles:
 * 1. Search departures
 * 2. Book and pay (with Paystack checkout flow or simulated fallback)
 * 3. My trips (reservations list, live countdowns, cancel with refund, details expander)
 * 4. Notifications (read/unread, polling, mark as read)
 */

import { api } from "./api.js";
import { el, showToast, formatMoney, formatUtcTime, startCountdown } from "./ui.js";

// Passenger UI State
let activeTab = "search"; // "search" | "book-pay" | "trips" | "notifications"
let notificationPollTimer = null;
let unreadCount = 0;

// Cached routes
let cachedRoutes = [];

/**
 * Returns tomorrow at 09:00 in local YYYY-MM-DDTHH:mm format for datetime-local input.
 */
function getDefaultScheduledDatetime() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T${pad(tomorrow.getHours())}:${pad(tomorrow.getMinutes())}`;
}

/**
 * Maps notification type to plain English description.
 */
function getNotificationTypeLabel(type) {
  switch (type) {
    case "DEPARTURE_CANCELLED":
      return "Your departure was cancelled";
    case "RESERVATION_CONFIRMED":
      return "Your reservation has been confirmed";
    case "TRIP_ARRIVED":
      return "Your driver has arrived at the pickup point";
    case "TRIP_DEPARTED":
      return "Your trip is now in progress";
    case "TRIP_COMPLETED":
      return "Your trip has been completed";
    default:
      return type ? type.replace(/_/g, " ").toLowerCase() : "Notification";
  }
}

/**
 * Stop any active notification polling timer.
 */
export function stopPassengerTimers() {
  if (notificationPollTimer) {
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }
}

/**
 * Fetches unread notifications count and updates the badge.
 */
async function fetchUnreadCount() {
  try {
    const { ok, data } = await api("GET", "/passengers/me/notifications?unread=true");
    if (ok && Array.isArray(data)) {
      unreadCount = data.length;
      updateNotificationBadge();
    }
  } catch {
    // Ignore periodic polling errors
  }
}

/**
 * Updates the unread badge in the tab header.
 */
function updateNotificationBadge() {
  const badge = document.getElementById("passenger-unread-badge");
  if (badge) {
    if (unreadCount > 0) {
      badge.textContent = String(unreadCount);
      badge.style.display = "inline-flex";
    } else {
      badge.style.display = "none";
    }
  }
}

/**
 * Main entry point: Renders the entire Passenger portal inside container.
 */
export async function renderPassengerScreen(container, user) {
  try {
    stopPassengerTimers();
    container.replaceChildren();

    const wrapper = el("div", { className: "passenger-portal" });

    // Collapsible Help Box
    const whatCanIDo = el(
      "details",
      { className: "what-can-i-do card" },
      el("summary", { className: "what-can-i-do-summary", text: "What can I do here?" }),
      el(
        "div",
        { className: "what-can-i-do-body" },
        el("p", {
          text: "Search and book scheduled or immediate departures across active commuter routes. Secure your seat with card payments within the 10-minute hold window. Track live trip status, receive real-time notifications as drivers arrive or depart, and cancel reservations if plans change.",
        })
      )
    );
    wrapper.appendChild(whatCanIDo);

    // Sub-navigation tabs
    const tabNav = el("div", { className: "passenger-tabs-nav", role: "tablist" });

    const tabs = [
      { id: "search", label: "Search" },
      { id: "book-pay", label: "Book and pay" },
      { id: "trips", label: "My trips" },
      { id: "notifications", label: "Notifications" },
    ];

    tabs.forEach((tab) => {
      const btn = el(
        "button",
        {
          id: `tab-btn-${tab.id}`,
          className: `passenger-tab-btn ${activeTab === tab.id ? "active" : ""}`,
          type: "button",
          role: "tab",
          onclick: () => {
            activeTab = tab.id;
            updateActiveTabUI();
          },
        },
        el("span", { text: tab.label })
      );

      if (tab.id === "notifications") {
        const badge = el("span", {
          id: "passenger-unread-badge",
          className: "badge badge-unread-count",
          text: String(unreadCount),
          style: { display: unreadCount > 0 ? "inline-flex" : "none" },
        });
        btn.appendChild(badge);
      }

      tabNav.appendChild(btn);
    });

    wrapper.appendChild(tabNav);

    // Tab content container
    const tabContent = el("div", { id: "passenger-tab-content", className: "passenger-tab-content" });
    wrapper.appendChild(tabContent);
    container.appendChild(wrapper);

    // Initial fetch of unread count and start 10s polling
    fetchUnreadCount();
    notificationPollTimer = setInterval(fetchUnreadCount, 10000);

    // Render the active tab content
    await renderTabContent();

    function updateActiveTabUI() {
      tabs.forEach((t) => {
        const b = document.getElementById(`tab-btn-${t.id}`);
        if (b) {
          b.classList.toggle("active", activeTab === t.id);
        }
      });
      renderTabContent();
    }
  } catch (err) {
    console.error("Failed to render passenger screen:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading passenger portal: ${err.message || err}` })
    );
  }
}

/**
 * Switch to a specific tab programmatically.
 */
function switchTab(tabId) {
  activeTab = tabId;
  const tabs = ["search", "book-pay", "trips", "notifications"];
  tabs.forEach((t) => {
    const b = document.getElementById(`tab-btn-${t}`);
    if (b) {
      b.classList.toggle("active", activeTab === t);
    }
  });
  renderTabContent();
}

/**
 * Renders the body of the currently selected passenger tab.
 */
async function renderTabContent() {
  const content = document.getElementById("passenger-tab-content");
  if (!content) return;
  content.replaceChildren();

  try {
    switch (activeTab) {
      case "search":
        await renderSearchTab(content);
        break;
      case "book-pay":
        await renderBookAndPayTab(content);
        break;
      case "trips":
        await renderTripsTab(content);
        break;
      case "notifications":
        await renderNotificationsTab(content);
        break;
    }
  } catch (err) {
    console.error(`Failed to render passenger tab '${activeTab}':`, err);
    showToast(err.message || String(err), "error");
    content.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading ${activeTab}: ${err.message || err}` })
    );
  }
}

/* ==========================================================================
   TAB 1: SEARCH
   ========================================================================== */

async function renderSearchTab(container) {
  try {
    const card = el("div", { className: "card search-panel" });
    card.appendChild(el("h3", { className: "panel-title", text: "Find a Departure" }));

  // Form controls
  const form = el("form", { className: "search-form", onsubmit: (e) => e.preventDefault() });

  // 1. Route Dropdown
  const routeSelect = el("select", {
    id: "search-route-select",
    className: "form-input",
    required: "true",
  });
  routeSelect.appendChild(el("option", { value: "", text: "Loading active routes..." }));

  const routeField = el(
    "div",
    { className: "form-field" },
    el("label", { for: "search-route-select", className: "form-label", text: "Route" }),
    routeSelect
  );
  form.appendChild(routeField);

  // 2. Mode Selector: SOLO or POOLED (required by search query schema)
  let selectedMode = "POOLED";
  const modeSelect = el("select", {
    id: "search-mode-select",
    className: "form-input",
  });
  modeSelect.appendChild(el("option", { value: "POOLED", text: "POOLED (Shared ride)" }));
  modeSelect.appendChild(el("option", { value: "SOLO", text: "SOLO (Private ride)" }));
  modeSelect.onchange = (e) => {
    selectedMode = e.target.value;
  };

  const modeField = el(
    "div",
    { className: "form-field" },
    el("label", { for: "search-mode-select", className: "form-label", text: "Ride Mode" }),
    modeSelect
  );
  form.appendChild(modeField);

  // 3. Timing Toggle: "Leaving now" vs "Scheduled"
  let selectedTiming = "immediate"; // "immediate" | "scheduled"

  const timingToggle = el("div", { className: "timing-toggle-group" });
  const btnNow = el("button", {
    type: "button",
    className: "btn btn-timing active",
    text: "Leaving now",
  });
  const btnScheduled = el("button", {
    type: "button",
    className: "btn btn-timing",
    text: "Scheduled",
  });

  timingToggle.appendChild(btnNow);
  timingToggle.appendChild(btnScheduled);

  const timingField = el(
    "div",
    { className: "form-field" },
    el("label", { className: "form-label", text: "When are you traveling?" }),
    timingToggle
  );
  form.appendChild(timingField);

  // 4. Datetime input for scheduled
  const datetimeInput = el("input", {
    id: "search-datetime-input",
    type: "datetime-local",
    className: "form-input",
    value: getDefaultScheduledDatetime(),
  });

  const datetimeField = el(
    "div",
    { className: "form-field scheduled-datetime-field", style: { display: "none" } },
    el("label", { for: "search-datetime-input", className: "form-label", text: "Departure Date & Time (Local)" }),
    datetimeInput
  );
  form.appendChild(datetimeField);

  btnNow.onclick = () => {
    selectedTiming = "immediate";
    btnNow.classList.add("active");
    btnScheduled.classList.remove("active");
    datetimeField.style.display = "none";
  };

  btnScheduled.onclick = () => {
    selectedTiming = "scheduled";
    btnScheduled.classList.add("active");
    btnNow.classList.remove("active");
    datetimeField.style.display = "block";
  };

  // Search button
  const searchBtn = el("button", {
    type: "submit",
    className: "btn btn-primary btn-search",
    text: "Search Departures",
  });
  form.appendChild(searchBtn);

  card.appendChild(form);

  // Search Results Container
  const resultsContainer = el("div", { id: "search-results-area", className: "search-results-area" });
  card.appendChild(resultsContainer);

  container.appendChild(card);

  // Populate routes dropdown
  loadRoutes(routeSelect);

  // Search submit handler
  searchBtn.onclick = async (e) => {
    e.preventDefault();
    const routeId = routeSelect.value;
    if (!routeId) {
      showToast("Please select a route from the dropdown", "error");
      return;
    }

    let url = `/departures/search?routeId=${encodeURIComponent(routeId)}&mode=${encodeURIComponent(selectedMode)}&when=${encodeURIComponent(selectedTiming)}`;

    if (selectedTiming === "scheduled") {
      const val = datetimeInput.value;
      if (!val) {
        showToast("Please choose a departure date and time", "error");
        return;
      }
      const isoUtc = new Date(val).toISOString();
      url += `&datetime=${encodeURIComponent(isoUtc)}`;
    }

    searchBtn.disabled = true;
    searchBtn.textContent = "Searching...";
    resultsContainer.replaceChildren(el("div", { className: "loading-text", text: "Finding available departures..." }));

    try {
      const { status, ok, data } = await api("GET", url);
      if (!ok) {
        const msg = data?.error || "Search failed";
        showToast(msg, "error", status);
        resultsContainer.replaceChildren(
          el("div", { className: "alert alert-danger", text: `[${status}] ${msg}` })
        );
        return;
      }

      renderSearchResults(resultsContainer, data?.results || []);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = "Search Departures";
    }
  };
  } catch (err) {
    console.error("Error rendering search tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading search tab: ${err.message || err}` })
    );
  }
}

/**
 * Loads routes into select dropdown.
 */
async function loadRoutes(selectEl) {
  if (cachedRoutes.length > 0) {
    populateRouteOptions(selectEl, cachedRoutes);
    return;
  }

  const { ok, data } = await api("GET", "/routes");
  if (ok && Array.isArray(data)) {
    cachedRoutes = data;
    populateRouteOptions(selectEl, cachedRoutes);
  } else {
    selectEl.replaceChildren(el("option", { value: "", text: "Failed to load routes" }));
  }
}

function populateRouteOptions(selectEl, routes) {
  selectEl.replaceChildren();
  selectEl.appendChild(el("option", { value: "", text: "-- Select Route (pickup to drop-off) --" }));
  routes.forEach((r) => {
    selectEl.appendChild(
      el("option", {
        value: r.id,
        text: `${r.pickup_point} to ${r.dropoff_point}`,
      })
    );
  });
}

/**
 * Renders departure search result cards.
 */
function renderSearchResults(container, results) {
  container.replaceChildren();

  if (!results || results.length === 0) {
    container.appendChild(
      el("div", { className: "empty-state-box", text: "No departures found" })
    );
    return;
  }

  const list = el("div", { className: "departure-cards-list" });

  results.forEach((dep) => {
    const depTime = dep.departure_time || dep.departureTime;
    const pickup = dep.pickup_point || dep.pickupPoint || "Pickup point";
    const dropoff = dep.dropoff_point || dep.dropoffPoint || "Drop-off point";
    const driverName = dep.driver_name || dep.driver || dep.driverName;
    const fare = dep.fare_amount || dep.fareAmount;
    const mode = dep.mode || "POOLED";
    const avail = dep.available_capacity ?? dep.availableCapacity ?? 0;

    const bookBtn = el("button", {
      type: "button",
      className: "btn btn-primary btn-sm btn-book",
      text: "Book",
      onclick: () => handleBookDeparture(dep.id || dep.departureId, dep, bookBtn),
    });

    const card = el(
      "div",
      { className: "departure-card card" },
      el("div", { className: "departure-card-header" },
        el("div", { className: "departure-time-group" },
          el("span", { className: "label-caption", text: "Departure Time" }),
          formatUtcTime(depTime, { className: "departure-time-val" })
        ),
        el("div", { className: "badges-group" },
          el("span", { className: `badge badge-mode badge-${mode.toLowerCase()}`, text: mode }),
          el("span", { className: "badge badge-seats", text: `${avail} seat${avail === 1 ? "" : "s"} left` })
        )
      ),
      el("div", { className: "departure-route-info" },
        el("div", { className: "route-stop" },
          el("span", { className: "stop-icon pickup-dot", text: "●" }),
          el("span", { className: "stop-name", text: pickup })
        ),
        el("div", { className: "route-line" }),
        el("div", { className: "route-stop" },
          el("span", { className: "stop-icon dropoff-dot", text: "■" }),
          el("span", { className: "stop-name", text: dropoff })
        )
      ),
      el("div", { className: "departure-card-footer" },
        el("div", { className: "driver-and-fare" },
          driverName ? el("div", { className: "driver-name", text: `Driver: ${driverName}` }) : false,
          el("div", { className: "fare-val", text: formatMoney(fare) })
        ),
        bookBtn
      )
    );

    list.appendChild(card);
  });

  container.appendChild(list);
}

/**
 * Handles clicking Book on a departure card: POST /departures/:id/reservations (no body needed).
 */
async function handleBookDeparture(departureId, depDetails, buttonEl) {
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Booking...";
  }

  try {
    const { status, ok, data } = await api("POST", `/departures/${departureId}/reservations`);

    if (!ok) {
      const errorMsg = data?.error || "Booking failed";
      console.error(`Booking departure failed (${status}):`, data);
      showToast(errorMsg, "error", status);
      return;
    }

    showToast("Seat reserved! Complete payment within 10 minutes.", "success");

    // Automatically transition to Book and pay tab and reload the list
    switchTab("book-pay");
  } catch (err) {
    console.error("Error booking departure:", err);
    showToast(err.message || String(err), "error");
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Book";
    }
  }
}

/* ==========================================================================
   TAB 2: BOOK AND PAY
   ========================================================================== */

async function renderBookAndPayTab(container) {
  try {
    container.replaceChildren();

    const card = el("div", { className: "card book-pay-panel" });
    const headerRow = el("div", { className: "panel-header-row" },
      el("h3", { className: "panel-title", text: "Book & Pay" }),
      el("button", {
        type: "button",
        className: "btn btn-outline btn-sm",
        text: "Refresh",
        onclick: () => renderBookAndPayTab(container),
      })
    );
    card.appendChild(headerRow);

    const listArea = el("div", { id: "book-pay-list-area", className: "book-pay-list-area" });
    listArea.appendChild(el("div", { className: "loading-text", text: "Loading reservations waiting for payment..." }));
    card.appendChild(listArea);
    container.appendChild(card);

    await loadBookAndPayList(listArea, container);
  } catch (err) {
    console.error("Error rendering Book and pay tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading Book and pay: ${err.message || String(err)}` })
    );
  }
}

async function loadBookAndPayList(listArea, container) {
  const { status, ok, data } = await api("GET", "/passengers/me/reservations");

  if (!ok) {
    const errorMsg = data?.error || "Failed to load reservations";
    showToast(errorMsg, "error", status);
    listArea.replaceChildren(
      el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
    );
    return;
  }

  const allReservations = Array.isArray(data) ? data : [];
  const pendingReservations = allReservations.filter((r) => r.status === "PENDING_PAYMENT");

  if (pendingReservations.length === 0) {
    listArea.replaceChildren(
      el("div", { className: "empty-state-box" },
        el("p", { text: "Nothing is waiting for payment." })
      )
    );
    return;
  }

  listArea.replaceChildren();
  const list = el("div", { className: "book-pay-cards-list" });

  for (const res of pendingReservations) {
    try {
      const resCard = await createBookAndPayCard(res, container);
      list.appendChild(resCard);
    } catch (err) {
      console.error("Error rendering reservation card:", err);
      const errorCard = el(
        "div",
        { className: "reservation-pay-card card card-error-fallback" },
        el("div", { className: "card-error-title", text: "This reservation could not be displayed" }),
        el("small", { className: "card-error-details details-line text-muted", text: err?.message || String(err) })
      );
      list.appendChild(errorCard);
    }
  }

  listArea.appendChild(list);
}

/**
 * Builds a card for a pending reservation awaiting payment.
 */
async function createBookAndPayCard(res, container) {
  let holdExpiresAt = res.hold_expires_at || res.holdExpiresAt;
  let departureTime = res.departure_time || res.departure?.departure_time;
  let pickupPoint = res.pickup_point || res.departure?.route?.pickup_point;
  let dropoffPoint = res.dropoff_point || res.departure?.route?.dropoff_point;
  let fareAmount = res.fare_amount || res.departure?.fare_amount;

  // If hold_expires_at is missing from list, fetch GET /reservations/:id
  if (!holdExpiresAt || !departureTime || !pickupPoint || !dropoffPoint || !fareAmount) {
    const detailRes = await api("GET", `/reservations/${res.id}`);
    if (detailRes.ok && detailRes.data) {
      if (!holdExpiresAt) holdExpiresAt = detailRes.data.hold_expires_at || detailRes.data.holdExpiresAt;
      if (!departureTime) departureTime = detailRes.data.departure?.departure_time;
      if (!pickupPoint) pickupPoint = detailRes.data.departure?.route?.pickup_point;
      if (!dropoffPoint) dropoffPoint = detailRes.data.departure?.route?.dropoff_point;
      if (!fareAmount) fareAmount = detailRes.data.fare_amount;
    }
  }

  const isAlreadyExpired = holdExpiresAt ? new Date(holdExpiresAt).getTime() <= Date.now() : false;

  const resCard = el("div", { className: "reservation-pay-card card" });

  // Top header: ID and Status
  const statusBadge = el("span", {
    className: `badge ${isAlreadyExpired ? "badge-status-expired" : "badge-status-pending_payment"}`,
    text: isAlreadyExpired ? "Hold expired" : "PENDING_PAYMENT",
  });

  resCard.appendChild(
    el("div", { className: "res-id-banner" },
      el("div", { className: "id-meta-left" },
        el("span", { className: "label-caption", text: "Reservation ID" }),
        el("code", { className: "id-code", text: res.id })
      ),
      statusBadge
    )
  );

  // Departure Time & Fare
  const metaRow = el("div", { className: "res-meta-row" },
    el("div", { className: "meta-item" },
      el("span", { className: "meta-label", text: "Departure Time" }),
      departureTime
        ? formatUtcTime(departureTime, { className: "trip-time-val" })
        : el("span", { text: "Scheduled" })
    ),
    el("div", { className: "meta-item" },
      el("span", { className: "meta-label", text: "Fare Amount" }),
      el("span", { className: "meta-fare", text: formatMoney(fareAmount) })
    )
  );
  resCard.appendChild(metaRow);

  // Pickup and drop-off
  const routeRow = el("div", { className: "trip-route-row" },
    el("div", { className: "trip-pickup" },
      el("span", { className: "pickup-dot", text: "●" }),
      el("strong", { text: pickupPoint || "Pickup point" }),
      dropoffPoint ? el("span", { className: "trip-dropoff", text: ` → ${dropoffPoint}` }) : false
    )
  );
  resCard.appendChild(routeRow);

  // An already-expired hold must render as "Hold expired. Book again from Search." with no buttons and no timer
  if (isAlreadyExpired) {
    const expiredNotice = el("div", {
      className: "hold-expired-box",
      text: "Hold expired. Book again from Search.",
    });
    resCard.appendChild(expiredNotice);
    return resCard;
  }

  // Live countdown to hold_expires_at (mm:ss)
  const countdownSpan = el("strong", { id: `countdown-${res.id}`, className: "countdown-value", text: "--:--" });
  const countdownBox = el(
    "div",
    { className: "countdown-box" },
    el("span", { className: "countdown-label", text: "Hold expires in: " }),
    countdownSpan
  );
  resCard.appendChild(countdownBox);

  // Action area for payment buttons / waiting state
  const actionArea = el("div", { className: "payment-action-area" });
  resCard.appendChild(actionArea);

  let pollInterval = null;
  let visibilityListener = null;

  function stopPolling() {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (visibilityListener) {
      document.removeEventListener("visibilitychange", visibilityListener);
      visibilityListener = null;
    }
  }

  // When hold runs out: changes to "Hold expired. Book again from Search."
  let stopTimer = null;
  function onHoldExpired() {
    stopPolling();
    if (typeof stopTimer === "function") {
      stopTimer();
    }
    countdownBox.replaceChildren(
      el("div", { className: "hold-expired-box", text: "Hold expired. Book again from Search." })
    );
    statusBadge.className = "badge badge-status-expired";
    statusBadge.textContent = "Hold expired";
    if (actionArea && actionArea.parentNode) {
      actionArea.remove();
    }
  }

  if (holdExpiresAt) {
    stopTimer = startCountdown(holdExpiresAt, countdownSpan, onHoldExpired);
  } else {
    // If still missing for any reason, fetch GET /reservations/:id for that reservation and use its hold_expires_at
    api("GET", `/reservations/${res.id}`).then(({ ok, data }) => {
      if (ok && data) {
        const fetchedHold = data.hold_expires_at || data.holdExpiresAt;
        if (fetchedHold) {
          if (new Date(fetchedHold).getTime() <= Date.now()) {
            onHoldExpired();
          } else {
            stopTimer = startCountdown(fetchedHold, countdownSpan, onHoldExpired);
          }
        }
      }
    });
  }

  // Initial payment action: "Pay with Paystack"
  const paystackBtn = el("button", {
    type: "button",
    id: `paystack-btn-${res.id}`,
    className: "btn btn-primary btn-pay",
    text: "Pay with Paystack",
    onclick: () => handlePayWithPaystack(),
  });
  actionArea.appendChild(paystackBtn);

  let isCheckingStatus = false;

  async function checkReservationStatus(force = false) {
    if (!resCard.isConnected) {
      stopPolling();
      return;
    }

    if (document.hidden && !force) {
      return;
    }

    if (isCheckingStatus) return;
    isCheckingStatus = true;

    try {
      const { status, ok, data } = await api("GET", `/reservations/${res.id}`);
      if (!resCard.isConnected) {
        stopPolling();
        return;
      }

      if (!ok) {
        return;
      }

      if (data.status === "CONFIRMED") {
        stopPolling();
        showToast("Payment confirmed", "success");
        switchTab("trips");
        const listArea = document.getElementById("trips-list-area");
        if (listArea) loadTripsList(listArea);
        return;
      }

      if (data.status === "EXPIRED") {
        stopPolling();
        onHoldExpired();
        return;
      }

      if (data.status !== "PENDING_PAYMENT") {
        stopPolling();
        await renderBookAndPayTab(container);
      }
    } catch (err) {
      console.error("Error polling reservation status:", err);
    } finally {
      isCheckingStatus = false;
    }
  }

  function startWaitingAndPolling() {
    actionArea.replaceChildren();

    const waitingBox = el(
      "div",
      { className: "payment-waiting-box" },
      el("div", { className: "waiting-header", text: "Waiting for payment confirmation..." }),
      el("p", {
        className: "waiting-desc",
        text: "Please complete your payment in the Paystack checkout tab. This page will update automatically once confirmed.",
      }),
      el("button", {
        type: "button",
        id: `check-now-btn-${res.id}`,
        className: "btn btn-outline btn-sm check-now-btn",
        text: "I have paid, check now",
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (btn) btn.disabled = true;
          try {
            await checkReservationStatus(true);
          } finally {
            if (btn && resCard.isConnected) {
              btn.disabled = false;
            }
          }
        },
      })
    );
    actionArea.appendChild(waitingBox);

    stopPolling();
    pollInterval = setInterval(() => checkReservationStatus(false), 3000);

    visibilityListener = () => {
      if (!document.hidden && resCard.isConnected) {
        checkReservationStatus(false);
      }
    };
    document.addEventListener("visibilitychange", visibilityListener);
  }

  function renderSimulatedButtons(paymentId) {
    actionArea.replaceChildren();

    const paySuccessBtn = el("button", {
      type: "button",
      className: "btn btn-primary btn-pay",
      text: "Pay (simulate success)",
      onclick: () => handleSimulatedPayment(paymentId, "SUCCESS", paySuccessBtn, payFailBtn),
    });

    const payFailBtn = el("button", {
      type: "button",
      className: "btn btn-outline btn-pay btn-fail",
      text: "Simulate failed payment",
      onclick: () => handleSimulatedPayment(paymentId, "FAILURE", paySuccessBtn, payFailBtn),
    });

    const simRow = el("div", { className: "payment-buttons-row" }, paySuccessBtn, payFailBtn);
    actionArea.appendChild(simRow);
  }

  async function handleSimulatedPayment(paymentId, outcome, btnSuccess, btnFail) {
    btnSuccess.disabled = true;
    btnFail.disabled = true;

    try {
      let targetPaymentId = paymentId;
      if (!targetPaymentId) {
        const initRes = await api("POST", `/reservations/${res.id}/payments`, { provider: "SIMULATED" });
        if (!initRes.ok) {
          showToast(initRes.data?.error || initRes.data?.message || "Payment initiation failed", "error", initRes.status);
          return;
        }
        targetPaymentId = initRes.data?.paymentId || initRes.data?.id;
      }

      const callbackRes = await api("POST", `/payments/${targetPaymentId}/callback`, { outcome });
      if (!callbackRes.ok) {
        showToast(callbackRes.data?.error || callbackRes.data?.message || "Payment callback failed", "error", callbackRes.status);
        return;
      }

      const cbStatus = callbackRes.data?.status;
      if (cbStatus === "SUCCEEDED") {
        showToast("Payment confirmed", "success");
      } else if (cbStatus === "FAILED") {
        showToast("Payment failed: the seat was released", "error");
      } else if (cbStatus === "IGNORED") {
        showToast("Too late: the hold had expired", "error");
      } else {
        showToast(callbackRes.data?.message || `Payment resolved with status: ${cbStatus}`, "success");
      }
    } catch (err) {
      showToast(err.message || String(err), "error");
    } finally {
      btnSuccess.disabled = false;
      btnFail.disabled = false;
      await renderBookAndPayTab(container);
    }
  }

  async function handlePayWithPaystack() {
    // 1. To avoid pop-up blocking, call window.open("", "_blank") synchronously inside the click handler
    let checkoutWin = null;
    try {
      checkoutWin = window.open("", "_blank");
    } catch (err) {
      console.warn("Could not open blank window:", err);
    }

    paystackBtn.disabled = true;

    try {
      // Call POST /reservations/:id/payments with no body
      const { status, ok, data } = await api("POST", `/reservations/${res.id}/payments`);

      if (!ok) {
        if (checkoutWin && !checkoutWin.closed) {
          checkoutWin.close();
        }
        paystackBtn.disabled = false;
        const errorMsg = data?.error || data?.message || "Payment initiation failed";
        showToast(errorMsg, "error", status);
        return;
      }

      if (data && data.checkoutUrl) {
        if (checkoutWin && !checkoutWin.closed) {
          checkoutWin.location.href = data.checkoutUrl;
        } else {
          window.open(data.checkoutUrl, "_blank");
        }
        startWaitingAndPolling();
        return;
      }

      // If the answer has no checkoutUrl, close the window and show the server's message / fallback
      if (checkoutWin && !checkoutWin.closed) {
        checkoutWin.close();
      }

      // 3. If development with simulated mode on (no checkoutUrl and provider SIMULATED or paymentId returned)
      if (data?.provider === "SIMULATED" || data?.paymentId) {
        renderSimulatedButtons(data.paymentId);
        return;
      }

      paystackBtn.disabled = false;
      const msg = data?.message || data?.error || "No checkout URL returned";
      showToast(msg, "error", status);
    } catch (err) {
      if (checkoutWin && !checkoutWin.closed) {
        checkoutWin.close();
      }
      paystackBtn.disabled = false;
      showToast(err.message || String(err), "error");
    }
  }

  return resCard;
}

/* ==========================================================================
   TAB 3: MY TRIPS
   ========================================================================== */

async function renderTripsTab(container) {
  try {
    container.replaceChildren();
    const card = el("div", { className: "card trips-panel" });

    const header = el("div", { className: "panel-header-row" },
      el("h3", { className: "panel-title", text: "My Trips" }),
      el("button", {
        type: "button",
        className: "btn btn-outline btn-sm",
        text: "Refresh",
        onclick: () => loadTripsList(listArea),
      })
    );
    card.appendChild(header);

    const listArea = el("div", { id: "trips-list-area", className: "trips-list-area" });
    card.appendChild(listArea);
    container.appendChild(card);

    await loadTripsList(listArea);
  } catch (err) {
    console.error("Error rendering trips tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading trips: ${err.message || String(err)}` })
    );
  }
}

/**
 * Loads passenger reservations from GET /passengers/me/reservations.
 */
async function loadTripsList(container) {
  try {
    container.replaceChildren(el("div", { className: "loading-text", text: "Loading your reservations..." }));

    const { status, ok, data } = await api("GET", "/passengers/me/reservations");
    if (!ok) {
      const errorMsg = data?.error || "Failed to load reservations";
      showToast(errorMsg, "error", status);
      container.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` })
      );
      return;
    }

    const trips = Array.isArray(data) ? data : [];
    if (trips.length === 0) {
      container.replaceChildren(
        el("div", { className: "empty-state-box", text: "No trips found. Book a departure to get started." })
      );
      return;
    }

    container.replaceChildren();
    const list = el("div", { className: "trips-cards-list" });

    for (const trip of trips) {
      try {
        const tripCard = createTripCard(trip);
        list.appendChild(tripCard);
      } catch (err) {
        console.error("Error rendering reservation card:", err);
        const errorCard = el(
          "div",
          { className: "trip-card card card-error-fallback" },
          el("div", { className: "card-error-title", text: "This reservation could not be displayed" }),
          el("small", { className: "card-error-details details-line text-muted", text: err?.message || String(err) })
        );
        list.appendChild(errorCard);
      }
    }

    container.appendChild(list);
  } catch (err) {
    console.error("Error loading trips list:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading trips: ${err.message || String(err)}` })
    );
  }
}

/**
 * Helper to build an individual reservation card.
 */
function createTripCard(trip) {
  const depTime = trip.departure_time;
  const pickup = trip.pickup_point || "Pickup point";
  const fare = trip.fare_amount;
  const resStatus = trip.status; // PENDING_PAYMENT | CONFIRMED | CANCELLED | EXPIRED | FAILED | COMPLETED
  const tripStatus = trip.trip_status || trip.tripStatus || "SCHEDULED"; // SCHEDULED | ARRIVED | IN_PROGRESS | COMPLETED | CANCELLED

  const card = el("div", { className: "trip-card card" });

  // Top header: Departure Time & Fare
  const topHeader = el("div", { className: "trip-card-header" },
    el("div", { className: "trip-time-info" },
      el("span", { className: "label-caption", text: "Departure Time" }),
      formatUtcTime(depTime, { className: "trip-time-val" })
    ),
    el("div", { className: "trip-fare-info" },
      el("span", { className: "label-caption", text: "Fare" }),
      el("span", { className: "fare-val", text: formatMoney(fare) })
    )
  );
  card.appendChild(topHeader);

  // Route pickup point & reservation badge
  const routeRow = el("div", { className: "trip-route-row" },
    el("div", { className: "trip-pickup" },
      el("span", { className: "pickup-dot", text: "●" }),
      el("strong", { text: pickup }),
      trip.dropoff_point ? el("span", { className: "trip-dropoff", text: ` → ${trip.dropoff_point}` }) : false
    ),
    el("span", {
      className: `badge badge-res-status badge-status-${resStatus.toLowerCase()}`,
      text: resStatus,
    })
  );
  card.appendChild(routeRow);

  // Trip progress stepper: SCHEDULED -> ARRIVED -> IN_PROGRESS -> COMPLETED (or CANCELLED)
  const stepper = createTripStepper(tripStatus);
  card.appendChild(stepper);

  // Countdown for PENDING_PAYMENT
  if (resStatus === "PENDING_PAYMENT") {
    const isAlreadyExpired = trip.hold_expires_at
      ? new Date(trip.hold_expires_at).getTime() <= Date.now()
      : false;

    if (isAlreadyExpired) {
      const statusBadgeEl = card.querySelector(".badge-res-status");
      if (statusBadgeEl) {
        statusBadgeEl.className = "badge badge-res-status badge-status-expired";
        statusBadgeEl.textContent = "Hold expired";
      }
      const expiredBox = el("div", {
        className: "trip-pending-box hold-expired-box",
        text: "Hold expired. Book again from Search.",
      });
      card.appendChild(expiredBox);
    } else {
      const countdownSpan = el("strong", { className: "countdown-timer", text: "--:--" });
      const payBtn = el("button", {
        type: "button",
        className: "btn btn-primary btn-xs",
        text: "Pay now",
        onclick: () => {
          switchTab("book-pay");
        },
      });

      const countdownContainer = el("div", { className: "trip-pending-box" },
        el("span", { className: "label-caption", text: "Payment Hold Active: " }),
        countdownSpan,
        payBtn
      );
      card.appendChild(countdownContainer);

      let stopTripTimer = null;
      const onTripHoldExpired = () => {
        if (typeof stopTripTimer === "function") {
          stopTripTimer();
        }
        countdownContainer.replaceChildren(
          el("span", { className: "hold-expired-text text-muted", text: "Hold expired. Book again from Search." })
        );
        const statusEl = card.querySelector(".badge-res-status");
        if (statusEl) {
          statusEl.className = "badge badge-res-status badge-status-expired";
          statusEl.textContent = "Hold expired";
        }
      };

      const tripHold = trip.hold_expires_at || trip.holdExpiresAt;
      // If hold_expires_at is missing, fetch it with GET /reservations/:id
      if (!tripHold) {
        api("GET", `/reservations/${trip.id}`).then(({ ok, data }) => {
          const fetchedHold = data?.hold_expires_at || data?.holdExpiresAt;
          if (ok && fetchedHold && countdownContainer.isConnected) {
            if (new Date(fetchedHold).getTime() <= Date.now()) {
              onTripHoldExpired();
            } else {
              stopTripTimer = startCountdown(fetchedHold, countdownSpan, onTripHoldExpired);
            }
          }
        }).catch((err) => {
          console.error("Error fetching reservation hold time:", err);
        });
      } else {
        stopTripTimer = startCountdown(tripHold, countdownSpan, onTripHoldExpired);
      }
    }
  }

  // Cancel Button: only for CONFIRMED reservations before departure
  const isBeforeDeparture = depTime ? new Date(depTime).getTime() > Date.now() : true;
  if (resStatus === "CONFIRMED" && tripStatus === "SCHEDULED" && isBeforeDeparture) {
    const cancelBtn = el("button", {
      type: "button",
      className: "btn btn-outline btn-sm btn-cancel-res",
      text: "Cancel Reservation",
      onclick: () => handleCancelReservation(trip.id, cancelBtn),
    });

    const actionRow = el("div", { className: "trip-actions-row" }, cancelBtn);
    card.appendChild(actionRow);
  }

  // Details expander: calls GET /reservations/:id and GET /payments/:id
  const detailsExpander = el("details", { className: "trip-details-expander" },
    el("summary", { className: "trip-details-summary", text: "View Details" }),
    el("div", { className: "trip-details-body", text: "Loading details..." })
  );

  let detailsLoaded = false;
  detailsExpander.ontoggle = async () => {
    if (detailsExpander.open && !detailsLoaded) {
      detailsLoaded = true;
      const body = detailsExpander.querySelector(".trip-details-body");
      if (body) {
        await loadTripDetails(trip.id, body);
      }
    }
  };

  card.appendChild(detailsExpander);
  return card;
}

/**
 * Creates visual stepper for trip status.
 */
function createTripStepper(tripStatus) {
  const container = el("div", { className: "trip-stepper-container" });

  if (tripStatus === "CANCELLED") {
    container.appendChild(
      el("div", { className: "stepper-cancelled" },
        el("span", { className: "badge badge-cancelled", text: "Trip Cancelled" })
      )
    );
    return container;
  }

  const steps = ["SCHEDULED", "ARRIVED", "IN_PROGRESS", "COMPLETED"];
  const stepLabels = ["Scheduled", "Arrived", "In Progress", "Completed"];
  const currentIdx = steps.indexOf(tripStatus);

  const stepper = el("div", { className: "stepper-track" });

  steps.forEach((step, idx) => {
    const isCompleted = idx < currentIdx;
    const isCurrent = idx === currentIdx;
    const isFuture = idx > currentIdx;

    let stepClass = "step-item";
    if (isCompleted) stepClass += " step-done";
    if (isCurrent) stepClass += " step-current";
    if (isFuture) stepClass += " step-future";

    const node = el(
      "div",
      { className: stepClass },
      el("span", { className: "step-indicator", text: isCompleted ? "✓" : String(idx + 1) }),
      el("span", { className: "step-text", text: stepLabels[idx] })
    );

    stepper.appendChild(node);

    if (idx < steps.length - 1) {
      stepper.appendChild(
        el("div", { className: `step-line ${idx < currentIdx ? "line-done" : ""}` })
      );
    }
  });

  container.appendChild(stepper);
  return container;
}

/**
 * Formats payment status into plain words for display.
 */
function formatPaymentStatus(status) {
  if (!status) return "Unknown";
  switch (status) {
    case "REFUND_PENDING":
      return "Refund processing";
    case "REFUNDED":
      return "Refunded";
    case "REFUND_FAILED":
      return "Refund failed";
    case "SUCCEEDED":
      return "Succeeded";
    case "PENDING":
      return "Pending";
    case "FAILED":
      return "Failed";
    case "EXPIRED":
      return "Expired";
    default:
      return String(status).replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
  }
}

function getPaymentStatusBadgeClass(status) {
  switch (status) {
    case "SUCCEEDED":
      return "badge-status-confirmed";
    case "REFUNDED":
      return "badge-status-refunded";
    case "REFUND_PENDING":
      return "badge-status-refund-pending";
    case "PENDING":
      return "badge-status-pending_payment";
    case "FAILED":
    case "REFUND_FAILED":
      return "badge-status-failed";
    case "EXPIRED":
      return "badge-status-expired";
    default:
      return "badge-status-info";
  }
}

/**
 * Polls GET /payments/:id every 3 seconds for up to 60 seconds after cancellation.
 */
function pollRefundStatus(paymentId) {
  const startTime = Date.now();
  const maxDurationMs = 60000;

  const timer = setInterval(async () => {
    if (Date.now() - startTime >= maxDurationMs) {
      clearInterval(timer);
      return;
    }

    if (document.hidden) {
      return;
    }

    try {
      const { ok, data } = await api("GET", `/payments/${paymentId}`);
      if (!ok || !data) return;

      if (data.status === "REFUNDED") {
        clearInterval(timer);
        showToast("Refunded", "success");
        const listArea = document.getElementById("trips-list-area");
        if (listArea) loadTripsList(listArea);
      } else if (data.status === "REFUND_FAILED") {
        clearInterval(timer);
        showToast("Refund could not be processed; contact support", "error");
        const listArea = document.getElementById("trips-list-area");
        if (listArea) loadTripsList(listArea);
      }
    } catch (err) {
      console.error("Refund status polling error:", err);
    }
  }, 3000);
}

/**
 * Cancels a confirmed reservation: POST /reservations/:id/cancel
 */
async function handleCancelReservation(reservationId, buttonEl) {
  if (!confirm("Are you sure you want to cancel this reservation?")) return;

  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Cancelling...";
  }

  try {
    const { status, ok, data } = await api("POST", `/reservations/${reservationId}/cancel`);
    if (!ok) {
      const msg = data?.error || data?.message || "Failed to cancel reservation";
      showToast(msg, "error", status);
      return;
    }

    // Refresh trips list immediately
    const listArea = document.getElementById("trips-list-area");
    if (listArea) loadTripsList(listArea);

    const refund = data.refund;
    if (refund && refund.status === "PENDING") {
      showToast(`Refund of ${formatMoney(refund.amount)} requested; processing`, "success");
      if (refund.paymentId) {
        pollRefundStatus(refund.paymentId);
      }
    } else {
      const refundAmount = refund?.amount;
      const msg = refundAmount
        ? `Reservation cancelled. Refund: ${formatMoney(refundAmount)}`
        : "Reservation cancelled successfully.";
      showToast(msg, "success");
    }
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Cancel Reservation";
    }
  }
}

/**
 * Loads deep details: GET /reservations/:id and GET /payments/:id
 */
async function loadTripDetails(reservationId, bodyEl) {
  bodyEl.replaceChildren(el("div", { className: "loading-text", text: "Fetching reservation & payment details..." }));

  const { status, ok, data } = await api("GET", `/reservations/${reservationId}`);
  if (!ok) {
    const msg = data?.error || "Could not load reservation details";
    bodyEl.replaceChildren(el("div", { className: "alert alert-danger", text: `[${status}] ${msg}` }));
    return;
  }

  bodyEl.replaceChildren();

  // Basic reservation details
  const detailsList = el("div", { className: "details-grid" },
    el("div", { className: "details-row" },
      el("span", { className: "details-label", text: "Reservation ID:" }),
      el("code", { className: "details-val", text: data.id })
    ),
    el("div", { className: "details-row" },
      el("span", { className: "details-label", text: "Created At:" }),
      formatUtcTime(data.created_at)
    )
  );

  if (data.cancellation_reason) {
    detailsList.appendChild(
      el("div", { className: "details-row" },
        el("span", { className: "details-label", text: "Cancellation Reason:" }),
        el("span", { className: "details-val", text: data.cancellation_reason })
      )
    );
  }

  bodyEl.appendChild(detailsList);

  // If there are payments, fetch GET /payments/:id
  const payments = Array.isArray(data.payments) ? data.payments : [];
  if (payments.length > 0) {
    const paymentSection = el("div", { className: "payment-details-section" },
      el("h5", { className: "section-subheading", text: "Payment Information" })
    );

    for (const p of payments) {
      const pBox = el("div", { className: "payment-item-box" });
      paymentSection.appendChild(pBox);

      // Fetch full payment details: GET /payments/:id
      const pRes = await api("GET", `/payments/${p.id}`);
      if (pRes.ok && pRes.data) {
        const pd = pRes.data;
        pBox.appendChild(
          el("div", { className: "details-grid" },
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Payment Status:" }),
              el("span", {
                className: `badge ${getPaymentStatusBadgeClass(pd.status)}`,
                text: formatPaymentStatus(pd.status),
              })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Amount:" }),
              el("span", { className: "details-val", text: formatMoney(pd.amount) })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Refunded At:" }),
              pd.refunded_at ? formatUtcTime(pd.refunded_at) : el("span", { text: "None" })
            )
          )
        );
      } else {
        // Fallback to embedded payment object if GET /payments/:id failed
        pBox.appendChild(
          el("div", { className: "details-grid" },
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Payment Status:" }),
              el("span", {
                className: `badge ${getPaymentStatusBadgeClass(p.status)}`,
                text: formatPaymentStatus(p.status),
              })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Amount:" }),
              el("span", { className: "details-val", text: formatMoney(p.amount) })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Refunded At:" }),
              p.refunded_at ? formatUtcTime(p.refunded_at) : el("span", { text: "None" })
            )
          )
        );
      }
    }

    bodyEl.appendChild(paymentSection);
  }
}

/* ==========================================================================
   TAB 4: NOTIFICATIONS
   ========================================================================== */

async function renderNotificationsTab(container) {
  try {
    container.replaceChildren();
    const card = el("div", { className: "card notifications-panel" });

    const header = el("div", { className: "panel-header-row" },
      el("h3", { className: "panel-title", text: "Notifications" }),
      el("button", {
        type: "button",
        className: "btn btn-outline btn-sm",
        text: "Refresh",
        onclick: () => loadNotificationsList(listArea),
      })
    );
    card.appendChild(header);

    const listArea = el("div", { id: "notifications-list-area", className: "notifications-list-area" });
    card.appendChild(listArea);
    container.appendChild(card);

    await loadNotificationsList(listArea);
  } catch (err) {
    console.error("Error rendering notifications tab:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading notifications: ${err.message || String(err)}` })
    );
  }
}

/**
 * Loads notifications: GET /passengers/me/notifications, sorted unread first.
 */
async function loadNotificationsList(container) {
  try {
    container.replaceChildren(el("div", { className: "loading-text", text: "Loading notifications..." }));

    const { status, ok, data } = await api("GET", "/passengers/me/notifications");
    if (!ok) {
      const errorMsg = data?.error || "Failed to load notifications";
      showToast(errorMsg, "error", status);
      container.replaceChildren(el("div", { className: "alert alert-danger", text: `[${status}] ${errorMsg}` }));
      return;
    }

    const items = Array.isArray(data) ? data : [];

    // Update badge count
    unreadCount = items.filter((n) => !n.read_at).length;
    updateNotificationBadge();

    if (items.length === 0) {
      container.replaceChildren(
        el("div", { className: "empty-state-box", text: "No notifications yet." })
      );
      return;
    }

  // Sort unread first, then newest first
  const sorted = [...items].sort((a, b) => {
    const aUnread = a.read_at === null ? 1 : 0;
    const bUnread = b.read_at === null ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  container.replaceChildren();
  const list = el("div", { className: "notifications-cards-list" });

  for (const notif of sorted) {
    const isUnread = !notif.read_at;
    const payload = notif.payload || {};

    const card = el("div", { className: `notification-card card ${isUnread ? "notif-unread" : "notif-read"}` });

    // Top row: Type title and unread status badge
    const topRow = el("div", { className: "notif-header" },
      el("div", { className: "notif-title-group" },
        el("span", { className: "notif-dot", text: isUnread ? "●" : "○" }),
        el("strong", { className: "notif-type", text: getNotificationTypeLabel(notif.type) })
      ),
      el("span", {
        className: `badge ${isUnread ? "badge-unread-indicator" : "badge-read-indicator"}`,
        text: isUnread ? "Unread" : "Read",
      })
    );
    card.appendChild(topRow);

    // Body content: departure time, pickup and dropoff, refund amount
    const bodyContent = el("div", { className: "notif-body" });

    const depTime = payload.departureTime || payload.departure_time;
    if (depTime) {
      bodyContent.appendChild(
        el("div", { className: "notif-info-line" },
          el("span", { className: "label-caption", text: "Departure Time: " }),
          formatUtcTime(depTime)
        )
      );
    }

    const pickup = payload.pickupPoint || payload.pickup_point;
    const dropoff = payload.dropoffPoint || payload.dropoff_point;
    if (pickup || dropoff) {
      bodyContent.appendChild(
        el("div", { className: "notif-info-line" },
          el("span", { className: "label-caption", text: "Route: " }),
          el("span", { text: `${pickup || ""} → ${dropoff || ""}` })
        )
      );
    }

    const refundAmount = payload.refund?.amount;
    if (refundAmount) {
      bodyContent.appendChild(
        el("div", { className: "notif-info-line notif-refund-line" },
          el("span", { className: "label-caption", text: "Refund Amount: " }),
          el("strong", { className: "refund-highlight", text: formatMoney(refundAmount) })
        )
      );
    }

    card.appendChild(bodyContent);

    // Footer with timestamp and Mark Read button
    const footer = el("div", { className: "notif-footer" },
      el("span", { className: "notif-timestamp" }, formatUtcTime(notif.created_at))
    );

    if (isUnread) {
      const markReadBtn = el("button", {
        type: "button",
        className: "btn btn-outline btn-xs btn-mark-read",
        text: "Mark read",
        onclick: () => handleMarkNotificationRead(notif.id, markReadBtn, card),
      });
      footer.appendChild(markReadBtn);
    }

    card.appendChild(footer);
    list.appendChild(card);
  }

  container.appendChild(list);
  } catch (err) {
    console.error("Error loading notifications list:", err);
    showToast(err.message || String(err), "error");
    container.replaceChildren(
      el("div", { className: "alert alert-danger", text: `Error loading notifications: ${err.message || String(err)}` })
    );
  }
}

/**
 * Marks a notification as read: PATCH /notifications/:id/read
 */
async function handleMarkNotificationRead(notificationId, buttonEl, cardEl) {
  if (buttonEl) {
    buttonEl.disabled = true;
    buttonEl.textContent = "Marking...";
  }

  try {
    const { status, ok, data } = await api("PATCH", `/notifications/${notificationId}/read`);
    if (!ok) {
      const msg = data?.error || "Failed to mark notification as read";
      showToast(msg, "error", status);
      return;
    }

    showToast("Notification marked as read", "success");

    // Update unread count
    if (unreadCount > 0) unreadCount--;
    updateNotificationBadge();

    // Reload list to re-sort
    const listArea = document.getElementById("notifications-list-area");
    if (listArea) loadNotificationsList(listArea);
  } finally {
    if (buttonEl) {
      buttonEl.disabled = false;
      buttonEl.textContent = "Mark read";
    }
  }
}
