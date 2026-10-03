const apiBase = "/global/api/saydian-app/v2";
const mallAuthBase = "/global/api/saidian-mall/v1/auth";
let consentVersion = "";
let accessToken = "";
let activeMethod = "password";
let smsLoginAvailable = false;
let challengeId = "";
let requestTimer = 0;

function apiData(response) {
  return response.json().then((body) => {
    if (!response.ok || (body?.code && body.code !== 200)) {
      throw new Error(
        body?.message ||
          body?.error?.message ||
          "The request could not be completed.",
      );
    }
    return body?.data ?? body;
  });
}

function showError(selector, error) {
  const element = document.querySelector(selector);
  element.textContent =
    error instanceof Error
      ? error.message
      : "The request could not be completed. Please try again.";
  element.hidden = false;
}

function clearError(selector) {
  const element = document.querySelector(selector);
  element.hidden = true;
  element.textContent = "";
}

function tokenFrom(session) {
  return String(session?.accessToken ?? session?.token ?? "");
}

async function loadCapabilities() {
  const status = document.querySelector("#page-status");
  const loginPanel = document.querySelector("#login-panel");
  const smsButton = document.querySelector('[data-method="sms"]');
  try {
    const capabilities = await apiData(
      await fetch(`${apiBase}/auth/capabilities?locale=en`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    consentVersion = String(capabilities?.consentVersion ?? "");
    smsLoginAvailable =
      capabilities?.login?.sms === true && Boolean(consentVersion);
    smsButton.hidden = !smsLoginAvailable;
    loginPanel.hidden = false;
    status.hidden = true;
  } catch (error) {
    smsLoginAvailable = false;
    smsButton.hidden = true;
    loginPanel.hidden = false;
    status.textContent =
      "Code sign-in is temporarily unavailable. You can still try your password or contact support.";
    status.classList.add("error");
  }
}

async function passwordLogin(event) {
  event.preventDefault();
  clearError("#login-error");
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const identifier = String(form.elements.identifier.value).trim();
  const password = String(form.elements.password.value);
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const session = await apiData(
      await fetch(`${apiBase}/auth/login`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          identifier,
          channel: identifier.includes("@") ? "email" : "sms",
          password,
          locale: "en",
        }),
      }),
    );
    acceptSession(session);
  } catch (error) {
    showError("#login-error", error);
  } finally {
    form.elements.password.value = "";
    button.disabled = false;
  }
}

async function requestSmsCode() {
  clearError("#login-error");
  if (!smsLoginAvailable)
    return showError(
      "#login-error",
      new Error("SMS code sign-in is currently unavailable."),
    );
  const identifier = String(
    document.querySelector("#sms-identifier").value,
  ).trim();
  if (
    !identifier ||
    !document.querySelector("#sms-identifier").reportValidity()
  )
    return;
  const button = document.querySelector("#request-code");
  button.disabled = true;
  try {
    const result = await apiData(
      await fetch(`${mallAuthBase}/code/request`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          channel: "sms",
          identifier,
          locale: "en",
          product: "saydian-global",
        }),
      }),
    );
    challengeId = String(result.challengeId ?? "");
    if (!challengeId)
      throw new Error(
        "The code could not be requested. Try signing in with your password or contact support.",
      );
    button.textContent = `Code sent · ${Number(result.retryAfter) || 60}s`;
    let seconds = Number(result.retryAfter) || 60;
    requestTimer = window.setInterval(() => {
      seconds -= 1;
      if (seconds <= 0) {
        window.clearInterval(requestTimer);
        button.disabled = false;
        button.textContent = "Send code";
      } else button.textContent = `Code sent · ${seconds}s`;
    }, 1000);
  } catch (error) {
    button.disabled = false;
    showError("#login-error", error);
  }
}

async function smsLogin(event) {
  event.preventDefault();
  clearError("#login-error");
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const identifier = String(form.elements.identifier.value).trim();
  const code = String(form.elements.code.value).trim();
  const consentAccepted = document.querySelector("#sms-consent").checked;
  if (!challengeId)
    return showError(
      "#login-error",
      new Error("Request a verification code first."),
    );
  if (!consentAccepted)
    return showError(
      "#login-error",
      new Error(
        "Read and agree to the current User Agreement and Privacy Notice to sign in with a code.",
      ),
    );
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const session = await apiData(
      await fetch(`${mallAuthBase}/code/login`, {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          channel: "sms",
          identifier,
          challengeId,
          code,
          consentVersion,
          locale: "en",
          product: "saydian-global",
        }),
      }),
    );
    acceptSession(session);
  } catch (error) {
    showError("#login-error", error);
  } finally {
    form.elements.code.value = "";
    button.disabled = false;
  }
}

function acceptSession(session) {
  accessToken = tokenFrom(session);
  if (!accessToken)
    throw new Error(
      "Sign-in succeeded without a usable session. Please contact support.",
    );
  document.querySelector("#login-panel").hidden = true;
  document.querySelector("#request-panel").hidden = false;
}

async function submitDeletion() {
  clearError("#delete-error");
  if (!accessToken)
    return showError("#delete-error", new Error("Sign in again to continue."));
  if (!document.querySelector("#delete-confirm").checked)
    return showError(
      "#delete-error",
      new Error("Confirm that you want to submit this deletion request."),
    );
  const button = document.querySelector("#submit-deletion");
  button.disabled = true;
  try {
    const result = await apiData(
      await fetch(`${apiBase}/auth/delete-account`, {
        method: "POST",
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }),
    );
    const executeAfter = new Date(result.executeAfter);
    document.querySelector("#success-message").textContent = Number.isFinite(
      executeAfter.valueOf(),
    )
      ? `Account access and push notifications are now disabled. Processing is scheduled no earlier than ${new Intl.DateTimeFormat("en", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" }).format(executeAfter)} UTC.`
      : "Your request was received. Account access and push notifications are now disabled. Contact support if you need the processing date.";
    accessToken = "";
    document.querySelector("#request-panel").hidden = true;
    document.querySelector("#success-panel").hidden = false;
  } catch (error) {
    showError("#delete-error", error);
  } finally {
    button.disabled = false;
  }
}

async function cancelSession() {
  if (accessToken) {
    await fetch(`${apiBase}/auth/logout`, {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }).catch(() => undefined);
  }
  accessToken = "";
  document.querySelector("#request-panel").hidden = true;
  document.querySelector("#login-panel").hidden = false;
  document.querySelector("#delete-confirm").checked = false;
}

document.querySelectorAll("[data-method]").forEach((button) =>
  button.addEventListener("click", () => {
    activeMethod = button.dataset.method;
    document
      .querySelectorAll("[data-method]")
      .forEach((item) =>
        item.setAttribute("aria-selected", String(item === button)),
      );
    document.querySelector("#password-form").hidden =
      activeMethod !== "password";
    document.querySelector("#sms-form").hidden = activeMethod !== "sms";
    clearError("#login-error");
  }),
);
document
  .querySelector("#password-form")
  .addEventListener("submit", passwordLogin);
document.querySelector("#sms-form").addEventListener("submit", smsLogin);
document
  .querySelector("#request-code")
  .addEventListener("click", requestSmsCode);
document
  .querySelector("#submit-deletion")
  .addEventListener("click", submitDeletion);
document
  .querySelector("#cancel-session")
  .addEventListener("click", cancelSession);
void loadCapabilities();
