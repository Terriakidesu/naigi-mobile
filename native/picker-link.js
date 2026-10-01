// A phone user who picked the wrong server must be able to leave sign-in and
// choose again. The shared pages cannot link to the picker, so this adds a way
// back on both entry pages.
import { naigiMobile } from "./mobile.js";

const { active } = naigiMobile.servers.list();
if (!active) location.replace("/picker.html");

const status = document.getElementById("auth-status") ?? document.getElementById("register-status");
const panel = status?.closest("main") ?? status?.parentElement;
if (!status || !panel) {
  // The entry page changed shape; fail visibly instead of silently trapping them.
  document.body.prepend(Object.assign(document.createElement("p"), {
    className: "naigi-picker-fallback",
    textContent: "Wrong server? Open the server list in the app menu.",
  }));
} else {
  const link = document.createElement("button");
  link.type = "button";
  link.className = "naigi-picker-change";
  const label = document.createElement("span");
  label.textContent = "Not your server?";
  const target = document.createElement("strong");
  target.textContent = active;
  link.append(label, target);
  link.addEventListener("click", () => location.assign("/picker.html"));
  status.after(link);
}
