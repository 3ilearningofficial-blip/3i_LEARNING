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

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  let path = "/";
  if (data.liveClassId) path = `/live-class/${data.liveClassId}`;
  else if (data.courseId) path = `/course/${data.courseId}`;
  else if (data.materialId) path = `/material/${data.materialId}`;
  else if (data.testId) path = `/test/${data.testId}`;
  else if (data.type && String(data.type).includes("admin")) path = "/admin";
  else if (data.type === "support_message") path = "/admin";

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
