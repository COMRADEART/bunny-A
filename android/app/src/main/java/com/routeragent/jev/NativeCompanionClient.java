package com.routeragent.jev;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import javax.net.ssl.HttpsURLConnection;

/** HTTPS only; no redirects and no workstation credentials or shell commands. */
final class NativeCompanionClient {
    /** What failed, so the screen can say whether to wait, retry or pair again. Messages never carry the credential. */
    static final class Failure extends Exception {
        static final int NETWORK = 1, AUTH = 2, IDENTITY = 3, RATE_LIMITED = 4, REFUSED = 5, UNAVAILABLE = 6, PROTOCOL = 7;
        final int kind;
        final String code;
        final long retryAfterMs;
        Failure(int kind, String message, String code, long retryAfterMs) { super(message); this.kind=kind; this.code=code; this.retryAfterMs=retryAfterMs; }
    }

    private static HttpsURLConnection open(String origin, String path, String method) throws Exception {
        String normalized=ServerAddress.normalize(origin);
        URL target=new URL(normalized + path);
        if (!ServerAddress.sameOrigin(normalized,target.toString())) throw new SecurityException("Origin changed.");
        HttpsURLConnection connection=(HttpsURLConnection) target.openConnection();
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(15000);
        connection.setRequestMethod(method); connection.setRequestProperty("Accept","application/json");
        connection.setRequestProperty("Origin",normalized.substring(0,normalized.length()-1));
        return connection;
    }
    private static String read(InputStream in) throws Exception {
        if(in==null) return "";
        try(InputStream body=in; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[4096]; int n, total=0;
            while((n=body.read(buffer))!=-1) { total+=n; if(total>2_000_000) throw new Failure(Failure.PROTOCOL,"Response too large.",null,0); out.write(buffer,0,n); }
            return out.toString("UTF-8");
        }
    }
    private static JSONObject response(HttpsURLConnection c) throws Exception {
        int status;
        try { status=c.getResponseCode(); }
        catch(javax.net.ssl.SSLException e) { throw new Failure(Failure.IDENTITY,"The workstation's HTTPS certificate was not trusted. Nothing was sent.",null,0); }
        catch(IOException e) { throw new Failure(Failure.NETWORK,"The workstation could not be reached.",null,0); }
        if(status>=200 && status<300) {
            try { return new JSONObject(read(c.getInputStream())); }
            catch(Failure f) { throw f; }
            catch(Exception e) { throw new Failure(Failure.PROTOCOL,"The workstation sent an unreadable answer.",null,0); }
        }
        JSONObject error;
        try { error=new JSONObject(read(c.getErrorStream())); } catch(Exception e) { error=new JSONObject(); }
        String code=error.optString("code",null), message=error.optString("error","");
        if(status==401) throw new Failure(Failure.AUTH,"This phone's access ended (revoked, expired or replaced). Pair it again from Windows.",code,0);
        if(status==429) throw new Failure(Failure.RATE_LIMITED,"The workstation asked this phone to slow down.",code,Math.max(1000,error.optLong("retryAfterMs",5000)));
        if("HOST_IDENTITY_CHANGED".equals(code)) throw new Failure(Failure.IDENTITY,"A different workstation answered. Nothing was changed; pair again if this is expected.",code,0);
        if(status==503) throw new Failure(Failure.UNAVAILABLE,"The workstation Host is not available right now.",code,0);
        throw new Failure(Failure.REFUSED,message.isEmpty() ? "The workstation refused this request (HTTP " + status + ")." : message,code,0);
    }
    private static void sendJson(HttpsURLConnection c, JSONObject value) throws Exception {
        c.setDoOutput(true); c.setRequestProperty("Content-Type","application/json");
        byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);
        try(OutputStream out=c.getOutputStream()) { out.write(bytes); }
        catch(javax.net.ssl.SSLException e) { throw new Failure(Failure.IDENTITY,"The workstation's HTTPS certificate was not trusted. Nothing was sent.",null,0); }
        catch(IOException e) { throw new Failure(Failure.NETWORK,"The workstation could not be reached. Nothing was sent.",null,0); }
    }
    NativeSessionStore.Session pair(String origin, String code, String name) throws Exception {
        String normalized=ServerAddress.normalize(origin);
        HttpsURLConnection c=open(normalized,"api/bunny-pair","POST");
        try {
            sendJson(c,new JSONObject().put("code",code).put("name",name));
            JSONObject body=response(c);
            if(!body.optBoolean("paired",false)) throw new IllegalStateException("Pairing was not confirmed.");
            String hostId=body.optString("hostId",""); if(hostId.isEmpty()) throw new SecurityException("Host identity missing.");
            return new NativeSessionStore.Session(normalized,NativeCookiePolicy.token(c.getHeaderFields()),hostId);
        } finally { c.disconnect(); }
    }
    JSONObject state(NativeSessionStore.Session session) throws Exception {
        HttpsURLConnection c=open(session.origin,"api/bunny-native-v1-state","GET");
        try {
            c.setRequestProperty("Cookie","bunny_device="+session.token);
            JSONObject body=response(c);
            if(!"bunny.native.state.v1".equals(body.optString("schema"))) throw new Failure(Failure.PROTOCOL,"Unsupported Host response.",null,0);
            JSONObject snapshot=body.getJSONObject("snapshot");
            JSONObject identity=snapshot.optJSONObject("hostIdentity");
            // The pinned Host identity: a snapshot from any other Host is never shown or acted on.
            if(identity==null || !session.hostId.equals(identity.optString("hostId"))) throw new Failure(Failure.IDENTITY,"A different workstation answered. Pair again if this is expected.","HOST_IDENTITY_CHANGED",0);
            return snapshot;
        } finally { c.disconnect(); }
    }
    /** One command bound to the pinned Host and the epoch of the view it came from. Never retried here. */
    JSONObject command(NativeSessionStore.Session session, String epoch, String action, JSONObject data) throws Exception {
        HttpsURLConnection c=open(session.origin,"api/bunny-native-v1-state","POST");
        try {
            c.setRequestProperty("Cookie","bunny_device="+session.token);
            JSONObject payload=new JSONObject();
            payload.put("action",action);
            payload.put("data",data==null ? new JSONObject() : data);
            payload.put("operationId",UUID.randomUUID().toString());
            JSONObject expect=new JSONObject().put("hostId",session.hostId);
            if(epoch!=null && !epoch.isEmpty()) expect.put("epoch",epoch);
            payload.put("expect",expect);
            sendJson(c,payload);
            return response(c);
        } finally { c.disconnect(); }
    }
    void revoke(NativeSessionStore.Session session) throws Exception {
        HttpsURLConnection c=open(session.origin,"api/bunny-pair","DELETE");
        try {
            c.setRequestProperty("Cookie","bunny_device="+session.token);
            JSONObject body=response(c);
            if(!body.optBoolean("signedOut",false) || !body.optBoolean("revoked",false)) throw new IllegalStateException("Host did not confirm revocation.");
        } finally { c.disconnect(); }
    }
}
