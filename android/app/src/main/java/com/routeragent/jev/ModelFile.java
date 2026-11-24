package com.routeragent.jev;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/** On-device voice: where the model file lives and whether it may be loaded. A file is READY only after its SHA-256 was checked. */
final class ModelFile {
    enum Status { MISSING, PARTIAL, UNVERIFIED, READY }

    private ModelFile() {}

    static File path(File filesDir) { return new File(new File(filesDir, "models"), ModelSource.FILE); }
    static File partial(File filesDir) { return new File(new File(filesDir, "models"), ModelSource.FILE + ".part"); }

    /** Identifies the exact file that was verified; a replaced or touched file no longer matches. */
    static String marker(File f) { return f.length() + ":" + f.lastModified(); }

    static Status status(File filesDir, long expectedSize, String verifiedMarker) {
        File model = path(filesDir);
        if (model.isFile()) {
            if (model.length() != expectedSize) return Status.PARTIAL;
            return marker(model).equals(verifiedMarker) ? Status.READY : Status.UNVERIFIED;
        }
        return partial(filesDir).isFile() ? Status.PARTIAL : Status.MISSING;
    }

    /** Streams the whole file through SHA-256; both the size and the hash must match. */
    static boolean verify(File f, long expectedSize, String sha256Hex) {
        if (!f.isFile() || f.length() != expectedSize) return false;
        try (InputStream in = new FileInputStream(f)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int n; (n = in.read(buffer)) > 0;) digest.update(buffer, 0, n);
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest.digest()) hex.append(Character.forDigit((b >> 4) & 15, 16)).append(Character.forDigit(b & 15, 16));
            return hex.toString().equalsIgnoreCase(sha256Hex);
        } catch (IOException | NoSuchAlgorithmException e) {
            return false;
        }
    }
}
