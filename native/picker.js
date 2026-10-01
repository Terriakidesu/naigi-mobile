// Server picker screen. Runs before sign-in, inside the app shell.
import { naigiMobile } from "./mobile.js";
import { normalizeServerOrigin } from "./servers.js";

const form = document.getElementById("picker-form");
const address = document.getElementById("picker-address");
const status = document.getElementById("picker-status");
const saved = document.getElementById("picker-saved");
const list = document.getElementById("picker-list");
const clear = document.getElementById("picker-clear");

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("is-error", error);
}

/** Turns a verification failure into guidance instead of a dead end. */
function verificationMessage(error) {
  switch (error?.code) {
    case "dns_failed":
      return "Could not find that server. If it is a local name, make this phone use your local DNS server (for example your Pi-hole) in the Wi-Fi settings.";
    case "tls_failed":
      return "The server's certificate is not trusted. Install its CA certificate in Android Settings, under Security and privacy.";
    case "connect_failed":
      return "Could not reach that server. Check that it is online and reachable from this network.";
    case "not_a_naigi_server":
      return "That address did not answer like a Naigi server.";
    case "invalid_naigi_origin":
      return "Enter only the server origin, without a path.";
    default:
      return error instanceof Error ? error.message : "Could not connect.";
  }
}

function icon(name) {
  const path = {
    server: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
    trash: "M18 6 6 18M6 6l12 12",
  }[name] ?? "";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "naigi-picker-icon");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2");
  svg.append(p);
  return svg;
}

function render() {
  const { servers, active } = naigiMobile.servers.list();
  list.replaceChildren();
  saved.hidden = servers.length === 0;
  for (const server of servers) {
    const item = document.createElement("li");
    item.className = `naigi-picker-item${server.origin === active ? " is-active" : ""}`;

    const use = document.createElement("button");
    use.type = "button";
    use.className = "naigi-picker-use";
    use.append(icon("server"));
    const copy = document.createElement("span");
    copy.className = "naigi-picker-copy";
    const name = document.createElement("strong");
    name.textContent = server.name || server.origin;
    const addressLine = document.createElement("small");
    addressLine.textContent = server.origin;
    copy.append(name, addressLine);
    use.append(copy);
    use.addEventListener("click", () => connect(server.origin, { reverify: true }));
    item.append(use);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "naigi-picker-remove";
    remove.title = `Remove ${server.origin}`;
    remove.setAttribute("aria-label", `Remove ${server.origin}`);
    remove.append(icon("trash"));
    remove.addEventListener("click", () => {
      naigiMobile.servers.remove(server.origin);
      render();
      setStatus(`Removed ${server.origin}.`);
    });
    item.append(remove);

    list.append(item);
  }
}

async function connect(value, options = {}) {
  let origin;
  try {
    origin = normalizeServerOrigin(value);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Invalid address.", true);
    return false;
  }
  setStatus(options.reverify ? `Checking ${origin}…` : `Connecting to ${origin}…`);
  try {
    if (options.reverify) await naigiMobile.servers.verify(origin);
    naigiMobile.servers.add(origin);
  } catch (error) {
    setStatus(verificationMessage(error), true);
    return false;
  }
  setStatus("Connected. Opening Naigi…");
  window.location.replace("/index.html");
  return true;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  void connect(address.value);
});
clear.addEventListener("click", () => {
  naigiMobile.servers.clear();
  render();
  setStatus("All saved servers removed.");
});

render();
if (naigiMobile.hasServer()) {
  setStatus("A server is already selected.");
}
