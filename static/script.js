
"use strict";

/* =========================================
   NAVJIVAN RC BAY
   Frontend: JavaScript
   Backend: Python Flask
   Bluetooth: HC-05 / HC-06 via Web Serial
========================================= */

// -----------------------------------------
// 1. HTML ELEMENTS
// -----------------------------------------

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

// -----------------------------------------
// 2. APPLICATION STATE
// -----------------------------------------

let loggedIn = false;

let port = null;
let writer = null;
let reader = null;

let keepReading = false;
let connected = false;
let connectionTask = null;
let disconnecting = false;

// -----------------------------------------
// 3. SERIAL MONITOR LOG
// -----------------------------------------

function log(message, cls = "sys") {
    if (!logEl) return;

    const line = document.createElement("div");
    line.className = cls;
    line.textContent = message;

    logEl.appendChild(line);

    // Keep the last 200 messages only.
    while (logEl.childNodes.length > 200) {
        logEl.removeChild(logEl.firstChild);
    }

    logEl.scrollTop = logEl.scrollHeight;
}

// -----------------------------------------
// 4. SHOW LOGIN OR DASHBOARD
// -----------------------------------------

function showLogin() {
    loggedIn = false;

    loginPage.hidden = false;
    dashboard.hidden = true;

    if (loginError) {
        loginError.textContent = "";
    }

    if (loginForm) {
        loginForm.reset();
    }
}

function showDashboard() {
    loggedIn = true;

    loginPage.hidden = true;
    dashboard.hidden = false;

    log("Python authentication successful.", "sys");
}

// -----------------------------------------
// 5. CHECK PYTHON SESSION
// -----------------------------------------

async function checkLoginSession() {
    try {
        const response = await fetch("/api/session", {
            method: "GET",
            credentials: "same-origin"
        });

        if (!response.ok) {
            throw new Error("Unable to check login session.");
        }

        const data = await response.json();

        if (data.logged_in) {
            showDashboard();
        } else {
            showLogin();
        }
    } catch (error) {
        showLogin();

        if (loginError) {
            loginError.textContent =
                "Cannot connect to Python server. Start app.py and refresh.";
        }

        console.error("Session check failed:", error);
    }
}

// -----------------------------------------
// 6. LOGIN USING PYTHON FLASK
// -----------------------------------------

loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (loginError) {
        loginError.textContent = "";
    }

    const username =
        document.getElementById("username").value.trim();

    const password =
        document.getElementById("password").value;

    try {
        const response = await fetch("/api/login", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        });

        const data = await response.json();

        if (!response.ok || !data.success) {
            loginError.textContent =
                data.message || "Invalid username or password.";

            return;
        }

        showDashboard();

        loginForm.reset();
    } catch (error) {
        loginError.textContent =
            "Server connection failed. Please start the Flask server.";

        console.error("Login failed:", error);
    }
});

// -----------------------------------------
// 7. LOGOUT
// -----------------------------------------

logoutBtn.addEventListener("click", async function () {
    // Disconnect the RC car before hiding the dashboard.
    if (connected || port || connectionTask) {
        await disconnect();
    }

    try {
        const response = await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin"
        });

        if (!response.ok) {
            log("Server logout could not be confirmed.", "sys");
        }
    } catch (error) {
        console.error("Logout request failed:", error);
    }

    showLogin();
});

// -----------------------------------------
// 8. SERIAL CONNECTION STATUS
// -----------------------------------------

function setLinked(isLinked) {
    connected = isLinked;

    statusDot.classList.toggle("linked", isLinked);
    connectBtn.classList.toggle("linked", isLinked);

    connectBtn.textContent = isLinked
        ? "Disconnect"
        : "Connect Serial Port";
}

function resetStatus() {
    teleMode.textContent = "--";
    teleMode.classList.remove("auto");

    teleScan.textContent = "-- / --";

    teleAction.textContent = "--";
    teleAction.classList.remove("alert");

    btnManual.classList.add("active");
    btnAuto.classList.remove("active");
}

// -----------------------------------------
// 9. MODE DISPLAY
// -----------------------------------------

function showMode(isAuto) {
    btnAuto.classList.toggle("active", isAuto);
    btnManual.classList.toggle("active", !isAuto);

    teleMode.textContent = isAuto
        ? "Obstacle"
        : "Manual";

    teleMode.classList.toggle("auto", isAuto);
}

// -----------------------------------------
// 10. PROCESS MESSAGES FROM THE RC CAR
// -----------------------------------------

function handleCarLine(line) {
    if (line === "MODE:AUTO") {
        showMode(true);

    } else if (
        line === "MODE:MANUAL" ||
        line === "READY"
    ) {
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
            teleScan.textContent =
                match[1] + " / " + match[2];
        }

    } else if (line.startsWith("TURN")) {
        teleAction.textContent =
            "Turn " + line.slice(5).toLowerCase();

        teleAction.classList.remove("alert");
    }
}

// -----------------------------------------
// 11. CONNECT TO BLUETOOTH SERIAL PORT
// -----------------------------------------

async function connect() {
    if (!loggedIn) {
        log("Please log in first.", "sys");
        return;
    }

    if (!("serial" in navigator)) {
        log(
            "Web Serial is unavailable. Use Chrome or Edge on a supported computer.",
            "sys"
        );
        return;
    }

    if (connected || connectionTask || disconnecting) {
        return;
    }

    const task = (async function () {
        let selectedPort = null;
        let opened = false;

        try {
            // Browser will show the serial port selection dialog.
            selectedPort = await navigator.serial.requestPort();

            if (!loggedIn) {
                return;
            }

            await selectedPort.open({
                baudRate: 9600
            });

            opened = true;
            port = selectedPort;

            if (!selectedPort.writable) {
                throw new Error("Serial port is not writable.");
            }

            writer = selectedPort.writable.getWriter();

            setLinked(true);

            log("Serial port connected at 9600 baud.", "sys");

            // Start the reader and keep track of its task.
            await readLoop(selectedPort);

        } catch (error) {
            log(
                "Connection failed: " + error.message,
                "sys"
            );

        } finally {
            if (selectedPort && opened) {
                if (writer && port === selectedPort) {
                    try {
                        writer.releaseLock();
                    } catch (_) {}

                    writer = null;
                }

                try {
                    if (selectedPort.readable || selectedPort.writable) {
                        await selectedPort.close();
                    }
                } catch (error) {
                    console.error("Port cleanup error:", error);
                }
            }

            if (port === selectedPort) {
                port = null;
                writer = null;
                reader = null;

                setLinked(false);
                resetStatus();
            }
        }
    })();

    connectionTask = task;

    try {
        await task;
    } finally {
        if (connectionTask === task) {
            connectionTask = null;
        }
    }
}

// -----------------------------------------
// 12. READ DATA FROM THE RC CAR
// -----------------------------------------

async function readLoop(activePort) {
    if (!activePort.readable) {
        throw new Error("Serial port is not readable.");
    }

    const decoder = new TextDecoderStream();

    const inputDone = activePort.readable.pipeTo(
        decoder.writable
    );

    const activeReader = decoder.readable.getReader();
    reader = activeReader;

    keepReading = true;

    let buffer = "";

    try {
        while (keepReading && port === activePort) {
            const result = await activeReader.read();

            if (result.done) {
                break;
            }

            if (result.value) {
                buffer += result.value;

                let index;

                while ((index = buffer.indexOf("\n")) !== -1) {
                    const line = buffer
                        .slice(0, index)
                        .trim();

                    buffer = buffer.slice(index + 1);

                    if (line) {
                        log(line, "rx");
                        handleCarLine(line);
                    }
                }

                // Prevent unbounded buffering if firmware sends
                // data without newline characters.
                if (buffer.length > 4096) {
                    buffer = buffer.slice(-1024);
                }
            }
        }
    } catch (error) {
        if (keepReading) {
            log("Serial read error: " + error.message, "sys");
        }
    } finally {
        keepReading = false;

        try {
            activeReader.releaseLock();
        } catch (_) {}

        if (reader === activeReader) {
            reader = null;
        }

        try {
            await inputDone;
        } catch (_) {}
    }
}

// -----------------------------------------
// 13. SEND COMMANDS TO THE RC CAR
// -----------------------------------------

async function sendCmd(command) {
    if (!loggedIn) {
        log("Please log in first.", "sys");
        return;
    }

    if (!connected || !writer || disconnecting) {
        log("Connect the serial port first.", "sys");
        return;
    }

    try {
        await writer.write(
            new TextEncoder().encode(command)
        );

        log(command, "tx");
    } catch (error) {
        log("Command failed: " + error.message, "sys");
    }
}

// -----------------------------------------
// 14. DISCONNECT SERIAL PORT
// -----------------------------------------

async function disconnect() {
    if (disconnecting) return;

    disconnecting = true;
    keepReading = false;

    const activePort = port;
    const activeWriter = writer;
    const activeReader = reader;

    try {
        // Send STOP first, then return to manual mode.
        if (activeWriter) {
            try {
                await activeWriter.write(
                    new TextEncoder().encode("S")
                );

                await activeWriter.write(
                    new TextEncoder().encode("w")
                );
            } catch (error) {
                log("Could not send stop command.", "sys");
            }
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

        // Wait for the read loop to finish releasing its locks.
        if (connectionTask) {
            try {
                await connectionTask;
            } catch (_) {}
        }

        if (activePort && port === activePort) {
            try {
                await activePort.close();
            } catch (error) {
                log(
                    "Port close error: " + error.message,
                    "sys"
                );
            }
        }

        port = null;

        setLinked(false);
        resetStatus();

        log("Serial port disconnected.", "sys");

    } finally {
        disconnecting = false;
    }
}

// -----------------------------------------
// 15. CONNECT / DISCONNECT BUTTON
// -----------------------------------------

connectBtn.addEventListener("click", async function () {
    if (!loggedIn) return;

    if (connected) {
        await disconnect();
    } else {
        await connect();
    }
});

// -----------------------------------------
// 16. DRIVE BUTTONS
// -----------------------------------------

document.querySelectorAll(".pad-btn[data-cmd]").forEach(
    function (button) {
        button.addEventListener("click", async function () {
            if (!loggedIn) return;

            const command = button.dataset.cmd;

            button.classList.add("pressed");

            try {
                await sendCmd(command);
            } finally {
                button.classList.remove("pressed");
            }
        });
    }
);

// -----------------------------------------
// 17. MANUAL / OBSTACLE MODE
// -----------------------------------------

function setMode(mode) {
    if (!loggedIn) return;

    const isAuto = mode === "auto";

    showMode(isAuto);

    // Firmware protocol:
    // W = obstacle mode
    // w = manual mode
    sendCmd(isAuto ? "W" : "w");
}

btnManual.addEventListener("click", function () {
    setMode("manual");
});

btnAuto.addEventListener("click", function () {
    setMode("auto");
});

// -----------------------------------------
// 18. INITIALIZE APPLICATION
// -----------------------------------------

// Start with the dashboard hidden until Flask confirms
// whether the current browser session is authenticated.
showLogin();
checkLoginSession();