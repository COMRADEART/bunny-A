package com.routeragent.jev;

import android.app.Activity;
import android.app.AlertDialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** A separate opt-in native preview. The existing launcher is not replaced by this incomplete client. */
public final class NativeCompanionActivity extends Activity {
    private static final int BG=Color.rgb(11,16,27), PANEL=Color.rgb(25,32,45), FG=Color.rgb(237,242,250), MUTED=Color.rgb(164,179,201), ACCENT=Color.rgb(121,170,255);
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private NativeSessionStore store;
    private NativeSessionStore.Session session;
    private final NativeCompanionClient client=new NativeCompanionClient();
    private volatile boolean destroyed;

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
        loading("Checking the protected connection…");
        worker.execute(() -> {
            try { NativeSessionStore.Session saved=store.load(); post(() -> {session=saved; if(saved==null) pairing(null); else loadState();}); }
            catch(Exception e) { post(() -> pairing("The protected session is unavailable. Revoke the old device on Windows before pairing again.")); }
        });
    }
    private static final class Insets30 {
        static void apply(View view,WindowInsets insets) {
            Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
        }
    }
    private int dp(int value) {return Math.round(value*getResources().getDisplayMetrics().density);}
    private GradientDrawable surface(int color) {GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(dp(12));return d;}
    private TextView text(String value,int size,int color) {TextView v=new TextView(this);v.setText(value);v.setTextSize(size);v.setTextColor(color);v.setLineSpacing(dp(3),1.05f);return v;}
    private void add(LinearLayout parent,View child,int top) {LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.topMargin=dp(top);parent.addView(child,p);}
    private Button button(String label,boolean primary,View.OnClickListener action) {
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setMinHeight(dp(48));b.setTextSize(15);b.setTextColor(primary?BG:FG);b.setBackground(surface(primary?ACCENT:PANEL));b.setOnClickListener(action);return b;
    }
    private LinearLayout page(String heading) {
        root.removeAllViews(); ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(dp(24),dp(32),dp(24),dp(32));
        TextView eyebrow=text("BUNNY A  /  LOKAM · NATIVE PREVIEW",12,MUTED); add(body,eyebrow,0);
        TextView title=text(heading,28,FG);title.setTypeface(Typeface.DEFAULT,Typeface.BOLD);add(body,title,16);
        scroll.addView(body);root.addView(scroll,new LinearLayout.LayoutParams(-1,-1));return body;
    }
    private void post(Runnable action) {main.post(() -> {if(!destroyed && !isFinishing()) action.run();});}
    private void loading(String message) {LinearLayout body=page("Bunny A");add(body,text(message,16,MUTED),20);}
    private void pairing(String error) {
        LinearLayout body=page("Pair with Windows");
        add(body,text("This preview supports secure pairing and task status. Conversation, approvals, and voice are not yet available here.",15,MUTED),12);
        if(error!=null) add(body,text(error,15,FG),16);
        add(body,text("Computer's HTTPS address",14,FG),24);
        EditText address=new EditText(this);address.setSingleLine(true);address.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);address.setTextColor(FG);address.setHintTextColor(MUTED);address.setHint("https://your-server.example");address.setPadding(dp(16),dp(12),dp(16),dp(12));address.setBackground(surface(PANEL));address.setContentDescription("Computer's HTTPS address");add(body,address,8);
        add(body,text("One-time pairing code",14,FG),20);
        EditText code=new EditText(this);code.setSingleLine(true);code.setSaveEnabled(false);code.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS);code.setTextColor(FG);code.setHintTextColor(MUTED);code.setPadding(dp(16),dp(12),dp(16),dp(12));code.setBackground(surface(PANEL));code.setContentDescription("One-time pairing code");add(body,code,8);
        add(body,button("Pair",true,v -> {
            final String origin=address.getText().toString(), pairingCode=code.getText().toString().trim();
            if(pairingCode.isEmpty()){code.setError("Enter the one-time pairing code.");return;}
            try {ServerAddress.normalize(origin);} catch(IllegalArgumentException ex){address.setError(ex.getMessage());return;}
            loading("Pairing securely…");
            worker.execute(() -> {
                try {NativeSessionStore.Session paired=client.pair(origin,pairingCode,"Bunny Android native preview");store.save(paired);post(() -> {session=paired;loadState();});}
                catch(Exception ex){post(() -> pairing("Pairing failed. Check the address and code, then try again."));}
            });
        }),24);
        add(body,button("Back to companion",false,v -> finish()),12);
    }
    private void loadState() {
        if(session==null){pairing(null);return;}
        NativeSessionStore.Session current=session; loading("Connecting to your computer…");
        worker.execute(() -> {
            try {JSONObject snapshot=client.state(current);post(() -> showState(snapshot));}
            catch(Exception ex){post(() -> offline());}
        });
    }
    private void offline() {
        LinearLayout body=page("Connection unavailable");
        add(body,text("The workstation could not be reached, the session may have expired, or the Host identity may have changed. Check your secure connection and try again.",16,MUTED),16);
        add(body,button("Try again",true,v -> loadState()),24);
        add(body,button("Forget locally and pair again",false,v -> new AlertDialog.Builder(this)
                .setTitle("Forget this device?")
                .setMessage("This only removes the local credential. If the Host is unreachable, revoke the old device on Windows too.")
                .setNegativeButton("Keep",null).setPositiveButton("Forget locally",(dialog,which) -> {if(store.clear()){session=null;pairing(null);}else{new AlertDialog.Builder(this).setMessage("The local credential could not be removed.").setPositiveButton("OK",null).show();}}).show()),12);
        add(body,button("Back to companion",false,v -> finish()),12);
    }
    private void showState(JSONObject snapshot) {
        try {
            JSONObject tasks=snapshot.getJSONObject("persistentTasks");
            if(!"ma4.ptask.snapshot.v1".equals(tasks.optString("schema"))) throw new IllegalStateException("Unsupported task snapshot.");
            JSONArray rows=tasks.getJSONArray("tasks");
            LinearLayout body=page("Your tasks");
            add(body,text("Connected to your Windows Host. The task list is read-only.",15,MUTED),12);
            if(rows.length()==0) add(body,text("No tasks in the current Host snapshot.",16,FG),24);
            for(int i=0;i<Math.min(rows.length(),200);i++) {
                JSONObject task=rows.getJSONObject(i);String title=task.getString("title"), state=task.getString("state");
                TextView row=text(title + "\n" + state,16,FG);row.setPadding(dp(16),dp(16),dp(16),dp(16));row.setBackground(surface(PANEL));add(body,row,12);
            }
            add(body,button("Refresh",true,v -> loadState()),24);
            add(body,button("Unpair this device",false,v -> revoke()),12);
            add(body,button("Back to companion",false,v -> finish()),12);
        } catch(Exception ex) {offline();}
    }
    private void revoke() {
        if(session==null){pairing(null);return;}
        NativeSessionStore.Session current=session;loading("Unpairing…");
        worker.execute(() -> {
            try {client.revoke(current);boolean cleared=store.clear();post(() -> {session=null;pairing(cleared ? "Device unpaired." : "The Host revoked this device, but the local credential could not be removed.");});}
            catch(Exception ex){post(() -> {LinearLayout body=page("Unpairing not confirmed");add(body,text("The Host did not confirm revocation. Try again or revoke this device on the Windows workstation.",15,MUTED),16);add(body,button("Try again",true,v -> revoke()),24);add(body,button("Back",false,v -> loadState()),12);});}
        });
    }
    @Override protected void onDestroy() {destroyed=true;worker.shutdownNow();super.onDestroy();}
}
