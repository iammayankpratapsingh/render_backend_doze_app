# MQTT Device Data Subscriber

This script subscribes to MQTT topics to receive and log data from IoT devices.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables in `.env` file:**
   ```env
   MQTT_BROKER_URL=mqtt://your-broker-url:1883
   MQTT_USERNAME=your-username
   MQTT_PASSWORD=your-password
   ```

   Example:
   ```env
   MQTT_BROKER_URL=mqtt://172.105.98.123:1883
   MQTT_USERNAME=doze
   MQTT_PASSWORD=bK67ZwBHSWkl
   ```

## Usage

### Subscribe to a specific device:
```bash
npm run mqtt:subscribe
# or
node mqtt-subscriber.js CAD5C864BBC3DE4C
```

### Subscribe to all devices:
```bash
npm run mqtt:subscribe:all
# or
node mqtt-subscriber.js all
```

## Topic Format

- **Specific device:** `device/{DEVICE_ID}/data`
  - Example: `device/CAD5C864BBC3DE4C/data`
  
- **All devices:** `device/+/data` (wildcard pattern)

## Output

The script will:
1. **Display messages in console** with formatted JSON and timestamps
2. **(Console-only)** It does not write any log files to disk.

## Logged Information

For each message received, the script logs:
- Timestamp
- Topic name
- Device ID (extracted from topic or payload)
- Message data (formatted JSON)
- Health metrics (if present):
  - Temperature (°C)
  - Humidity (%)
  - Heart Rate (bpm)
  - Respiration (rpm)
  - IAQ, eCO2, TVOC
  - Stress level
  - HRV

## Stopping the Script

Press `Ctrl+C` to gracefully stop the subscriber. The script will:
- Close MQTT connection
- Save final log entry
- Display log file location

## Troubleshooting

1. **Connection failed:**
   - Check MQTT_BROKER_URL in `.env`
   - Verify broker is accessible
   - Check firewall/network settings

2. **Authentication failed:**
   - Verify MQTT_USERNAME and MQTT_PASSWORD in `.env`
   - Some brokers don't require authentication (leave empty)

3. **No messages received:**
   - Verify device is publishing to correct topic
   - Check topic pattern matches device topic
   - Ensure device is connected and sending data

4. **Permission errors:**
   - Ensure `logs/` directory is writable
   - Check file permissions

