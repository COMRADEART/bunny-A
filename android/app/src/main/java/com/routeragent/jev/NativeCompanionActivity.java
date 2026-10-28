package com.routeragent.jev;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
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
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native Android companion: supervises the workstation over HTTPS. No consequential approval or shell authority. */
public final class NativeCompanionActivity extends Activity {
    private static final int BG=Color.rgb(11,16,27), PANEL=Color.rgb(25,32,45), ELEVATED=Color.rgb(34,42,58),
            FG=Color.rgb(237,242,250), MUTED=Color.rgb(164,179,201), ACCENT=Color.rgb(121,170,255),
            WARN=Color.rgb(240,207,143), DANGER=Color.rgb(255,164,168), SUCCESS=Color.rgb(134,232,171);

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
    // Process-wide so a rotated or recreated screen keeps every message's state; open messages are also stored (ChatTurn.encode).
    private static ChatTurn.Book chat;
    private SharedPreferences chatStore;
    private String chatDraft="";

    private final Runnable poll=new Runnable() { @Override public void run() { pollNow(); } };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state); store=new NativeSessionStore(this);
        // Rotation recreates the screen: keep the open tab and the unsent draft.
        if(state!=null) { activeTab=state.getInt("tab",0); chatDraft=state.getString("draft",""); }
        chatStore=getSharedPreferences("native_chat_v1",MODE_PRIVATE);
        // A new process restores open messages from storage; a recreated screen keeps the live ones. Either way a send
        // started by an earlier screen can no longer report here, so it becomes "outcome unknown" (Book.interrupted).
        if(chat==null) chat=ChatTurn.Book.decode(chatStore.getString("turns",null)); else chat.interrupted();
        saveChat();
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
                post(() -> { session=saved; if(saved==null) pairing(null); else { schedulePoll(0); reconcileOpen(); } });
            } catch(Exception e) {
                post(() -> pairing("This phone could not unlock its protected session (Android Keystore). Revoke the old device on Windows, then pair again."));
            }
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); out.putInt("tab",activeTab); out.putString("draft",chatDraft); }
    @Override protected void onStart() { super.onStart(); started=true; if(session!=null) { schedulePoll(0); reconcileOpen(); } }
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

    private long pollInterval() { return PollPolicy.interval(chat.following(), activeTab==0); }

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
        boolean recovered=failures>0;
        failures=0; lastFailure=null; lastSyncAt=System.currentTimeMillis();
        snapshot=fresh;
        trackChat();
        // Reachable again: an open message is checked once against the Host's record, never re-sent.
        if(recovered) reconcileOpen();
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
    interface Failed { void failed(Exception e); }

    /** One command, never retried. Refusals are shown as the Host worded them. */
    private void runCommand(String action, JSONObject data, Done done) { runCommand(action,data,UUID.randomUUID().toString(),epoch(),done,null); }

    /** With failed set, the caller shows the outcome (chat does, on the message itself); otherwise a dialog does. */
    private void runCommand(String action, JSONObject data, String operationId, String epoch, Done done, Failed failed) {
        if(session==null) return;
        final NativeSessionStore.Session asked=session;
        commands.execute(() -> {
            try {
                JSONObject result=client.command(asked,epoch,action,data,operationId);
                post(() -> { if(done!=null) done.ok(result); schedulePoll(0); });
            } catch(Exception e) {
                post(() -> {
                    if(failed!=null) failed.failed(e);
                    if(e instanceof HostExchange.Failure && ((HostExchange.Failure) e).kind==HostExchange.Failure.AUTH) { lastFailure=(HostExchange.Failure) e; offline(); return; }
                    if(failed==null) {
                        int kind=e instanceof HostExchange.Failure ? ((HostExchange.Failure) e).kind : 0;
                        // Only a Host refusal or a send that never left the phone is "not done"; the rest stay open.
                        String title=kind==HostExchange.Failure.OUTCOME_UNKNOWN ? "Outcome unknown" : kind==HostExchange.Failure.FAILED ? "Failed, may have partly applied" : "Not done";
                        new AlertDialog.Builder(this).setTitle(title).setMessage(e instanceof HostExchange.Failure ? e.getMessage() : "The request failed.").setPositiveButton("OK",null).show();
                    }
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
        String signature=activeTab + "|" + (lastFailure==null ? "" : lastFailure.getMessage()) + "|" + chat.signature().hashCode() + "|" +
                (activeTab==1 ? "" : (String.valueOf(snapshot.optJSONObject("persistentTasks")) + snapshot.optJSONObject("missions") + snapshot.optJSONObject("hostIdentity") + snapshot.optJSONArray("tasks")).hashCode());
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
        // Chat tasks (this projection's active and recent ones), so a message with an unknown outcome can be looked up here.
        JSONArray chats=snapshot.optJSONArray("tasks");
        for(int i=0; chats!=null && i<Math.min(chats.length(),15); i++) {
            JSONObject t=chats.optJSONObject(i);
            if(t==null) continue;
            String state=t.optString("state","unknown");
            if("waiting_for_approval".equals(state)) approvals++;
            String prompt=t.optString("prompt","Chat");
            String detail="Chat · " + state.replace('_',' ') + " · " + t.optString("provider","?") + " · " + t.optString("model","?") + " · " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(t.optLong("createdAt")));
            boolean stoppable=!"completed".equals(state) && !"failed".equals(state) && !"stopped".equals(state);
            addCard(body, prompt.length()>80 ? prompt.substring(0,80) + "…" : prompt, detail, stoppable ? "stop" : null, t.optString("id"));
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

    /** Only ids, the Host, the epoch and proven states are stored; never the message text, a credential or a success. */
    private void saveChat() { chatStore.edit().putString("turns", chat.encode()).commit(); }

    private void chatChanged() {
        saveChat();
        if(activeTab==1) renderCurrentTab(false);
    }

    private static String str(JSONObject o, String key) { return o==null || o.isNull(key) ? null : o.optString(key, null); }
    private static int kindOf(Exception e) { return e instanceof HostExchange.Failure ? ((HostExchange.Failure) e).kind : 0; }

    /** Follows each acknowledged message's own task through the polled snapshot; nothing here blocks a thread. */
    private void trackChat() {
        String before=chat.signature();
        JSONArray tasks=snapshot.optJSONArray("tasks");
        long now=System.currentTimeMillis();
        for(ChatTurn turn : chat.turns) {
            if(!turn.following()) continue;
            JSONObject t=null;
            for(int i=0; tasks!=null && i<tasks.length(); i++) { JSONObject x=tasks.optJSONObject(i); if(x!=null && turn.taskId.equals(x.optString("id"))) { t=x; break; } }
            if(t==null) { turn.taskMissing(now); continue; }
            String state=t.optString("state","");
            turn.taskObserved(state, t.optString("provider","?"), t.optString("model","model"), t.optString("output",""), str(t,"error"), now);
            approveOnce(turn, state);
        }
        if(!before.equals(chat.signature())) saveChat();
    }

    /** The Host lets a phone launch only local, tool-free inference; anything else waits for Windows. Asked once per message. */
    private void approveOnce(ChatTurn turn, String taskState) {
        if(!"waiting_for_approval".equals(taskState) || turn.approveRequested || turn.taskId==null) return;
        turn.approveRequested=true;
        saveChat();
        try { runCommand("approve", new JSONObject().put("id", turn.taskId), null); } catch(Exception ignored) {}
    }

    private void sendChat(String prompt) {
        if(prompt.isEmpty() || session==null || chat.blocking()!=null) return;
        chatDraft="";
        // The operation id is chosen and stored before sending, so a lost answer can still be looked up by it.
        final ChatTurn turn=chat.start(prompt, UUID.randomUUID().toString(), session.hostId, epoch(), System.currentTimeMillis());
        chatChanged();
        JSONObject data;
        try { data=new JSONObject().put("prompt", prompt).put("mode", "fast"); }
        catch(Exception e) { turn.commandFailed(HostExchange.Failure.NETWORK, "The message could not be prepared. Nothing was sent."); chatChanged(); return; }
        runCommand("submit", data, turn.operationId, turn.epoch, res -> {
            JSONObject task=res.optJSONObject("task");
            turn.acknowledged(str(task,"id"), System.currentTimeMillis());
            if(task!=null) approveOnce(turn, task.optString("state"));
            chatChanged();
        }, e -> {
            turn.commandFailed(kindOf(e), e instanceof HostExchange.Failure ? e.getMessage() : "The request failed.");
            chatChanged();
            if(turn.state==ChatTurn.State.OUTCOME_UNKNOWN) reconcile(turn);
            // The dialog repeats the message's own line; closing it changes nothing.
            if(kindOf(e)!=HostExchange.Failure.AUTH) new AlertDialog.Builder(this).setTitle(turn.label()).setMessage(turn.text()).setPositiveButton("OK",null).show();
        });
    }

    private void reconcileOpen() { for(ChatTurn turn : chat.turns) reconcile(turn); }

    /** Read-only: asks the Host what became of this message's operation id. Never re-sends the message. */
    private void reconcile(ChatTurn turn) {
        final NativeSessionStore.Session asked=session;
        if(asked==null || !started || turn.checking || !turn.needsReconcile()) return;
        if(!asked.hostId.equals(turn.hostId)) { turn.recordGone(); chatChanged(); return; }
        JSONObject data;
        try { data=new JSONObject().put("operationId", turn.operationId); } catch(Exception e) { return; }
        turn.checking=true;
        chatChanged();
        // Bound to the message's own epoch: a restarted Host refuses (HOST_EPOCH_CHANGED) instead of answering from a new ledger.
        runCommand("operation.status", data, UUID.randomUUID().toString(), turn.epoch, res -> {
            turn.checking=false;
            JSONObject d=res.optJSONObject("data"), snap=res.optJSONObject("snapshot");
            JSONObject identity=snap==null ? null : snap.optJSONObject("hostIdentity");
            String opState=d==null ? "unknown" : d.optString("state","unknown");
            turn.reconciled(identity==null ? asked.hostId : str(identity,"hostId"), str(d,"epoch"), opState, str(d,"taskId"), str(d,"error"), System.currentTimeMillis());
            chatChanged();
            if(turn.needsReconcile() && "in_progress".equals(opState)) main.postDelayed(() -> reconcile(turn), 5000);
        }, e -> {
            turn.checking=false;
            String code=e instanceof HostExchange.Failure ? ((HostExchange.Failure) e).code : null;
            if("HOST_EPOCH_CHANGED".equals(code) || "HOST_IDENTITY_CHANGED".equals(code)) turn.recordGone(); else turn.checkFailed();
            chatChanged();
        });
    }

    private int labelColor(ChatTurn turn) {
        switch(turn.state) {
            case COMPLETED: return SUCCESS;
            case OUTCOME_UNKNOWN: case FAILED: case RECONCILED: return WARN;
            case REFUSED: case NOT_SENT: return DANGER;
            default: return MUTED;
        }
    }

    private LinearLayout bubble(String sender, String body, boolean user, String label, int labelColor) {
        LinearLayout bubble=new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        bubble.setBackground(surface(user ? ELEVATED : Color.rgb(20, 28, 44), 8));
        bubble.setPadding(dp(12), dp(8), dp(12), dp(8));
        TextView from=text(sender, 11, user ? ACCENT : SUCCESS);
        from.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        bubble.addView(from);
        if(label!=null) bubble.addView(text(label, 12, labelColor));
        TextView content=text(body, 14, FG);
        content.setTextIsSelectable(true);
        bubble.addView(content);
        bubble.setContentDescription(sender + ": " + (label==null ? "" : label + ". ") + body);
        return bubble;
    }

    /** What the user can do about a message whose outcome is open: look, never re-send it. */
    private View recoveryActions(ChatTurn turn) {
        LinearLayout row=new LinearLayout(this);
        row.setOrientation(LinearLayout.VERTICAL);
        if(turn.needsReconcile()) {
            Button check=button(turn.checking ? "Checking the workstation…" : "Check workstation", false, v -> reconcile(turn));
            check.setEnabled(!turn.checking);
            add(row, check, 8);
        }
        add(row, button("View workstation tasks", false, v -> { activeTab=0; renderCurrentTab(true); schedulePoll(0); }), 8);
        if(turn.state==ChatTurn.State.OUTCOME_UNKNOWN && !turn.released)
            add(row, button("Send a new message anyway…", false, v -> new AlertDialog.Builder(this)
                    .setTitle("Send a new message?")
                    .setMessage("The earlier message may already have run on the workstation. Bunny A could not confirm it and did not send it again. A new message is a separate request: if the earlier one ran, both will have run.")
                    .setNegativeButton("Keep waiting", null)
                    .setPositiveButton("I understand", (d, w) -> { turn.release(); chatChanged(); }).show()), 8);
        return row;
    }

    private ChatTurn followed() { for(ChatTurn t : chat.turns) if(t.following()) return t; return null; }

    private void showChatTab() {
        LinearLayout body=page("Companion Chat");
        statusView=text(statusLine(), 12, lastFailure==null ? MUTED : WARN);
        add(body, statusView, 6);
        banner(body, "🛡️ Workstation authority", "The phone can ask for local, tool-free answers and stop them. Files, shell and approvals stay on Windows.", ACCENT, Color.rgb(36, 46, 68));

        LinearLayout chatBox=new LinearLayout(this);
        chatBox.setOrientation(LinearLayout.VERTICAL);
        chatBox.setBackground(surface(PANEL, 10));
        chatBox.setPadding(dp(12), dp(12), dp(12), dp(12));
        if(chat.turns.isEmpty()) chatBox.addView(text("No messages yet.", 13, MUTED));
        for(ChatTurn turn : chat.turns) {
            String said=turn.prompt!=null ? turn.prompt : "Message sent at " + DateFormat.getTimeInstance(DateFormat.SHORT).format(new Date(turn.sentAt)) + ". Its text is not kept on this phone after Bunny A restarts.";
            add(chatBox, bubble("You", said, true, null, MUTED), 6);
            LinearLayout reply=bubble(turn.sender, turn.text(), false, turn.label() + (turn.checking ? " · checking the workstation…" : ""), labelColor(turn));
            if(turn.state==ChatTurn.State.OUTCOME_UNKNOWN || turn.state==ChatTurn.State.RECONCILED) reply.addView(recoveryActions(turn));
            add(chatBox, reply, 6);
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
        ChatTurn open=chat.blocking(), followed=followed();
        Button sendBtn=button(open==null ? "Send" : open.state==ChatTurn.State.OUTCOME_UNKNOWN ? "Resolve above first" : "Waiting…", true, v -> sendChat(chatDraft.trim()));
        sendBtn.setEnabled(open==null && lastFailure==null);
        Button stopBtn=button("Stop", false, v -> {
            ChatTurn t=followed();
            if(t==null) return;
            try { runCommand("stop", new JSONObject().put("id", t.taskId), null); } catch(Exception ignored) {}
        });
        stopBtn.setEnabled(followed!=null);
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
        session=null; snapshot=null; lastFailure=null; chat.turns.clear(); saveChat();
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
                    session=null; snapshot=null; lastFailure=null; chat.turns.clear(); saveChat();
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
