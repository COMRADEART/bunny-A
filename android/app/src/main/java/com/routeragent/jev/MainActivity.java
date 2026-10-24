package com.routeragent.jev;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(11, 16, 27);
    private static final int PANEL = Color.rgb(25, 32, 45);
    private static final int FG = Color.rgb(237, 242, 250);
    private static final int MUTED = Color.rgb(164, 179, 201);
    private static final int ACCENT = Color.rgb(121, 170, 255);
    private LinearLayout root;
    private WebView web;
    private String serverUrl = "";
    private boolean failed;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        setContentView(root);
        serverUrl = getPreferences(MODE_PRIVATE).getString("server_url", "");
        if (serverUrl.isEmpty()) showConnection(); else connect(serverUrl);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private TextView text(String value, int size, int color) {
        TextView result = new TextView(this);
        result.setText(value);
        result.setTextSize(size);
        result.setTextColor(color);
        result.setLineSpacing(dp(3), 1.1f);
        return result;
    }
    private GradientDrawable surface(int color, int radius) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(radius));
        return drawable;
    }
    private Button button(String label, boolean primary, View.OnClickListener listener) {
        Button result = new Button(this);
        result.setText(label);
        result.setAllCaps(false);
        result.setTextSize(15);
        result.setTextColor(primary ? BG : FG);
        result.setMinHeight(dp(48));
        result.setPadding(dp(16), dp(8), dp(16), dp(8));
        result.setBackground(surface(primary ? ACCENT : PANEL, 10));
        result.setOnClickListener(listener);
        return result;
    }
    private void add(LinearLayout parent, View child, int top) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2);
        params.topMargin = dp(top);
        parent.addView(child, params);
    }
    private void clearPage() {
        if (web != null) {
            web.stopLoading();
            root.removeView(web);
            web.destroy();
            web = null;
        }
        root.removeAllViews();
    }
    private void showConnection() {
        clearPage();
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(32), dp(24), dp(32));
        ImageView icon = new ImageView(this);
        icon.setImageResource(R.drawable.jev_icon);
        icon.setContentDescription("Bunny-A");
        content.addView(icon, new LinearLayout.LayoutParams(dp(72), dp(72)));
        TextView title = text("Connect to Bunny-A", 28, FG);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        add(content, title, 24);
        add(content, text("Your agents, wherever you work.", 17, FG), 8);
        add(content, text("Use the secure phone address shown in Bunny Island, then enter its one-time pairing code.", 15, MUTED), 16);
        add(content, text("Computer's HTTPS address", 14, FG), 32);
        EditText address = new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setTextColor(FG);
        address.setHintTextColor(MUTED);
        address.setTextSize(16);
        address.setHint("https://your-server.example");
        address.setText(serverUrl);
        address.setPadding(dp(16), dp(16), dp(16), dp(16));
        address.setBackground(surface(PANEL, 10));
        address.setContentDescription("Computer's HTTPS address");
        add(content, address, 8);
        add(content, text("Your computer must be awake with Bunny-A Host running. A temporary tunnel address can change after reconnecting.", 13, MUTED), 12);
        add(content, button("Connect", true, view -> {
            try {
                String normalized = ServerAddress.normalize(address.getText().toString());
                serverUrl = normalized;
                getPreferences(MODE_PRIVATE).edit().putString("server_url", normalized).apply();
                ((android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
                        .hideSoftInputFromWindow(address.getWindowToken(), 0);
                connect(normalized);
            } catch (IllegalArgumentException ex) { address.setError(ex.getMessage()); }
        }), 24);
        add(content, button("Connection help", false, view -> new AlertDialog.Builder(this)
                .setTitle("Remote connection")
                .setMessage("In Bunny Island, choose Phone to find your HTTPS address and one-time pairing code.\n\nConnect to that address here, then enter the code on the pairing page. Codes expire after 10 minutes. You can revoke this device from the workstation dashboard.\n\nThe workstation must be awake. Task execution and agent credentials stay on the workstation. This APK supports any configured HTTPS gateway; it does not embed a temporary tunnel address.")
                .setPositiveButton("Got it", null).show()), 12);
        String version;
        try { version = getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
        catch (android.content.pm.PackageManager.NameNotFoundException ex) { version = "unknown"; }
        add(content, text("Bunny-A · router_agent\nAndroid 8 or newer · version " + version, 12, MUTED), 32);
        scroll.addView(content);
        root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
    }
    private void openBrowser(String url) {
        if (!url.startsWith("https://")) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
        catch (ActivityNotFoundException ex) {
            new AlertDialog.Builder(this).setMessage("Install a web browser to open this link.").setPositiveButton("OK", null).show();
        }
    }
    private void connect(String url) {
        clearPage();
        failed = false;
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(dp(12), dp(8), dp(12), dp(8));
        TextView title = text("Bunny-A", 18, FG);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        bar.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        Button reload = button("Reload", false, view -> connect(serverUrl));
        bar.addView(reload);
        LinearLayout.LayoutParams connectionParams = new LinearLayout.LayoutParams(-2, -2);
        connectionParams.leftMargin = dp(8);
        bar.addView(button("Connection", false, view -> showConnection()), connectionParams);
        root.addView(bar);
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        root.addView(progress, new LinearLayout.LayoutParams(-1, dp(4)));
        web = new WebView(this);
        web.addJavascriptInterface(new BunnyNotifications(this, url, web), "BunnyNotify");
        web.setBackgroundColor(BG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String destination = request.getUrl().toString();
                if (!"https".equalsIgnoreCase(request.getUrl().getScheme())) return true;
                if (request.hasGesture() && !ServerAddress.sameOrigin(serverUrl, destination)) {
                    openBrowser(destination);
                    return true;
                }
                // HTTPS redirects may be the trusted tunnel's sign-in flow.
                return false;
            }
            @Override public void onPageFinished(WebView view, String pageUrl) {
                progress.setVisibility(View.GONE);
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();
                showFailure("The connection's certificate could not be verified. Check your remote address and HTTPS configuration.");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showFailure("Could not reach your computer. Check your remote connection and make sure Bunny-A is running.");
            }
            @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                if (request.isForMainFrame() && response.getStatusCode() >= 400) {
                    showFailure("The server returned " + response.getStatusCode() + ". Check the address and your remote access permissions.");
                }
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(-1, 0, 1));
        web.loadUrl(url + (url.endsWith("/") ? "" : "/") + "?companion=1");
    }
    private void showFailure(String message) {
        if (failed) return;
        failed = true;
        root.post(() -> {
            if (isFinishing() || isDestroyed()) return;
            clearPage();
            LinearLayout content = new LinearLayout(this);
            content.setOrientation(LinearLayout.VERTICAL);
            content.setPadding(dp(24), dp(32), dp(24), dp(24));
            TextView title = text("Connection unavailable", 26, FG);
            title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            add(content, title, 0);
            add(content, text(message, 16, MUTED), 16);
            add(content, text(serverUrl, 14, MUTED), 16);
            add(content, button("Try again", true, view -> connect(serverUrl)), 32);
            add(content, button("Change connection", false, view -> showConnection()), 12);
            add(content, button("Open in browser", false, view -> openBrowser(serverUrl)), 12);
            ScrollView scroll = new ScrollView(this);
            scroll.addView(content);
            root.addView(scroll, new LinearLayout.LayoutParams(-1, -1));
        });
    }
    @Override public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack();
        else if (web != null) showConnection();
        else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        clearPage();
        super.onDestroy();
    }
}
