package com.routeragent.jev;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
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
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(10000); connection.setReadTimeout(10000);
        connection.setRequestMethod(method); connection.setRequestProperty("Accept","application/json");
        connection.setRequestProperty("Origin",normalized.substring(0,normalized.length()-1));
        return connection;
    }
    private static JSONObject response(HttpsURLConnection c) throws Exception {
        int status=c.getResponseCode();
        if(status<200 || status>=300) throw new IllegalStateException(status==401 ? "Pair this device again." : "Connection unavailable (HTTP " + status + ").");
        try(InputStream in=c.getInputStream(); ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[4096]; int n, total=0;
            while((n=in.read(buffer))!=-1) { total+=n; if(total>2_000_000) throw new IllegalStateException("Response too large."); out.write(buffer,0,n); }
            return new JSONObject(out.toString("UTF-8"));
        }
    }
    private static void sendJson(HttpsURLConnection c, JSONObject value) throws Exception {
        c.setDoOutput(true); c.setRequestProperty("Content-Type","application/json");
        byte[] bytes=value.toString().getBytes(StandardCharsets.UTF_8);
        try(OutputStream out=c.getOutputStream()) { out.write(bytes); }
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
            if(!"bunny.native.state.v1".equals(body.optString("schema"))) throw new IllegalStateException("Unsupported Host response.");
            JSONObject snapshot=body.getJSONObject("snapshot");
            if(!session.hostId.equals(snapshot.getJSONObject("hostIdentity").getString("hostId"))) throw new SecurityException("Host identity changed; pair again.");
            return snapshot;
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
