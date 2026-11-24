// ClassHub service worker — push notifications when the app is closed.
// Registered with scope "/" from index.html.
// The VAPID applicationServerKey must match the private key held by the
// send-push Edge Function (not deployed on this device yet).

self.addEventListener("push", event=>{
  let title = "ClassHub";
  let body = "You have a new update.";
  let icon = "/favicon.svg";
  let tag = "classhub-push";
  if(event.data){
    try{
      const json = event.data.json();
      title = json.title || title;
      body = json.body || body;
      icon = json.icon || icon;
      tag = json.tag || tag;
    }catch(e){
      body = event.data.text() || body;
    }
  }
  const options = {body, icon, tag, renotify:true, requireInteraction:false};
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", event=>{
  event.notification.close();
  const url = event.notification.data && event.notification.data.url ? event.notification.data.url : "/";
  event.waitUntil(
    self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
      for(const client of clients){
        if(client.url.includes(self.location.origin) && "focus" in client){
          return client.focus();
        }
      }
      if(self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
