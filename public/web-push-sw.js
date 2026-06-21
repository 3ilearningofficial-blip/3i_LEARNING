self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_e) {
    payload = {};
  }

  const title = payload.title || "3i Learning";
  const options = {
    body: payload.body || "",
    icon: "/favicon.png",
    badge: "/favicon.png",
    data: payload.data || {},
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

function adminOpsPath(data) {
  const type = String(data.type || "");
  if (type === "support_message") return "/admin";
  if (
    type === "new_user_registration" ||
    type === "student_login_new_device" ||
    type === "new_purchase" ||
    type === "buy_now_abandoned" ||
    type === "app_install" ||
    type === "capture_attempt" ||
    type === "live_class_completed" ||
    (type && type.includes("admin"))
  ) {
    return "/admin";
  }
  return null;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let path = adminOpsPath(data);
  if (!path) {
    if (data.liveClassId) path = `/live-class/${data.liveClassId}`;
    else if (data.courseId) path = `/course/${data.courseId}`;
    else if (data.materialId) path = `/material/${data.materialId}`;
    else if (data.testId) path = `/test/${data.testId}`;
    else path = "/";
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(path);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(path);
      return undefined;
    })
  );
});
