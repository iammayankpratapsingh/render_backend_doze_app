require("dotenv").config();

/**
 * Middleware to validate API key from device requests
 * Checks X-API-Key header against DOZEMATE_API_KEY from environment
 */
const deviceApiKeyMiddleware = (req, res, next) => {
  try {
    // Extract API key from header
    const apiKey = req.header("X-API-Key");

    // Check if API key is provided
    if (!apiKey) {
      return res.status(401).json({ 
        success: false,
        error: "Missing API key",
        message: "X-API-Key header is required" 
      });
    }

    // Get API key from environment
    const validApiKey = process.env.DOZEMATE_API_KEY;

    // If API key is not configured, skip validation (for development)
    if (!validApiKey) {
      console.warn("⚠️ DOZEMATE_API_KEY not configured - skipping API key validation (development mode)");
      return next(); // Skip validation and proceed
    }

    // Validate API key
    if (apiKey !== validApiKey) {
      console.warn(`⚠️ Invalid API key attempt from ${req.ip}`);
      return res.status(403).json({ 
        success: false,
        error: "Invalid API key",
        message: "The provided API key is not valid" 
      });
    }

    // API key is valid, proceed to next middleware
    next();
  } catch (error) {
    console.error("❌ Error in API key validation:", error);
    return res.status(500).json({ 
      success: false,
      error: "Internal server error",
      message: "Error validating API key" 
    });
  }
};

module.exports = deviceApiKeyMiddleware;

