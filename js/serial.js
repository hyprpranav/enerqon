// ============================================================
//  SmartEnergy Monitor — USB Web Serial Module
//  js/serial.js
// ============================================================

export class SerialManager {
  constructor(options = {}) {
    this.port          = null;
    this.reader        = null;
    this.isConnected   = false;
    this.buffer        = "";
    this.BAUD_RATE     = options.baudRate || 115200;
    this.DATA_TIMEOUT  = options.dataTimeout || 5000; // ms before "offline"
    this.lastDataTime  = null;
    this.timeoutTimer  = null;

    // Callbacks
    this.onData        = options.onData        || (() => {});
    this.onConnect     = options.onConnect     || (() => {});
    this.onDisconnect  = options.onDisconnect  || (() => {});
    this.onError       = options.onError       || ((e) => console.error(e));
    this.onTimeout     = options.onTimeout     || (() => {});

    // Listen for device removal event
    if ("serial" in navigator) {
      navigator.serial.addEventListener("disconnect", (e) => {
        if (this.port === e.target) {
          this._handleDisconnect("ESP32 USB cable disconnected");
        }
      });
    }
  }

  // ── Check Web Serial API support ────────────────────────────
  static isSupported() {
    return "serial" in navigator;
  }

  // ── Connect ──────────────────────────────────────────────────
  async connect() {
    if (!SerialManager.isSupported()) {
      throw new Error("Web Serial API is not supported in this browser. Please use Google Chrome or Microsoft Edge.");
    }

    try {
      // Prompt user to select ANY available serial / COM port (no restrictive filters)
      this.port = await navigator.serial.requestPort();

      if (!this.port) {
        return false;
      }

      // Open port at 115200 baud (matching ESP32 firmware)
      await this.port.open({
        baudRate: this.BAUD_RATE,
        dataBits: 8,
        stopBits: 1,
        parity:   "none",
        bufferSize: 4096
      });

      this.isConnected = true;
      this._startReadLoop();
      this._resetTimeout();
      this.onConnect();
      return true;

    } catch (err) {
      // User dismissed port picker modal
      if (err.name === "NotFoundError") {
        return false;
      }

      // Check if port is locked by another application (e.g. Arduino IDE Serial Monitor)
      let friendlyMsg = err.message || "";
      if (
        err.name === "NetworkError" ||
        friendlyMsg.includes("Failed to open") ||
        friendlyMsg.includes("Access denied") ||
        friendlyMsg.includes("in use")
      ) {
        throw new Error("Port is locked or busy! If Arduino IDE Serial Monitor or another terminal is open, please CLOSE it and click Connect again.");
      }

      throw err;
    }
  }

  // ── Disconnect ───────────────────────────────────────────────
  async disconnect() {
    this.isConnected = false;
    await this._cleanup();
    this._handleDisconnect("Manual disconnect");
  }

  // ── Read Loop ────────────────────────────────────────────────
  _startReadLoop() {
    this._doRead().catch(err => {
      if (this.isConnected) {
        console.warn("Serial read loop terminated:", err);
      }
    });
  }

  async _doRead() {
    const textDecoder = new TextDecoder();

    while (this.port && this.port.readable && this.isConnected) {
      this.reader = this.port.readable.getReader();

      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) {
            break;
          }

          if (value) {
            this.buffer += textDecoder.decode(value, { stream: true });

            // Process line-by-line delimited by \n
            const lines = this.buffer.split("\n");
            this.buffer = lines.pop(); // Retain remainder for next chunk

            for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed) {
                this._processLine(trimmed);
              }
            }
          }
        }
      } catch (err) {
        if (this.isConnected) {
          console.warn("Serial stream read warning:", err.message);
        }
      } finally {
        if (this.reader) {
          try {
            this.reader.releaseLock();
          } catch (_) {}
          this.reader = null;
        }
      }
    }
  }

  // ── Process incoming line ────────────────────────────────────
  _processLine(line) {
    this._resetTimeout();

    try {
      // Extract JSON substring in case of serial debug prefixes or noise
      let jsonStr = line;
      const startIdx = line.indexOf("{");
      const endIdx   = line.lastIndexOf("}");
      if (startIdx >= 0 && endIdx > startIdx) {
        jsonStr = line.substring(startIdx, endIdx + 1);
      }

      const data = JSON.parse(jsonStr);

      // Validate required telemetry fields
      if (
        typeof data.voltage === "number" &&
        typeof data.current === "number" &&
        typeof data.power   === "number"
      ) {
        if (!data.timestamp) {
          data.timestamp = new Date().toISOString();
        }
        this.lastDataTime = Date.now();
        this.onData(data);
      } else if (data.status || data.msg) {
        // ESP32 Status / Command Ack message
        console.log("ESP32 Ack Message:", data);
      }
    } catch (e) {
      // Non-JSON debug message (e.g. boot output or calibration info)
      this.onError(`Serial text: ${line}`);
    }
  }

  // ── Timeout detection ────────────────────────────────────────
  _resetTimeout() {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      this.onTimeout();
    }, this.DATA_TIMEOUT);
  }

  // ── Cleanup ──────────────────────────────────────────────────
  async _cleanup() {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (_) {}
      try {
        this.reader.releaseLock();
      } catch (_) {}
      this.reader = null;
    }

    if (this.port) {
      try {
        await this.port.close();
      } catch (e) {
        console.warn("Serial port close notice:", e.message);
      }
      this.port = null;
    }
  }

  // ── Handle disconnect ────────────────────────────────────────
  _handleDisconnect(reason) {
    this.isConnected = false;
    this._cleanup();
    this.onDisconnect(reason);
  }

  // ── Get info ─────────────────────────────────────────────────
  getInfo() {
    if (!this.port) return null;
    try {
      return this.port.getInfo();
    } catch {
      return null;
    }
  }

  // ── Time since last data ─────────────────────────────────────
  timeSinceData() {
    if (!this.lastDataTime) return null;
    const secs = Math.floor((Date.now() - this.lastDataTime) / 1000);
    if (secs < 60)   return `${secs}s ago`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
    return `${Math.floor(secs / 3600)}h ago`;
  }
}
