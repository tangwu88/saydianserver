async function loadSupport() {
  const status = document.querySelector("#page-status");
  try {
    const response = await fetch("/global/api/saydian-app/v2/support/config", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    const body = await response.json();
    if (!response.ok || (body?.code && body.code !== 200))
      throw new Error(
        body?.message || "Support channels are temporarily unavailable.",
      );
    const config = body?.data ?? body;
    if (!config?.configured)
      throw new Error(
        config?.message ||
          "Support contact details have not been published yet.",
      );
    if (config.phone) {
      const phone = String(config.phone).trim();
      if (!/^\+?[0-9][0-9 -]{4,20}$/.test(phone))
        throw new Error(
          "Published support contact is temporarily unavailable.",
        );
      const link = document.querySelector("#support-phone");
      link.href = `tel:${phone.replace(/[ -]/g, "")}`;
      link.textContent = phone;
      document.querySelector("#support-phone-row").hidden = false;
    }
    if (config.officialAccount) {
      document.querySelector("#support-account").textContent = String(
        config.officialAccount,
      ).slice(0, 64);
      document.querySelector("#support-account-row").hidden = false;
    }
    if (config.serviceHours) {
      document.querySelector("#support-hours").textContent = String(
        config.serviceHours,
      ).slice(0, 120);
      document.querySelector("#support-hours-row").hidden = false;
    }
    document.querySelector("#support-message").textContent = String(
      config.message ?? "",
    );
    document.querySelector("#support-details").hidden = false;
    status.hidden = true;
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : "Support channels are temporarily unavailable.";
    status.classList.add("error");
  }
}

void loadSupport();
