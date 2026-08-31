const jwt = require("jsonwebtoken");
const User = require("../models/User");

module.exports = async function (req, res, next) {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Fetch fresh user data from database to get latest assignedAreas
    const user = await User.findById(decoded.id).select("-password");
    
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    
    req.user = {
      id: user._id,
      role: user.role,
      ownerId: user.ownerId,
      assignedAreas: user.assignedAreas || [], // Ensure assignedAreas is included
      locationOnly: !!user.locationOnly,
    };

    // A locationOnly account is meant to do exactly one thing through the
    // API: look up customers (for the autocomplete) and set/update a
    // customer's GPS location. That's enforced here -- not just by the app
    // routing them to a single screen -- so the restriction holds even if
    // someone calls the API directly with this account's token. Every
    // other authenticated route in the app runs through this same
    // middleware, so this one check covers all of them.
    //
    // req.baseUrl is the mount prefix from server.js (e.g. "/api/customers")
    // and req.path is the matched path *within* that router, so this reads
    // as: GET /api/customers (the list, for the ID search box) or
    // PUT /api/customers/:id/location (saving a location).
    if (req.user.locationOnly) {
      const isCustomerList = req.baseUrl === "/api/customers" && req.method === "GET" && req.path === "/";
      const isSetLocation =
        req.baseUrl === "/api/customers" && req.method === "PUT" && /^\/[^/]+\/location$/.test(req.path);

      if (!isCustomerList && !isSetLocation) {
        return res.status(403).json({
          message: "This account can only look up customers and set their location.",
        });
      }
    }

    console.log("Auth middleware - User:", req.user);
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    res.status(401).json({ message: "Token is not valid" });
  }
};