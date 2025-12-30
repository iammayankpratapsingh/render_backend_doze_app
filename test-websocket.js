const io = require('socket.io-client');
require('dotenv').config();

// JWT Token
const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2OTNkMzExMmMzZGJiNTdmYTU5ZTFjY2YiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NjYxNDU3MDAsImV4cCI6MTc2ODczNzcwMH0.s37vLpFd6EK-oaZRgVxXwf7eS3C2xwm419IyfgADQog';

// Server URL - use API_BASE_URL or APP_BASE_URL from .env, fallback to localhost
const serverUrl = process.env.API_BASE_URL || process.env.APP_BASE_URL || 'http://localhost:5000';

console.log('🔌 Connecting to WebSocket server...');
console.log('📍 Server:', serverUrl);
console.log('🔑 Token:', token.substring(0, 20) + '...');

// Create socket connection
const socket = io(serverUrl, {
  auth: {
    token: token
  },
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionAttempts: 5
});

// ========== Connection Events ==========

socket.on('connect', () => {
  console.log('\n✅ ✅ ✅ CONNECTED SUCCESSFULLY! ✅ ✅ ✅');
  console.log('📡 Socket ID:', socket.id);
  console.log('🔗 Connection Status: ACTIVE\n');
});

socket.on('disconnect', (reason) => {
  console.log('\n❌ DISCONNECTED');
  console.log('Reason:', reason);
  console.log('🔄 Will attempt to reconnect...\n');
});

socket.on('connect_error', (error) => {
  console.error('\n❌ CONNECTION ERROR:');
  console.error('Error:', error.message);
  console.error('Details:', error);
  console.log('\n💡 Check:');
  console.log('   1. Backend server is running on port 5000');
  console.log('   2. Token is valid and not expired');
  console.log('   3. CORS settings allow connection\n');
});

// ========== Server Messages ==========

socket.on('connected', (data) => {
  console.log('\n📨 SERVER CONFIRMATION RECEIVED:');
  console.log('   Success:', data.success);
  console.log('   Message:', data.message);
  console.log('   User ID:', data.userId);
  console.log('   Subscribed Devices:', data.subscribedDevices || []);
  console.log('');
});

socket.on('subscribed', (data) => {
  console.log('✅ SUBSCRIBED TO DEVICE:');
  console.log('   Device ID:', data.deviceId);
  console.log('   Room:', data.room);
  console.log('');
});

socket.on('unsubscribed', (data) => {
  console.log('👋 UNSUBSCRIBED FROM DEVICE:', data.deviceId);
});

// ========== Real-Time Data Events ==========

socket.on('health_data_update', (data) => {
  console.log('\n📊 📊 📊 HEALTH DATA UPDATE RECEIVED! 📊 📊 📊');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Device ID:', data.deviceId);
  console.log('Timestamp:', new Date(data.timestamp).toLocaleString());
  console.log('\n📈 Health Metrics:');
  if (data.temperature !== undefined) console.log('   🌡️  Temperature:', data.temperature, '°C');
  if (data.humidity !== undefined) console.log('   💧 Humidity:', data.humidity, '%');
  if (data.heartRate !== undefined) console.log('   ❤️  Heart Rate:', data.heartRate, 'bpm');
  if (data.respiration !== undefined) console.log('   🫁 Respiration:', data.respiration, 'rpm');
  if (data.pm10 !== undefined) console.log('   🌬️  PM10:', data.pm10);
  if (data.co2 !== undefined) console.log('   💨 CO2:', data.co2, 'ppm');
  if (data.voc !== undefined) console.log('   ☁️  VOC:', data.voc);
  if (data.etoh !== undefined) console.log('   🍺 ETOH:', data.etoh);
  if (data.voltage !== undefined) console.log('   ⚡ Voltage:', data.voltage, 'V');
  if (data.level !== undefined) console.log('   📊 Level:', data.level);
  if (data.status !== undefined) console.log('   📍 Status:', data.status);
  
  if (data.signals && Object.keys(data.signals).length > 0) {
    console.log('\n📡 Signals:');
    if (data.signals.motion !== undefined) console.log('   🏃 Motion:', data.signals.motion);
    if (data.signals.presence !== undefined) console.log('   👤 Presence:', data.signals.presence);
    if (data.signals.activity !== undefined) console.log('   🎯 Activity:', data.signals.activity);
    if (data.signals.battery !== undefined) console.log('   🔋 Battery:', data.signals.battery);
    if (data.signals.mic !== undefined) console.log('   🎤 Mic:', data.signals.mic);
  }
  
  if (data.metrics && Object.keys(data.metrics).length > 0) {
    console.log('\n📊 Advanced Metrics:');
    const importantMetrics = ['mean_hr', 'sdnn', 'rmssd', 'stress_ind', 'SleepStage', 'SleepQuality'];
    importantMetrics.forEach(key => {
      if (data.metrics[key] !== undefined && data.metrics[key] !== null) {
        console.log(`   ${key}:`, data.metrics[key]);
      }
    });
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
});

socket.on('device_status_update', (data) => {
  console.log('\n📱 DEVICE STATUS UPDATE:');
  console.log('   Device ID:', data.deviceId);
  console.log('   Status:', data.status);
  if (data.lastActiveAt) console.log('   Last Active:', new Date(data.lastActiveAt).toLocaleString());
  if (data.wifiStatus) console.log('   WiFi Status:', data.wifiStatus);
  console.log('');
});

// ========== Error Handling ==========

socket.on('error', (error) => {
  console.error('\n❌ WEBSOCKET ERROR:');
  console.error('   Message:', error.message || error);
  console.error('');
});

// ========== Ping/Pong Test ==========

socket.on('pong', () => {
  console.log('🏓 Pong received - Connection is healthy!');
});

// ========== Interactive Commands ==========

console.log('\n📝 Available Commands (type in console):');
console.log('   socket.emit("ping") - Test connection health');
console.log('   socket.emit("subscribe_device", { deviceId: "YOUR_DEVICE_ID" }) - Subscribe to device');
console.log('   socket.emit("unsubscribe_device", { deviceId: "YOUR_DEVICE_ID" }) - Unsubscribe');
console.log('   socket.disconnect() - Disconnect');
console.log('   socket.connect() - Reconnect');
console.log('\n⏳ Waiting for connection and data updates...\n');
console.log('💡 To test: Send health data via API and watch for real-time updates!\n');

// Auto ping every 30 seconds to keep connection alive
setInterval(() => {
  if (socket.connected) {
    socket.emit('ping');
    console.log('🏓 Ping sent (connection health check)');
  }
}, 30000);

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n\n👋 Disconnecting...');
  socket.disconnect();
  process.exit(0);
});

// Keep process running
process.stdin.resume();



