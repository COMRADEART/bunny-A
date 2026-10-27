package com.routeragent.jev;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Device credential storage for the native preview; no plaintext token is persisted. */
final class NativeSessionStore {
    private static final String ALIAS = "bunny-native-companion-v1";
    private final SharedPreferences preferences;
    NativeSessionStore(Context context) { preferences = context.getSharedPreferences("native_session_v1", Context.MODE_PRIVATE); }
    static final class Session {
        final String origin, token, hostId;
        Session(String origin, String token, String hostId) { this.origin=origin; this.token=token; this.hostId=hostId; }
    }
    private SecretKey key(boolean create) throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        if (!create) throw new IllegalStateException("Protected session key unavailable; pair again.");
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).build());
        return generator.generateKey();
    }
    void save(Session session) throws Exception {
        JSONObject value = new JSONObject().put("origin",session.origin).put("token",session.token).put("hostId",session.hostId);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE,key(true));
        byte[] encrypted=cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8));
        JSONObject stored=new JSONObject().put("iv",Base64.encodeToString(cipher.getIV(),Base64.NO_WRAP))
                .put("ciphertext",Base64.encodeToString(encrypted,Base64.NO_WRAP));
        if (!preferences.edit().putString("session",stored.toString()).commit()) throw new IllegalStateException("Could not save protected session.");
    }
    Session load() throws Exception {
        String stored=preferences.getString("session",null); if (stored==null) return null;
        JSONObject value=new JSONObject(stored);
        byte[] iv=Base64.decode(value.getString("iv"),Base64.NO_WRAP);
        byte[] encrypted=Base64.decode(value.getString("ciphertext"),Base64.NO_WRAP);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE,key(false),new GCMParameterSpec(128,iv));
        JSONObject plain=new JSONObject(new String(cipher.doFinal(encrypted),StandardCharsets.UTF_8));
        String origin=ServerAddress.normalize(plain.getString("origin"));
        String token=plain.getString("token"), hostId=plain.getString("hostId");
        if (!token.matches("[A-Za-z0-9_-]{43}") || hostId.isEmpty()) throw new IllegalStateException("Protected session is invalid.");
        return new Session(origin,token,hostId);
    }
    boolean clear() {
        boolean prefsCleared = preferences.edit().remove("session").commit();
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(ALIAS)) {
                store.deleteEntry(ALIAS);
            }
        } catch (Exception ignored) {}
        return prefsCleared;
    }
}
