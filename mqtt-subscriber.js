require('dotenv').config();
const mqtt = require('mqtt');

// Configuration from .env file
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || 'mqtt://172.236.188.162:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME || 'doze';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD || 'bK67ZwBHSWkl';

// Topic configuration
// Use specific device ID or wildcard pattern
const DEVICE_ID_ARG = process.argv[2];
const SUBSCRIBE_TO_ALL = DEVICE_ID_ARG === 'all' || DEVICE_ID_ARG === '+';
const DEVICE_ID = SUBSCRIBE_TO_ALL ? 'ALL' : (DEVICE_ID_ARG || '3BCE9E1BFA48CF12');
const TOPIC_PATTERN = SUBSCRIBE_TO_ALL ? 'device/+/data' : `device/${DEVICE_ID}/data`;

// Helper function to write logs (console only; no file is created)
function writeToLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;
  
  // Write to console
  console.log(logMessage.trim());
}

// Helper function to format JSON nicely
function formatJSON(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch (e) {
    return String(obj);
  }
}

// Parse MQTT broker URL
let brokerUrl = MQTT_BROKER_URL;
if (!brokerUrl.startsWith('mqtt://') && !brokerUrl.startsWith('mqtts://') && 
    !brokerUrl.startsWith('ws://') && !brokerUrl.startsWith('wss://')) {
  brokerUrl = `mqtt://${brokerUrl}`;
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('🚀 MQTT Device Data Subscriber');
console.log('═══════════════════════════════════════════════════════════════');
console.log(`📍 Broker URL: ${brokerUrl}`);
console.log(`👤 Username: ${MQTT_USERNAME || '(not set)'}`);
console.log(`🔑 Password: ${MQTT_PASSWORD ? '***' : '(not set)'}`);
console.log(`📡 Topic Pattern: ${TOPIC_PATTERN}`);
if (SUBSCRIBE_TO_ALL) {
  console.log(`   (Subscribing to ALL devices)`);
} else {
  console.log(`   (Device ID: ${DEVICE_ID})`);
}
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// MQTT client options
const clientOptions = {
  clientId: `mqtt_subscriber_${Math.random().toString(16).substring(2, 10)}`,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  keepalive: 60,
};

// Add credentials if provided
if (MQTT_USERNAME) {
  clientOptions.username = MQTT_USERNAME;
}
if (MQTT_PASSWORD) {
  clientOptions.password = MQTT_PASSWORD;
}

// Create MQTT client
writeToLog(`🔌 Connecting to MQTT broker: ${brokerUrl}...`);
const client = mqtt.connect(brokerUrl, clientOptions);

// Connection event handlers
client.on('connect', (connack) => {
  writeToLog(`✅ Connected to MQTT broker successfully!`);
  writeToLog(`📋 Connection details: ${formatJSON(connack)}`);
  
  // Subscribe to topic
  writeToLog(`📡 Subscribing to topic: ${TOPIC_PATTERN}...`);
  client.subscribe(TOPIC_PATTERN, { qos: 0 }, (err, granted) => {
    if (err) {
      writeToLog(`❌ Subscription error: ${err.message}`);
      console.error('Subscription error:', err);
    } else {
      writeToLog(`✅ Successfully subscribed to topic(s):`);
      granted.forEach((grant) => {
        writeToLog(`   - Topic: ${grant.topic}, QoS: ${grant.qos}`);
      });
      writeToLog('');
      writeToLog('═══════════════════════════════════════════════════════════════');
      writeToLog('👂 Listening for device messages...');
      writeToLog('═══════════════════════════════════════════════════════════════');
      writeToLog('');
    }
  });
});

// Message event handler
client.on('message', (topic, message) => {
  const timestamp = new Date().toISOString();
  
  try {
    // Try to parse as JSON
    const data = JSON.parse(message.toString());
    
    writeToLog(`📨 [${timestamp}] Message received from topic: ${topic}`);
    writeToLog(`📊 Message Data:`);
    writeToLog(formatJSON(data));
    
    // Extract device ID from topic if using wildcard
    const topicParts = topic.split('/');
    if (topicParts.length >= 2) {
      const deviceIdFromTopic = topicParts[1];
      writeToLog(`🆔 Device ID: ${deviceIdFromTopic}`);
    }
    
    // Log specific fields if they exist
    if (data.deviceId) {
      writeToLog(`🆔 Device ID (from payload): ${data.deviceId}`);
    }
    if (data.timestamp || data.TS) {
      const ts = data.timestamp || data.TS;
      writeToLog(`⏰ Timestamp: ${ts} (${new Date(ts * 1000).toISOString()})`);
    }
    if (data.type) {
      writeToLog(`📦 Type: ${data.type}`);
    }
    
    // Health data fields
    if (data.data) {
      writeToLog(`💊 Health Data:`);
      if (data.data.T !== undefined) writeToLog(`   🌡️  Temperature: ${data.data.T}°C`);
      if (data.data.H !== undefined) writeToLog(`   💧 Humidity: ${data.data.H}%`);
      if (data.data.HR !== undefined) writeToLog(`   ❤️  Heart Rate: ${data.data.HR} bpm`);
      if (data.data.RE !== undefined) writeToLog(`   🫁 Respiration: ${data.data.RE} rpm`);
      if (data.data.iaq !== undefined) writeToLog(`   🌬️  IAQ: ${data.data.iaq}`);
      if (data.data.eco2 !== undefined) writeToLog(`   💨 eCO2: ${data.data.eco2} ppm`);
      if (data.data.tvoc !== undefined) writeToLog(`   💨 TVOC: ${data.data.tvoc} ppb`);
      if (data.data.stress !== undefined) writeToLog(`   😰 Stress: ${data.data.stress}`);
      if (data.data.hrv !== undefined) writeToLog(`   📈 HRV: ${data.data.hrv}`);
    }
    
    writeToLog('───────────────────────────────────────────────────────────────');
    writeToLog('');
    
  } catch (parseError) {
    // If not JSON, log as raw message
    writeToLog(`📨 [${timestamp}] Message received from topic: ${topic}`);
    writeToLog(`📄 Raw Message (not JSON):`);
    writeToLog(message.toString());
    writeToLog('───────────────────────────────────────────────────────────────');
    writeToLog('');
  }
});

// Error event handler
client.on('error', (error) => {
  writeToLog(`❌ MQTT Error: ${error.message}`);
  console.error('MQTT Error:', error);
});

// Reconnect event handler
client.on('reconnect', () => {
  writeToLog(`🔄 Reconnecting to MQTT broker...`);
});

// Offline event handler
client.on('offline', () => {
  writeToLog(`⚠️  MQTT client is offline`);
});

// Close event handler
client.on('close', () => {
  writeToLog(`🔌 MQTT connection closed`);
});

// End event handler
client.on('end', () => {
  writeToLog(`🔚 MQTT client ended`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  writeToLog('');
  writeToLog('═══════════════════════════════════════════════════════════════');
  writeToLog('🛑 Shutting down MQTT subscriber...');
  writeToLog('═══════════════════════════════════════════════════════════════');
  
  if (client) {
    client.end(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  writeToLog('');
  writeToLog('═══════════════════════════════════════════════════════════════');
  writeToLog('🛑 Shutting down MQTT subscriber...');
  writeToLog('═══════════════════════════════════════════════════════════════');
  
  if (client) {
    client.end(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  writeToLog(`❌ Uncaught Exception: ${error.message}`);
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  writeToLog(`❌ Unhandled Rejection: ${reason}`);
  console.error('Unhandled Rejection:', reason);
});

