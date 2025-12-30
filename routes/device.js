const express = require("express");
const Device = require("../models/Device");
const User = require("../models/User");
const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");
const mongoose = require('mongoose');
const DevicePrefix = require('../models/DevicePrefix');
const Profile = require("../models/Profile");
const router = express.Router();
const ID_RX = /^\d{4}-[0-9A-F]{12}$/i;; // 4 digits 12 hex chars
const pad5 = (n) => String(n).padStart(5, '0');
const deviceController= require('../controllers/deviceManagementController');

// --- local handlers so we don't need another controller import ---
async function getByDeviceId(req, res) {
  try {
    const device = await Device.findOne({ deviceId: req.params.deviceId });
    if (!device) return res.status(404).json({ message: 'Device not found' });
    res.json({ data: { device } });
  } catch (e) {
    res.status(500).json({ message: 'Server error' });
  }
}

async function validateDeviceId(req, res) {
  try {
    const { deviceId } = req.query;
    if (!deviceId) return res.status(400).json({ ok: false, message: 'deviceId required' });

    const d = await Device.findOne({ deviceId });
    res.json({
      ok: true,
      exists: !!d,
      assigned: !!d?.userId,
      device: d || null
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
}


// Add Device
router.post("/add", authMiddleware, async (req, res) => {
  const {
    // legacy/manual fields (still supported)
    deviceId,
    deviceType,
    manufacturer,
    prefixId,
    firmwareVersion,
    location,
    status,
    validity,
    accountId,
    profileId,
  } = req.body;

  const now = new Date();
  const processedStatus = (status || 'inactive').toLowerCase();

  try {
    const payload = {
      firmwareVersion,
      location,
      status: processedStatus,
      validity,
      createdAt: now,
      lastActiveAt: now,
      userId: req.user.userId,
      accountId,  
      profileId  
    };
    if (profileId) {
      payload.profileId = new mongoose.Types.ObjectId(profileId);
    }

    if (prefixId) {
      // --- New: server issues deviceId from prefix ---
      const p = await DevicePrefix.findByIdAndUpdate(
        prefixId,
        { $inc: { sequence: 1 } },
        { new: true, session }
      );
      if (!p) throw new Error("Invalid prefixId");

      const second = pad5(p.sequence);                    
      payload.deviceId = `${p.prefix}-${second}`;        
      payload.deviceType = p.deviceName;                
      payload.manufacturer = p.manufacturer;       
    } else {
     
      if (!deviceId || !deviceType || !manufacturer) {
        throw new Error("deviceId, deviceType and manufacturer are required (or provide prefixId)");
      }
      if (!ID_RX.test(deviceId)) {
        throw new Error("deviceId must match ######-XXXXXXXXXXXX (4 digits, hyphen, 12 hex chars)");
      }
      payload.deviceId = deviceId.trim().toUpperCase();
      payload.deviceType = deviceType.trim();
      payload.manufacturer = manufacturer.trim();
    }

    console.log(">>> Creating device with payload:", payload);
    const [device] = await Device.create([payload]);
    console.log(">>> Device created:", device._id, "deviceId:", device.deviceId, "status:", device.status);

    const user = await User.findById(req.user.userId);
    console.log(">>> Found user:", req.user.userId, "=>", user ? "YES" : "NO");

    if (user) {
      console.log(">>> Before push, user.devices:", user.devices);

      user.devices.push(device._id);
      console.log(">>> After push, user.devices:", user.devices);

      if (!user.activeDevice && device.status === "active") {
        console.log(">>> No activeDevice set, assigning device:", device._id);
        user.activeDevice = new mongoose.Types.ObjectId(device._id);
      } else {
        console.log(">>> activeDevice already set or device not active:",
          "activeDevice:", user.activeDevice,
          "device.status:", device.status
        );
      }

      await user.save();
      console.log(">>> User saved with activeDevice:", user.activeDevice);
    } else {
      console.log(">>> No user found with ID:", req.user.userId);
    }


    return res.status(201).json({
      message: "Device added successfully",
      device,
      createdAt: device.createdAt,
      formattedDate: device.createdAt.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    });
  }
  catch (error) {

    // duplicate key (unique deviceId)
    if (error && error.code === 11000) {
      return res.status(409).json({
        status: "fail",
        message: "A device with this Device ID already exists."
      });
    }

    // validation / format errors
    if (error && (error.name === 'ValidationError' || error.message)) {
      return res.status(400).json({
        status: "fail",
        message: error.message || "Validation failed"
      });
    }

    console.error("Error adding device:", error);
    return res.status(500).json({
      status: "fail",
      message: "An internal server error occurred while adding the device."
    });
  }
});


// GET /devices/organization/:organizationId - Fetch devices by organizationId (Admin only)
router.get('/devices/organization/:organizationId', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { organizationId } = req.params;

    // Convert organizationId string to ObjectId
    if (!mongoose.Types.ObjectId.isValid(organizationId)) {
      return res.status(400).json({
        status: "fail",
        message: "Invalid organization ID format"
      });
    }

    const orgObjectId = new mongoose.Types.ObjectId(organizationId);

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    // Step 1: Find all users in this organization using ObjectId
    const usersInOrg = await User.find({ organizationId: orgObjectId }).select('devices');

    if (usersInOrg.length === 0) {
      return res.status(200).json({
        status: "success",
        results: 0,
        totalPages: 0,
        currentPage: page,
        total: 0,
        organizationId,
        data: []
      });
    }

    // Step 2: Extract all device IDs from users' devices arrays
    const deviceIds = [];
    usersInOrg.forEach(user => {
      if (user.devices && user.devices.length > 0) {
        deviceIds.push(...user.devices);
      }
    });

    if (deviceIds.length === 0) {
      return res.status(200).json({
        status: "success",
        results: 0,
        totalPages: 0,
        currentPage: page,
        total: 0,
        organizationId,
        data: []
      });
    }

    // Step 3: Build filter for devices
    const filter = {
      _id: { $in: deviceIds }
    };

    // Additional filters
    if (req.query.status) {
      filter.status = req.query.status.toLowerCase().trim();
    }

    if (req.query.deviceType) {
      filter.deviceType = req.query.deviceType;
    }

    // Search by deviceId or manufacturer
    if (req.query.search) {
      filter.$or = [
        { deviceId: { $regex: req.query.search, $options: "i" } },
        { manufacturer: { $regex: req.query.search, $options: "i" } }
      ];
    }

    // Step 4: Fetch device details with pagination
    const devices = await Device.find(filter)
      .populate('userId', 'name email organizationId')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Get total count for pagination
    const total = await Device.countDocuments(filter);

    res.status(200).json({
      status: "success",
      results: devices.length,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
      organizationId,
      data: devices
    });

  } catch (error) {
    console.error("Error fetching devices by organization:", error);
    res.status(500).json({
      status: "fail",
      message: "Server error",
      error: error.message
    });
  }
});

router.get('/devices/by-deviceId/:deviceId', getByDeviceId);

router.get('/validate', validateDeviceId);

router.get("/history", authMiddleware, deviceController.getDeviceHistory);
router.get("/history/respiration", authMiddleware, deviceController.getRespirationLive);
router.get("/history/stress", authMiddleware, deviceController.getStressAggregates);

// in the same router that serves other /public routes

router.get('/public/available', async (req, res) => {
  try {
    const deviceId = String(req.query.deviceId || '').trim().toUpperCase();
    if (!deviceId) return res.status(400).json({ ok: false, message: 'deviceId required' });

    const d = await Device.findOne({ deviceId }).lean();
    return res.json({
      ok: true,
      exists: !!d,
      assigned: !!d?.userId,
      device: d || null
    });
  } catch (e) {
    res.status(500).json({ ok: false, message: e.message });
  }
});

// was: router.get('/users/suggest', ...
router.get('/users/suggest', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const limit = Math.min(parseInt(req.query.limit || '10', 10), 25);
    if (q.length < 2) return res.json({ data: [], note: 'q too short' });

    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const users = await User.find(
      { $or: [{ email: rx }, { name: rx }] },
      { _id: 1, email: 1, name: 1 }
    ).limit(limit).lean();

    res.json({ data: users });
  } catch (e) {
    console.error('users/suggest error:', e);
    res.status(500).json({ message: 'Server error' });
  }
});



// PUT /activate/:deviceId?profileId=xxxx
router.put("/activate/:deviceId", authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { profileId } = req.query;
    if (!profileId) return res.status(400).json({ message: "profileId required" });

    const device = await Device.findOne({ deviceId });
    if (!device) return res.status(404).json({ message: "Device not found" });

    // --- if already active under another profile
    if (device.status === "active" && device.profileId && device.profileId.toString() !== profileId) {
      const activeProfile = await Profile.findById(device.profileId).lean();
      return res.status(409).json({
        message: `Device ${deviceId} is already active on profile "${activeProfile?.identifier || device.profileId}"`
      });
    }

    // --- deactivate all devices for this profile
    await Device.updateMany({ profileId }, { $set: { status: "inactive" } });


    device.status = "active";
    device.profileId = new mongoose.Types.ObjectId(profileId);
    device.lastActiveAt = new Date();
    await device.save();
    await User.findByIdAndUpdate(
      device.userId,
      { $set: { activeDevice: new mongoose.Types.ObjectId(device._id) } },
      { new: true }
    );

    // --- get profile name for success message
    const newProfile = await Profile.findById(profileId).lean();

    return res.json({
      message: `Device ${deviceId} activated on profile "${newProfile?.identifier || profileId}"`,
      deviceId,
      profileId
    });

  } catch (e) {
    console.error("activate error:", e);
    res.status(500).json({ message: e.message });
  }
});


// GET /mapping/:profileId
router.get("/mapping/:profileId", authMiddleware, async (req, res) => {
  try {
    const { profileId } = req.params;
    const devices = await Device.find({ profileId }).lean();
    res.json({
      profileId,
      devices: devices.map(d => ({
        deviceId: d.deviceId,
        status: d.status,
        active: d.status === "active"
      }))
    });
  } catch (e) {
    console.error("mapping error:", e);
    res.status(500).json({ message: e.message });
  }
});


// GET /profiles/:profileId/active-device
router.get("/profiles/:profileId/active-device", authMiddleware, async (req, res) => {
  try {
    const { profileId } = req.params;
    const active = await Device.findOne({ profileId, status: "active" }).lean();
    res.json({
      profileId,
      activeDevice: active ? { deviceId: active.deviceId } : null
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /devices/user - Fetch devices assigned to logged-in user
router.get("/user", authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).lean();
    if (!user) return res.status(404).json({ message: "User not found" });

    // fetch all devices that belong to this user
    const devices = await Device.find(
      { userId: req.user.userId },
      "deviceId name deviceType manufacturer firmwareVersion location status _id customName"
    ).lean();

    // Map device names from user's deviceNames Map (for backward compatibility)
    // Mongoose Map is converted to object when using .lean(), so we need to handle both Map and Object
    let deviceNamesMap = {};
    if (user.deviceNames) {
      if (user.deviceNames instanceof Map) {
        deviceNamesMap = Object.fromEntries(user.deviceNames);
      } else {
        deviceNamesMap = user.deviceNames;
      }
    }
    
    // Priority: Device.customName > User.deviceNames > null
    const devicesWithNames = devices.map(device => ({
      ...device,
      customName: device.customName || deviceNamesMap[device.deviceId] || null
    }));

    console.log("📋 Returning devices for user:", req.user.userId, devices.map(d => d.deviceId));

    res.json({
      devices: devicesWithNames,
      activeDevice: user.activeDevice,
      deviceNames: deviceNamesMap
    });
  } catch (error) {
    console.error("Error fetching devices:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// PATCH /devices/rename/:deviceId - Update device custom name for current user
router.patch("/rename/:deviceId", authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { customName } = req.body;
    const userId = req.user.userId;

    // Validate deviceId format
    if (!deviceId || typeof deviceId !== 'string') {
      return res.status(400).json({ message: "Invalid device ID" });
    }

    const normalizedDeviceId = deviceId.trim().toUpperCase();

    // Check if device belongs to user
    const device = await Device.findOne({ deviceId: normalizedDeviceId, userId });
    if (!device) {
      return res.status(404).json({ message: "Device not found or does not belong to this user" });
    }

    // Validate customName (optional, but if provided must be non-empty string)
    let updatedName = null;
    if (customName !== undefined && customName !== null) {
      const trimmedName = String(customName).trim();
      if (trimmedName.length === 0) {
        // Remove the custom name if empty string
        device.customName = null;
      } else {
        // Set the custom name (max 50 characters)
        device.customName = trimmedName.substring(0, 50);
        updatedName = device.customName;
      }
    } else {
      // Remove custom name if null/undefined
      device.customName = null;
    }

    // Save to Device collection
    await device.save();

    // Also update User.deviceNames Map for backward compatibility
    const user = await User.findById(userId);
    if (user) {
      if (updatedName) {
        if (!user.deviceNames) {
          user.deviceNames = new Map();
        }
        user.deviceNames.set(normalizedDeviceId, updatedName);
      } else {
        // Remove from User.deviceNames if name is removed
        if (user.deviceNames) {
          user.deviceNames.delete(normalizedDeviceId);
        }
      }
      await user.save();
    }

    console.log(`✅ Device name updated for ${normalizedDeviceId}: ${updatedName || 'removed'}`);

    res.json({
      success: true,
      message: updatedName ? "Device name updated successfully" : "Device name removed",
      deviceId: normalizedDeviceId,
      customName: updatedName
    });
  } catch (error) {
    console.error("Error updating device name:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// POST /devices/auto-register - Auto-register device to current user
// Called automatically when device connects to WiFi
router.post("/auto-register", authMiddleware, async (req, res) => {
  try {
    const { serialNumber } = req.body;
    const currentUserId = req.user.userId;

    // Validate serial number
    if (!serialNumber || typeof serialNumber !== 'string') {
      return res.status(400).json({
        success: false,
        message: "Serial number is required"
      });
    }

    const deviceId = serialNumber.trim().toUpperCase();

    // Find device by deviceId (serialNumber)
    let device = await Device.findOne({ deviceId });

    const now = new Date();
    let wasReassigned = false;
    let previousUserId = null;

    if (device) {
      // Device exists - check if it needs reassignment
      previousUserId = device.userId ? device.userId.toString() : null;
      const currentUserIdStr = currentUserId.toString();

      if (previousUserId && previousUserId !== currentUserIdStr) {
        // Device is registered to another user - transfer ownership
        wasReassigned = true;
        
        // Remove device from previous user's devices array
        const previousUser = await User.findById(previousUserId);
        if (previousUser) {
          previousUser.devices = previousUser.devices.filter(
            d => d.toString() !== device._id.toString()
          );
          // If this was the active device, clear it
          if (previousUser.activeDevice && 
              previousUser.activeDevice.toString() === device._id.toString()) {
            previousUser.activeDevice = null;
          }
          await previousUser.save();
        }
      }

      // Update device to current user
      device.userId = new mongoose.Types.ObjectId(currentUserId);
      device.status = "active";
      device.wifiStatus = "CONNECTED";
      device.wifiConnectedAt = now;
      device.lastActiveAt = now;
      await device.save();

    } else {
      // Device is new - create it
      // Extract device type and manufacturer from deviceId (first 2 chars)
      const deviceType = deviceId.substring(0, 2) || "01";
      const manufacturer = "02"; // Default manufacturer, adjust as needed

      device = await Device.create({
        deviceId,
        deviceType,
        manufacturer,
        firmwareVersion: "1.0.0", // Default, can be updated later
        location: "Unknown", // Default, can be updated later
        status: "active",
        userId: new mongoose.Types.ObjectId(currentUserId),
        wifiStatus: "CONNECTED",
        wifiConnectedAt: now,
        lastActiveAt: now,
        createdAt: now,
        validity: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        profileVersion: 1
      });
    }

    // Add device to current user's devices array (if not already present)
    const currentUser = await User.findById(currentUserId);
    if (currentUser) {
      const deviceIdInArray = currentUser.devices.find(
        d => d.toString() === device._id.toString()
      );
      
      if (!deviceIdInArray) {
        currentUser.devices.push(device._id);
      }

      // Set as active device if user doesn't have one
      if (!currentUser.activeDevice && device.status === "active") {
        currentUser.activeDevice = device._id;
      }

      await currentUser.save();
    }

    return res.status(200).json({
      success: true,
      message: wasReassigned 
        ? "Device registered successfully (transferred from another user)"
        : "Device registered successfully",
      device: {
        deviceId: device.deviceId,
        _id: device._id,
        userId: device.userId,
        status: device.status,
        wifiStatus: device.wifiStatus,
        wifiConnectedAt: device.wifiConnectedAt
      },
      wasReassigned
    });

  } catch (error) {
    console.error("Error in auto-register device:", error);
    
    // Handle duplicate key error (shouldn't happen but just in case)
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Device already exists"
      });
    }

    return res.status(500).json({
      success: false,
      message: "Failed to register device",
      error: error.message
    });
  }
});


module.exports = router;