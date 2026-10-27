package com.routeragent.jev;

import java.security.KeyStore;

/** Kept free of android.* so the erasure decision runs under plain JVM tests (android/tests/KeystoreErasureTest). */
final class KeystoreErasure {
    private KeystoreErasure() {}

    /** True only when the alias is observably absent afterwards; a failed or ignored delete is never reported as erased. */
    static boolean delete(KeyStore store, String alias) {
        try {
            if (store.containsAlias(alias)) store.deleteEntry(alias);
            return !store.containsAlias(alias);
        } catch (Exception e) {
            return false;
        }
    }
}
