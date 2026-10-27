package com.routeragent.jev;

import java.security.Key;
import java.security.KeyStore;
import java.security.KeyStoreSpi;
import java.security.cert.Certificate;
import java.util.Collections;
import java.util.Date;
import java.util.Enumeration;
import javax.crypto.KeyGenerator;

/** Real java.security.KeyStore behaviour (not Android's provider): success, a throwing delete and a delete that leaves the key. */
public final class KeystoreErasureTest {
    /** A store whose delete either throws or silently keeps the entry, as a failing hardware-backed provider might. */
    static final class FailingSpi extends KeyStoreSpi {
        final boolean throwOnDelete;
        FailingSpi(boolean throwOnDelete) { this.throwOnDelete = throwOnDelete; }
        public Key engineGetKey(String a, char[] p) { return null; }
        public Certificate[] engineGetCertificateChain(String a) { return null; }
        public Certificate engineGetCertificate(String a) { return null; }
        public Date engineGetCreationDate(String a) { return new Date(); }
        public void engineSetKeyEntry(String a, Key k, char[] p, Certificate[] c) {}
        public void engineSetKeyEntry(String a, byte[] k, Certificate[] c) {}
        public void engineSetCertificateEntry(String a, Certificate c) {}
        public void engineDeleteEntry(String a) throws java.security.KeyStoreException { if (throwOnDelete) throw new java.security.KeyStoreException("provider refused"); }
        public Enumeration<String> engineAliases() { return Collections.enumeration(Collections.singletonList("k")); }
        public boolean engineContainsAlias(String a) { return "k".equals(a); }
        public int engineSize() { return 1; }
        public boolean engineIsKeyEntry(String a) { return true; }
        public boolean engineIsCertificateEntry(String a) { return false; }
        public String engineGetCertificateAlias(Certificate c) { return null; }
        public void engineStore(java.io.OutputStream o, char[] p) {}
        public void engineLoad(java.io.InputStream i, char[] p) {}
    }
    static KeyStore failing(boolean throwOnDelete) throws Exception {
        KeyStore store = new KeyStore(new FailingSpi(throwOnDelete), null, "failing") {};
        store.load(null, null);
        return store;
    }
    public static void main(String[] args) throws Exception {
        KeyStore real = KeyStore.getInstance("PKCS12");
        real.load(null, null);
        real.setEntry("k", new KeyStore.SecretKeyEntry(KeyGenerator.getInstance("AES").generateKey()), new KeyStore.PasswordProtection("p".toCharArray()));
        if (!KeystoreErasure.delete(real, "k")) throw new AssertionError("a real delete must report erased");
        if (real.containsAlias("k")) throw new AssertionError("key must be gone");
        if (!KeystoreErasure.delete(real, "k")) throw new AssertionError("an absent key is erased");
        if (KeystoreErasure.delete(failing(true), "k")) throw new AssertionError("a throwing delete must not report erased");
        if (KeystoreErasure.delete(failing(false), "k")) throw new AssertionError("a delete that leaves the key must not report erased");
        System.out.println("Android Keystore erasure: 5 checks passed.");
    }
}
