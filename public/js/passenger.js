/**
 * MoveMe Passenger Screen
 * Handles:
 * 1. Search departures
 * 2. Book and pay (with simulated payment callback)
 * 3. My trips (reservations list, live countdowns, cancel with refund, details expander)
 * 4. Notifications (read/unread, polling, mark as read)
 */

import { api } from "./api.js";
import { el, showToast, formatMoney, formatUtcTime, startCountdown } from "./ui.js";

// Passenger UI State
let activeTab = "search"; // "search" | "book-pay" | "trips" | "notifications"
let activeReservation = null; // Currently booking/paying reservation
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
        text: "Search and book scheduled or immediate departures across active commuter routes. Secure your seat with simulated card payments within the 10-minute hold window. Track live trip status, receive real-time notifications as drivers arrive or depart, and cancel reservations if plans change.",
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
  renderTabContent();

  function updateActiveTabUI() {
    tabs.forEach((t) => {
      const b = document.getElementById(`tab-btn-${t.id}`);
      if (b) {
        b.classList.toggle("active", activeTab === t.id);
      }
    });
    renderTabContent();
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
function renderTabContent() {
  const content = document.getElementById("passenger-tab-content");
  if (!content) return;
  content.replaceChildren();

  switch (activeTab) {
    case "search":
      renderSearchTab(content);
      break;
    case "book-pay":
      renderBookAndPayTab(content);
      break;
    case "trips":
      renderTripsTab(content);
      break;
    case "notifications":
      renderNotificationsTab(content);
      break;
  }
}

/* ==========================================================================
   TAB 1: SEARCH
   ========================================================================== */

async function renderSearchTab(container) {
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
      showToast(errorMsg, "error", status);
      return;
    }

    showToast("Seat reserved! Complete payment within 5 minutes.", "success");

    activeReservation = {
      id: data.reservationId || data.id,
      status: data.status,
      holdExpiresAt: data.holdExpiresAt || data.hold_expires_at,
      fareAmount: data.fareAmount || data.fare_amount,
      departure: depDetails,
    };

    // Automatically transition to Book and pay tab
    switchTab("book-pay");
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

function renderBookAndPayTab(container) {
  const card = el("div", { className: "card book-pay-panel" });
  card.appendChild(el("h3", { className: "panel-title", text: "Book & Pay" }));

  if (!activeReservation) {
    const empty = el(
      "div",
      { className: "empty-state-box" },
      el("p", { text: "No active reservation awaiting payment." }),
      el("button", {
        type: "button",
        className: "btn btn-primary btn-sm",
        text: "Search departures to book",
        onclick: () => switchTab("search"),
      })
    );
    card.appendChild(empty);
    container.appendChild(card);
    return;
  }

  // Active reservation display
  const res = activeReservation;
  const resCard = el("div", { className: "reservation-pay-card" });

  resCard.appendChild(
    el("div", { className: "res-id-banner" },
      el("span", { className: "label-caption", text: "Reservation ID" }),
      el("code", { className: "id-code", text: res.id })
    )
  );

  // Status & Fare
  resCard.appendChild(
    el("div", { className: "res-meta-row" },
      el("div", { className: "meta-item" },
        el("span", { className: "meta-label", text: "Status" }),
        el("span", { className: `badge badge-status-${res.status.toLowerCase()}`, text: res.status })
      ),
      el("div", { className: "meta-item" },
        el("span", { className: "meta-label", text: "Fare Amount" }),
        el("span", { className: "meta-fare", text: formatMoney(res.fareAmount) })
      )
    )
  );

  // Live countdown to hold_expires_at
  const countdownBox = el(
    "div",
    { className: "countdown-box" },
    el("span", { className: "countdown-label", text: "Hold expires in: " }),
    el("strong", { id: "active-res-countdown", className: "countdown-value", text: "--:--:--" })
  );
  resCard.appendChild(countdownBox);

  // Start countdown
  const timerTarget = res.holdExpiresAt;
  const countdownSpan = countdownBox.querySelector("#active-res-countdown");
  if (timerTarget && countdownSpan) {
    startCountdown(timerTarget, countdownSpan, () => {
      showToast("Reservation hold expired", "error", 409);
      activeReservation = null;
      renderBookAndPayTab(container);
    });
  }

  // Result display container
  const resultDisplay = el("div", { id: "payment-result-box", className: "payment-result-box" });

  // Payment simulation action buttons
  const paySuccessBtn = el("button", {
    type: "button",
    className: "btn btn-primary btn-pay",
    text: "Pay (simulate success)",
    onclick: () => handleExecutePayment(res.id, "SUCCESS", paySuccessBtn, payFailBtn, resultDisplay),
  });

  const payFailBtn = el("button", {
    type: "button",
    className: "btn btn-outline btn-pay btn-fail",
    text: "Simulate failed payment",
    onclick: () => handleExecutePayment(res.id, "FAILURE", paySuccessBtn, payFailBtn, resultDisplay),
  });

  const btnRow = el("div", { className: "payment-buttons-row" }, paySuccessBtn, payFailBtn);
  resCard.appendChild(btnRow);
  resCard.appendChild(resultDisplay);

  card.appendChild(resCard);
  container.appendChild(card);
}

/**
 * Handles payment flow: POST /reservations/:id/payments then POST /payments/:id/callback
 */
async function handleExecutePayment(reservationId, outcome, btnSuccess, btnFail, resultArea) {
  btnSuccess.disabled = true;
  btnFail.disabled = true;
  resultArea.replaceChildren(el("div", { className: "loading-text", text: "Processing payment simulation..." }));

  try {
    // Step 1: Initiate payment
    const initRes = await api("POST", `/reservations/${reservationId}/payments`);
    if (!initRes.ok) {
      const errorMsg = initRes.data?.error || "Payment initiation failed";
      showToast(errorMsg, "error", initRes.status);
      resultArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${initRes.status}] ${errorMsg}` })
      );
      return;
    }

    const paymentId = initRes.data?.paymentId || initRes.data?.id;
    if (!paymentId) {
      showToast("No payment ID returned by server", "error");
      return;
    }

    // Step 2: Callback simulation
    const callbackRes = await api("POST", `/payments/${paymentId}/callback`, { outcome });
    if (!callbackRes.ok) {
      const errorMsg = callbackRes.data?.error || "Payment callback failed";
      showToast(errorMsg, "error", callbackRes.status);
      resultArea.replaceChildren(
        el("div", { className: "alert alert-danger", text: `[${callbackRes.status}] ${errorMsg}` })
      );
      return;
    }

    // Step 3: Interpret outcome in plain words
    const cbStatus = callbackRes.data?.status;

    if (cbStatus === "SUCCEEDED") {
      showToast("Payment confirmed", "success");
      activeReservation = null;

      resultArea.replaceChildren(
        el("div", { className: "alert alert-success" },
          el("strong", { text: "Payment confirmed" }),
          el("p", { text: "Your seat is confirmed! You can view the departure under 'My trips'." }),
          el("button", {
            type: "button",
            className: "btn btn-primary btn-sm",
            text: "View My Trips",
            onclick: () => switchTab("trips"),
          })
        )
      );
    } else if (cbStatus === "FAILED") {
      showToast("Payment failed: the seat was released", "error");
      activeReservation = null;

      resultArea.replaceChildren(
        el("div", { className: "alert alert-danger" },
          el("strong", { text: "Payment failed: the seat was released" }),
          el("p", { text: "The simulated payment failed. The reservation has been terminated." })
        )
      );
    } else if (cbStatus === "IGNORED") {
      // IGNORED means the hold had expired or was duplicate/closed
      showToast("Too late: the hold had expired", "error");
      activeReservation = null;

      resultArea.replaceChildren(
        el("div", { className: "alert alert-warning" },
          el("strong", { text: "Too late: the hold had expired" }),
          el("p", { text: callbackRes.data?.message || "The reservation hold expired before payment was settled." })
        )
      );
    } else {
      const fallbackMsg = callbackRes.data?.message || `Payment resolved with status: ${cbStatus}`;
      showToast(fallbackMsg, "success");
      activeReservation = null;
      resultArea.replaceChildren(el("div", { className: "alert alert-info", text: fallbackMsg }));
    }
  } finally {
    btnSuccess.disabled = false;
    btnFail.disabled = false;
  }
}

/* ==========================================================================
   TAB 3: MY TRIPS
   ========================================================================== */

async function renderTripsTab(container) {
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

  loadTripsList(listArea);
}

/**
 * Loads passenger reservations from GET /passengers/me/reservations.
 */
async function loadTripsList(container) {
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
    const tripCard = createTripCard(trip);
    list.appendChild(tripCard);
  }

  container.appendChild(list);
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
    const countdownContainer = el("div", { className: "trip-pending-box" },
      el("span", { className: "label-caption", text: "Payment Hold Active: " }),
      el("strong", { className: "countdown-timer", text: "--:--:--" }),
      el("button", {
        type: "button",
        className: "btn btn-primary btn-xs",
        text: "Pay now",
        onclick: () => {
          activeReservation = {
            id: trip.id,
            status: trip.status,
            holdExpiresAt: trip.hold_expires_at,
            fareAmount: trip.fare_amount,
          };
          switchTab("book-pay");
        },
      })
    );

    const countdownSpan = countdownContainer.querySelector(".countdown-timer");

    // If hold_expires_at is missing, fetch it with GET /reservations/:id
    if (!trip.hold_expires_at) {
      api("GET", `/reservations/${trip.id}`).then(({ ok, data }) => {
        if (ok && data?.hold_expires_at && countdownSpan) {
          startCountdown(data.hold_expires_at, countdownSpan, () => {
            const listArea = document.getElementById("trips-list-area");
            if (listArea) loadTripsList(listArea);
          });
        }
      });
    } else if (countdownSpan) {
      startCountdown(trip.hold_expires_at, countdownSpan, () => {
        const listArea = document.getElementById("trips-list-area");
        if (listArea) loadTripsList(listArea);
      });
    }

    card.appendChild(countdownContainer);
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
      const msg = data?.error || "Failed to cancel reservation";
      showToast(msg, "error", status);
      return;
    }

    const refundAmount = data.refund?.amount;
    const msg = refundAmount
      ? `Reservation cancelled. Simulated refund: ${formatMoney(refundAmount)}`
      : "Reservation cancelled successfully.";
    showToast(msg, "success");

    // Refresh trips list immediately
    const listArea = document.getElementById("trips-list-area");
    if (listArea) loadTripsList(listArea);
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
              el("span", { className: "badge badge-status-ok", text: pd.status })
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
              el("span", { className: "details-label", text: "Status:" }),
              el("span", { text: p.status })
            ),
            el("div", { className: "details-row" },
              el("span", { className: "details-label", text: "Amount:" }),
              el("span", { text: formatMoney(p.amount) })
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

  loadNotificationsList(listArea);
}

/**
 * Loads notifications: GET /passengers/me/notifications, sorted unread first.
 */
async function loadNotificationsList(container) {
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
