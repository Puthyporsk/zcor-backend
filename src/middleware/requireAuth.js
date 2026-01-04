export default function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  if (!req.user.business) {
    return res.status(403).json({ message: "No business associated with user" });
  }
  req.businessId = String(req.user.business);
  next();
};
