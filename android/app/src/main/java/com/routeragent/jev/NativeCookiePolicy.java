package com.routeragent.jev;
import java.util.List;
import java.util.Map;

/** Reject ambiguous, unprotected or malformed device cookies. */
final class NativeCookiePolicy {
    static String token(Map<String,List<String>> headers) {
        String token=null;
        for(Map.Entry<String,List<String>> entry:headers.entrySet()) {
            if(entry.getKey()==null || !entry.getKey().equalsIgnoreCase("Set-Cookie")) continue;
            for(String header:entry.getValue()) {
                String[] parts=header.split(";");
                if(parts.length==0 || !parts[0].trim().startsWith("bunny_device=")) continue;
                if(token!=null) throw new SecurityException("Ambiguous device credential.");
                String candidate=parts[0].trim().substring("bunny_device=".length());
                boolean secure=false,httpOnly=false,path=false,sameSite=false;
                for(int i=1;i<parts.length;i++) {
                    String flag=parts[i].trim();
                    if(flag.equalsIgnoreCase("Secure")) secure=true;
                    if(flag.equalsIgnoreCase("HttpOnly")) httpOnly=true;
                    if(flag.equalsIgnoreCase("Path=/")) path=true;
                    if(flag.equalsIgnoreCase("SameSite=Strict")) sameSite=true;
                }
                if(!secure || !httpOnly || !path || !sameSite || !candidate.matches("[A-Za-z0-9_-]{43}")) throw new SecurityException("Invalid device credential.");
                token=candidate;
            }
        }
        if(token==null) throw new SecurityException("Device credential missing.");
        return token;
    }
}
