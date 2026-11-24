package com.routeragent.jev;

import android.content.Context;
import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Content;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;
import java.io.File;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * On-device voice: a thin wrapper over LiteRT-LM. One process-wide engine (a rotated screen keeps the loaded model), one request
 * at a time on a single worker thread, a fresh conversation per request. It has no network code and never talks to the Host.
 */
final class VoiceEngine {
    interface Listener { void partial(String soFar); void done(String full); void failed(Exception e); }

    /** The AAR's minSdkVersion (litertlm-android 0.19.1). */
    static final int LIBRARY_MIN_SDK = 24;
    /** Room for a 30 s recording plus the instruction and a short answer. */
    private static final int MAX_TOKENS = 4096;

    private static final VoiceEngine INSTANCE = new VoiceEngine();
    static VoiceEngine get() { return INSTANCE; }

    private final ExecutorService worker = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "bunny-voice-engine");
        t.setDaemon(true);
        return t;
    });
    /** Bumped by cancel() and close(); a request whose ticket is stale never calls its listener again. */
    private final AtomicInteger generation = new AtomicInteger();
    private volatile Conversation current;
    private Engine engine;          // worker thread only
    private String loadedPath;      // worker thread only

    private VoiceEngine() {}

    void ask(Context context, final File model, final String system, final byte[] wav, final Listener listener) {
        final int ticket = generation.incrementAndGet();
        final String cacheDir = context.getCacheDir().getPath();
        worker.execute(() -> {
            if (ticket != generation.get()) return;
            Conversation conversation = null;
            try {
                conversation = load(model.getPath(), cacheDir).createConversation(new ConversationConfig(Contents.Companion.of(system)));
                current = conversation;
                if (ticket != generation.get()) return;
                final StringBuilder text = new StringBuilder();
                final Throwable[] error = {null};
                final CountDownLatch finished = new CountDownLatch(1);
                conversation.sendMessageAsync(Contents.Companion.of(new Content.AudioBytes(wav)), new MessageCallback() {
                    @Override public void onMessage(Message message) {
                        for (Content c : message.getContents().getContents()) if (c instanceof Content.Text) text.append(((Content.Text) c).getText());
                        if (ticket == generation.get()) listener.partial(text.toString());
                    }
                    @Override public void onDone() { finished.countDown(); }
                    @Override public void onError(Throwable t) { error[0] = t; finished.countDown(); }
                });
                while (!finished.await(250, TimeUnit.MILLISECONDS)) {
                    if (ticket != generation.get()) conversation.cancelProcess();
                }
                if (ticket != generation.get()) return;
                if (error[0] != null) throw error[0];
                listener.done(text.toString());
            } catch (Throwable t) {
                if (ticket == generation.get()) listener.failed(t instanceof Exception ? (Exception) t : new Exception(t.toString(), t));
            } finally {
                current = null;
                if (conversation != null) conversation.close();
            }
        });
    }

    /** GPU first (fastest on the phone that passed the feasibility gate), CPU when GPU initialisation throws. */
    private Engine load(String path, String cacheDir) {
        if (engine != null && path.equals(loadedPath)) return engine;
        release();
        Engine candidate = new Engine(new EngineConfig(path, new Backend.GPU(), null, new Backend.CPU(), MAX_TOKENS, null, cacheDir));
        try {
            candidate.initialize();
        } catch (RuntimeException gpuFailed) {
            candidate.close();
            candidate = new Engine(new EngineConfig(path, new Backend.CPU(), null, new Backend.CPU(), MAX_TOKENS, null, cacheDir));
            candidate.initialize();
        }
        engine = candidate;
        loadedPath = path;
        return engine;
    }

    private void release() {
        if (engine != null) engine.close();
        engine = null;
        loadedPath = null;
    }

    /** Stops the current generation; the cancelled request's listener is never called again. */
    void cancel() {
        generation.incrementAndGet();
        Conversation c = current;
        if (c != null) {
            try { c.cancelProcess(); } catch (RuntimeException ignored) { /* already finished */ }
        }
    }

    /** Frees the model's memory after any running request has stopped; safe when nothing is loaded. */
    void close() {
        cancel();
        worker.execute(this::release);
    }
}
