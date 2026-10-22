
"use strict";

// LOGIN CONFIGURATION
// Client-side credentials are suitable for a demo only.
const VALID_USERNAME = "capstone";
const VALID_PASSWORD = "admin";

const loginPage = document.getElementById("loginPage");
const dashboard = document.getElementById("dashboard");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const logoutBtn = document.getElementById("logoutBtn");

const connectBtn = document.getElementById("connectBtn");
const statusDot = document.getElementById("statusDot");
const logEl = document.getElementById("log");

const btnManual = document.getElementById("btnManual");
const btnAuto = document.getElementById("btnAuto");

const teleMode = document.getElementById("teleMode");
const teleScan = document.getElementById("teleScan");
const teleAction = document.getElementById("teleAction");

let port = null;
let writer = null;
let reader = null;
let keepReading = false;
let connected = false;
let loggedIn = false;
let connectionTask = null;

// LOGIN
loginForm.addEventListener("submit", function (event) {
  event.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;

  if (
    username === VALID_USERNAME &&
    password === VALID_PASSWORD
  ) {
    loggedIn = true;
    loginError.textContent = "";
    loginPage.hidden = true;
    dashboard.hidden = false;
    loginForm.reset();

    log("Login successful. Welcome to Navjivan RC Bay.", "sys");
  } else {
    loginError.textContent = "Invalid username or password.";
  }
});

logoutBtn.addEventListener("click", async function () {
  // Stop/disconnect before hiding the controls.
  if (connected || port || connectionTask) {
    await disconnect();
  }

  loggedIn = false;
  dashboard.hidden = true;
  loginPage.hidden = false;
  loginForm.reset();
  loginError.textContent = "";
});

// SERIAL MONITOR
function log(message, cls = "sys") {
  const line = document.createElement("div");
  line.className = cls;
  line.textContent = message;

  logEl.appendChild(line);

  while (logEl.childNodes.length > 200) {
    logEl.removeChild(logEl.firstChild);
  }

  logEl.scrollTop = logEl.scrollHeight;
}

function setLinked(isLinked) {
  connected = isLinked;
  statusDot.classList.toggle("linked", isLinked);
  connectBtn.classList.toggle("linked", isLinked);
  connectBtn.textContent = isLinked
    ? "Disconnect"
    : "Connect Serial Port";
}

function showMode(isAuto) {
  btnAuto.classList.toggle("active", isAuto);
  btnManual.classList.toggle("active", !isAuto);

  teleMode.textContent = isAuto ? "Obstacle" : "Manual";
  teleMode.classList.toggle("auto", isAuto);
}

function resetStatus() {
  teleMode.textContent = "--";
  teleMode.classList.remove("auto");

  teleScan.textContent = "-- / --";

  teleAction.textContent = "--";
  teleAction.classList.remove("alert");
}

// HANDLE MESSAGES FROM THE CAR
function handleCarLine(line) {
  if (line === "MODE:AUTO") {
    showMode(true);
  } else if (line === "MODE:MANUAL" || line === "READY") {
    showMode(false);
  } else if (line.startsWith("BLOCKED")) {
    const match = line.match(/d=(\d+)/);

    teleAction.textContent = match
      ? "Blocked at " + match[1] + " cm"
      : "Blocked";

    teleAction.classList.add("alert");
  } else if (line.startsWith("SCAN")) {
    const match = line.match(/L=(\d+)\s+R=(\d+)/);

    if (match) {
      teleScan.textContent = match[1] + " / " + match[2];
    }
  } else if (line.startsWith("TURN")) {
    teleAction.textContent = "Turn " + line.slice(5).toLowerCase();
    teleAction.classList.remove("alert");
  }
}

// CONNECT TO THE SERIAL PORT
async function connect() {
  if (!loggedIn) return;

  if (!("serial" in navigator)) {
    log(
      "Web Serial unavailable. Use Chrome or Edge on a supported computer.",
      "sys"
    );
    return;
  }

  if (connectionTask) return;

  connectionTask = (async function () {
    try {
      const selectedPort = await navigator.serial.requestPort();

      if (!loggedIn) return;

      await selectedPort.open({ baudRate: 9600 });

      if (!loggedIn) {
        await selectedPort.close();
        return;
      }

      port = selectedPort;
      setLinked(true);

      log("Serial port open at 9600 baud.", "sys");

      // Start reading and retain the task for clean shutdown.
      const task = readLoop(selectedPort);
      connectionTask = task;

      await task;
    } catch (error) {
      log("Connection failed: " + error.message, "sys");
    } finally {
      if (port && !connected) {
        try {
          await port.close();
        } catch (_) {}
        port = null;
      }

      connectionTask = null;
    }
  })();

  await connectionTask;
}

// READ SERIAL DATA
async function readLoop(activePort) {
  const decoder = new TextDecoderStream();
  const inputDone = activePort.readable.pipeTo(decoder.writable);

  reader = decoder.readable.getReader();
  keepReading = true;

  let buffer = "";

  try {
    while (keepReading) {
      const { value, done } = await reader.read();

      if (done) break;

      if (value) {
        buffer += value;

        let index;

        while ((index = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, index).trim();
          buffer = buffer.slice(index + 1);

          if (line) {
            log(line, "rx");
            handleCarLine(line);
          }
        }
      }
    }
  } catch (error) {
    if (keepReading) {
      log("Read stopped: " + error.message, "sys");
    }
  } finally {
    keepReading = false;

    if (reader) {
      try {
        reader.releaseLock();
      } catch (_) {}
      reader = null;
    }

    try {
      await inputDone;
    } catch (_) {}

    if (port === activePort) {
      setLinked(false);
      resetStatus();
    }
  }
}

// SEND COMMANDS
async function sendCmd(command) {
  if (!loggedIn) return;

  if (!writer) {
    log("Not connected yet.", "sys");
    return;
  }

  try {
    await writer.write(new TextEncoder().encode(command));
    log(command, "tx");
  } catch (error) {
    log("Send failed: " + error.message, "sys");
  }
}

// DISCONNECT SAFELY
async function disconnect() {
  keepReading = false;

  const activePort = port;
  const activeWriter = writer;
  const activeReader = reader;

  // Ask the car to stop and return to manual mode.
  if (activeWriter) {
    try {
      await activeWriter.write(new TextEncoder().encode("S"));
      await activeWriter.write(new TextEncoder().encode("w"));
    } catch (_) {}
  }

  if (activeReader) {
    try {
      await activeReader.cancel();
    } catch (_) {}
  }

  if (activeWriter) {
    try {
      activeWriter.releaseLock();
    } catch (_) {}
  }

  writer = null;
  reader = null;

  if (activePort) {
    try {
      await activePort.close();
    } catch (error) {
      log("Port close: " + error.message, "sys");
    }
  }

  port = null;
  setLinked(false);
  resetStatus();

  log("Serial port disconnected.", "sys");
}

// CONNECT / DISCONNECT BUTTON
connectBtn.addEventListener("click", async function () {
  if (connected) {
    await disconnect();
  } else {
    await connect();
  }
});

// DRIVE CONTROLS
document.querySelectorAll(".pad-btn[data-cmd]").forEach(function (button) {
  button.addEventListener("click", async function () {
    if (!loggedIn) return;

    const command = button.dataset.cmd;
    await sendCmd(command);
  });
});

// MANUAL / OBSTACLE MODE
function setMode(mode) {
  if (!loggedIn) return;

  const isAuto = mode === "auto";
  showMode(isAuto);

  // Preserves the original command protocol:
  // W = obstacle mode, w = manual mode.
  sendCmd(isAuto ? "W" : "w");
}

btnManual.addEventListener("click", function () {
  setMode("manual");
});

btnAuto.addEventListener("click", function () {
  setMode("auto");
});

// ATTEMPT A SAFE DISCONNECT WHEN LEAVING THE PAGE
window.addEventListener("pagehide", function () {
  if (writer) {
    // Browsers may terminate the page before asynchronous cleanup finishes.
    // Use the STOP button before closing the page for dependable stopping.
    writer.write(new TextEncoder().encode("S")).catch(function () {});
  }
});
