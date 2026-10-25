// Vantera TMS desktop app: a window that opens your Vantera website.
// The website address is read from config.json (or typed in the first time the app starts).
const { app, BrowserWindow, Menu, shell, ipcMain, session } = require("electron");
const path = require("path");
const fs = require("fs");

app.setAppUserModelId("com.vantera.tms");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;

const userConfig = () => path.join(app.getPath("userData"), "config.json");

function readUrl() {
  try {
    const u = JSON.parse(fs.readFileSync(userConfig(), "utf8")).url;
    if (u) return u;
  } catch (e) { /* no saved address yet */ }
  try {
    const u = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8")).url;
    if (u && !u.includes("YOUR-SITE")) return u;
  } catch (e) { /* ignore */ }
  return null;
}

function normalize(input) {
  let u = String(input || "").trim();
  if (!u) throw new Error("Type your website address.");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  const parsed = new URL(u);
  return parsed.origin;
}

function siteOrigin() {
  const u = readUrl();
  try { return u ? new URL(u).origin : null; } catch (e) { return null; }
}

function showSetup() {
  if (win) win.loadFile(path.join(__dirname, "setup.html"));
}

function loadSite() {
  const url = readUrl();
  if (!url) return showSetup();
  win.loadURL(url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: "#0f1116",
    title: "Vantera TMS",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Links to other websites, phone numbers and email open outside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).origin === siteOrigin()) return { action: "allow" };
    } catch (e) { /* fall through */ }
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) return;
    try {
      if (new URL(url).origin === siteOrigin()) return;
    } catch (e) { /* fall through */ }
    event.preventDefault();
    shell.openExternal(url);
  });

  // No internet or the site is down: show a friendly page with a Retry button.
  win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 = cancelled
    win.loadFile(path.join(__dirname, "offline.html"));
  });

  loadSite();
}

app.whenReady().then(() => {
  // Only the Vantera site may use location and notifications.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
    let ok = false;
    try { ok = new URL(details.requestingUrl).origin === siteOrigin(); } catch (e) { ok = false; }
    callback(ok && ["geolocation", "notifications", "clipboard-sanitized-write"].includes(permission));
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "App", submenu: [
      { label: "Change website address…", click: () => showSetup() },
      { type: "separator" },
      { role: "quit" },
    ] },
    { label: "View", submenu: [
      { role: "reload" }, { role: "forceReload" }, { type: "separator" },
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" },
      { role: "togglefullscreen" },
    ] },
  ]));

  ipcMain.handle("save-url", (_e, input) => {
    try {
      const origin = normalize(input);
      fs.mkdirSync(path.dirname(userConfig()), { recursive: true });
      fs.writeFileSync(userConfig(), JSON.stringify({ url: origin }));
      win.loadURL(origin);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message || "That address does not look right." };
    }
  });
  ipcMain.handle("retry", () => loadSite());
  ipcMain.handle("change-url", () => showSetup());

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("second-instance", () => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on("window-all-closed", () => app.quit());
