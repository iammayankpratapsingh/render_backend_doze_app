require('dotenv').config();
const mqtt = require('mqtt');
const HealthData = require('../models/HealthData');
const Device = require('../models/Device');
const { logger } = require('../utils/logger');
const { broadcastHealthData, broadcastDeviceStatus } = require('./websocketService');

// Configuration from .env file
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://172.236.188.162:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'doze';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'bK67ZwBHSWkl';

// Topic pattern - subscribe to all devices
const TOPIC_PATTERN = 'device/+/data';

// Message buffer for incomplete messages (deviceId -> buffer)
const messageBuffers = new Map();

// Helper functions (same as http.js)
const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

function convertStringsToNumbers(obj) {
  if (!obj || typeof obj !== "object") return obj;
  
  const converted = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      converted[key] = value;
    } else if (typeof value === "string") {
      if (value === "") {
        converted[key] = null;
      } else {
        const num = Number(value);
        converted[key] = Number.isFinite(num) ? num : value;
      }
    } else if (typeof value === "object" && !Array.isArray(value)) {
      converted[key] = convertStringsToNumbers(value);
    } else if (Array.isArray(value)) {
      converted[key] = value.map(item => 
        typeof item === "string" && item !== "" && !isNaN(Number(item)) 
          ? Number(item) 
          : item
      );
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

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

function mapAbbreviatedToFullNames(data) {
  if (!data || typeof data !== "object") return data;
  
  const mapped = {};
  for (const [key, value] of Object.entries(data)) {
    const mappedKey = fieldNameMapping[key] || key;
    mapped[mappedKey] = value;
  }
  return mapped;
}

function parseAbbreviatedFormat(data) {
  if (!data || typeof data !== "object") return null;
  
  const patch = {};
  const metrics = {};
  const signals = {};
  const raw = {};
  
  const toNumLocal = (v) => {
    if (v === "" || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  
  // Note: Using abbreviated names here, will be mapped to full names later
  if (data.T !== undefined && data.T !== "") patch.temp = toNumLocal(data.T);
  if (data.H !== undefined && data.H !== "") patch.humidity = toNumLocal(data.H);
  if (data.HR !== undefined && data.HR !== "") patch.heartRate = toNumLocal(data.HR);
  if (data.RE !== undefined && data.RE !== "") patch.respiration = toNumLocal(data.RE);
  if (data.S !== undefined && data.S !== "") patch.stress = toNumLocal(data.S);
  if (data.IA !== undefined && data.IA !== "") patch.iaq = toNumLocal(data.IA);
  if (data.CO !== undefined && data.CO !== "") patch.eco2 = toNumLocal(data.CO);
  if (data.VO !== undefined && data.VO !== "") patch.tvoc = toNumLocal(data.VO);
  if (data.ET !== undefined && data.ET !== "") patch.etoh = toNumLocal(data.ET);
  if (data.V !== undefined && data.V !== "") signals.battery = toNumLocal(data.V);
  if (data.L !== undefined && data.L !== "") patch.level = toNumLocal(data.L);
  if (data.TS !== undefined && data.TS !== "") patch.timestampSeconds = toNumLocal(data.TS);
  if (data.TS_ms !== undefined && data.TS_ms !== "") patch.timestampMilliseconds = toNumLocal(data.TS_ms);
  
  Object.assign(raw, data);
  
  return { patch, metrics, signals, raw };
}

/**
 * Buffer incomplete messages and reconstruct complete JSON
 */
function bufferMessage(deviceId, messageChunk) {
  if (!messageBuffers.has(deviceId)) {
    messageBuffers.set(deviceId, '');
  }
  
  const buffer = messageBuffers.get(deviceId) + messageChunk.toString();
  messageBuffers.set(deviceId, buffer);
  
  // Try to find complete JSON objects in buffer
  const completeMessages = [];
  let remainingBuffer = buffer;
  
  // Look for JSON objects (starting with { and ending with })
  while (remainingBuffer.length > 0) {
    const startIdx = remainingBuffer.indexOf('{');
    if (startIdx === -1) {
      // No more JSON objects, clear buffer
      messageBuffers.set(deviceId, '');
      break;
    }
    
    // Find matching closing brace
    let braceCount = 0;
    let endIdx = -1;
    for (let i = startIdx; i < remainingBuffer.length; i++) {
      if (remainingBuffer[i] === '{') braceCount++;
      if (remainingBuffer[i] === '}') braceCount--;
      if (braceCount === 0) {
        endIdx = i;
        break;
      }
    }
    
    if (endIdx !== -1) {
      // Found complete JSON
      const jsonStr = remainingBuffer.substring(startIdx, endIdx + 1);
      completeMessages.push(jsonStr);
      remainingBuffer = remainingBuffer.substring(endIdx + 1);
    } else {
      // Incomplete JSON, keep in buffer
      messageBuffers.set(deviceId, remainingBuffer);
      break;
    }
  }
  
  return completeMessages;
}

/**
 * Process and save health data to MongoDB
 */
async function processAndSaveHealthData(deviceId, data) {
  try {
    // Verify device exists
    const device = await Device.findOne({ deviceId });
    if (!device) {
      logger.warn(`Device ${deviceId} not found in database, skipping MQTT message`);
      return;
    }

    // Convert strings to numbers first to extract timestampSeconds
    const convertedData = convertStringsToNumbers(data);
    
    // Extract device timestamp for duplicate checking
    const deviceTimestampSeconds = convertedData.TS !== undefined && convertedData.TS !== "" 
      ? Number(convertedData.TS) 
      : null;
    
    // Check for duplicate: if deviceTimestampSeconds exists, check if we already have this data
    if (deviceTimestampSeconds !== null && Number.isFinite(deviceTimestampSeconds)) {
      const existingRecord = await HealthData.findOne({
        deviceId: deviceId,
        timestampSeconds: deviceTimestampSeconds
      });
      
      if (existingRecord) {
        logger.info(`⏭️ MQTT: Skipping duplicate data`, {
          deviceId,
          timestampSeconds: deviceTimestampSeconds,
          existingRecordId: existingRecord._id
        });
        return; // Skip saving duplicate
      }
    }

    // Update device status
    await Device.findByIdAndUpdate(device._id, {
      status: "active",
      lastActiveAt: new Date(),
    }, { new: true });
    
    // Broadcast device status update
    try {
      broadcastDeviceStatus(deviceId, {
        status: "active",
        lastActiveAt: new Date()
      });
    } catch (wsError) {
      logger.err(wsError, { where: "MQTT: broadcastDeviceStatus" });
    }
    
    // Remove temperature if present (use T field only)
    const cleanData = { ...convertedData };
    delete cleanData.temperature;

    // Check if data is in abbreviated format
    const isAbbreviatedFormat = cleanData.hasOwnProperty("TS") || cleanData.hasOwnProperty("T") || 
                                cleanData.hasOwnProperty("H") || cleanData.hasOwnProperty("HR");
    
    if (!isAbbreviatedFormat) {
      logger.warn(`MQTT: Data is not in abbreviated format, skipping`, { deviceId });
      return;
    }

    // Map abbreviated fields to full names FIRST
    const mappedData = mapAbbreviatedToFullNames(cleanData);
    
    // Define all valid schema fields
    const validSchemaFields = [
      'timestampSeconds', 'timestampMilliseconds', 'temperature', 'humidity',
      'motionStart', 'motionEndReason', 'absenceStart', 'absenceEnd',
      'snoringStart', 'snoringStop', 'snoringFrequency', 'respirationStop', 'respirationStart',
      'voltage', 'level', 'status', 'heartRate', 'respiration',
      'pm10', 'co2', 'voc', 'etoh'
    ];
    
    // Extract only valid mapped fields
    const validMappedFields = {};
    const extraFields = {}; // Fields not in schema - will go to raw
    
    Object.keys(mappedData).forEach(key => {
      if (validSchemaFields.includes(key)) {
        // Only include non-null/non-empty values
        if (mappedData[key] !== null && mappedData[key] !== undefined && mappedData[key] !== '') {
          validMappedFields[key] = mappedData[key];
        }
      } else {
        // Extra fields that don't map to schema
        extraFields[key] = mappedData[key];
      }
    });

    // Extract signals (voltage goes to signals.battery, not top-level)
    const signals = {};
    if (validMappedFields.voltage !== undefined) {
      signals.battery = validMappedFields.voltage;
      // Remove voltage from top-level fields (it's stored in signals.battery)
      delete validMappedFields.voltage;
    }

    // Build final document with ONLY mapped fields
    const finalDoc = {
      deviceId,
      timestamp: new Date(),
      metrics: {},
      signals: signals,
      raw: extraFields // Only store extra/unmapped fields in raw
    };

    // Add all valid mapped fields to finalDoc
    Object.assign(finalDoc, validMappedFields);

    // Create and save document - only with mapped fields
    const newHealthData = new HealthData();
    
    // Build fieldsToSet with only valid schema fields
    const fieldsToSet = {
      deviceId: finalDoc.deviceId,
      timestamp: finalDoc.timestamp,
      metrics: finalDoc.metrics || {},
      signals: finalDoc.signals || {},
      raw: Object.keys(finalDoc.raw || {}).length > 0 ? finalDoc.raw : {} // Only extra fields
    };

    // Add all valid mapped schema fields
    validSchemaFields.forEach(field => {
      if (finalDoc[field] !== undefined && finalDoc[field] !== null && finalDoc[field] !== '') {
        fieldsToSet[field] = finalDoc[field];
      }
    });

    // Ensure no abbreviated keys remain
    Object.keys(fieldNameMapping).forEach(abbr => {
      if (fieldsToSet[abbr] !== undefined) {
        delete fieldsToSet[abbr];
      }
    });
    
    // Log what we're saving
    logger.info(`📊 MQTT: Mapped data for saving`, {
      deviceId,
      mappedFields: Object.keys(validMappedFields),
      extraFields: Object.keys(extraFields),
      timestampSeconds: deviceTimestampSeconds
    });

    newHealthData.set(fieldsToSet);
    
    try {
      const savedDoc = await newHealthData.save();
      logger.info(`✅ MQTT: Saved health data to healthdata_new collection`, {
        deviceId,
        documentId: savedDoc._id,
        timestampSeconds: deviceTimestampSeconds || 'N/A'
      });
      
      // Broadcast via WebSocket
      try {
        broadcastHealthData(deviceId, savedDoc.toObject());
      } catch (wsError) {
        logger.err(wsError, { where: "MQTT: broadcastHealthData" });
      }
    } catch (saveError) {
      // Handle duplicate key error (race condition - another process saved same data)
      if (saveError.code === 11000 || saveError.name === 'MongoServerError') {
        logger.info(`⏭️ MQTT: Duplicate detected (race condition), skipping save`, {
          deviceId,
          timestampSeconds: deviceTimestampSeconds || 'N/A',
          error: saveError.message
        });
        return; // Skip - duplicate already exists
      }
      throw saveError; // Re-throw other errors
    }

  } catch (error) {
    logger.err(error, { 
      where: "MQTT: processAndSaveHealthData",
      deviceId 
    });
  }
}

/**
 * Initialize MQTT client and subscribe to topics
 */
let mqttClient = null;

function initializeMQTT() {
  if (mqttClient && mqttClient.connected) {
    logger.info('MQTT client already connected');
    return mqttClient;
  }

  // Parse broker URL
  let brokerUrl = MQTT_BROKER_URL;
  if (!brokerUrl.startsWith('mqtt://') && !brokerUrl.startsWith('mqtts://') && 
      !brokerUrl.startsWith('ws://') && !brokerUrl.startsWith('wss://')) {
    brokerUrl = `mqtt://${brokerUrl}`;
  }

  // MQTT client options
  const clientOptions = {
    clientId: `backend_mqtt_${Math.random().toString(16).substring(2, 10)}`,
    clean: true,
    reconnectPeriod: 5000,
    connectTimeout: 30000,
    keepalive: 60,
  };

  if (MQTT_USERNAME) {
    clientOptions.username = MQTT_USERNAME;
  }
  if (MQTT_PASSWORD) {
    clientOptions.password = MQTT_PASSWORD;
  }

  logger.info('🔌 Connecting to MQTT broker...', {
    url: brokerUrl,
    username: MQTT_USERNAME || '(not set)',
    topic: TOPIC_PATTERN
  });

  mqttClient = mqtt.connect(brokerUrl, clientOptions);

  // Connection event handlers
  mqttClient.on('connect', (connack) => {
    logger.info('✅ MQTT: Connected to broker successfully', { connack });
    
    // Subscribe to all device topics
    mqttClient.subscribe(TOPIC_PATTERN, { qos: 0 }, (err, granted) => {
      if (err) {
        logger.err(err, { where: "MQTT: Subscription error" });
      } else {
        logger.info('✅ MQTT: Subscribed to topics', {
          topics: granted.map(g => ({ topic: g.topic, qos: g.qos }))
        });
      }
    });
  });

  // Message event handler
  mqttClient.on('message', (topic, message) => {
    try {
      // Extract device ID from topic (device/{deviceId}/data)
      const topicParts = topic.split('/');
      if (topicParts.length < 3) {
        logger.warn('Invalid MQTT topic format', { topic });
        return;
      }
      
      const deviceId = topicParts[1];
      
      // Buffer message chunks and get complete JSON messages
      const completeMessages = bufferMessage(deviceId, message);
      
      // Process each complete message
      for (const jsonStr of completeMessages) {
        try {
          const data = JSON.parse(jsonStr);
          logger.info('📨 MQTT: Received message', { deviceId, topic });
          
          // Process and save to database
          processAndSaveHealthData(deviceId, data);
        } catch (parseError) {
          logger.warn('Failed to parse MQTT message as JSON', {
            deviceId,
            error: parseError.message,
            message: jsonStr.substring(0, 100)
          });
        }
      }
    } catch (error) {
      logger.err(error, { where: "MQTT: message handler", topic });
    }
  });

  // Error event handler
  mqttClient.on('error', (error) => {
    logger.err(error, { where: "MQTT: Connection error" });
  });

  // Reconnect event handler
  mqttClient.on('reconnect', () => {
    logger.info('🔄 MQTT: Reconnecting to broker...');
  });

  // Offline event handler
  mqttClient.on('offline', () => {
    logger.warn('⚠️ MQTT: Client is offline');
  });

  // Close event handler
  mqttClient.on('close', () => {
    logger.info('🔌 MQTT: Connection closed');
  });

  return mqttClient;
}

/**
 * Disconnect MQTT client
 */
function disconnectMQTT() {
  if (mqttClient) {
    mqttClient.end();
    mqttClient = null;
    logger.info('🔌 MQTT: Disconnected');
  }
}

module.exports = {
  initializeMQTT,
  disconnectMQTT
};

