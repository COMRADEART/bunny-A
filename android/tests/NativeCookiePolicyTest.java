package com.routeragent.jev;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.List;

public final class NativeCookiePolicyTest {
    private static void reject(Map<String,List<String>> headers) {
        try { NativeCookiePolicy.token(headers); throw new AssertionError("unprotected cookie accepted"); }
        catch(SecurityException expected) { }
    }
    public static void main(String[] args) {
        String token="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ";
        String valid="bunny_device="+token+"; Path=/; HttpOnly; Secure; SameSite=Strict";
        Map<String,List<String>> headers=new HashMap<>(); headers.put("Set-Cookie",Collections.singletonList(valid));
        if(!token.equals(NativeCookiePolicy.token(headers))) throw new AssertionError("valid cookie rejected");
        headers.put("Set-Cookie",Collections.singletonList(valid.replace("; Secure",""))); reject(headers);
        headers.put("Set-Cookie",Collections.singletonList(valid.replace("; HttpOnly",""))); reject(headers);
        headers.put("Set-Cookie",Collections.singletonList(valid.replace("SameSite=Strict","SameSite=None"))); reject(headers);
        headers.put("Set-Cookie",Collections.singletonList(valid.replace("Path=/","Path=/wrong"))); reject(headers);
        headers.put("Set-Cookie",Arrays.asList(valid,valid)); reject(headers);
        headers.put("Set-Cookie",Collections.singletonList(valid.replace(token,"abc"))); reject(headers);
        headers.clear(); reject(headers);
        System.out.println("NativeCookiePolicyTest passed");
    }
}
