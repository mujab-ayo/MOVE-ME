/**
 * UI Utilities and DOM helpers
 * Follows strict security rules: safe element creation, textContent only, no innerHTML with server data.
 */

/**
 * Safely create DOM elements with attributes, event listeners, and children.
 * Never uses innerHTML with server or user data.
 */
export function el(tag, props = {}, ...children) {
  const element = document.createElement(tag);

  for (const [key, val] of Object.entries(props)) {
    if (val === undefined || val === null) continue;

    if (key === "className" || key === "class") {
      element.className = val;
    } else if (key === "textContent" || key === "text") {
      element.textContent = val;
    } else if (key === "dataset" && typeof val === "object") {
      for (const [dKey, dVal] of Object.entries(val)) {
        element.dataset[dKey] = dVal;
      }
    } else if (key === "style" && typeof val === "object") {
      Object.assign(element.style, val);
    } else if (key.startsWith("on") && typeof val === "function") {
      const eventName = key.slice(2).toLowerCase();
      element.addEventListener(eventName, val);
    } else {
      element.setAttribute(key, val);
    }
  }

  function appendChildSafe(child) {
    if (child === undefined || child === null || child === false) return;
    if (Array.isArray(child)) {
      for (const item of child) {
        appendChildSafe(item);
      }
    } else if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  }

  for (const child of children) {
    appendChildSafe(child);
  }

  return element;
}

/**
 * Display toast notification.
 * Green for success, red for errors.
 * For errors, shows status code and server's error message.
 */
export function showToast(messageOrOptions, type = "success", statusCode = null) {
  let message = "";
  let toastType = "success";
  let status = null;

  if (typeof messageOrOptions === "object" && messageOrOptions !== null) {
    message = messageOrOptions.message || "";
    toastType = messageOrOptions.type || "success";
    status = messageOrOptions.statusCode || messageOrOptions.status || null;
  } else {
    message = String(messageOrOptions || "");
    toastType = type;
    status = statusCode;
  }

  let toastContainer = document.getElementById("toast-container");
  if (!toastContainer) {
    toastContainer = el("div", { id: "toast-container", className: "toast-container" });
    document.body.appendChild(toastContainer);
  }

  let displayMessage = message;
  if (toastType === "error") {
    if (status) {
      displayMessage = `[${status}] ${message}`;
    }
  }

  const toastItem = el(
    "div",
    { className: `toast toast-${toastType}` },
    el("div", { className: "toast-content" },
      el("span", { className: "toast-icon", text: toastType === "success" ? "✓" : "✕" }),
      el("span", { className: "toast-text", text: displayMessage })
    ),
    el("button", {
      className: "toast-close",
      type: "button",
      title: "Close",
      text: "×",
      onclick: () => removeToast(toastItem),
    })
  );

  function removeToast(node) {
    if (!node.classList.contains("toast-closing")) {
      node.classList.add("toast-closing");
      setTimeout(() => {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }, 300);
    }
  }

  toastContainer.appendChild(toastItem);

  // Auto-remove after 4.5 seconds
  setTimeout(() => {
    removeToast(toastItem);
  }, 4500);
}

/**
 * Money formatting helper: NGN with thousands separators.
 * Example: 7500 -> "NGN 7,500.00"
 */
export function formatMoney(amount) {
  if (amount === null || amount === undefined || amount === "" || isNaN(Number(amount))) {
    return "NGN 0.00";
  }
  const num = Number(amount);
  return "NGN " + num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format a UTC time string for display in the viewer's local time
 * with the full UTC value in a tooltip (HTML title attribute).
 * Returns a <time> DOM element.
 */
export function formatUtcTime(utcString, options = {}) {
  const timeEl = document.createElement("time");
  timeEl.className = options.className || "utc-time-display";

  if (!utcString) {
    timeEl.textContent = "—";
    return timeEl;
  }

  const date = new Date(utcString);
  if (isNaN(date.getTime())) {
    timeEl.textContent = String(utcString);
    return timeEl;
  }

  const isoUtc = date.toISOString();
  timeEl.setAttribute("datetime", isoUtc);
  timeEl.setAttribute("title", `UTC: ${isoUtc}`);

  const localFormatted = date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...(options.formatOptions || {}),
  });

  timeEl.textContent = localFormatted;
  return timeEl;
}

/**
 * Helper to get local and UTC strings.
 */
export function formatUtcTimeString(utcString) {
  if (!utcString) return { local: "—", utc: "" };
  const date = new Date(utcString);
  if (isNaN(date.getTime())) return { local: String(utcString), utc: String(utcString) };
  return {
    local: date.toLocaleString(),
    utc: date.toISOString(),
  };
}

/**
 * Countdown helper that updates every second and stops when its element is removed from DOM.
 * @param {string|Date|number} targetDate Target UTC time or date
 * @param {HTMLElement} element DOM element whose textContent is updated
 * @param {Function} [onComplete] Callback invoked when countdown expires
 * @returns {Function} Stop function to cancel the countdown manually
 */
export function startCountdown(targetDate, element, onComplete) {
  if (!element || !targetDate) return () => {};

  const targetTime = (targetDate instanceof Date ? targetDate : new Date(targetDate)).getTime();
  if (isNaN(targetTime)) return () => {};

  let timerId = null;
  let isStopped = false;
  let hasBeenConnected = false;

  function stop() {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    isStopped = true;
  }

  function update() {
    if (isStopped) return;

    // Automatically stop when element is removed from DOM after being attached
    if (element.isConnected) {
      hasBeenConnected = true;
    } else if (hasBeenConnected) {
      stop();
      return;
    }

    const remainingMs = targetTime - Date.now();
    if (remainingMs <= 0) {
      element.textContent = "00:00";
      stop();
      if (typeof onComplete === "function") {
        queueMicrotask(() => {
          try {
            onComplete();
          } catch (err) {
            console.error("Error in countdown onComplete callback:", err);
          }
        });
      }
      return;
    }

    const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    const formatted = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    element.textContent = formatted;
  }

  // Assign interval before initial update so stop() is always safe to call
  timerId = setInterval(update, 1000);
  update();

  return stop;
}
