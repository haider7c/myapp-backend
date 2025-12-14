exports.isOwner = (req, res, next) => {
  if (req.user.role !== "owner")
    return res.status(403).json({ message: "Owner access only" });
  next();
};

exports.isEmployee = (req, res, next) => {
  if (req.user.role !== "employee")
    return res.status(403).json({ message: "Employee access only" });
  next();
};
