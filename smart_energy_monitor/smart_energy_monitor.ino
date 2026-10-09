// ============================================================================
//  SmartEnergy Monitor — ALL-IN-ONE ESP32 FIRMWARE
//  smart_energy_monitor.ino
//
//  Complete Standalone Code — No Extra Header Files Required!
//  Open this single file in Arduino IDE and click Upload.
//
//  Hardware Connections:
//  - ESP32 DevKit V1 (30-pin or 38-pin)
//  - AC Voltage Sensor (LM358 V3 / ZMPT101B) Analog OUT -> GPIO 34 (ADC1_CH6)
//  - ACS712 Current Sensor Analog OUT                  -> GPIO 35 (ADC1_CH7)
//  - I2C 16x2 LCD (PCF8574 Backpack) SDA               -> GPIO 21
//  - I2C 16x2 LCD (PCF8574 Backpack) SCL               -> GPIO 22
//  - On-Board Status LED                               -> GPIO 2
//  - USB Connection                                    -> 115200 Baud (Web Serial API)
//
//  Required Arduino IDE Library:
//  - "LiquidCrystal I2C" by Frank de Brabander (Install via Tools -> Manage Libraries)
// ============================================================================

#include <Wire.h>
#include <LiquidCrystal_I2C.h>

// ============================================================================
// 1. HARDWARE CONFIGURATION & CONSTANTS
// ============================================================================
#define DEVICE_ID             "ESP32_001"
#define FIRMWARE_VERSION      "2.5.0"

// Pin Definitions (Using stable ADC1 pins - Safe with Wi-Fi / Serial)
#define PIN_VOLTAGE_SENSOR    34    // LM358 V3 AC Voltage Transformer Analog Output
#define PIN_CURRENT_SENSOR    35    // ACS712 Analog Out (via resistor divider to 3.3V)
#define PIN_STATUS_LED        2     // On-board Blue LED (activity indicator)

// I2C 16x2 Character LCD
#define PIN_I2C_SDA           21
#define PIN_I2C_SCL           22
#define LCD_I2C_ADDR          0x27  // Standard PCF8574 address (or 0x3F)
#define LCD_COLS              16
#define LCD_ROWS              2

// Communication & Refresh Rates
#define SERIAL_BAUD_RATE      115200
#define TELEMETRY_INTERVAL_MS 1000  // Send JSON telemetry every 1000ms (1 Hz)
#define LCD_PAGE_INTERVAL_MS  3000  // Rotate LCD screens every 3 seconds

// AC Waveform Sampling Parameters
#define AC_FREQUENCY_HZ       50    // 50Hz (India / Europe) or 60Hz (USA)
#define SAMPLES_PER_CYCLE     100   // Samples per 20ms AC cycle (200µs per sample)
#define SAMPLE_CYCLES         10    // Number of cycles to sample (200ms sampling window)
#define TOTAL_SAMPLES         (SAMPLES_PER_CYCLE * SAMPLE_CYCLES) // 1000 samples

#define ADC_RESOLUTION_BITS   12    // 12-bit ADC (0 - 4095)
#define ADC_MAX_VALUE         4095.0f
#define ADC_VREF_VOLTS        3.30f  // Reference voltage for ESP32 ADC

// ACS712 Sensitivity (Volts per Ampere):
// 5A Model:  0.185 V/A (185 mV/A)
// 20A Model: 0.100 V/A (100 mV/A)
// 30A Model: 0.066 V/A (66 mV/A)
#define ACS712_SENSITIVITY_V_PER_A 0.185f

// Calibration Factors
float g_voltageCalFactor   = 2.556f; // Calibrated for AC mains 230V RMS (scales LM358 ~89.9V sensor output to ~230V)
float g_currentCalFactor   = 1.000f; // Fine-tune against calibrated clamp meter
float g_powerFactor        = 0.980f; // Typical residential power factor
float g_tariffRatePerKwh   = 5.00f;  // Electricity tariff (INR per Unit/kWh prototype rate)
const float CURRENT_NOISE_CUTOFF = 0.050f; // Suppress noise below 50mA

// Zero-Current Baseline
float g_acs712ZeroRawADC   = 2048.0f;

// ============================================================================
// 2. GLOBAL STATE VARIABLES
// ============================================================================
LiquidCrystal_I2C lcd(LCD_I2C_ADDR, LCD_COLS, LCD_ROWS);

// Electrical Telemetry Readings
float g_voltageRMS  = 0.0f; // Volts RMS
float g_currentRMS  = 0.0f; // Amperes RMS
float g_activePower = 0.0f; // Active Real Power (Watts)
float g_energyKWh   = 0.0f; // Cumulative Energy (kWh)
float g_estCost     = 0.0f; // Estimated Cost (INR)

// Energy Accumulator State
double   g_accumulatedEnergyWh = 0.0;
uint32_t g_lastEnergyCalcMs    = 0;

// Timing State
uint32_t g_lastTelemetryMs     = 0;
uint32_t g_lastLcdPageMs       = 0;
int      g_currentLcdPage      = 0;

// Serial Command Buffer
String g_serialBuffer = "";

// ============================================================================
// 3. SENSOR SAMPLING ALGORITHMS (TRUE RMS)
// ============================================================================

// Auto-calibrate zero-current ADC offset at startup or on command
void calibrateZeroCurrent(int sampleCount = 500) {
    long sum = 0;
    for (int i = 0; i < sampleCount; i++) {
        sum += analogRead(PIN_CURRENT_SENSOR);
        delayMicroseconds(200);
    }
    g_acs712ZeroRawADC = (float)sum / (float)sampleCount;
}

// True RMS Voltage Measurement with LM358 V3 Conditioning Circuit
float readVoltageRMS() {
    double sumSq = 0;
    double sumRaw = 0;
    int rawSamples[TOTAL_SAMPLES];

    // 1. Synchronized sampling over 10 AC cycles
    for (int i = 0; i < TOTAL_SAMPLES; i++) {
        int raw = analogRead(PIN_VOLTAGE_SENSOR);
        rawSamples[i] = raw;
        sumRaw += raw;
        delayMicroseconds(200);
    }

    // 2. Virtual dynamic DC bias calculation
    float midADC = (float)sumRaw / (float)TOTAL_SAMPLES;

    // 3. Calculate mean square deviation
    for (int i = 0; i < TOTAL_SAMPLES; i++) {
        float diff = (float)rawSamples[i] - midADC;
        sumSq += (diff * diff);
    }

    double meanSq = sumSq / (double)TOTAL_SAMPLES;
    double rmsADC = sqrt(meanSq);

    // 4. Convert to Volts RMS (scaled to 230V mains)
    float vSensorRMS = (rmsADC / ADC_MAX_VALUE) * ADC_VREF_VOLTS;
    float vMainsRMS  = vSensorRMS * 230.0f * g_voltageCalFactor;

    // Suppress open-circuit floating voltage
    if (vMainsRMS < 15.0f) {
        vMainsRMS = 0.0f;
    }

    return vMainsRMS;
}

// True RMS Current Measurement with ACS712 Hall-Effect Sensor
float readCurrentRMS() {
    double sumSqAmps = 0;
    int rawSamples[TOTAL_SAMPLES];
    double sumRaw = 0;

    for (int i = 0; i < TOTAL_SAMPLES; i++) {
        int raw = analogRead(PIN_CURRENT_SENSOR);
        rawSamples[i] = raw;
        sumRaw += raw;
        delayMicroseconds(200);
    }

    float midADC = (float)sumRaw / (float)TOTAL_SAMPLES;

    for (int i = 0; i < TOTAL_SAMPLES; i++) {
        float diffADC = (float)rawSamples[i] - midADC;
        float diffVolt = (diffADC / ADC_MAX_VALUE) * ADC_VREF_VOLTS;
        float instAmp  = diffVolt / ACS712_SENSITIVITY_V_PER_A;
        sumSqAmps += (instAmp * instAmp);
    }

    double meanSqAmps = sumSqAmps / (double)TOTAL_SAMPLES;
    float iRMS = (float)sqrt(meanSqAmps) * g_currentCalFactor;

    // Cut off background noise
    if (iRMS < CURRENT_NOISE_CUTOFF) {
        iRMS = 0.0f;
    }

    return iRMS;
}

// ============================================================================
// 4. ENERGY ACCUMULATION & COST CALCULATION
// ============================================================================
void accumulateEnergy(float powerWatts, uint32_t nowMs) {
    if (g_lastEnergyCalcMs == 0) {
        g_lastEnergyCalcMs = nowMs;
        return;
    }

    uint32_t deltaMs = nowMs - g_lastEnergyCalcMs;
    g_lastEnergyCalcMs = nowMs;

    // Reject huge gaps (> 60 seconds)
    if (deltaMs > 0 && deltaMs <= 60000) {
        double deltaHours = (double)deltaMs / 3600000.0;
        double deltaWh    = (double)powerWatts * deltaHours;
        g_accumulatedEnergyWh += deltaWh;
    }

    g_energyKWh = (float)(g_accumulatedEnergyWh / 1000.0);
    g_estCost   = g_energyKWh * g_tariffRatePerKwh;
}

// ============================================================================
// 5. LCD DISPLAY UPDATE
// ============================================================================
void updateLCD() {
    lcd.clear();

    if (g_currentLcdPage == 0) {
        // Page 0: Live Electrical Readings (V, I, P, PF)
        lcd.setCursor(0, 0);
        lcd.printf("V:%5.1fV I:%4.2fA", g_voltageRMS, g_currentRMS);

        lcd.setCursor(0, 1);
        lcd.printf("P:%5.0fW PF:%4.2f", g_activePower, g_powerFactor);
    }
    else {
        // Page 1: Cumulative Energy & Cost
        lcd.setCursor(0, 0);
        lcd.printf("E:%7.3fkWh     ", g_energyKWh);

        lcd.setCursor(0, 1);
        lcd.printf("Cost:Rs %6.2f ", g_estCost);
    }
}

// ============================================================================
// 6. JSON USB WEB SERIAL TELEMETRY TRANSMISSION
// ============================================================================
void sendSerialData() {
    // Flash status LED during transmission
    digitalWrite(PIN_STATUS_LED, HIGH);

    // Output formatted JSON packet followed by newline '\n'
    // Format: {"device_id":"ESP32_001","voltage":230.4,"current":1.82,"power":419.3,"energy_kwh":2.84,"estimated_cost":18.42}
    Serial.print("{\"device_id\":\"");
    Serial.print(DEVICE_ID);
    Serial.print("\",\"voltage\":");
    Serial.print(g_voltageRMS, 1);
    Serial.print(",\"current\":");
    Serial.print(g_currentRMS, 2);
    Serial.print(",\"power\":");
    Serial.print(g_activePower, 1);
    Serial.print(",\"energy_kwh\":");
    Serial.print(g_energyKWh, 3);
    Serial.print(",\"estimated_cost\":");
    Serial.print(g_estCost, 2);
    Serial.println("}");

    digitalWrite(PIN_STATUS_LED, LOW);
}

// ============================================================================
// 7. INCOMING SERIAL COMMAND PARSER (FROM WEB DASHBOARD)
// ============================================================================
void executeCommand(const String& cmd) {
    if (cmd == "RESET_ENERGY") {
        g_accumulatedEnergyWh = 0.0;
        g_energyKWh = 0.0f;
        g_estCost   = 0.0f;
        Serial.println("{\"status\":\"OK\",\"msg\":\"Energy accumulator reset to 0\"}");
    }
    else if (cmd.startsWith("SET_TARIFF:")) {
        float newRate = cmd.substring(11).toFloat();
        if (newRate > 0) {
            g_tariffRatePerKwh = newRate;
            Serial.printf("{\"status\":\"OK\",\"msg\":\"Tariff updated to %.2f\"}\n", newRate);
        }
    }
    else if (cmd == "ZERO_CURRENT") {
        calibrateZeroCurrent();
        Serial.println("{\"status\":\"OK\",\"msg\":\"Zero-current offset recalibrated\"}");
    }
    else if (cmd.startsWith("CAL_VOLT:")) {
        float factor = cmd.substring(9).toFloat();
        if (factor > 0.1f && factor < 10.0f) {
            g_voltageCalFactor = factor;
            Serial.printf("{\"status\":\"OK\",\"msg\":\"Voltage factor set to %.3f\"}\n", factor);
        }
    }
    else if (cmd.startsWith("CAL_CURR:")) {
        float factor = cmd.substring(9).toFloat();
        if (factor > 0.1f && factor < 10.0f) {
            g_currentCalFactor = factor;
            Serial.printf("{\"status\":\"OK\",\"msg\":\"Current factor set to %.3f\"}\n", factor);
        }
    }
    else if (cmd == "PING") {
        Serial.println("{\"status\":\"PONG\",\"device_id\":\"" DEVICE_ID "\"}");
    }
}

void handleIncomingSerial() {
    while (Serial.available() > 0) {
        char c = (char)Serial.read();
        if (c == '\n' || c == '\r') {
            g_serialBuffer.trim();
            if (g_serialBuffer.length() > 0) {
                executeCommand(g_serialBuffer);
                g_serialBuffer = "";
            }
        } else {
            g_serialBuffer += c;
        }
    }
}

// ============================================================================
// 8. SETUP ROUTINE
// ============================================================================
void setup() {
    // 1. Initialize USB Serial (Web Serial API communication)
    Serial.begin(SERIAL_BAUD_RATE);
    delay(200);

    // 2. Configure Status LED
    pinMode(PIN_STATUS_LED, OUTPUT);
    digitalWrite(PIN_STATUS_LED, HIGH);

    // 3. Initialize ADC on ESP32
    analogSetPinAttenuation(PIN_VOLTAGE_SENSOR, ADC_11db);
    analogSetPinAttenuation(PIN_CURRENT_SENSOR, ADC_11db);
    analogReadResolution(ADC_RESOLUTION_BITS);

    // 4. Initialize I2C Bus and 16x2 LCD
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
    lcd.init();
    lcd.backlight();
    lcd.clear();

    // Boot Splash Screen
    lcd.setCursor(0, 0);
    lcd.print("SmartEnergy IoT ");
    lcd.setCursor(0, 1);
    lcd.print("v" FIRMWARE_VERSION " Booting...");
    delay(1200);

    // 5. Zero-Current Calibration
    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Calibrating ACS ");
    lcd.setCursor(0, 1);
    lcd.print("Zero Offset...  ");
    calibrateZeroCurrent(500);
    delay(600);

    lcd.clear();
    lcd.setCursor(0, 0);
    lcd.print("Sensors Ready!  ");
    lcd.setCursor(0, 1);
    lcd.print("ID: " DEVICE_ID);
    delay(800);
    lcd.clear();

    digitalWrite(PIN_STATUS_LED, LOW);
}

// ============================================================================
// 9. MAIN LOOP
// ============================================================================
void loop() {
    uint32_t now = millis();

    // 1. Process incoming commands from Web Serial interface
    handleIncomingSerial();

    // 2. Read True RMS AC Voltage and Current
    g_voltageRMS  = readVoltageRMS();
    g_currentRMS  = readCurrentRMS();

    // 3. Calculate Real Active Power: P = V_rms * I_rms * PowerFactor
    g_activePower = g_voltageRMS * g_currentRMS * g_powerFactor;

    // 4. Accumulate Energy (kWh) and Cost (INR)
    accumulateEnergy(g_activePower, now);

    // 5. Send JSON Telemetry over USB Serial every 1000ms
    if (now - g_lastTelemetryMs >= TELEMETRY_INTERVAL_MS) {
        g_lastTelemetryMs = now;
        sendSerialData();
    }

    // 6. Rotate LCD Screens every 3000ms
    if (now - g_lastLcdPageMs >= LCD_PAGE_INTERVAL_MS) {
        g_lastLcdPageMs = now;
        g_currentLcdPage = (g_currentLcdPage + 1) % 2;
        updateLCD();
    }
}
