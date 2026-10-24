package com.routeragent.jev;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONObject;

/** One notification method for the paired Host page. It is not a general native command bridge. */
public final class BunnyNotifications {
    static final String CHANNEL = "bunny-a-host";
    private final Activity activity;
    private final String serverUrl;
    private final WebView web;

    BunnyNotifications(Activity activity, String serverUrl, WebView web) {
        this.activity = activity;
        this.serverUrl = serverUrl;
        this.web = web;
        ensureChannel();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = activity.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL, "Bunny-A", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Host task and approval notices for this paired phone.");
        manager.createNotificationChannel(channel);
    }

    @JavascriptInterface
    public String permission() {
        if (Build.VERSION.SDK_INT < 33) return "granted";
        return activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED ? "granted" : "denied";
    }

    @JavascriptInterface
    public void requestPermission() {
        if (Build.VERSION.SDK_INT < 33) return;
        activity.runOnUiThread(() -> activity.requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 41));
    }

    @JavascriptInterface
    public void post(String json) {
        String page = web.getUrl();
        if (page == null || !ServerAddress.sameOrigin(serverUrl, page)) return;
        if (!"granted".equals(permission())) return;
        try {
            JSONObject body = new JSONObject(json);
            if (body.length() != 4 || !body.has("id") || !body.has("title") || !body.has("body") || !body.has("category")) return;
            String id = body.getString("id");
            String title = body.getString("title");
            String text = body.getString("body");
            if (id.length() < 1 || id.length() > 160 || title.length() > 80 || text.length() > 140) return;
            if (title.indexOf("Bearer ") >= 0 || text.indexOf("Bearer ") >= 0 || title.indexOf("sk-") >= 0 || text.indexOf("sk-") >= 0) return;
            NotificationManager manager = activity.getSystemService(NotificationManager.class);
            if (manager == null) return;
            Intent open = new Intent(activity, MainActivity.class);
            PendingIntent pending = PendingIntent.getActivity(activity, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(activity, CHANNEL)
                    : new Notification.Builder(activity);
            builder.setSmallIcon(android.R.drawable.stat_notify_chat)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setAutoCancel(true)
                    .setContentIntent(pending)
                    .setCategory(category(body.getString("category")));
            manager.notify(id.hashCode(), builder.build());
        } catch (Exception ignored) {
            /* A bad payload posts nothing. The in-app notice is unchanged. */
        }
    }

    private static String category(String value) {
        if ("approval_needed".equals(value) || "recovery_needed".equals(value)) return Notification.CATEGORY_STATUS;
        if ("task_failed".equals(value)) return Notification.CATEGORY_ERROR;
        return Notification.CATEGORY_EVENT;
    }
}
