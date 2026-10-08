// ============================================================
//  SmartEnergy Monitor — USB Web Serial Module
//  js/serial.js
// ============================================================

export class SerialManager {
  constructor(options = {}) {
    this.port          = null;
    this.reader        = null;
    this.writer        = null;
    this.readLoop      = null;
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

    // Listen for device removal
    navigator.serial.addEventListener("disconnect", (e) => {
      if (this.port === e.target) this._handleDisconnect("Device removed");
    });
  }

  // ── Check Web Serial API support ────────────────────────────
  static isSupported() {
    return "serial" in navigator;
  }

  // ── Connect ──────────────────────────────────────────────────
  async connect() {
    if (!SerialManager.isSupported()) {
      throw new Error("Web Serial API is not supported in this browser. Use Chrome or Edge.");
    }

    try {
      // Request port from user
      this.port = await navigator.serial.requestPort({
        filters: [
          { usbVendorId: 0x10C4 },   // CP210x (common ESP32 USB-UART)
          { usbVendorId: 0x1A86 },   // CH340 (common Chinese clone)
          { usbVendorId: 0x0403 }    // FTDI
        ]
      });

      await this.port.open({ baudRate: this.BAUD_RATE });

      this.isConnected = true;
      this._startReadLoop();
      this._resetTimeout();
      this.onConnect();
      return true;

    } catch (err) {
      if (err.name === "NotFoundError") return false; // user cancelled
      throw err;
    }
  }

  // ── Disconnect ───────────────────────────────────────────────
  async disconnect() {
    await this._cleanup();
    this._handleDisconnect("Manual disconnect");
  }

  // ── Read Loop ────────────────────────────────────────────────
  _startReadLoop() {
    this.readLoop = this._doRead();
  }

  async _doRead() {
    const decoder = new TextDecoderStream();
    const inputDone = this.port.readable.pipeTo(decoder.writable);
    this.reader = decoder.readable.getReader();

    try {
      while (true) {
        const { value, done } = await this.reader.read();
        if (done) break;

        this.buffer += value;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          this._processLine(trimmed);
        }
      }
    } catch (err) {
      if (this.isConnected) {
        this._handleDisconnect(`Read error: ${err.message}`);
      }
    }
  }

  // ── Process incoming line ────────────────────────────────────
  _processLine(line) {
    this._resetTimeout();

    try {
      const data = JSON.parse(line);

      // Validate required fields
      if (
        typeof data.voltage  !== "number" ||
        typeof data.current  !== "number" ||
        typeof data.power    !== "number"
      ) {
        this.onError(`Incomplete data: ${line}`);
        return;
      }

      // Enrich with client timestamp if not provided
      if (!data.timestamp) {
        data.timestamp = new Date().toISOString();
      }

      this.lastDataTime = Date.now();
      this.onData(data);

    } catch (e) {
      // Not valid JSON — could be debug output from ESP32
      this.onError(`Invalid JSON: ${line}`);
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
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    try { if (this.reader) { await this.reader.cancel(); this.reader = null; } } catch {}
    try { if (this.port)   { await this.port.close();   } } catch {}
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
    try { return this.port.getInfo(); } catch { return null; }
  }

  // ── Time since last data ─────────────────────────────────────
  timeSinceData() {
    if (!this.lastDataTime) return null;
    const secs = Math.floor((Date.now() - this.lastDataTime) / 1000);
    if (secs < 60)  return `${secs} sec ago`;
    if (secs < 3600) return `${Math.floor(secs/60)} min ago`;
    return `${Math.floor(secs/3600)} hr ago`;
  }
}
