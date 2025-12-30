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
      assignedAreas: user.assignedAreas || [] // Ensure assignedAreas is included
    };
    
    console.log("Auth middleware - User:", req.user);
    next();
  } catch (err) {
    console.error("Token verification error:", err);
    res.status(401).json({ message: "Token is not valid" });
  }
};