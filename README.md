# SmartEnergy Monitor — IoT AC Energy & Cost Analytics Platform

An enterprise-ready, full-stack IoT Smart Energy Monitoring and Real-Time Consumption Cost Estimation Platform engineered for residential and commercial AC power distribution. 

Powered by **ESP32**, **ACS712 Hall-Effect Current Sensor**, **LM358 V3 AC Voltage Transformer**, **Firebase Cloud Infrastructure**, and browser-native **W3C Web Serial API**.

---

## 📑 Table of Contents
1. [Key Features](#-key-features)
2. [Hardware Wiring & Pinout Guide](#-hardware-wiring--pinout-guide)
3. [Software & Folder Architecture](#-software--folder-architecture)
4. [Web Serial USB Communication](#-web-serial-usb-communication)
5. [Firebase Cloud Setup & Security Rules](#-firebase-cloud-setup--security-rules)
6. [ESP32 Firmware Compilation & Upload](#-esp32-firmware-compilation--upload)
7. [Mathematical Formulas & Calibration](#-mathematical-formulas--calibration)
8. [Configurable Tariff & Anomaly System](#-configurable-tariff--anomaly-system)
9. [User Workflow & Role Isolation](#-user-workflow--role-isolation)
10. [High Voltage Electrical Safety Warning](#-high-voltage-electrical-safety-warning)

---

## ⚡ Key Features

- **True RMS Sampling:** High-frequency AC waveform sampling (1000 samples over 10 AC cycles at 50Hz) for both AC voltage and AC current, eliminating harmonics and DC offset distortion.
- **Direct USB Web Serial Streaming:** Zero driver or cloud latency. The web application establishes a direct, bidirectional hardware connection to the ESP32 COM port over USB at 115200 baud.
- **Multi-Tenant Firebase Synchronization:** Secure Firebase Realtime Database and Authentication integration with user isolation, admin approvals, and continuous cloud telemetry persistence.
- **Multi-Role Portals:**
  - **Client Portal:** Live telemetry meters, high-speed streaming waveform charts, historical audit table, CSV/JSON data export, and 24-hour / 14-day energy analytics.
  - **Admin Control Center:** Multi-node grid monitoring cards (automatic red alert cards on high load), sensor calibration controls, utility tariff rates, and account provisioning.
- **Anomaly Protection:** Instant visual alarms for overvoltage (<180V or >270V), current surges (>13A), and power spikes (>3000W).
- **Embedded LCD Display:** I2C 16x2 LCD rotates periodically between live electrical readings (`V`, `I`, `P`, `PF`) and cumulative energy billing (`kWh`, `Cost`).

---

## 🔌 Hardware Wiring & Pinout Guide

### Component Bill of Materials (BOM):
1. **ESP32 DevKit V1 (30-pin or 38-pin)**
2. **AC Voltage Sensor Module (ZMPT101B / LM358 V3)**
3. **ACS712 Current Sensor Module (5A / 20A / 30A model)**
4. **16x2 I2C Character LCD (PCF8574 Backpack @ 0x27)**
5. **Resistor Voltage Divider (for ACS712 output: 2kΩ & 1kΩ or 10kΩ & 20kΩ to scale 5V down to safe 3.3V ADC range)**
6. **Micro-USB Cable**

### Pinout Mapping:

| Sensor / Module | Sensor Pin | ESP32 Pin | Function / Description |
| :--- | :--- | :--- | :--- |
| **LM358 Voltage Sensor** | VCC | 3.3V / 5V | Sensor Logic Power |
| | GND | GND | Common Ground |
| | OUT | **GPIO 34 (ADC1_CH6)** | Analog conditioned AC sine wave |
| **ACS712 Current Sensor**| VCC | 5V | Hall-Effect Sensor Supply |
| | GND | GND | Common Ground |
| | OUT | **GPIO 35 (ADC1_CH7)** | Analog output (through 3.3V divider) |
| **I2C 16x2 LCD** | VCC | 5V | Display Backlight & Driver |
| | GND | GND | Common Ground |
| | SDA | **GPIO 21** | I2C Data Line |
| | SCL | **GPIO 22** | I2C Clock Line |
| **On-board LED** | D2 | **GPIO 2** | Serial Transmit Activity Indicator |

> ⚠️ **Important ESP32 ADC Rule:** Always use **ADC1** pins (GPIO 32, 33, 34, 35, 36, 39). Do not use ADC2 pins when Wi-Fi or Bluetooth stacks are initialized.

---

## 📂 Software & Folder Architecture

```text
smart-energy-monitor/
├── index.html                 # Brand landing page with system overview & interactive demo
├── login.html                 # Role-based authentication portal (Admin & Client routing)
├── register.html              # Client access request & premise registration form
│
├── admin/                     # Master Administrator Portal
│   ├── dashboard.html         # Grid overview, KPI metrics, dynamic red alert cards, tariff & cal modals
│   ├── users.html             # Client directory table, pending request approvals, fast provisioning
│   └── user-details.html      # Individual client telemetry audit, equipment ID editing, status toggle
│
├── user/                      # Client Consumer Portal
│   ├── dashboard.html         # Live telemetry meters, Web Serial USB connect, real-time waveform chart
│   ├── history.html           # Historical log audit, date-range filters, CSV & JSON data export
│   └── analytics.html         # 24-hr load curve, peak demand hours, 14-day trend, cost projection
│
├── css/
│   ├── style.css              # Global Design System (tokens, buttons, typography, badges, forms)
│   ├── dashboard.css          # KPI cards, grid layouts, table styles, modals, alert banners
│   └── responsive.css         # Breakpoints & mobile drawer navigation
│
├── js/
│   ├── firebase-config.js     # Firebase SDK initialization, path helpers, default parameters
│   ├── auth.js                # Auth listener, role detection, session guard, registration workflow
│   ├── serial.js              # W3C Web Serial API manager (auto-reconnect, JSON stream parser, timeout)
│   ├── energy.js              # True RMS energy accumulation, anomaly detector, formatting utils
│   ├── analytics.js           # Query aggregator, hourly bins, peak/low hour detection, Chart.js helpers
│   ├── dashboard.js           # Live UI controller, KPI updaters, real-time Firebase sync
│   └── admin.js               # Admin table/card renderers, tariff persistence, calibration engine
│
├── ESP/                       # Complete Production ESP32 Firmware
│   ├── smart_energy_monitor.ino # Main Arduino setup & loop, LCD rotation, serial command handler
│   ├── config.h               # Pin assignments, sampling rates, ADC constants, default tariff
│   ├── sensors.h              # LM358 & ACS712 True RMS math and auto zero-current offset calibration
│   └── energy_calculation.h   # Trapezoidal kWh energy integration and electricity cost math
│
├── assets/                    # System branding, vector SVG icons and graphics
│   ├── logo/logo.svg
│   └── icons/plug.svg
│
└── README.md                  # Comprehensive engineering documentation
```

---

## 🔌 Web Serial USB Communication

The application communicates directly with the ESP32 through the **W3C Web Serial API** in supported browsers (**Google Chrome** or **Microsoft Edge**).

### Communication Specifications:
- **Baud Rate:** `115200` bps (8-N-1)
- **Framing:** Plain-text JSON string terminated by newline (`\n`)
- **Packet Format:**
```json
{
  "device_id": "ESP32_001",
  "voltage": 230.4,
  "current": 1.82,
  "power": 419.3,
  "energy_kwh": 2.84,
  "estimated_cost": 18.42
}
```

### Two-Way Control Protocol (Browser to ESP32):
You can send ASCII commands directly over the serial terminal to configure the ESP32:
- `RESET_ENERGY\n` — Clears internal energy accumulation register back to 0.000 kWh.
- `SET_TARIFF:7.50\n` — Dynamically modifies the local LCD tariff rate multiplier.
- `ZERO_CURRENT\n` — Re-samples and zeroes the ACS712 quiescent ADC baseline.
- `CAL_VOLT:1.025\n` — Adjusts software voltage multiplier factor.
- `CAL_CURR:0.985\n` — Adjusts software current multiplier factor.

---

## 🔥 Firebase Cloud Setup & Security Rules

1. **Firebase Authentication:**
   - Go to [Firebase Authentication Providers](https://console.firebase.google.com/project/mechproj1/authentication/providers).
   - Ensure **Email/Password** sign-in method is **Enabled**.

2. **Realtime Database:**
   - Go to [Realtime Database](https://console.firebase.google.com/project/mechproj1/database).
   - Create a database if not already created (Default URL: `https://mechproj1-default-rtdb.firebaseio.com`).

3. **Deploy Realtime Database Rules:**
   - Go to [Database Rules Tab](https://console.firebase.google.com/project/mechproj1/database/rules).
   - Paste the contents of `database.rules.json`:
```json
{
  "rules": {
    "users": {
      ".read": "auth != null",
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('role').val() === 'admin')"
      }
    },
    "devices": {
      ".read": "auth != null",
      ".write": "auth != null"
    },
    "readings": {
      ".read": "auth != null",
      "$uid": {
        ".read": "auth != null",
        ".write": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('role').val() === 'admin')"
      }
    },
    "settings": {
      ".read": "auth != null",
      ".write": "auth != null && (root.child('users').child(auth.uid).child('role').val() === 'admin' || !root.child('settings').exists())"
    },
    "alerts": {
      "$uid": {
        ".read": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('role').val() === 'admin')",
        ".write": "auth != null && (auth.uid === $uid || root.child('users').child(auth.uid).child('role').val() === 'admin')"
      }
    }
  }
}
```

4. **Initialize Master Admin Account:**
   - Open `admin-setup.html` in your browser.
   - Master Administrator Credentials:
     - **Email:** `projifyra@gmail.com`
     - **Password:** `927624BME001`
   - Click **"Create & Activate Admin Account"** to bootstrap the account and database settings.

5. **Deploy Website (Firebase Hosting):**
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only hosting
   ```
   Or deploy database rules directly:
   ```bash
   firebase deploy --only database
   ```

---

## 💻 ESP32 Firmware Compilation & Upload

### Arduino IDE Instructions:
1. Install **Arduino IDE** (v2.0 or newer).
2. Go to **File > Preferences** and add the ESP32 board manager URL:
   `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json`
3. In **Tools > Board > Boards Manager**, install **esp32 by Espressif Systems**.
4. Install the required library:
   - **LiquidCrystal I2C** (by Frank de Brabander or Marco Schwartz via Library Manager).
5. Open `ESP/smart_energy_monitor.ino`.
6. Select **Board: "ESP32 Dev Module"**, configure **Upload Speed: 921600**, and select your ESP32 COM port.
7. Click **Upload**.

---

## 📐 Mathematical Formulas & Calibration

### 1. True RMS Voltage:
$$V_{\text{RMS}} = \sqrt{ \frac{1}{N} \sum_{i=1}^{N} (V_i - V_{\text{mid}})^2 } \times K_{\text{volt}}$$

### 2. True RMS Current:
$$I_i = \frac{(V_{i,\text{sensor}} - V_{\text{zero}})}{\text{Sensitivity}}$$
$$I_{\text{RMS}} = \sqrt{ \frac{1}{N} \sum_{i=1}^{N} I_i^2 } \times K_{\text{curr}}$$

### 3. Active Real Power:
$$P = V_{\text{RMS}} \times I_{\text{RMS}} \times \text{PF}$$

### 4. Trapezoidal Energy Integration:
$$\Delta E \, (\text{kWh}) = \frac{P \times \Delta t \, (\text{hours})}{1000} = \frac{P \times \Delta t \, (\text{seconds})}{3\,600\,000}$$
$$E_{\text{total}} = \sum \Delta E$$

### 5. Estimated Electricity Cost:
$$\text{Cost} \, (₹) = E_{\text{total}} \, (\text{kWh}) \times \text{Tariff Rate} \, (₹/\text{kWh})$$

---

## ⚡ High Voltage Electrical Safety Warning

> ⚠️ **DANGER: RISK OF ELECTRIC SHOCK & FIRE HAZARD**
>
> - 230V AC Mains voltage is **LETHAL**.
> - Always perform AC wiring only when the main circuit breaker is completely disconnected and locked out.
> - Ensure all AC high-voltage connections are properly insulated inside an approved fire-retardant terminal enclosure.
> - Maintain adequate galvanic creepage and clearance distances (> 6.3mm) between high-voltage AC terminals and low-voltage ESP32 DC electronics.
> - Always place a 5A fast-acting fuse in series with the AC line before the sensor input.
