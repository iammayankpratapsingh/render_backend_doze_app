const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const Device = require("../models/Device");
const User = require("../models/User");
const { logger } = require("../utils/logger");

let io = null;

/**
 * Initialize WebSocket server
 * @param {http.Server} server - HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
function initializeWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin: "*", // In production, specify your React Native app origin
      methods: ["GET", "POST"],
      credentials: true
    },
    transports: ["websocket", "polling"], // Support both for better compatibility
    pingTimeout: 60000,
    pingInterval: 25000
  });

  // Authentication middleware for WebSocket connections
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      
      if (!token) {
        logger.err(new Error("WebSocket: No token provided"), { socketId: socket.id });
        return next(new Error("Authentication error: No token provided"));
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Attach user info to socket
      socket.userId = decoded.userId || decoded.id;
      socket.userRole = decoded.role;
      socket.accountId = decoded.accountId;
      
      logger.info("WebSocket: User authenticated", { 
        socketId: socket.id, 
        userId: socket.userId,
        role: socket.userRole 
      });
      
      next();
    } catch (error) {
      logger.err(error, { where: "WebSocket: Authentication failed", socketId: socket.id });
      next(new Error("Authentication error: Invalid token"));
    }
  });

  // Handle client connections
  io.on("connection", async (socket) => {
    logger.info("WebSocket: Client connected", { 
      socketId: socket.id, 
      userId: socket.userId 
    });

    // Get user's devices and auto-subscribe to device rooms
    try {
      const user = await User.findById(socket.userId).populate("devices");
      
      if (user && user.devices && user.devices.length > 0) {
        const deviceIds = user.devices.map(device => device.deviceId || device._id.toString());
        
        // Subscribe to each device room
        deviceIds.forEach(deviceId => {
          const roomName = `device:${deviceId}`;
          socket.join(roomName);
          logger.info("WebSocket: Subscribed to device room", { 
            socketId: socket.id, 
            userId: socket.userId,
            deviceId,
            room: roomName 
          });
        });

        // Also subscribe to user-specific room
        socket.join(`user:${socket.userId}`);
        
        // Send confirmation
        socket.emit("connected", {
          success: true,
          message: "Connected to WebSocket server",
          subscribedDevices: deviceIds,
          userId: socket.userId
        });
      } else {
        socket.emit("connected", {
          success: true,
          message: "Connected to WebSocket server",
          subscribedDevices: [],
          userId: socket.userId
        });
      }
    } catch (error) {
      logger.err(error, { where: "WebSocket: Error fetching user devices", socketId: socket.id });
      socket.emit("connected", {
        success: true,
        message: "Connected to WebSocket server",
        subscribedDevices: [],
        userId: socket.userId
      });
    }

    // Handle manual device subscription
    socket.on("subscribe_device", async (data) => {
      try {
        const { deviceId } = data;
        console.log(`📡 [WebSocket Backend] subscribe_device received for deviceId: ${deviceId}, socketId: ${socket.id}`);
        
        if (!deviceId) {
          console.log(`❌ [WebSocket Backend] subscribe_device failed: deviceId is required`);
          socket.emit("error", { message: "deviceId is required" });
          return;
        }

        // Verify user has access to this device
        const device = await Device.findOne({ deviceId });
        if (!device) {
          console.log(`❌ [WebSocket Backend] subscribe_device failed: Device not found: ${deviceId}`);
          socket.emit("error", { message: "Device not found" });
          return;
        }

        // Check if user owns this device or is admin
        const user = await User.findById(socket.userId);
        const hasAccess = 
          (device.userId && device.userId.toString() === socket.userId) ||
          (device.accountId && device.accountId === socket.accountId) ||
          socket.userRole === "admin" ||
          socket.userRole === "superadmin" ||
          (user && user.devices && user.devices.some(d => d.toString() === device._id.toString()));

        if (!hasAccess) {
          console.log(`❌ [WebSocket Backend] subscribe_device failed: Access denied for device: ${deviceId}`);
          socket.emit("error", { message: "Access denied to this device" });
          return;
        }

        const roomName = `device:${deviceId}`;
        socket.join(roomName);
        const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
        
        console.log(`✅ [WebSocket Backend] Subscribed to device room: ${roomName}, Total clients in room: ${roomSize}`);
        
        logger.info("WebSocket: Manually subscribed to device", { 
          socketId: socket.id, 
          userId: socket.userId,
          deviceId,
          room: roomName,
          roomSize
        });

        socket.emit("subscribed", { deviceId, room: roomName });
      } catch (error) {
        console.error(`❌ [WebSocket Backend] subscribe_device error:`, error);
        logger.err(error, { where: "WebSocket: Subscribe device error", socketId: socket.id });
        socket.emit("error", { message: "Failed to subscribe to device" });
      }
    });

    // Handle device unsubscription
    socket.on("unsubscribe_device", (data) => {
      try {
        const { deviceId } = data;
        if (deviceId) {
          const roomName = `device:${deviceId}`;
          socket.leave(roomName);
          logger.info("WebSocket: Unsubscribed from device", { 
            socketId: socket.id, 
            userId: socket.userId,
            deviceId 
          });
          socket.emit("unsubscribed", { deviceId });
        }
      } catch (error) {
        logger.err(error, { where: "WebSocket: Unsubscribe device error", socketId: socket.id });
      }
    });

    // Handle ping/pong for connection health
    socket.on("ping", () => {
      socket.emit("pong");
    });

    // Handle disconnection
    socket.on("disconnect", (reason) => {
      logger.info("WebSocket: Client disconnected", { 
        socketId: socket.id, 
        userId: socket.userId,
        reason 
      });
    });
  });

  logger.info("✅ WebSocket server initialized");
  return io;
}

/**
 * Broadcast health data update to all clients subscribed to a device
 * @param {string} deviceId - Device ID
 * @param {Object} healthData - Health data object
 */
function broadcastHealthData(deviceId, healthData) {
  if (!io) {
    logger.err(new Error("WebSocket server not initialized"), { where: "broadcastHealthData" });
    return;
  }

  try {
    const roomName = `device:${deviceId}`;
    
    // Prepare data for client (remove sensitive/internal fields)
    const clientData = {
      deviceId: healthData.deviceId,
      timestamp: healthData.timestamp,
      timestampSeconds: healthData.timestampSeconds, // Include timestampSeconds for accurate timestamp extraction
      temperature: healthData.temperature,
      humidity: healthData.humidity,
      heartRate: healthData.heartRate,
      respiration: healthData.respiration,
      pm10: healthData.pm10,
      co2: healthData.co2,
      voc: healthData.voc,
      etoh: healthData.etoh,
      voltage: healthData.voltage,
      level: healthData.level,
      status: healthData.status,
      metrics: healthData.metrics || {},
      signals: healthData.signals || {}
    };

    // Broadcast to device room
    const roomSize = io.sockets.adapter.rooms.get(roomName)?.size || 0;
    console.log(`📡 [WebSocket] Broadcasting health_data_update to room: ${roomName}, Clients: ${roomSize}, Respiration: ${clientData.respiration}`);
    io.to(roomName).emit("health_data_update", clientData);
    
    logger.info("WebSocket: Health data broadcasted", { 
      deviceId, 
      room: roomName,
      timestamp: healthData.timestamp,
      clients: roomSize,
      respiration: clientData.respiration
    });
  } catch (error) {
    logger.err(error, { where: "broadcastHealthData", deviceId });
  }
}

/**
 * Broadcast device status update
 * @param {string} deviceId - Device ID
 * @param {Object} deviceStatus - Device status object
 */
function broadcastDeviceStatus(deviceId, deviceStatus) {
  if (!io) {
    return;
  }

  try {
    const roomName = `device:${deviceId}`;
    io.to(roomName).emit("device_status_update", {
      deviceId,
      ...deviceStatus
    });
    
    logger.info("WebSocket: Device status broadcasted", { deviceId, room: roomName });
  } catch (error) {
    logger.err(error, { where: "broadcastDeviceStatus", deviceId });
  }
}

/**
 * Get WebSocket server instance
 * @returns {Server|null} Socket.IO server instance
 */
function getIO() {
  return io;
}

module.exports = {
  initializeWebSocket,
  broadcastHealthData,
  broadcastDeviceStatus,
  getIO
};




