package com.routeragent.jev;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.text.Editable;
import android.text.InputType;
import android.text.TextWatcher;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.os.Handler;
import android.os.Looper;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.DateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native Android companion: supervises the workstation over HTTPS. No consequential approval or shell authority. */
public final class NativeCompanionActivity extends Activity {
    private static final int BG=Color.rgb(11,16,27), PANEL=Color.rgb(25,32,45), ELEVATED=Color.rgb(34,42,58),
            FG=Color.rgb(237,242,250), MUTED=Color.rgb(164,179,201), ACCENT=Color.rgb(121,170,255),
            WARN=Color.rgb(240,207,143), DANGER=Color.rgb(255,164,168), SUCCESS=Color.rgb(134,232,171);
    private static final long CHAT_TRACK_LIMIT_MS=10*60_000;

    // Reads and commands run on separate threads so Stop never waits behind a state request.
    private final ExecutorService reads=Executors.newSingleThreadExecutor();
    private final ExecutorService commands=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private final NativeCompanionClient client=new NativeCompanionClient();
    private LinearLayout root;
    private NativeSessionStore store;
    private NativeSessionStore.Session session;
    private volatile boolean destroyed;

    private boolean started, pollInFlight;
    private final PollPolicy policy=new PollPolicy();
    private int failures;
    private HostExchange.Failure lastFailure;
    private long lastSyncAt, nextRetryAt;
    private JSONObject snapshot;
    private String renderedSignature="";
    private TextView statusView;

    private int activeTab=0; // 0 = Tasks, 1 = Chat, 2 = System
    private final List<ChatMessage> chatHistory=new ArrayList<>();
    private String chatDraft="";
    private String pendingChatTaskId;
    private long pendingChatSince;
    private int chatVersion;

    private static final class ChatMessage {
        final String sender, text;
        final boolean isUser;
        ChatMessage(String sender, String text, boolean isUser) { this.sender=sender; this.text=text; this.isUser=isUser; }
    }

    private final Runnable poll=new Runnable() { @Override public void run() { pollNow(); } };

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
        reads.execute(() -> {
            try {
                NativeSessionStore.Session saved=store.load();
                post(() -> { session=saved; if(saved==null) pairing(null); else schedulePoll(0); });
            } catch(Exception e) {
                post(() -> pairing("This phone could not unlock its protected session (Android Keystore). Revoke the old device on Windows, then pair again."));
            }
        });
    }

    @Override protected void onStart() { super.onStart(); started=true; if(session!=null) schedulePoll(0); }
    @Override protected void onStop() { started=false; main.removeCallbacks(poll); super.onStop(); }
    @Override protected void onDestroy() {
        destroyed=true;
        main.removeCallbacksAndMessages(null);
        reads.shutdownNow();
        commands.shutdownNow();
        super.onDestroy();
    }

    private static final class Insets30 {
        static void apply(View view,WindowInsets insets) {
            // The keyboard is an inset too: with edge-to-edge drawing, adjustResize alone does not lift the input row.
            android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
        }
    }

    // ==========================================
    // POLLING (HTTP polling, not streaming)
    // ==========================================

    private long pollInterval() { return PollPolicy.interval(pendingChatTaskId!=null, activeTab==0); }

    private void schedulePoll(long delayMs) {
        main.removeCallbacks(poll);
        if(started && session!=null && !destroyed) main.postDelayed(poll,delayMs);
    }

    private void pollNow() {
        if(!started || session==null || pollInFlight || destroyed) return;
        pollInFlight=true;
        final int generation=policy.issue();
        final NativeSessionStore.Session asked=session;
        reads.execute(() -> {
            try {
                JSONObject fresh=client.state(asked);
                post(() -> onSnapshot(generation,asked,fresh));
            } catch(Exception e) {
                post(() -> onPollFailed(generation,asked,e));
            }
        });
    }

    private void onSnapshot(int generation, NativeSessionStore.Session asked, JSONObject fresh) {
        pollInFlight=false;
        // A response for an earlier session or older than one already shown never overwrites newer state.
        if(asked!=session || !policy.accept(generation)) { schedulePoll(pollInterval()); return; }
        failures=0; lastFailure=null; lastSyncAt=System.currentTimeMillis();
        snapshot=fresh;
        trackChat();
        renderCurrentTab(false);
        if(statusView!=null) statusView.setText(statusLine());
        schedulePoll(pollInterval());
    }

    private void onPollFailed(int generation, NativeSessionStore.Session asked, Exception e) {
        pollInFlight=false;
        if(asked!=session) return;
        lastFailure=e instanceof HostExchange.Failure ? (HostExchange.Failure) e
                : new HostExchange.Failure(HostExchange.Failure.NETWORK,"The workstation could not be reached.",null,0);
        if(lastFailure.kind==HostExchange.Failure.AUTH || lastFailure.kind==HostExchange.Failure.IDENTITY) {
            // No retry loop: the credential or the Host identity is no longer valid for this phone.
            offline();
            return;
        }
        failures++;
        long delay=PollPolicy.backoff(failures, lastFailure.kind==HostExchange.Failure.RATE_LIMITED ? lastFailure.retryAfterMs : 0);
        nextRetryAt=System.currentTimeMillis()+delay;
        if(snapshot==null) offline(); else renderCurrentTab(true);
        schedulePoll(delay);
    }

    private String epoch() {
        JSONObject identity=snapshot==null ? null : snapshot.optJSONObject("hostIdentity");
        return identity==null ? null : identity.optString("epoch",null);
    }

    interface Done { void ok(JSONObject result); }

    /** One command, never retried. Refusals are shown as the Host worded them. */
    private void runCommand(String action, JSONObject data, Done done) {
        if(session==null) return;
        final NativeSessionStore.Session asked=session;
        final String epoch=epoch();
        commands.execute(() -> {
            try {
                JSONObject result=client.command(asked,epoch,action,data);
                post(() -> { if(done!=null) done.ok(result); schedulePoll(0); });
            } catch(Exception e) {
                post(() -> {
                    String message=e instanceof HostExchange.Failure ? e.getMessage() : "The request failed.";
                    if(e instanceof HostExchange.Failure && ((HostExchange.Failure) e).kind==HostExchange.Failure.AUTH) { lastFailure=(HostExchange.Failure) e; offline(); return; }
                    int kind=e instanceof HostExchange.Failure ? ((HostExchange.Failure) e).kind : 0;
                    // Only a Host refusal or a send that never left the phone is "not done"; the rest stay open.
                    String title=kind==HostExchange.Failure.OUTCOME_UNKNOWN ? "Outcome unknown" : kind==HostExchange.Failure.FAILED ? "Failed, may have partly applied" : "Not done";
                    new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("OK",null).show();
                    schedulePoll(0);
                });
            }
        });
    }

    // ==========================================
    // VIEW HELPERS
    // ==========================================

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

    private ScrollView scroll;

    private LinearLayout page(String heading) {
        root.removeAllViews();
        statusView=null;
        scroll=new ScrollView(this);
        scroll.setFillViewport(true);
        LinearLayout body=new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(20),dp(24),dp(20),dp(24));

        add(body,text("BUNNY A  /  LOKAM · NATIVE COMPANION",11,MUTED),0);
        TextView title=text(heading,26,FG);
        title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);
        if(Build.VERSION.SDK_INT>=28) title.setAccessibilityHeading(true);
        add(body,title,12);

        scroll.addView(body);
        root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1f));
        if(session!=null && snapshot!=null) root.addView(createBottomNavigation(), new LinearLayout.LayoutParams(-1, -2));
        return body;
    }

    private View createBottomNavigation() {
        LinearLayout nav=new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackgroundColor(Color.rgb(18, 24, 36));
        nav.setPadding(dp(8), dp(6), dp(8), dp(6));
        nav.addView(createNavItem("📋 Tasks", "Tasks", 0), new LinearLayout.LayoutParams(0, dp(52), 1f));
        nav.addView(createNavItem("💬 Chat", "Chat", 1), new LinearLayout.LayoutParams(0, dp(52), 1f));
        nav.addView(createNavItem("⚙️ System", "System", 2), new LinearLayout.LayoutParams(0, dp(52), 1f));
        return nav;
    }

    private Button createNavItem(String label, String name, int index) {
        Button b=new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        boolean selected=activeTab==index;
        b.setTextColor(selected ? ACCENT : MUTED);
        b.setBackground(surface(selected ? PANEL : Color.TRANSPARENT, 8));
        b.setSelected(selected);
        b.setContentDescription(name + " tab" + (selected ? ", selected" : ""));
        b.setOnClickListener(v -> { activeTab=index; renderCurrentTab(true); schedulePoll(0); });
        return b;
    }

    private void loading(String message) {
        LinearLayout body=page("Bunny A");
        add(body,text(message,16,MUTED),20);
    }

    private void secure(boolean on) {
        // The one-time pairing code is a secret for its ten minutes: keep it out of screenshots and the task switcher.
        if(on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE); else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
    }

    // ==========================================
    // PAIRING
    // ==========================================

    private void pairing(String error) {
        main.removeCallbacks(poll);
        snapshot=null;
        secure(true);
        LinearLayout body=page("Pair with Windows");
        add(body,text("Secure companion pairing over HTTPS. Model work and consequential approvals stay on your Windows workstation.",14,MUTED),10);
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
        address.setContentDescription("Workstation HTTPS address");
        // The WebView build saved this address; reuse it once so an upgraded phone does not retype it.
        address.setText(getSharedPreferences("MainActivity",MODE_PRIVATE).getString("server_url",""));
        add(body,address,6);

        add(body,text("One-Time 10-Minute Pairing Code",13,FG),18);
        EditText code=new EditText(this);
        code.setSingleLine(true);
        code.setSaveEnabled(false);
        code.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS|InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD);
        code.setTextColor(FG);
        code.setHintTextColor(MUTED);
        code.setHint("Code shown on Windows");
        code.setPadding(dp(14),dp(12),dp(14),dp(12));
        code.setBackground(surface(PANEL));
        code.setContentDescription("One-time pairing code");
        add(body,code,6);

        add(body,button("Pair Securely",true,v -> {
            final String origin=address.getText().toString(), pairingCode=code.getText().toString().trim();
            if(pairingCode.isEmpty()){code.setError("Enter the one-time pairing code.");return;}
            try {ServerAddress.normalize(origin);} catch(IllegalArgumentException ex){address.setError(ex.getMessage());return;}
            loading("Verifying pairing with workstation…");
            reads.execute(() -> {
                try {
                    NativeSessionStore.Session paired=client.pair(origin,pairingCode,"Bunny Android Native Companion");
                    store.save(paired);
                    post(() -> { secure(false); session=paired; activeTab=0; schedulePoll(0); loading("Paired. Loading workstation state…"); });
                } catch(HostExchange.Failure f) {
                    post(() -> pairing(f.kind==HostExchange.Failure.NETWORK ? "The workstation could not be reached. Check the address and that it is running." : f.getMessage()));
                } catch(Exception ex){
                    post(() -> pairing("Pairing failed. Check the address, that the workstation is running, and that the code is fresh."));
                }
            });
        }),22);
        add(body,button("Close",false,v -> finish()),12);
    }

    // ==========================================
    // RENDERING
    // ==========================================

    private String statusLine() {
        if(lastFailure!=null) {
            long wait=Math.max(0,(nextRetryAt-System.currentTimeMillis())/1000);
            return "⚠️ Offline: " + lastFailure.getMessage() + " Showing data from " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(lastSyncAt)) + "; retrying in " + wait + " s.";
        }
        return "Updated " + DateFormat.getTimeInstance(DateFormat.MEDIUM).format(new Date(lastSyncAt)) + " · refreshes every " + (pollInterval()/1000.0) + " s while open";
    }

    /** Rebuilds the tab only when what it shows changed, so polling does not reset scrolling or typing. */
    private void renderCurrentTab(boolean force) {
        if(snapshot==null) { if(session!=null) loading("Connecting securely to workstation…"); return; }
        String signature=activeTab + "|" + (lastFailure==null ? "" : lastFailure.getMessage()) + "|" + chatVersion + "|" +
                (activeTab==1 ? "" : (String.valueOf(snapshot.optJSONObject("persistentTasks")) + snapshot.optJSONObject("missions") + snapshot.optJSONObject("hostIdentity")).hashCode());
        if(!force && signature.equals(renderedSignature)) return;
        renderedSignature=signature;
        secure(false);
        switch (activeTab) {
            case 0: showTasksTab(); break;
            case 1: showChatTab(); break;
            default: showSystemTab(); break;
        }
    }

    private void banner(LinearLayout body, String title, String detail, int color, int background) {
        LinearLayout box=new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setBackground(surface(background, 8));
        box.setPadding(dp(12), dp(10), dp(12), dp(10));
        box.addView(text(title, 13, color));
        if(detail!=null) box.addView(text(detail, 12, MUTED));
        add(body, box, 12);
    }

    private Button smallButton(String label, int color, View.OnClickListener action) {
        Button b=new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(13);
        b.setMinHeight(dp(48));
        b.setTextColor(color);
        b.setBackground(surface(Color.rgb(44, 20, 24), 6));
        b.setOnClickListener(action);
        return b;
    }

    private void confirmStop(String title, String action, JSONObject data) {
        new AlertDialog.Builder(this).setTitle("Stop “" + title + "”?").setMessage("The workstation stops this work. It cannot be resumed from the phone.")
                .setNegativeButton("Keep running", null).setPositiveButton("Stop", (d, w) -> runCommand(action, data, null)).show();
    }

    private void showTasksTab() {
        LinearLayout body=page("Supervised Work");
        statusView=text(statusLine(), 12, lastFailure==null ? MUTED : WARN);
        add(body, statusView, 6);
        banner(body, "🛡️ Workstation authority", "Approvals, file changes and tools are decided on Windows. This phone can watch and stop work.", WARN, Color.rgb(38, 30, 20));

        int approvals=0;
        JSONArray missions=snapshot.optJSONObject("missions")==null ? null : snapshot.optJSONObject("missions").optJSONArray("missions");
        JSONArray tasks=snapshot.optJSONObject("persistentTasks")==null ? null : snapshot.optJSONObject("persistentTasks").optJSONArray("tasks");
        int shown=0;
        for(int i=0; missions!=null && i<Math.min(missions.length(),30); i++) {
            JSONObject m=missions.optJSONObject(i);
            if(m==null) continue;
            String state=m.optString("state","unknown");
            if("waiting_for_approval".equals(state)) approvals++;
            JSONObject progress=m.optJSONObject("progress");
            String detail="Mission · " + state.replace('_',' ') + (progress!=null ? " · " + progress.optInt("completed") + "/" + progress.optInt("total") + " steps done" : "");
            boolean stoppable="planning".equals(state) || "running".equals(state) || "ready".equals(state) || "waiting_for_user".equals(state) || "verifying".equals(state) || "waiting_for_approval".equals(state);
            addCard(body, m.optString("title","Mission"), detail, stoppable ? "mission.stop" : null, m.optString("id"));
            shown++;
        }
        for(int i=0; tasks!=null && i<Math.min(tasks.length(),30); i++) {
            JSONObject t=tasks.optJSONObject(i);
            if(t==null) continue;
            if(t.optBoolean("corrupt")) { addCard(body, "Unreadable task record", "Needs attention on Windows", null, null); shown++; continue; }
            String state=t.optString("state","UNKNOWN");
            if(t.optJSONObject("pendingAction")!=null) approvals++;
            JSONObject progress=t.optJSONObject("progress");
            String detail="Task · " + t.optString("truthState", state) + (progress!=null ? " · " + progress.optInt("done") + "/" + progress.optInt("total") + " steps" : "");
            boolean stoppable="VALIDATED".equals(state) || "QUEUED".equals(state) || "RUNNING".equals(state) || "PAUSED".equals(state) || "RESUMING".equals(state) || "AWAITING_APPROVAL".equals(state);
            addCard(body, t.optString("title","Task"), detail, stoppable ? "ptask.cancel" : null, t.optString("id"));
            shown++;
        }
        if(approvals>0) banner(body, "⚖️ " + approvals + " waiting for approval", "Open Bunny A on Windows to review and decide.", ACCENT, Color.rgb(36, 46, 68));
        if(shown==0) add(body, text("No missions or tasks on the workstation.", 14, FG), 20);
        add(body, button("Refresh Now", true, v -> schedulePoll(0)), 20);
    }

    private void addCard(LinearLayout body, String title, String detail, String stopAction, String id) {
        LinearLayout card=new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(surface(PANEL, 10));
        card.setPadding(dp(14), dp(12), dp(14), dp(12));
        TextView titleView=text(title, 15, FG);
        titleView.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        card.addView(titleView);
        card.addView(text(detail, 12, MUTED));
        if(stopAction!=null && id!=null && !id.isEmpty()) {
            Button stop=smallButton("Stop", DANGER, v -> { try { confirmStop(title, stopAction, new JSONObject().put("id", id)); } catch(Exception ignored) {} });
            stop.setContentDescription("Stop " + title);
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-2, -2);
            lp.topMargin=dp(8);
            card.addView(stop, lp);
        }
        add(body, card, 10);
    }

    // ==========================================
    // CHAT
    // ==========================================

    private void setLastReply(String sender, String text) {
        if(!chatHistory.isEmpty() && !chatHistory.get(chatHistory.size()-1).isUser) chatHistory.set(chatHistory.size()-1, new ChatMessage(sender, text, false));
        else chatHistory.add(new ChatMessage(sender, text, false));
        chatVersion++;
        if(activeTab==1) renderCurrentTab(false);
    }

    /** Follows the pending chat task through the polled snapshot; nothing here blocks a thread. */
    private void trackChat() {
        if(pendingChatTaskId==null) return;
        JSONArray tasks=snapshot.optJSONArray("tasks");
        JSONObject t=null;
        for(int i=0; tasks!=null && i<tasks.length(); i++) { JSONObject x=tasks.optJSONObject(i); if(x!=null && pendingChatTaskId.equals(x.optString("id"))) { t=x; break; } }
        long elapsed=(System.currentTimeMillis()-pendingChatSince)/1000;
        if(t==null) { if(elapsed*1000>CHAT_TRACK_LIMIT_MS) { pendingChatTaskId=null; setLastReply("Bunny", "The workstation no longer lists this chat."); } return; }
        String state=t.optString("state",""), model=t.optString("model","model");
        String sender="Bunny (" + t.optString("provider","?") + " · " + model + ")";
        if("completed".equals(state)) { pendingChatTaskId=null; String out=t.optString("output",""); setLastReply(sender, out.isEmpty() ? "(The model completed with empty output.)" : out); }
        else if("failed".equals(state)) { pendingChatTaskId=null; setLastReply(sender, "Failed: " + t.optString("error","the task failed.")); }
        else if("stopped".equals(state)) { pendingChatTaskId=null; setLastReply(sender, "Stopped."); }
        else if(elapsed*1000>CHAT_TRACK_LIMIT_MS) { pendingChatTaskId=null; setLastReply(sender, "No result after " + elapsed + " s. It is still on the workstation and was not stopped."); }
        else if("waiting_for_approval".equals(state)) setLastReply(sender, "Waiting for approval on Windows.");
        else if("running".equals(state)) setLastReply(sender, "Generating (" + elapsed + " s)…");
        else setLastReply(sender, "Workstation state: " + state.replace('_',' ') + "…");
    }

    private void sendChat(String prompt) {
        if(prompt.isEmpty() || pendingChatTaskId!=null) return;
        chatDraft="";
        chatHistory.add(new ChatMessage("You", prompt, true));
        chatHistory.add(new ChatMessage("Bunny", "Sending to the workstation…", false));
        chatVersion++;
        renderCurrentTab(false);
        try {
            runCommand("submit", new JSONObject().put("prompt", prompt).put("mode", "fast"), res -> {
                JSONObject task=res.optJSONObject("task");
                if(task==null) { setLastReply("Bunny", "The workstation did not create a task for this message."); return; }
                pendingChatTaskId=task.optString("id");
                pendingChatSince=System.currentTimeMillis();
                if("waiting_for_approval".equals(task.optString("state"))) {
                    // The Host lets a phone launch only local, tool-free inference; anything else waits for Windows.
                    try {
                        runCommand("approve", new JSONObject().put("id", pendingChatTaskId), started -> setLastReply("Bunny", "Running on the workstation's local model…"));
                    } catch(Exception ignored) {}
                }
            });
        } catch(Exception e) { setLastReply("Bunny", "The message could not be sent."); }
    }

    private void showChatTab() {
        LinearLayout body=page("Companion Chat");
        statusView=text(statusLine(), 12, lastFailure==null ? MUTED : WARN);
        add(body, statusView, 6);
        banner(body, "🛡️ Workstation authority", "The phone can ask for local, tool-free answers and stop them. Files, shell and approvals stay on Windows.", ACCENT, Color.rgb(36, 46, 68));

        LinearLayout chatBox=new LinearLayout(this);
        chatBox.setOrientation(LinearLayout.VERTICAL);
        chatBox.setBackground(surface(PANEL, 10));
        chatBox.setPadding(dp(12), dp(12), dp(12), dp(12));
        if(chatHistory.isEmpty()) chatBox.addView(text("No messages yet.", 13, MUTED));
        for(ChatMessage msg : chatHistory) {
            LinearLayout bubble=new LinearLayout(this);
            bubble.setOrientation(LinearLayout.VERTICAL);
            bubble.setBackground(surface(msg.isUser ? ELEVATED : Color.rgb(20, 28, 44), 8));
            bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
            TextView sender=text(msg.sender, 11, msg.isUser ? ACCENT : SUCCESS);
            sender.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
            bubble.addView(sender);
            TextView content=text(msg.text, 14, FG);
            content.setTextIsSelectable(true);
            bubble.addView(content);
            bubble.setContentDescription(msg.sender + ": " + msg.text);
            LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1, -2);
            lp.topMargin=dp(6);
            chatBox.addView(bubble, lp);
        }
        add(body, chatBox, 14);

        EditText input=new EditText(this);
        input.setHint("Ask the workstation…");
        input.setContentDescription("Message");
        input.setTextColor(FG);
        input.setHintTextColor(MUTED);
        input.setBackground(surface(ELEVATED, 8));
        input.setPadding(dp(14), dp(12), dp(14), dp(12));
        input.setMinHeight(dp(48));
        input.setText(chatDraft);
        input.setSelection(chatDraft.length());
        input.addTextChangedListener(new TextWatcher() {
            @Override public void beforeTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(Editable s) { chatDraft=s.toString(); }
        });
        add(body, input, 12);

        LinearLayout actions=new LinearLayout(this);
        actions.setOrientation(LinearLayout.HORIZONTAL);
        Button sendBtn=button(pendingChatTaskId==null ? "Send" : "Waiting…", true, v -> sendChat(chatDraft.trim()));
        sendBtn.setEnabled(pendingChatTaskId==null && lastFailure==null);
        Button stopBtn=button("Stop", false, v -> {
            if(pendingChatTaskId==null) return;
            try { runCommand("stop", new JSONObject().put("id", pendingChatTaskId), null); } catch(Exception ignored) {}
        });
        stopBtn.setEnabled(pendingChatTaskId!=null);
        actions.addView(sendBtn, new LinearLayout.LayoutParams(0, -2, 2f));
        LinearLayout.LayoutParams stopParams=new LinearLayout.LayoutParams(0, -2, 1f);
        stopParams.leftMargin=dp(8);
        actions.addView(stopBtn, stopParams);
        add(body, actions, 10);
        // Newest message and the input stay in view after each update.
        scroll.post(() -> scroll.fullScroll(View.FOCUS_DOWN));
    }

    // ==========================================
    // SYSTEM & SESSION
    // ==========================================

    private void row(LinearLayout card, String label, String value, int color) {
        TextView l=text(label, 12, MUTED);
        LinearLayout.LayoutParams lp=new LinearLayout.LayoutParams(-1, -2);
        lp.topMargin=dp(10);
        card.addView(l, lp);
        card.addView(text(value, 13, color));
    }

    private void showSystemTab() {
        LinearLayout body=page("Workstation Connection");
        LinearLayout card=new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setBackground(surface(PANEL, 10));
        card.setPadding(dp(14), dp(4), dp(14), dp(14));
        row(card, "Status", statusLine(), lastFailure==null ? SUCCESS : WARN);
        row(card, "HTTPS origin", session.origin, FG);
        row(card, "Pinned workstation identity", session.hostId, ACCENT);
        JSONObject identity=snapshot.optJSONObject("hostIdentity");
        row(card, "Host epoch (changes when the Host restarts)", identity==null ? "unknown" : identity.optString("epoch","unknown"), FG);
        row(card, "Updates", "HTTP polling while this screen is open (every 5–10 s, 1.5 s during a chat). It stops in the background; this is not real-time streaming.", MUTED);
        row(card, "Notifications", "This companion posts no notifications and requests no notification permission.", MUTED);
        add(body, card, 14);

        add(body, button("Sync Now", true, v -> schedulePoll(0)), 20);
        add(body, button("Unpair & Revoke This Phone", false, v -> new AlertDialog.Builder(this)
                .setTitle("Revoke this phone?")
                .setMessage("The workstation invalidates this phone's credential now, and the phone erases its Android Keystore key.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Revoke", (dialog, which) -> revoke())
                .show()), 12);
    }

    private void forgetLocally() {
        boolean cleared=store.clear();
        session=null; snapshot=null; lastFailure=null; pendingChatTaskId=null; chatHistory.clear(); chatVersion++;
        pairing(cleared ? null : "This phone could not confirm erasing its local key. Clear Bunny A's app data in Android Settings to finish.");
    }

    private void offline() {
        main.removeCallbacks(poll);
        secure(false);
        int kind=lastFailure==null ? HostExchange.Failure.NETWORK : lastFailure.kind;
        boolean terminal=kind==HostExchange.Failure.AUTH || kind==HostExchange.Failure.IDENTITY;
        LinearLayout body=page(kind==HostExchange.Failure.AUTH ? "Pair Again" : kind==HostExchange.Failure.IDENTITY ? "Workstation Changed" : "Connection Unavailable");
        add(body, text(lastFailure==null ? "The workstation could not be reached." : lastFailure.getMessage(), 15, terminal ? WARN : MUTED), 16);
        if(!terminal) add(body, text("Retrying automatically in " + Math.max(0,(nextRetryAt-System.currentTimeMillis())/1000) + " s.", 13, MUTED), 8);
        add(body, button("Try Again Now", !terminal, v -> { lastFailure=null; loading("Connecting securely to workstation…"); schedulePoll(0); }), 24);
        add(body, button("Forget Locally & Re-Pair", terminal, v -> new AlertDialog.Builder(this)
                .setTitle("Forget this pairing?")
                .setMessage("Removes this phone's credential and its Android Keystore key. Revoke the device on Windows too if it is still listed.")
                .setNegativeButton("Keep", null).setPositiveButton("Forget", (dialog, which) -> forgetLocally()).show()), 12);
    }

    private void revoke() {
        if(session==null){pairing(null);return;}
        final NativeSessionStore.Session current=session;
        main.removeCallbacks(poll);
        loading("Revoking this phone on the workstation…");
        commands.execute(() -> {
            try {
                client.revoke(current);
                post(() -> {
                    boolean cleared=store.clear();
                    session=null; snapshot=null; lastFailure=null; pendingChatTaskId=null; chatHistory.clear();
                    pairing(cleared ? "This phone was revoked and its local key erased." : "Revoked on the workstation, but this phone could not confirm erasing its local key. Clear Bunny A's app data in Android Settings.");
                });
            } catch(Exception ex){
                post(() -> {
                    LinearLayout body=page("Revocation Not Confirmed");
                    add(body,text("The workstation did not confirm revocation: " + (ex instanceof HostExchange.Failure ? ex.getMessage() : "the request failed.") + " This phone kept its credential.",14,MUTED),16);
                    add(body,button("Try Again",true,v -> revoke()),20);
                    add(body,button("Back",false,v -> { renderCurrentTab(true); schedulePoll(0); }),10);
                });
            }
        });
    }

    @Override public void onBackPressed() {
        if(session!=null && snapshot!=null && activeTab!=0) {
            activeTab=0;
            renderCurrentTab(true);
        } else {
            super.onBackPressed();
        }
    }
}
