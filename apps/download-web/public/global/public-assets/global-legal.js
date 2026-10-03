const apiBase = "/global/api/saydian-app/v2";
const allowedTags = new Set([
  "A",
  "B",
  "BLOCKQUOTE",
  "BR",
  "DIV",
  "EM",
  "H2",
  "H3",
  "H4",
  "I",
  "LI",
  "OL",
  "P",
  "S",
  "SPAN",
  "STRONG",
  "U",
  "UL",
]);

function apiData(response) {
  return response.json().then((body) => {
    if (!response.ok || (body?.code && body.code !== 200)) {
      throw new Error(
        body?.message || "The published document is temporarily unavailable.",
      );
    }
    return body?.data ?? body;
  });
}

function safeHtml(value) {
  const parsed = new DOMParser().parseFromString(
    String(value ?? ""),
    "text/html",
  );
  const clean = (parent) => {
    [...parent.childNodes].forEach((node) => {
      if (node.nodeType === Node.COMMENT_NODE) return node.remove();
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node;
      if (
        [
          "SCRIPT",
          "STYLE",
          "IFRAME",
          "OBJECT",
          "EMBED",
          "SVG",
          "MATH",
        ].includes(element.tagName)
      )
        return element.remove();
      if (!allowedTags.has(element.tagName)) {
        clean(element);
        element.replaceWith(...element.childNodes);
        return;
      }
      const href =
        element.tagName === "A"
          ? (element.getAttribute("href")?.trim() ?? "")
          : "";
      [...element.attributes].forEach((attribute) =>
        element.removeAttribute(attribute.name),
      );
      if (
        element.tagName === "A" &&
        /^(https:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href)
      ) {
        element.setAttribute("href", href);
        element.setAttribute("rel", "noopener noreferrer");
      }
      clean(element);
    });
  };
  clean(parsed.body);
  return parsed.body.innerHTML;
}

async function loadDocument() {
  const root = document.querySelector("[data-legal-document]");
  const type = root?.dataset.legalDocument;
  const key = type === "privacyPolicy" ? "privacyPolicy" : "userAgreement";
  const fallbackTitle =
    key === "privacyPolicy" ? "Privacy Notice" : "User Agreement";
  const status = document.querySelector("#page-status");
  try {
    const capabilities = await apiData(
      await fetch(`${apiBase}/auth/capabilities?locale=en`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    const reference = capabilities?.legal?.[key];
    if (!reference?.path || !reference.version)
      throw new Error("No current reviewed document is available.");
    const documentData = await apiData(
      await fetch(`/global${reference.path}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    document.querySelector("#page-title").textContent =
      documentData.title || fallbackTitle;
    document.title = `${documentData.title || fallbackTitle} · SAYDIAN Health`;
    document.querySelector("#document-meta").textContent =
      `Version ${documentData.version} · ${documentData.locale}`;
    document.querySelector("#document-content").innerHTML = safeHtml(
      documentData.contentHtml,
    );
    status.hidden = true;
  } catch (error) {
    status.textContent =
      error instanceof Error
        ? error.message
        : "The published document is temporarily unavailable.";
    status.classList.add("error");
  }
}

void loadDocument();
