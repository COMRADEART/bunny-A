package com.routeragent.jev;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;

/**
 * On-device voice: resumable download of the model file. Bytes go to a ".part" file; a cancelled or dropped transfer keeps it
 * and the next run resumes with a Range request. Only a file whose size and SHA-256 both match is renamed into place.
 * No Host code is involved and no Cookie or Authorization header is ever set.
 */
final class ModelDownload {
    interface Opener { HttpURLConnection open(String url) throws IOException; }
    interface Progress { void at(long done, long total); boolean cancelled(); }
    enum Result { DONE, CANCELLED }

    static final String CHECKSUM_FAILED = "The downloaded model did not match its expected checksum. It was removed.";

    private ModelDownload() {}

    static Result run(Opener opener, String url, File filesDir, long expectedSize, String sha256Hex, Progress progress) throws IOException {
        File part = ModelFile.partial(filesDir);
        File model = ModelFile.path(filesDir);
        File folder = part.getParentFile();
        if (!folder.isDirectory() && !folder.mkdirs()) throw new IOException("The voice model folder could not be created.");
        long have = part.isFile() ? part.length() : 0;
        if (have > expectedSize) { delete(part); have = 0; }

        HttpURLConnection connection = opener.open(url);
        try {
            connection.setUseCaches(false);
            connection.setConnectTimeout(20_000);
            connection.setReadTimeout(30_000);
            if (have > 0) connection.setRequestProperty("Range", "bytes=" + have + "-");
            int code = connection.getResponseCode();
            if (code == 416 && have == expectedSize) {
                // Everything is already here; go straight to verification.
            } else if (code == 200 || code == 206) {
                boolean append = code == 206;
                if (append) {
                    String range = connection.getHeaderField("Content-Range");
                    if (range == null || !range.startsWith("bytes " + have + "-")) {
                        delete(part);
                        throw new IOException("The download could not resume. Try again to start it over.");
                    }
                } else {
                    have = 0;
                }
                long done = have;
                long lastReport = 0;
                try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(part, append)) {
                    byte[] buffer = new byte[64 * 1024];
                    for (int n; (n = in.read(buffer)) > 0;) {
                        out.write(buffer, 0, n);
                        done += n;
                        if (done > expectedSize) break;
                        long now = System.currentTimeMillis();
                        if (lastReport == 0 || now - lastReport >= 250) { progress.at(done, expectedSize); lastReport = now; }
                        if (progress.cancelled()) return Result.CANCELLED;
                    }
                }
                progress.at(Math.min(done, expectedSize), expectedSize);
                if (done < expectedSize) throw new IOException("The download stopped before it finished. It will resume where it stopped.");
            } else {
                throw new IOException("The voice model download failed (HTTP " + code + ").");
            }
        } finally {
            connection.disconnect();
        }

        if (!ModelFile.verify(part, expectedSize, sha256Hex)) {
            delete(part);
            throw new IOException(CHECKSUM_FAILED);
        }
        if (model.exists()) delete(model);
        if (!part.renameTo(model)) throw new IOException("The voice model could not be put in place.");
        return Result.DONE;
    }

    private static void delete(File f) throws IOException {
        if (f.exists() && !f.delete()) throw new IOException("Could not remove " + f.getName() + ".");
    }
}
