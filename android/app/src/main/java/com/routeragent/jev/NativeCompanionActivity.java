package com.routeragent.jev;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Complete native Android companion client. Scoped access; no consequential approval or shell authority. */
public final class NativeCompanionActivity extends Activity {
    private static final int BG=Color.rgb(11,16,27), PANEL=Color.rgb(25,32,45), ELEVATED=Color.rgb(34,42,58),
            FG=Color.rgb(237,242,250), MUTED=Color.rgb(164,179,201), ACCENT=Color.rgb(121,170,255),
            WARN=Color.rgb(240,207,143), DANGER=Color.rgb(255,164,168), SUCCESS=Color.rgb(134,232,171);

    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private NativeSessionStore store;
    private NativeSessionStore.Session session;
    private final NativeCompanionClient client=new NativeCompanionClient();
    private volatile boolean destroyed;

    private int activeTab = 0; // 0 = Tasks, 1 = Chat, 2 = System
    private JSONObject latestSnapshot;
    private final List<ChatMessage> chatHistory = new ArrayList<>();
    private String activeInferenceTaskId = null;

    private static final class ChatMessage {
        final String sender;
        final String text;
        final boolean isUser;
        final long time;
        ChatMessage(String sender, String text, boolean isUser) {
            this.sender = sender;
            this.text = text;
            this.isUser = isUser;
            this.time = System.currentTimeMillis();
        }
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store=new NativeSessionStore(this);
        root=new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setBackgroundColor(BG);
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            if(Build.VERSION.SDK_INT>=30) Insets30.apply(view,insets);
            else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        if(Build.VERSION.SDK_INT>=30) getWindow().setDecorFitsSystemWindows(false);
        setContentView(root);
        loading("Connecting securely to workstation…");
        worker.execute(() -> {
            try {
                NativeSessionStore.Session saved=store.load();
                post(() -> {
                    session=saved;
                    if(saved==null) pairing(null);
                    else loadState();
                });
            } catch(Exception e) {
                post(() -> pairing("The protected session is unavailable. Revoke the old device on Windows before pairing again."));
            }
        });
    }

    private static final class Insets30 {
        static void apply(View view,WindowInsets insets) {
            android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
        }
    }

    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
    private GradientDrawable surface(int color) {return surface(color, 12);}
    private GradientDrawable surface(int color, int radiusDp) {
        GradientDrawable d=new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(radiusDp));
        return d;
    }

    private TextView text(String value,int size,int color) {
        TextView v=new TextView(this);
        v.setText(value);
        v.setTextSize(size);
        v.setTextColor(color);
        v.setLineSpacing(dp(3),1.05f);
        return v;
    }

    private void add(LinearLayout parent,View child,int top) {
        LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);
        p.topMargin=dp(top);
        parent.addView(child,p);
    }

    private Button button(String label,boolean primary,View.OnClickListener action) {
        Button b=new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setMinHeight(dp(48));
        b.setTextSize(15);
        b.setTextColor(primary?BG:FG);
        b.setBackground(surface(primary?ACCENT:PANEL));
        b.setOnClickListener(action);
        return b;
    }

    private void post(Runnable action) {
        main.post(() -> {if(!destroyed && !isFinishing()) action.run();});
    }

    private LinearLayout page(String heading) {
        root.removeAllViews();
        ScrollView scroll=new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body=new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(20),dp(24),dp(20),dp(24));

        TextView eyebrow=text("BUNNY A  /  LOKAM · NATIVE COMPANION",11,MUTED);
        add(body,eyebrow,0);

        TextView title=text(heading,26,FG);
        title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        add(body,title,12);

        scroll.addView(body);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));

        if(session != null) {
            root.addView(createBottomNavigation(), new LinearLayout.LayoutParams(-1, -2));
        }
        return body;
    }

    private View createBottomNavigation() {
        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackgroundColor(Color.rgb(18, 24, 36));
        nav.setPadding(dp(8), dp(6), dp(8), dp(6));

        nav.addView(createNavItem("📋 Tasks", 0), new LinearLayout.LayoutParams(0, dp(48), 1f));
        nav.addView(createNavItem("💬 Chat", 1), new LinearLayout.LayoutParams(0, dp(48), 1f));
        nav.addView(createNavItem("⚙️ System", 2), new LinearLayout.LayoutParams(0, dp(48), 1f));
        return nav;
    }

    private Button createNavItem(String label, int index) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setTextColor(activeTab == index ? ACCENT : MUTED);
        b.setBackground(surface(activeTab == index ? PANEL : Color.TRANSPARENT, 8));
        b.setContentDescription(label);
        b.setOnClickListener(v -> {
            activeTab = index;
            renderCurrentTab();
        });
        return b;
    }

    private void loading(String message) {
        LinearLayout body=page("Bunny A");
        add(body,text(message,16,MUTED),20);
    }

    private void pairing(String error) {
        LinearLayout body=page("Pair with Windows");
        add(body,text("Secure companion pairing over HTTPS. All model inference and consequential approvals stay on your Windows workstation.",14,MUTED),10);
        if(error!=null) add(body,text(error,14,WARN),14);

        add(body,text("Workstation HTTPS Gateway Address",13,FG),20);
        EditText address=new EditText(this);
        address.setSingleLine(true);
        address.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
        address.setTextColor(FG);
        address.setHintTextColor(MUTED);
        address.setHint("https://your-workstation.example");
        address.setPadding(dp(14),dp(12),dp(14),dp(12));
        address.setBackground(surface(PANEL));
        address.setContentDescription("Workstation HTTPS Address");
        add(body,address,6);

        add(body,text("One-Time 10-Minute Pairing Code",13,FG),18);
        EditText code=new EditText(this);
        code.setSingleLine(true);
        code.setSaveEnabled(false);
        code.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);
        code.setTextColor(FG);
        code.setHintTextColor(MUTED);
        code.setHint("e.g. 12-char code from Windows");
        code.setPadding(dp(14),dp(12),dp(14),dp(12));
        code.setBackground(surface(PANEL));
        code.setContentDescription("One-time pairing code");
        add(body,code,6);

        add(body,button("Pair Securely",true,v -> {
            final String origin=address.getText().toString(), pairingCode=code.getText().toString().trim();
            if(pairingCode.isEmpty()){code.setError("Enter the one-time pairing code.");return;}
            try {ServerAddress.normalize(origin);} catch(IllegalArgumentException ex){address.setError(ex.getMessage());return;}
            loading("Verifying pairing with workstation…");
            worker.execute(() -> {
                try {
                    NativeSessionStore.Session paired=client.pair(origin,pairingCode,"Bunny Android Native Companion");
                    store.save(paired);
                    post(() -> {session=paired; loadState();});
                } catch(Exception ex){
                    post(() -> pairing("Pairing failed. Verify workstation is running, address is correct, and pairing code is fresh."));
                }
            });
        }),22);

        add(body,button("Back",false,v -> finish()),12);
    }

    private void loadState() {
        if(session==null){pairing(null);return;}
        NativeSessionStore.Session current=session;
        worker.execute(() -> {
            try {
                JSONObject snapshot=client.state(current);
                post(() -> {
                    latestSnapshot = snapshot;
                    renderCurrentTab();
                });
            } catch(Exception ex){
                post(this::offline);
            }
        });
    }

    private void renderCurrentTab() {
        if(latestSnapshot == null) {
            loadState();
            return;
        }

        switch (activeTab) {
            case 0: showTasksTab(); break;
            case 1: showChatTab(); break;
            case 2: showSystemTab(); break;
        }
    }

    // ==========================================
    // 1. TASKS TAB (A3)
    // ==========================================
    private void showTasksTab() {
        try {
            JSONObject ptasks = latestSnapshot.getJSONObject("persistentTasks");
            JSONArray tasks = ptasks.getJSONArray("tasks");

            LinearLayout body = page("Supervised Tasks");
            add(body, text("Connected to workstation. Live task supervision & progress.", 13, MUTED), 6);

            // Invariant Notice: Consequential approvals require Windows
            LinearLayout warnBanner = new LinearLayout(this);
            warnBanner.setOrientation(LinearLayout.VERTICAL);
            warnBanner.setBackground(surface(Color.rgb(38, 30, 20), 8));
            warnBanner.setPadding(dp(12), dp(10), dp(12), dp(10));
            warnBanner.addView(text("🛡️ Approval Invariant", 13, WARN));
            warnBanner.addView(text("Consequential actions (file writes, tools) require explicit approval on Windows.", 12, MUTED));
            add(body, warnBanner, 12);

            if(tasks.length() == 0) {
                add(body, text("No active or historical tasks on workstation.", 14, FG), 20);
            }

            for(int i = 0; i < Math.min(tasks.length(), 60); i++) {
                JSONObject t = tasks.getJSONObject(i);
                String id = t.getString("id");
                String title = t.optString("title", "Task");
                String state = t.optString("state", "UNKNOWN");

                LinearLayout card = new LinearLayout(this);
                card.setOrientation(LinearLayout.VERTICAL);
                card.setBackground(surface(PANEL, 10));
                card.setPadding(dp(14), dp(12), dp(14), dp(12));

                TextView titleView = text(title, 15, FG);
                titleView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
                card.addView(titleView);

                TextView stateView = text("Status: " + state + " · ID: " + id, 12, MUTED);
                card.addView(stateView);

                // Cancel button if cancellable
                if("RUNNING".equals(state) || "PLANNING".equals(state) || "WORKING".equals(state) || "AWAITING_APPROVAL".equals(state)) {
                    Button cancelBtn = new Button(this);
                    cancelBtn.setText("Stop Task");
                    cancelBtn.setAllCaps(false);
                    cancelBtn.setTextSize(12);
                    cancelBtn.setMinHeight(dp(36));
                    cancelBtn.setTextColor(DANGER);
                    cancelBtn.setBackground(surface(Color.rgb(44, 20, 24), 6));
                    cancelBtn.setOnClickListener(v -> {
                        worker.execute(() -> {
                            try {
                                client.command(session, "ptask.cancel", new JSONObject().put("id", id));
                                post(this::loadState);
                            } catch (Exception ex) {
                                post(() -> new AlertDialog.Builder(this).setMessage("Stop refused: " + ex.getMessage()).show());
                            }
                        });
                    });
                    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-2, -2);
                    lp.topMargin = dp(8);
                    card.addView(cancelBtn, lp);
                }

                add(body, card, 10);
            }

            add(body, button("Refresh Tasks", true, v -> loadState()), 20);
        } catch(Exception ex) {
            offline();
        }
    }

    // ==========================================
    // 2. CHAT TAB (A2)
    // ==========================================
    private void showChatTab() {
        LinearLayout body = page("Companion Conversation");
        add(body, text("Chat with your local AI via the authorized workstation Host.", 13, MUTED), 6);

        // Chat messages box
        LinearLayout chatBox = new LinearLayout(this);
        chatBox.setOrientation(LinearLayout.VERTICAL);
        chatBox.setBackground(surface(PANEL, 10));
        chatBox.setPadding(dp(12), dp(12), dp(12), dp(12));

        if(chatHistory.isEmpty()) {
            chatBox.addView(text("No messages yet. Send a prompt below to consult your AI.", 13, MUTED));
        }

        for(ChatMessage msg : chatHistory) {
            LinearLayout bubble = new LinearLayout(this);
            bubble.setOrientation(LinearLayout.VERTICAL);
            bubble.setBackground(surface(msg.isUser ? ELEVATED : Color.rgb(20, 28, 44), 8));
            bubble.setPadding(dp(12), dp(8), dp(12), dp(8));

            TextView sender = text(msg.sender, 11, msg.isUser ? ACCENT : SUCCESS);
            sender.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            bubble.addView(sender);

            TextView content = text(msg.text, 14, FG);
            bubble.addView(content);

            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin = dp(6);
            chatBox.addView(bubble, lp);
        }

        add(body, chatBox, 14);

        // Input row
        EditText input = new EditText(this);
        input.setHint("Type your message or query…");
        input.setTextColor(FG);
        input.setHintTextColor(MUTED);
        input.setBackground(surface(ELEVATED, 8));
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        add(body, input, 12);

        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);

        Button sendBtn = button("Send Prompt", true, v -> {
            String prompt = input.getText().toString().trim();
            if(prompt.isEmpty()) return;
            input.setText("");
            chatHistory.add(new ChatMessage("You", prompt, true));
            showChatTab();

            worker.execute(() -> {
                try {
                    JSONObject res = client.command(session, "submit", new JSONObject().put("prompt", prompt).put("mode", "fast"));
                    String reply = "Task started on workstation.";
                    if(res.has("task")) {
                        activeInferenceTaskId = res.getJSONObject("task").optString("id", null);
                    }
                    post(() -> {
                        chatHistory.add(new ChatMessage("Bunny", reply, false));
                        showChatTab();
                    });
                } catch(Exception ex) {
                    post(() -> {
                        chatHistory.add(new ChatMessage("System", "Error: " + ex.getMessage(), false));
                        showChatTab();
                    });
                }
            });
        });

        Button stopBtn = button("Stop", false, v -> {
            if(activeInferenceTaskId != null) {
                worker.execute(() -> {
                    try {
                        client.command(session, "stop", new JSONObject().put("id", activeInferenceTaskId));
                        post(() -> {
                            chatHistory.add(new ChatMessage("System", "Stop requested on workstation.", false));
                            showChatTab();
                        });
                    } catch(Exception ignored) {}
                });
            }
        });

        actions.addView(sendBtn, new LinearLayout.LayoutParams(0, -2, 2f));
        LinearLayout.LayoutParams stopParams = new LinearLayout.LayoutParams(0, -2, 1f);
        stopParams.leftMargin = dp(8);
        actions.addView(stopBtn, stopParams);

        add(body, actions, 10);
    }

    // ==========================================
    // 3. SYSTEM & PAIRING TAB (A4)
    // ==========================================
    private void showSystemTab() {
        LinearLayout body = page("Workstation Connection");
        add(body, text("Cryptographically paired native Android companion details.", 13, MUTED), 6);

        LinearLayout infoCard = new LinearLayout(this);
        infoCard.setOrientation(LinearLayout.VERTICAL);
        infoCard.setBackground(surface(PANEL, 10));
        infoCard.setPadding(dp(14), dp(14), dp(14), dp(14));

        infoCard.addView(text("HTTPS Origin", 12, MUTED));
        infoCard.addView(text(session.origin, 14, FG));

        TextView hostLabel = text("Trusted Host ID", 12, MUTED);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin = dp(10);
        infoCard.addView(hostLabel, lp);
        infoCard.addView(text(session.hostId, 13, ACCENT));

        if(latestSnapshot != null) {
            JSONObject identity = latestSnapshot.optJSONObject("hostIdentity");
            if(identity != null) {
                TextView epochLabel = text("Host Epoch", 12, MUTED);
                LinearLayout.LayoutParams lp2 = new LinearLayout.LayoutParams(-1, -2);
                lp2.topMargin = dp(10);
                infoCard.addView(epochLabel, lp2);
                infoCard.addView(text(identity.optString("epoch", "active"), 13, FG));
            }
        }

        add(body, infoCard, 14);

        add(body, button("Sync State Now", true, v -> loadState()), 20);

        add(body, button("Unpair & Revoke Companion", false, v -> {
            new AlertDialog.Builder(this)
                    .setTitle("Revoke this Device?")
                    .setMessage("This immediately invalidates the device credential on your workstation and clears local Keystore secrets.")
                    .setNegativeButton("Cancel", null)
                    .setPositiveButton("Revoke", (dialog, which) -> revoke())
                    .show();
        }), 12);
    }

    private void offline() {
        LinearLayout body=page("Connection Unavailable");
        add(body,text("The workstation could not be reached, the session may have expired, or the Host identity changed. Verify network and try again.",15,MUTED),16);
        add(body,button("Try Again",true,v -> loadState()),24);
        add(body,button("Forget Locally & Re-Pair",false,v -> new AlertDialog.Builder(this)
                .setTitle("Forget this device?")
                .setMessage("Removes local credentials from Android Keystore.")
                .setNegativeButton("Keep",null).setPositiveButton("Forget",(dialog,which) -> {
                    if(store.clear()){session=null;pairing(null);}
                }).show()),12);
    }

    private void revoke() {
        if(session==null){pairing(null);return;}
        NativeSessionStore.Session current=session;
        loading("Revoking device credential on Host…");
        worker.execute(() -> {
            try {
                client.revoke(current);
                boolean cleared=store.clear();
                post(() -> {
                    session=null;
                    pairing(cleared ? "Device revoked and unpaired successfully." : "Revocation confirmed on Host.");
                });
            } catch(Exception ex){
                post(() -> {
                    LinearLayout body=page("Revocation Refused");
                    add(body,text("Workstation did not confirm revocation: " + ex.getMessage(),14,MUTED),16);
                    add(body,button("Try Again",true,v -> revoke()),20);
                    add(body,button("Back",false,v -> renderCurrentTab()),10);
                });
            }
        });
    }

    @Override public void onBackPressed() {
        if(activeTab != 0) {
            activeTab = 0;
            renderCurrentTab();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onDestroy() {
        destroyed=true;
        worker.shutdownNow();
        super.onDestroy();
    }
}
