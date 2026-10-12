// ABOUTME: Runs temporary account-restricted conversations in the browser.
// ABOUTME: Renders messages as text and clears the transcript when access ends.
import qrcode from "qrcode-generator";
const $ = (id) => document.getElementById(id);
let identity,
  recipient,
  room,
  cursor = 0,
  polling = false,
  pending,
  generation = 0;
const id = /^\/r\/([A-Za-z0-9_-]{22})$/.exec(location.pathname)?.[1];
const status = (message, error = false) => {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
  $("retry").hidden = true;
};

async function api(path, method = "GET", value) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", "X-Kant-Request": "1" },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error || "Request failed"), {
      status: response.status,
    });
  return data;
}
function clearRoom() {
  generation++;
  room = undefined;
  cursor = 0;
  pending = undefined;
  $("messages").replaceChildren();
  $("message").value = "";
  $("conversation").hidden = true;
  $("room-link").value = "";
  $("members").textContent = "";
  $("qr").removeAttribute("src");
}
function signedOut() {
  clearRoom();
  identity = undefined;
  $("create").hidden = true;
  $("login").hidden = false;
  $("logout").hidden = true;
  $("account").textContent = "";
  $("signin").href =
    "/auth/login?returnTo=" + encodeURIComponent(id ? "/r/" + id : "/");
}
function failure(error) {
  if (error.status === 401) signedOut();
  if (error.status === 404) clearRoom();
  status(error.message || "Connection interrupted; please retry.", true);
  $("retry").hidden = !!error.status && error.status < 500;
}
async function action(button, run) {
  button.disabled = true;
  try {
    await run();
  } catch (error) {
    failure(error);
  } finally {
    button.disabled = false;
  }
}
function tick() {
  if (!room) return;
  const remaining = room.expiresAt - Date.now();
  if (remaining <= 0) {
    clearRoom();
    status("Room unavailable or expired", true);
    return;
  }
  const seconds = Math.ceil(remaining / 1000);
  $("countdown").textContent =
    `Ends in ${Math.floor(seconds / 3600)}h ${Math.floor(seconds / 60) % 60}m ${seconds % 60}s`;
}
function showRoom(value) {
  room = value;
  $("conversation").hidden = false;
  $("create").hidden = true;
  $("close").hidden = room.owner !== identity.did;
  $("deadline").textContent =
    "Expires " + new Date(room.expiresAt).toLocaleString();
  $("members").textContent = room.owner + " ↔ " + room.recipient;
  $("room-link").value = location.origin + "/r/" + id;
  const qr = qrcode(0, "M");
  qr.addData($("room-link").value);
  qr.make();
  $("qr").src = qr.createDataURL(4, 4);
  tick();
}
function append(message) {
  const article = document.createElement("article");
  article.classList.toggle("mine", message.sender === identity.did);
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const sender = document.createElement("strong");
  sender.textContent =
    message.sender === identity.did ? "You" : "Other participant";
  sender.title = message.sender;
  const time = document.createElement("time");
  time.dateTime = new Date(message.sentAt).toISOString();
  time.textContent = new Date(message.sentAt).toLocaleTimeString();
  const copy = document.createElement("button");
  copy.textContent = "Copy message";
  copy.onclick = () =>
    action(copy, async () => {
      await navigator.clipboard.writeText(message.text);
      status("Message copied.");
    });
  meta.append(sender, time, copy);
  const text = document.createElement("pre");
  text.textContent = message.text;
  article.append(meta, text);
  $("messages").append(article);
}
async function poll() {
  if (!id || !identity || polling) return;
  polling = true;
  const current = generation;
  try {
    const value = await api(`/rooms/${id}?after=${cursor}`);
    if (!identity || current !== generation) return;
    if (!room) showRoom(value.room);
    if (Date.now() >= value.room.expiresAt) {
      clearRoom();
      status("Room unavailable or expired", true);
      return;
    }
    for (const message of value.messages) append(message);
    cursor = value.cursor;
  } catch (error) {
    failure(error);
  } finally {
    polling = false;
  }
}
async function boot() {
  try {
    const value = await api("/session");
    if (!value.authenticated) {
      signedOut();
      status(
        id
          ? "Sign in to open this invitation."
          : "Your next conversation starts here.",
      );
      return;
    }
    identity = value;
    $("account").textContent = value.handle;
    $("logout").hidden = false;
    $("login").hidden = true;
    $("create").hidden = !!id;
    status(id ? "Opening room…" : "Choose the account you want to talk to.");
    if (id) {
      await poll();
      if (room) status("Connected. Messages expire with the room.");
    }
  } catch (error) {
    failure(error);
  }
}
$("recipient").addEventListener("input", () => {
  recipient = undefined;
  $("verified").hidden = true;
});
$("recipient-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const handle = $("recipient").value.trim();
  action(event.submitter, async () => {
    const resolved = await api("/resolve?handle=" + encodeURIComponent(handle));
    if ($("recipient").value.trim() !== handle) return;
    if (resolved.did === identity.did)
      throw new Error("Choose another account.");
    recipient = resolved;
    $("recipient-handle").textContent = resolved.handle;
    $("recipient-did").textContent = resolved.did;
    $("verified").hidden = false;
    status("Check the account above, then choose when the conversation ends.");
  });
});
$("create-form").addEventListener("submit", (event) => {
  event.preventDefault();
  action(event.submitter, async () => {
    if (!recipient) throw new Error("Check the recipient first.");
    const value = await api("/rooms", "POST", {
      recipient: recipient.did,
      lifetime: Number($("lifetime").value),
    });
    location.assign("/r/" + value.id);
  });
});
$("message-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = $("message").value;
  action(event.submitter, async () => {
    if (!room || Date.now() >= room.expiresAt)
      throw new Error("Room unavailable or expired");
    if (!pending || pending.text !== text)
      pending = { text, requestId: crypto.randomUUID() };
    await api(`/rooms/${id}/messages`, "POST", pending);
    pending = undefined;
    if ($("message").value === text) $("message").value = "";
    status("Message sent.");
    await poll();
  });
});
$("copy-link").onclick = (event) =>
  action(event.currentTarget, async () => {
    await navigator.clipboard.writeText($("room-link").value);
    status("Room link copied. Only the selected accounts can join.");
  });
$("close").onclick = (event) =>
  action(event.currentTarget, async () => {
    await api(`/rooms/${id}`, "DELETE", {});
    clearRoom();
    status("Room closed. Its stored messages have been deleted.");
  });
$("logout").onclick = (event) =>
  action(event.currentTarget, async () => {
    await api("/logout", "POST", {});
    signedOut();
    status("Signed out.");
  });
$("retry").onclick = (event) => action(event.currentTarget, boot);
window.addEventListener("pagehide", () => {
  clearRoom();
  identity = undefined;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) boot();
});
setInterval(tick, 1000);
setInterval(() => {
  if (room && !document.hidden) poll();
}, 2000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    tick();
    if (room) poll();
  }
});
boot();
