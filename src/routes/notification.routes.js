const express = require("express");
const router = express.Router();
const { authenticate } = require("../middleware/auth.middleware");
const {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead
} = require("../controllers/notification.controller");

// All notification routes require authenticated user
router.use(authenticate);

router.get("/", listNotifications);
router.patch("/:id/read", markNotificationRead);
router.patch("/read-all", markAllNotificationsRead);

module.exports = router;
