package com.routeragent.jev;

import com.routeragent.jev.HostExchange.Failure;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import javax.net.ssl.HttpsURLConnection;

/** HTTPS only; no redirects and no workstation credentials or shell commands. */
final class NativeCompanionClient {
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
    private static JSONObject json(String body) {
        try { return new JSONObject(body); } catch(Exception e) { return null; }
    }
    private static Failure refusal(int status, String body, String operationId) {
        JSONObject error=json(body);
        if(error==null) return HostExchange.refusal(status,null,"",5000,operationId);
        return HostExchange.refusal(status,error.optString("code",null),error.optString("error",""),error.optLong("retryAfterMs",5000),operationId);
    }
    /** Reads (state, revoke): a failure here never stands for a command's outcome. */
    private static JSONObject response(HttpsURLConnection c) throws Exception {
        int status;
        try { status=c.getResponseCode(); }
        catch(javax.net.ssl.SSLException e) { throw new Failure(Failure.IDENTITY,"The workstation's HTTPS certificate was not trusted.",null,0); }
        catch(IOException e) { throw new Failure(Failure.NETWORK,"The workstation could not be reached.",null,0); }
        if(status>=200 && status<300) {
            JSONObject body;
            try { body=json(HostExchange.read(c.getInputStream())); } catch(IOException e) { body=null; }
            if(body==null) throw new Failure(Failure.PROTOCOL,"The workstation sent an unreadable answer.",null,0);
            return body;
        }
        String error;
        try { error=HostExchange.read(c.getErrorStream()); } catch(IOException e) { error=""; }
        throw refusal(status,error,null);
    }
    NativeSessionStore.Session pair(String origin, String code, String name) throws Exception {
        String normalized=ServerAddress.normalize(origin);
        HttpsURLConnection c=open(normalized,"api/bunny-pair","POST");
        try {
            HostExchange.Answer answer=HostExchange.send(c,new JSONObject().put("code",code).put("name",name).toString().getBytes(StandardCharsets.UTF_8),null);
            if(answer.status<200 || answer.status>=300) throw refusal(answer.status,answer.body,null);
            JSONObject body=json(answer.body);
            if(body==null || !body.optBoolean("paired",false)) throw new IllegalStateException("Pairing was not confirmed.");
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
    /**
     * One command bound to the pinned Host and the epoch of the view it came from. The caller chooses the operation id
     * before sending so a lost answer can be looked up by it; each id is used for one send only. Never retried.
     */
    JSONObject command(NativeSessionStore.Session session, String epoch, String action, JSONObject data, String operationId) throws Exception {
        HttpsURLConnection c=open(session.origin,"api/bunny-native-v1-state","POST");
        try {
            c.setRequestProperty("Cookie","bunny_device="+session.token);
            JSONObject payload=new JSONObject();
            payload.put("action",action);
            payload.put("data",data==null ? new JSONObject() : data);
            payload.put("operationId",operationId);
            JSONObject expect=new JSONObject().put("hostId",session.hostId);
            if(epoch!=null && !epoch.isEmpty()) expect.put("epoch",epoch);
            payload.put("expect",expect);
            HostExchange.Answer answer=HostExchange.send(c,payload.toString().getBytes(StandardCharsets.UTF_8),operationId);
            if(answer.status<200 || answer.status>=300) throw refusal(answer.status,answer.body,operationId);
            JSONObject body=json(answer.body);
            // Accepted, but the answer cannot be read: it may well have been applied.
            if(body==null) throw HostExchange.unknown(operationId);
            return body;
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
