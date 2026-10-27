import { api, getApiLog, onApiCall } from "./api.js";
import { el, showToast } from "./ui.js";
import { renderPassengerScreen, stopPassengerTimers } from "./passenger.js";
import { renderDriverScreen } from "./driver.js";
import { renderAdminScreen } from "./admin.js";

/**
 * Seeded credentials for demo purposes.
 * Only rendered when ?demo=1 is in the URL.
 */
const DEMO_LOGINS = {
  admin: {
    email: "admin@example.com",
    password: "AdminPassword123!",
  },
  driver: {
    email: "driver1@example.com",
    password: "DriverPassword123!",
  },
  passenger: {
    email: "passenger1@example.com",
    password: "PassengerPassword123!",
  },
};

/**
 * Safely decode JWT payload from base64url.
 */
export function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
    const jsonStr = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

// Application State
let currentUser = null;
let activeAuthTab = "login"; // "login" | "register-passenger" | "register-driver"
let isApiLogExpanded = false;

/**
 * Initialize user session from sessionStorage.
 */
function initSession() {
  const token = sessionStorage.getItem("token");
  if (token) {
    const payload = decodeJwt(token);
    if (payload && payload.sub && payload.role) {
      currentUser = {
        sub: payload.sub,
        role: payload.role,
        email: sessionStorage.getItem("email") || "User",
      };
    } else {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("email");
      sessionStorage.removeItem("role");
      sessionStorage.removeItem("sub");
      currentUser = null;
    }
  }
}

/**
 * Log out handler.
 */
function handleLogout() {
  stopPassengerTimers();
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("email");
  sessionStorage.removeItem("role");
  sessionStorage.removeItem("sub");
  currentUser = null;
  showToast("Logged out successfully", "success");
  render();
}

/**
 * Render Header.
 */
function renderHeader() {
  const userArea = document.getElementById("header-user-area");
  const emailSpan = document.getElementById("header-email");
  const roleSpan = document.getElementById("header-role");
  const logoutBtn = document.getElementById("header-logout-btn");

  if (!userArea || !emailSpan || !roleSpan || !logoutBtn) return;

  if (currentUser) {
    userArea.style.display = "flex";
    emailSpan.textContent = currentUser.email;
    roleSpan.textContent = currentUser.role;
    roleSpan.className = `badge badge-role badge-${currentUser.role.toLowerCase()}`;
    logoutBtn.onclick = handleLogout;
  } else {
    userArea.style.display = "none";
    emailSpan.textContent = "";
    roleSpan.textContent = "";
  }
}

/**
 * Render Main Screen.
 */
function renderMain() {
  const main = document.getElementById("main-content");
  if (!main) return;
  main.replaceChildren();

  if (currentUser) {
    if (currentUser.role === "PASSENGER") {
      renderPassengerScreen(main, currentUser);
      return;
    }
    if (currentUser.role === "DRIVER") {
      renderDriverScreen(main, currentUser);
      return;
    }

    if (currentUser.role === "ADMIN") {
      renderAdminScreen(main, currentUser);
      return;
    }
  } else {
    // Signed out auth screen
    const authCard = el("div", { className: "auth-card card" });

    // Tabs
    const tabsNav = el("div", { className: "tabs-nav", role: "tablist" });
    const tabs = [
      { id: "login", label: "Log in" },
      { id: "register-passenger", label: "Register as passenger" },
      { id: "register-driver", label: "Register as driver" },
    ];

    tabs.forEach((tab) => {
      const tabBtn = el("button", {
        className: `tab-btn ${activeAuthTab === tab.id ? "active" : ""}`,
        type: "button",
        role: "tab",
        text: tab.label,
        onclick: () => {
          activeAuthTab = tab.id;
          renderMain();
        },
      });
      tabsNav.appendChild(tabBtn);
    });

    authCard.appendChild(tabsNav);

    // Active tab content
    const tabContent = el("div", { className: "tab-content" });

    if (activeAuthTab === "login") {
      // Check ?demo=1 query parameter
      const urlParams = new URLSearchParams(window.location.search);
      const isDemo = urlParams.get("demo") === "1";

      if (isDemo) {
        const demoBar = el(
          "div",
          { className: "demo-shortcuts-bar" },
          el("span", { className: "demo-label", text: "Demo Fill:" }),
          el("button", {
            className: "btn btn-xs btn-demo",
            type: "button",
            text: "Fill admin",
            onclick: () => {
              const emailInput = document.getElementById("login-email");
              const passInput = document.getElementById("login-password");
              if (emailInput && passInput) {
                emailInput.value = DEMO_LOGINS.admin.email;
                passInput.value = DEMO_LOGINS.admin.password;
              }
            },
          }),
          el("button", {
            className: "btn btn-xs btn-demo",
            type: "button",
            text: "Fill driver",
            onclick: () => {
              const emailInput = document.getElementById("login-email");
              const passInput = document.getElementById("login-password");
              if (emailInput && passInput) {
                emailInput.value = DEMO_LOGINS.driver.email;
                passInput.value = DEMO_LOGINS.driver.password;
              }
            },
          }),
          el("button", {
            className: "btn btn-xs btn-demo",
            type: "button",
            text: "Fill passenger",
            onclick: () => {
              const emailInput = document.getElementById("login-email");
              const passInput = document.getElementById("login-password");
              if (emailInput && passInput) {
                emailInput.value = DEMO_LOGINS.passenger.email;
                passInput.value = DEMO_LOGINS.passenger.password;
              }
            },
          })
        );
        tabContent.appendChild(demoBar);
      }

      // Login form
      const emailInput = el("input", {
        id: "login-email",
        type: "email",
        className: "form-input",
        placeholder: "name@example.com",
        required: "true",
        autocomplete: "username",
      });

      const passInput = el("input", {
        id: "login-password",
        type: "password",
        className: "form-input",
        placeholder: "••••••••",
        required: "true",
        autocomplete: "current-password",
      });

      const submitBtn = el("button", {
        type: "submit",
        className: "btn btn-primary btn-block",
        text: "Log in",
      });

      const loginForm = el(
        "form",
        {
          className: "form-group-stack",
          onsubmit: async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passInput.value;
            if (!email || !password) return;

            submitBtn.disabled = true;
            submitBtn.textContent = "Logging in...";

            try {
              const { status, ok, data } = await api("POST", "/auth/login", { email, password });
              if (!ok) {
                const errorMsg = data?.error || "Invalid email or password";
                showToast(errorMsg, "error", status);
              } else {
                const { accessToken, role } = data;
                const decoded = decodeJwt(accessToken);
                const sub = decoded?.sub;
                const userRole = decoded?.role || role;

                sessionStorage.setItem("token", accessToken);
                sessionStorage.setItem("email", email);
                sessionStorage.setItem("role", userRole);
                if (sub) {
                  sessionStorage.setItem("sub", sub);
                }

                currentUser = {
                  email,
                  role: userRole,
                  sub,
                };

                showToast("Signed in successfully", "success");
                render();
              }
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = "Log in";
            }
          },
        },
        el("div", { className: "form-field" },
          el("label", { for: "login-email", className: "form-label", text: "Email address" }),
          emailInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "login-password", className: "form-label", text: "Password" }),
          passInput
        ),
        submitBtn
      );

      tabContent.appendChild(loginForm);
    } else if (activeAuthTab === "register-passenger") {
      // Register as passenger form
      const emailInput = el("input", {
        id: "reg-pass-email",
        type: "email",
        className: "form-input",
        placeholder: "ada.passenger@example.com",
        required: "true",
      });

      const passInput = el("input", {
        id: "reg-pass-password",
        type: "password",
        className: "form-input",
        placeholder: "At least 6 characters",
        required: "true",
        minlength: "6",
      });

      const nameInput = el("input", {
        id: "reg-pass-fullname",
        type: "text",
        className: "form-input",
        placeholder: "Ada Lovelace",
      });

      const phoneInput = el("input", {
        id: "reg-pass-phone",
        type: "tel",
        className: "form-input",
        placeholder: "+2348012345678",
      });

      const submitBtn = el("button", {
        type: "submit",
        className: "btn btn-primary btn-block",
        text: "Register as passenger",
      });

      const regForm = el(
        "form",
        {
          className: "form-group-stack",
          onsubmit: async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passInput.value;
            const fullName = nameInput.value.trim();
            const phone = phoneInput.value.trim();

            if (!email || !password) return;

            const body = { email, password };
            if (fullName) body.fullName = fullName;
            if (phone) body.phone = phone;

            submitBtn.disabled = true;
            submitBtn.textContent = "Registering...";

            try {
              const { status, ok, data } = await api("POST", "/auth/register/passenger", body);
              if (!ok) {
                const errorMsg = data?.error || "Registration failed";
                showToast(errorMsg, "error", status);
              } else {
                showToast("Passenger registered successfully! Please log in.", "success");
                activeAuthTab = "login";
                renderMain();
                const loginEmailInput = document.getElementById("login-email");
                if (loginEmailInput) {
                  loginEmailInput.value = email;
                }
              }
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = "Register as passenger";
            }
          },
        },
        el("div", { className: "form-field" },
          el("label", { for: "reg-pass-email", className: "form-label", text: "Email address *" }),
          emailInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-pass-password", className: "form-label", text: "Password (min 6 chars) *" }),
          passInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-pass-fullname", className: "form-label", text: "Full name (optional)" }),
          nameInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-pass-phone", className: "form-label", text: "Phone number (optional)" }),
          phoneInput
        ),
        submitBtn
      );

      tabContent.appendChild(regForm);
    } else if (activeAuthTab === "register-driver") {
      // Register as driver form
      const emailInput = el("input", {
        id: "reg-driver-email",
        type: "email",
        className: "form-input",
        placeholder: "kofi.driver@example.com",
        required: "true",
      });

      const passInput = el("input", {
        id: "reg-driver-password",
        type: "password",
        className: "form-input",
        placeholder: "At least 6 characters",
        required: "true",
        minlength: "6",
      });

      const nameInput = el("input", {
        id: "reg-driver-fullname",
        type: "text",
        className: "form-input",
        placeholder: "Kofi Mensah",
      });

      const phoneInput = el("input", {
        id: "reg-driver-phone",
        type: "tel",
        className: "form-input",
        placeholder: "+2348087654321",
      });

      const submitBtn = el("button", {
        type: "submit",
        className: "btn btn-primary btn-block",
        text: "Register as driver",
      });

      const regForm = el(
        "form",
        {
          className: "form-group-stack",
          onsubmit: async (e) => {
            e.preventDefault();
            const email = emailInput.value.trim();
            const password = passInput.value;
            const fullName = nameInput.value.trim();
            const phone = phoneInput.value.trim();

            if (!email || !password) return;

            const body = { email, password };
            if (fullName) body.fullName = fullName;
            if (phone) body.phone = phone;

            submitBtn.disabled = true;
            submitBtn.textContent = "Registering...";

            try {
              const { status, ok, data } = await api("POST", "/auth/register/driver", body);
              if (!ok) {
                const errorMsg = data?.error || "Registration failed";
                showToast(errorMsg, "error", status);
              } else {
                showToast("Driver registered successfully! Account pending admin verification. Please log in.", "success");
                activeAuthTab = "login";
                renderMain();
                const loginEmailInput = document.getElementById("login-email");
                if (loginEmailInput) {
                  loginEmailInput.value = email;
                }
              }
            } finally {
              submitBtn.disabled = false;
              submitBtn.textContent = "Register as driver";
            }
          },
        },
        el("div", { className: "form-field" },
          el("label", { for: "reg-driver-email", className: "form-label", text: "Email address *" }),
          emailInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-driver-password", className: "form-label", text: "Password (min 6 chars) *" }),
          passInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-driver-fullname", className: "form-label", text: "Full name (optional)" }),
          nameInput
        ),
        el("div", { className: "form-field" },
          el("label", { for: "reg-driver-phone", className: "form-label", text: "Phone number (optional)" }),
          phoneInput
        ),
        submitBtn
      );

      tabContent.appendChild(regForm);
    }

    authCard.appendChild(tabContent);
    main.appendChild(authCard);
  }
}

/**
 * Render the API log panel with last 30 calls newest first.
 */
function renderApiLog() {
  const countBadge = document.getElementById("api-log-count");
  const listContainer = document.getElementById("api-log-list");
  const toggleBtn = document.getElementById("api-log-toggle");
  const drawer = document.getElementById("api-log-drawer");

  const logs = getApiLog();
  if (countBadge) {
    countBadge.textContent = String(logs.length);
  }

  if (toggleBtn) {
    toggleBtn.textContent = isApiLogExpanded ? "▼ Collapse" : "▲ Expand";
  }

  if (drawer) {
    drawer.classList.toggle("collapsed", !isApiLogExpanded);
  }

  if (!listContainer) return;
  listContainer.replaceChildren();

  // Last 30 calls newest first
  const recentLogs = [...logs].reverse().slice(0, 30);

  if (recentLogs.length === 0) {
    listContainer.appendChild(
      el("div", { className: "api-log-empty", text: "No API calls recorded yet." })
    );
    return;
  }

  for (const call of recentLogs) {
    const isSuccess = call.status >= 200 && call.status < 300;
    const timeFormatted = new Date(call.time).toLocaleTimeString();

    const summary = el(
      "summary",
      { className: "api-log-summary" },
      el("span", {
        className: `badge badge-method badge-${call.method.toLowerCase()}`,
        text: call.method,
      }),
      el("span", {
        className: `badge badge-status ${isSuccess ? "status-ok" : "status-err"}`,
        text: String(call.status || "ERR"),
      }),
      el("span", { className: "api-log-path", text: call.path }),
      el("span", { className: "api-log-duration", text: `${call.duration}ms` }),
      el("span", { className: "api-log-time", text: timeFormatted })
    );

    const reqJson = call.requestBody !== null && call.requestBody !== undefined
      ? JSON.stringify(call.requestBody, null, 2)
      : "(no request body)";

    const resJson = call.responseBody !== null && call.responseBody !== undefined
      ? JSON.stringify(call.responseBody, null, 2)
      : "(empty response)";

    const detailsContent = el(
      "div",
      { className: "api-log-details" },
      el("div", { className: "api-log-section" },
        el("div", { className: "api-log-section-title", text: `Request Body (${call.method} ${call.path}):` }),
        el("pre", { className: "code-block", text: reqJson })
      ),
      el("div", { className: "api-log-section" },
        el("div", { className: "api-log-section-title", text: `Response Body (Status ${call.status}):` }),
        el("pre", { className: "code-block", text: resJson })
      )
    );

    const logItem = el("details", { className: "api-log-item" }, summary, detailsContent);
    listContainer.appendChild(logItem);
  }
}

/**
 * Setup API log toggle interactions.
 */
function setupApiLogDrawer() {
  const toggleBtn = document.getElementById("api-log-toggle");
  const header = document.getElementById("api-log-header");

  function toggle() {
    isApiLogExpanded = !isApiLogExpanded;
    renderApiLog();
  }

  if (toggleBtn) {
    toggleBtn.onclick = (e) => {
      e.stopPropagation();
      toggle();
    };
  }

  if (header) {
    header.onclick = () => {
      toggle();
    };
  }

  // Subscribe to new API calls
  onApiCall(() => {
    renderApiLog();
  });
}

/**
 * Full page re-render.
 */
export function render() {
  renderHeader();
  renderMain();
  renderApiLog();
}

/**
 * Bootstraps the application.
 */
function init() {
  initSession();
  setupApiLogDrawer();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
