const http = require('http');
require('dotenv').config();

// Configuration
const API_URL = process.env.API_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5000';
const API_ENDPOINT = '/api/http/ingest';
const API_KEY = '7f9c2c9f1a3b9d0e7a6c1b2d8e4f9a7c3d5e6b8a9c1d2e3f4a5b6c7d8e9f0a';
const DEVICE_ID = '3BCE9E1BFA48CF12';
const JWT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTNkMzExMmMzZGJiNTdmYTU5ZTFjY2YiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NjYzOTkwOTIsImV4cCI6MTc2ODk5MTA5Mn0.frfopfvgJiA6YBWc-ojLliYua79YAfraCuBFyZZiAk4';

// Note: API key validation is optional if DOZEMATE_API_KEY is not set in server .env

// Interval: 6 seconds
const INTERVAL_MS = 6000;

// Heart Rate range (random values between 60-100 bpm)
const MIN_HEART_RATE = 60;
const MAX_HEART_RATE = 100;

// Temperature range (random values between 20-30°C)
const MIN_TEMPERATURE = 20;
const MAX_TEMPERATURE = 30;

// Humidity range (random values between 40-80%)
const MIN_HUMIDITY = 40;
const MAX_HUMIDITY = 80;

// Respiration range (random values between 12-20 rpm)
const MIN_RESPIRATION = 12;
const MAX_RESPIRATION = 20;

/**
 * Generate random number between min and max
 */
function getRandomNumber(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate random float between min and max (for temperature)
 */
function getRandomFloat(min, max) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(1));
}

/**
 * Get current timestamp in seconds
 */
function getCurrentTimestamp() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Send health data to server
 */
function sendHealthData() {
  // Generate random values
  const timestamp = getCurrentTimestamp();
  const temperature = getRandomFloat(MIN_TEMPERATURE, MAX_TEMPERATURE);
  const humidity = getRandomNumber(MIN_HUMIDITY, MAX_HUMIDITY);
  const heartRate = getRandomNumber(MIN_HEART_RATE, MAX_HEART_RATE);
  const respiration = getRandomNumber(MIN_RESPIRATION, MAX_RESPIRATION);

  // Prepare payload
  const payload = {
    deviceId: DEVICE_ID,
    type: "health",
    data: {
      TS: timestamp,
      T: temperature,
      H: humidity,
      HR: heartRate,
      RE: respiration
    }
  };

  // Parse URL
  const url = new URL(API_ENDPOINT, API_URL);
  
  // Create request options
  const options = {
    hostname: url.hostname,
    port: url.port || (process.env.PORT || 5000),  // Use PORT from .env or default to 5000
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY  // Optional if DOZEMATE_API_KEY not set in server .env
    }
  };

  // Create request
  const req = http.request(options, (res) => {
    let data = '';

    res.on('data', (chunk) => {
      data += chunk;
    });

    res.on('end', () => {
      const timestampStr = new Date().toLocaleTimeString();
      if (res.statusCode === 200) {
        console.log(`✅ [${timestampStr}] Data sent successfully:`);
        console.log(`   📊 HR: ${heartRate} bpm | Resp: ${respiration} rpm | Temp: ${temperature}°C | Humidity: ${humidity}%`);
        try {
          const response = JSON.parse(data);
          console.log(`   📨 Response: ${response.message || 'OK'}`);
        } catch (e) {
          console.log(`   📨 Response: ${data}`);
        }
      } else {
        console.error(`❌ [${timestampStr}] Error: Status ${res.statusCode}`);
        console.error(`   Response: ${data}`);
      }
      console.log(''); // Empty line for readability
    });
  });

  req.on('error', (error) => {
    const timestampStr = new Date().toLocaleTimeString();
    console.error(`❌ [${timestampStr}] Request error:`, error.message);
    console.log('');
  });

  // Send payload
  req.write(JSON.stringify(payload));
  req.end();
}

// Main execution
console.log('🚀 Starting Health Data Pusher...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`📍 Server: ${API_URL}`);
console.log(`🔑 Device ID: ${DEVICE_ID}`);
console.log(`⏱️  Interval: ${INTERVAL_MS / 1000} seconds`);
console.log(`📊 Heart Rate Range: ${MIN_HEART_RATE}-${MAX_HEART_RATE} bpm`);
console.log(`🌡️  Temperature Range: ${MIN_TEMPERATURE}-${MAX_TEMPERATURE}°C`);
console.log(`💧 Humidity Range: ${MIN_HUMIDITY}-${MAX_HUMIDITY}%`);
console.log(`🫁 Respiration Range: ${MIN_RESPIRATION}-${MAX_RESPIRATION} rpm`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Send first data immediately
sendHealthData();

// Then send every 6 seconds
const intervalId = setInterval(() => {
  sendHealthData();
}, INTERVAL_MS);

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping Health Data Pusher...');
  clearInterval(intervalId);
  console.log('✅ Stopped successfully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Stopping Health Data Pusher...');
  clearInterval(intervalId);
  console.log('✅ Stopped successfully');
  process.exit(0);
});

