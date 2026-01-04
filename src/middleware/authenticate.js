// middleware/authenticate.js
import jwt from "jsonwebtoken";
import User from "../models/User.js";

export default async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || "";
    const [type, token] = header.split(" ");

    if (type !== "Bearer" || !token) {
      // No token: user stays unauthenticated; requireAuth will block protected routes
      return next();
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // Load the user from DB (include business + role)
    const user = await User.findById(payload.sub).select("business role status email firstName lastName displayName");

    if (!user) return next();

    // Optional: block disabled/deleted users
    if (user.status === "disabled" || user.status === "deleted") return next();

    req.user = user;
    next();
  } catch (err) {
    // Invalid token -> treat as unauthenticated
    next();
  }
}
