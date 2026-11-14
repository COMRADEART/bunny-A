package com.routeragent.jev;

import com.routeragent.jev.ModelFile.Status;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.security.MessageDigest;

/** Where the voice model lives, its MISSING / PARTIAL / UNVERIFIED / READY states and the hash check; exercised without Android. */
public final class ModelFileTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }

    static void write(File f, int n) throws Exception {
        f.getParentFile().mkdirs();
        try (FileOutputStream out = new FileOutputStream(f)) { for (int i = 0; i < n; i++) out.write('a' + i % 26); }
    }
    static String sha(File f) throws Exception {
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(f.toPath()))) hex.append(String.format("%02x", b));
        return hex.toString();
    }

    public static void main(String[] args) throws Exception {
        File dir = Files.createTempDirectory("bunny-model").toFile();
        check(ModelFile.path(dir).equals(new File(new File(dir, "models"), "gemma-4-E2B-it.litertlm")), "model path");
        check(ModelFile.partial(dir).getName().equals("gemma-4-E2B-it.litertlm.part"), "part path");
        check(ModelFile.status(dir, 10, null) == Status.MISSING, "nothing there");
        write(ModelFile.partial(dir), 4);  check(ModelFile.status(dir, 10, null) == Status.PARTIAL, "part file");
        write(ModelFile.path(dir), 7);     check(ModelFile.status(dir, 10, null) == Status.PARTIAL, "truncatedIsNotReady");
        write(ModelFile.path(dir), 10);    check(ModelFile.status(dir, 10, null) == Status.UNVERIFIED, "right size, never verified");
        check(ModelFile.status(dir, 10, ModelFile.marker(ModelFile.path(dir))) == Status.READY, "verified marker matches");
        check(ModelFile.status(dir, 10, "10:1") == Status.UNVERIFIED, "file replaced since verification");
        File f = ModelFile.path(dir);
        check(ModelFile.verify(f, 10, sha(f)) && !ModelFile.verify(f, 10, sha(f).replace('a', 'b').replace('1', '2')) && !ModelFile.verify(f, 11, sha(f)), "size and hash both matter");
        check(ModelFile.verify(f, 10, sha(f).toUpperCase()), "hash case does not matter");
        check(!ModelFile.verify(new File(dir, "absent"), 10, sha(f)), "a missing file never verifies");
        check(ModelSource.url().equals("https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/2d74ac41a33d7da82f39f7d5720a04c68514a103/gemma-4-E2B-it.litertlm"), "pinned revision URL");
        check(ModelSource.SHA256.length() == 64 && ModelSource.SIZE == 2_588_147_712L, "pinned size and hash");
        System.out.println("ModelFileTest: " + checks + " checks passed");
    }
}
