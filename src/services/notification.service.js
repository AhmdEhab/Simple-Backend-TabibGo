const Notification = require("../models/Notification");

/**
 * Send an in-app notification (best-effort, non-blocking)
 */
const sendNotification = async ({
  userId,
  role = "all",
  type,
  title,
  body,
  referenceType = null,
  referenceId = null
}) => {
  try {
    return await Notification.create({
      userId,
      role,
      type,
      title,
      body,
      referenceType,
      referenceId
    });
  } catch (error) {
    console.error("Failed to create in-app notification:", error.message);
    return null;
  }
};

/**
 * List notifications for user
 */
const getNotifications = async (userId, queryParams = {}) => {
  const { page = 1, limit = 20, unreadOnly } = queryParams;
  const filter = { userId };
  if (unreadOnly === "true" || unreadOnly === true) {
    filter.isRead = false;
  }

  const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const notifications = await Notification.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(limit, 10));

  const total = await Notification.countDocuments(filter);
  const unreadCount = await Notification.countDocuments({ userId, isRead: false });

  return {
    notifications,
    unreadCount,
    pagination: {
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    }
  };
};

/**
 * Mark single notification as read
 */
const markAsRead = async (userId, notificationId) => {
  const notification = await Notification.findOne({ _id: notificationId, userId });
  if (!notification) {
    const error = new Error("Notification not found.");
    error.statusCode = 404;
    throw error;
  }

  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();
  return notification;
};

/**
 * Mark all notifications as read
 */
const markAllAsRead = async (userId) => {
  const now = new Date();
  await Notification.updateMany(
    { userId, isRead: false },
    { $set: { isRead: true, readAt: now } }
  );
  return true;
};

module.exports = {
  sendNotification,
  getNotifications,
  markAsRead,
  markAllAsRead
};
