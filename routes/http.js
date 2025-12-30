const express = require("express");
const dotenv = require("dotenv");
const HealthData = require("../models/HealthData");
const SleepData = require("../models/SleepData");
const Device = require("../models/Device");
const deviceApiKeyMiddleware = require("../middleware/deviceApiKeyMiddleware");
const { broadcastHealthData, broadcastDeviceStatus } = require("../services/websocketService");

dotenv.config();

const router = express.Router();

// --- UART helpers (keep inline to avoid new files)
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// Helper function to convert all string values in an object to numbers
function convertStringsToNumbers(obj) {
  if (!obj || typeof obj !== "object") return obj;
  
  const converted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      converted[key] = value;
    } else if (typeof value === "string") {
      // Convert string to number if it's a valid number
      if (value === "") {
        converted[key] = null; // Empty strings become null
      } else {
        const num = Number(value);
        converted[key] = Number.isFinite(num) ? num : value; // Keep original if not a number
      }
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // Recursively convert nested objects
      converted[key] = convertStringsToNumbers(value);
    } else if (Array.isArray(value)) {
      // Convert array elements if they are strings
      converted[key] = value.map(item => 
        typeof item === "string" && item !== "" && !isNaN(Number(item)) 
          ? Number(item) 
          : item
      );
    } else {
      converted[key] = value; // Keep other types as is
    }
  }
  return converted;
}

// Mapping from abbreviated codes to full field names
const fieldNameMapping = {
  'TS': 'timestampSeconds',
  'TS_ms': 'timestampMilliseconds',
  'T': 'temperature',
  'H': 'humidity',
  'MS': 'motionStart',
  'MST': 'motionEndReason',
  'AS': 'absenceStart',
  'AST': 'absenceEnd',
  'SS': 'snoringStart',
  'SST': 'snoringStop',
  'SF': 'snoringFrequency',
  'RST': 'respirationStop',
  'RS': 'respirationStart',
  'V': 'voltage',
  'L': 'level',
  'S': 'status',
  'HR': 'heartRate',
  'RE': 'respiration',
  'IA': 'pm10',
  'CO': 'co2',
  'VO': 'voc',
  'ET': 'etoh'
};

// Function to convert abbreviated field names to full names
function mapAbbreviatedToFullNames(data) {
  if (!data || typeof data !== "object") return data;
  
  const mapped = {};
  for (const [key, value] of Object.entries(data)) {
    // If key exists in mapping, use full name; otherwise keep original key
    const mappedKey = fieldNameMapping[key] || key;
    mapped[mappedKey] = value;
  }
  return mapped;
}

// Parse abbreviated JSON format -> { patch, metrics, signals, raw }
function parseAbbreviatedFormat(data) {
  if (!data || typeof data !== "object") return null;
  
  const patch = {};
  const metrics = {};
  const signals = {};
  const raw = {};
  
  // Helper to convert string to number
  const toNum = (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  
  // Map abbreviated fields to database fields
  if (data.T !== undefined && data.T !== "") patch.temp = toNum(data.T);
  if (data.H !== undefined && data.H !== "") patch.humidity = toNum(data.H);
  if (data.HR !== undefined && data.HR !== "") patch.heartRate = toNum(data.HR);
  if (data.RE !== undefined && data.RE !== "") patch.respiration = toNum(data.RE);
  if (data.S !== undefined && data.S !== "") patch.stress = toNum(data.S);
  if (data.IA !== undefined && data.IA !== "") patch.iaq = toNum(data.IA);
  if (data.CO !== undefined && data.CO !== "") patch.eco2 = toNum(data.CO);
  if (data.VO !== undefined && data.VO !== "") patch.tvoc = toNum(data.VO);
  if (data.ET !== undefined && data.ET !== "") patch.etoh = toNum(data.ET);
  
  // Battery/Voltage
  if (data.V !== undefined && data.V !== "") signals.battery = toNum(data.V);
  
  // Store all fields in raw for reference
  Object.assign(raw, data);
  
  return { patch, metrics, signals, raw };
}

// Parse one UART CSV line -> { patch, metrics, signals }
function parseUartLine(line) {
  if (!line || typeof line !== "string") return null;
  const parts = line.trim().split(",").map(s => s.trim());
  const tag = (parts[0] || "").toUpperCase();

  const patch = {};    // goes to flat fields (temp, heartRate, respiration, hrv, stress…)
  const metrics = {};  // goes to HealthData.metrics (HRV detail)
  const signals = {};  // goes to HealthData.signals (flags)

  switch (tag) {
    case "HRV_DATA": {
      // Expected order (17 values after tag):
      // mean_rr, sdnn, rmssd, pnn50, hr_median, rr_tri_index, tin_rmssd,
      // sd1, sd2, lf, hf, lfhf, sample_entropy, sd1sd2, sns_index, pns_index
      if (parts.length >= 17) {
        const [
          _,
          mean_rr, sdnn, rmssd, pnn50, hr_median, rr_tri_index, tin_rmssd,
          sd1, sd2, lf, hf, lfhf, sample_entropy, sd1sd2, sns_index, pns_index
        ] = parts;

        Object.assign(metrics, {
          mean_rr: toNum(mean_rr),
          sdnn: toNum(sdnn),
          rmssd: toNum(rmssd),
          pnn50: toNum(pnn50),
          hr_median: toNum(hr_median),
          rr_tri_index: toNum(rr_tri_index),
          tin_rmssd: toNum(tin_rmssd),
          sd1: toNum(sd1),
          sd2: toNum(sd2),
          lf: toNum(lf),
          hf: toNum(hf),
          lfhf: toNum(lfhf),
          sample_entropy: toNum(sample_entropy),
          sd1sd2: toNum(sd1sd2),
          sns_index: toNum(sns_index),
          pns_index: toNum(pns_index),
        });

        // Optional: keep legacy flats filled if present
        if (metrics.rmssd !== undefined) patch.hrv = metrics.rmssd;
        if (metrics.hr_median !== undefined) patch.heartRate = metrics.hr_median;
      }
      break;
    }

    case "TEMP_HUM":
      patch.temp = toNum(parts[1]);
      patch.humidity = toNum(parts[2]);
      break;

    case "HR":
      patch.heartRate = toNum(parts[1]);
      break;

    case "RES":
      patch.respiration = toNum(parts[1]);
      break;

    case "STRESS":
      patch.stress = toNum(parts[1]);
      break;

    case "RR":
      // optional raw RR sample (not always present)
      if (!("sample_entropy" in metrics)) metrics.sample_entropy = undefined;
      break;

    case "MOTION":
      signals.motion = parts[1] !== undefined ? Number(parts[1]) === 1 : undefined;
      break;

    case "PRESENCE":
      signals.presence = parts[1] !== undefined ? Number(parts[1]) === 1 : undefined;
      break;

    case "ACT":
    case "ACTIVITY":
      signals.activity = toNum(parts[1]);
      break;

    case "BAT":
      signals.battery = toNum(parts[1]);
      break;

    case "MIC":
      signals.mic = toNum(parts[1]);
      break;

    default:
      // leave unrecognized as raw only
      break;
  }

  return { patch, metrics, signals, raw: line };
}

router.post("/ingest", deviceApiKeyMiddleware, async (req, res) => {
  try {
    const { deviceId, type, data } = req.body;

    if (!deviceId || !type || !data) {
      return res.status(400).json({ message: "deviceId, type, and data are required" });
    }

    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ message: `Device ${deviceId} not found` });
    }

    const updatedDevice = await Device.findByIdAndUpdate(device._id, {
      status: "active",
      lastActiveAt: new Date(),
    }, { new: true });
    
    // Broadcast device status update via WebSocket
    try {
      broadcastDeviceStatus(deviceId, {
        status: updatedDevice.status,
        lastActiveAt: updatedDevice.lastActiveAt
      });
    } catch (wsError) {
      // Don't fail the request if WebSocket broadcast fails
      console.error("⚠️ WebSocket device status broadcast error (non-fatal):", wsError.message);
    }

    if (type === "health") {

      console.log("Incoming data:", JSON.stringify(data, null, 2));

      // Convert all string values in data to numbers
      const convertedData = convertStringsToNumbers(data);
      console.log("Converted data (strings to numbers):", JSON.stringify(convertedData, null, 2));

      // CRITICAL: Remove temperature from data if present, use temp only
      // Store original data for raw field (but remove temperature)
      const originalDataForRaw = { ...convertedData };
      delete originalDataForRaw.temperature;
      
      const cleanData = { ...convertedData };
      delete cleanData.temperature;
      
      // Base document - only essential fields, no mapped fields
      const base = {
        deviceId,
        timestamp: new Date(),
        metrics: {
          ...(data.metrics || {})
        },
        signals: {
          motion: data.signals?.motion ?? null,
          presence: data.signals?.presence ?? null,
          battery: data.signals?.battery ?? null,
          activity: data.signals?.activity ?? null,
          mic: data.signals?.mic ?? null,
          rrIntervals: data.signals?.rrIntervals || [],
          rawWaveform: data.signals?.rawWaveform || []
        },
        raw: {}  // Empty for abbreviated format
      };


      // NEW: accept a single UART line or an array of lines and fold into the same doc
      // Also handle abbreviated JSON format (TS, T, H, HR, RE, etc.)
      let mergedPatch = {};
      let mergedMetrics = {};
      let mergedSignals = {};
      let raws = [];
      let isAbbreviatedFormat = false;

      // Check if data is in abbreviated format (has TS, T, H, HR, etc.)
      isAbbreviatedFormat = cleanData.hasOwnProperty("TS") || cleanData.hasOwnProperty("T") || 
                            cleanData.hasOwnProperty("H") || cleanData.hasOwnProperty("HR");
      
      if (isAbbreviatedFormat) {
        const parsed = parseAbbreviatedFormat(cleanData);
        if (parsed) {
          Object.assign(mergedPatch, parsed.patch);
          Object.assign(mergedMetrics, parsed.metrics);
          Object.assign(mergedSignals, parsed.signals);
          // Store ALL original fields in raw (including empty strings)
          // Use originalDataForRaw which has all fields except temperature
          raws.push(JSON.stringify(originalDataForRaw));
        }
      }

      // Also handle UART CSV lines if present
      const lines = Array.isArray(data.lines) ? data.lines : (data.line ? [data.line] : []);
      for (const ln of lines) {
        const parsed = parseUartLine(String(ln));
        if (!parsed) continue;
        Object.assign(mergedPatch, parsed.patch);
        Object.assign(mergedMetrics, parsed.metrics);
        Object.assign(mergedSignals, parsed.signals);
        raws.push(parsed.raw);
      }

      // Final document (legacy fields preserved, UART merged if present)
      // Remove 'temperature' if present and ensure only 'temp' is used
      const { temperature, ...mergedPatchClean } = mergedPatch;
      
      // For abbreviated format, don't store in raw (fields are top-level)
      // Only store raw for UART CSV lines
      let finalRaw = {};
      if (isAbbreviatedFormat) {
        // Don't store abbreviated fields in raw - they're top-level fields
        finalRaw = {};
      } else if (raws.length > 0) {
        finalRaw = raws.join("\n");
      } else {
        finalRaw = base.raw || {};
      }
      
      // Build final document - only abbreviated fields and essential fields
      // Removed mapped fields: temp, humidity, iaq, eco2, tvoc, etoh, hrv, stress, respiration, heartRate
      const finalDoc = {
        deviceId: base.deviceId,
        timestamp: base.timestamp,
        metrics: { ...base.metrics, ...mergedMetrics },
        signals: { ...base.signals, ...mergedSignals },
        raw: finalRaw
      };
      
      // Map abbreviated fields to full names and add to document
      if (isAbbreviatedFormat && originalDataForRaw) {
        // Map all abbreviated fields to full names
        const mappedData = mapAbbreviatedToFullNames(originalDataForRaw);
        // Add mapped fields to finalDoc (exclude base fields)
        Object.keys(mappedData).forEach(key => {
          if (!['deviceId', 'timestamp', 'metrics', 'signals', 'raw'].includes(key)) {
            finalDoc[key] = mappedData[key];
          }
        });
      }
      
      // Create document using set() method to ensure only valid fields
      const newHealthData = new HealthData();
      
      // Base fields
      const fieldsToSet = {
        deviceId: finalDoc.deviceId,
        timestamp: finalDoc.timestamp,
        metrics: finalDoc.metrics || {},
        signals: finalDoc.signals || {},
        raw: finalDoc.raw || {}
      };
      
      // Add all mapped fields (full names) from finalDoc
      // Only add fields that are in the schema (full names)
      const schemaFields = [
        'timestampSeconds', 'timestampMilliseconds', 'temperature', 'humidity',
        'motionStart', 'motionEndReason', 'absenceStart', 'absenceEnd',
        'snoringStart', 'snoringStop', 'snoringFrequency', 'respirationStop', 'respirationStart',
        'voltage', 'level', 'status', 'heartRate', 'respiration',
        'pm10', 'co2', 'voc', 'etoh'
      ];
      
      schemaFields.forEach(field => {
        if (finalDoc[field] !== undefined) {
          fieldsToSet[field] = finalDoc[field];
        }
      });
      
      // Remove any abbreviated keys that might still be present
      Object.keys(fieldNameMapping).forEach(abbr => {
        if (fieldsToSet[abbr] !== undefined) {
          delete fieldsToSet[abbr];
        }
      });
      
      newHealthData.set(fieldsToSet);
      
      try {
        const savedDoc = await newHealthData.save();
        console.log("✅ Saved to healthdata_new collection. Document ID:", savedDoc._id);
        console.log("📊 Collection name:", savedDoc.collection.name);
        
        // Broadcast health data via WebSocket to all subscribed clients
        try {
          broadcastHealthData(deviceId, savedDoc.toObject());
        } catch (wsError) {
          // Don't fail the request if WebSocket broadcast fails
          console.error("⚠️ WebSocket broadcast error (non-fatal):", wsError.message);
        }
        
        return res.json({ 
          message: "Health data saved via http",
          collection: "healthdata_new",
          documentId: savedDoc._id
        });
      } catch (saveError) {
        console.error("❌ Error saving to healthdata_new:", saveError);
        throw saveError;
      }
    }

    if (type === "sleep") {
      const newSleepData = new SleepData({
        deviceId,
        timestamp: new Date(),
        sleepQuality: data.sleepQuality || "Unknown",
        duration: data.duration || 0,
      });

      await newSleepData.save();
      return res.json({ message: "Sleep data saved" });
    }

    return res.status(400).json({ message: "Invalid type. Use 'health' or 'sleep'" });

  } catch (err) {
    console.error("❌ Error saving data via HTTP:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// WiFi Status Endpoint - Check if device got network/internet or not
router.post("/wifi-status", deviceApiKeyMiddleware, async (req, res) => {
  try {
    const { deviceId, status } = req.body;

    // Validate required fields
    if (!deviceId) {
      return res.status(400).json({ 
        success: false,
        message: "deviceId is required" 
      });
    }

    if (!status) {
      return res.status(400).json({ 
        success: false,
        message: "status is required" 
      });
    }

    // Validate status value
    const validStatuses = ["CONNECTED", "FAILED"];
    const upperStatus = status.toUpperCase();
    if (!validStatuses.includes(upperStatus)) {
      return res.status(400).json({ 
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(", ")}` 
      });
    }

    // Find device
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ 
        success: false,
        message: `Device ${deviceId} not found` 
      });
    }

    // Prepare update data
    const updateData = {
      wifiStatus: upperStatus,
      wifiLastAttempt: new Date()
    };

    // If connected, also update wifiConnectedAt and device status
    if (upperStatus === "CONNECTED") {
      updateData.wifiConnectedAt = new Date();
      updateData.status = "active";
      updateData.lastActiveAt = new Date();
    }

    // Update device with WiFi status
    const updatedDevice = await Device.findByIdAndUpdate(
      device._id,
      updateData,
      { new: true }
    );

    console.log(`✅ WiFi status updated for device ${deviceId}: ${upperStatus}`);

    // Broadcast device status update via WebSocket
    try {
      broadcastDeviceStatus(deviceId, {
        status: updatedDevice.status,
        wifiStatus: updatedDevice.wifiStatus,
        wifiConnectedAt: updatedDevice.wifiConnectedAt,
        wifiLastAttempt: updatedDevice.wifiLastAttempt,
        lastActiveAt: updatedDevice.lastActiveAt
      });
    } catch (wsError) {
      console.error("⚠️ WebSocket device status broadcast error (non-fatal):", wsError.message);
    }

    return res.json({
      success: true,
      message: `WiFi status updated: ${upperStatus}`,
      deviceId: updatedDevice.deviceId,
      wifiStatus: updatedDevice.wifiStatus,
      wifiConnectedAt: updatedDevice.wifiConnectedAt,
      wifiLastAttempt: updatedDevice.wifiLastAttempt
    });

  } catch (err) {
    console.error("❌ Error updating WiFi status:", err);
    res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: err.message 
    });
  }
});

// GET WiFi Status Endpoint - Frontend can check device WiFi connection status
router.get("/wifi-status/:deviceId", async (req, res) => {
  try {
    const { deviceId } = req.params;

    if (!deviceId) {
      return res.status(400).json({ 
        success: false,
        message: "deviceId is required" 
      });
    }

    // Find device
    const device = await Device.findOne({ deviceId }).select('deviceId wifiStatus wifiConnectedAt wifiLastAttempt status');
    
    if (!device) {
      return res.status(404).json({ 
        success: false,
        message: `Device ${deviceId} not found` 
      });
    }

    return res.json({
      success: true,
      deviceId: device.deviceId,
      wifiStatus: device.wifiStatus || null,
      wifiConnectedAt: device.wifiConnectedAt || null,
      wifiLastAttempt: device.wifiLastAttempt || null,
      deviceStatus: device.status,
      isConnected: device.wifiStatus === "CONNECTED"
    });

  } catch (err) {
    console.error("❌ Error fetching WiFi status:", err);
    res.status(500).json({ 
      success: false,
      message: "Internal server error",
      error: err.message 
    });
  }
});

module.exports = router;