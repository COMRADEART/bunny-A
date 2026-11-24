package com.routeragent.jev.tools;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;

/**
 * Packages a compiled Android App Bundle base module zip with forward slashes
 * and deterministic timestamps for bundletool consumption.
 */
public final class PackageModule {
    private static void putEntry(ZipOutputStream zos, String entryName, byte[] data) throws IOException {
        ZipEntry entry = new ZipEntry(entryName);
        entry.setTime(1609459200000L); // Fixed 2021-01-01 00:00:00 UTC
        entry.setSize(data.length);
        zos.putNextEntry(entry);
        zos.write(data);
        zos.closeEntry();
    }

    /** classes.dex, classes2.dex, ... in multidex order; a single file keeps the old one-dex form. */
    public static List<File> dexFiles(File dexInput) {
        if (!dexInput.isDirectory()) return Collections.singletonList(dexInput);
        File[] found = dexInput.listFiles((dir, name) -> name.matches("classes\\d*\\.dex"));
        List<File> files = new ArrayList<>(Arrays.asList(found == null ? new File[0] : found));
        files.sort(Comparator.comparingInt(f -> { String n = f.getName().replaceAll("\\D", ""); return n.isEmpty() ? 1 : Integer.parseInt(n); }));
        if (files.isEmpty() || !files.get(0).getName().equals("classes.dex")) throw new IllegalStateException("No classes.dex in " + dexInput);
        return files;
    }

    /** The .so files of the optional native-library directory argument, sorted; none when the argument is absent. */
    public static File[] nativeLibraries(String[] args, int index) {
        if (args.length <= index) return new File[0];
        File[] found = new File(args[index]).listFiles((dir, name) -> name.endsWith(".so"));
        if (found == null || found.length == 0) throw new IllegalStateException("No native libraries in " + args[index]);
        Arrays.sort(found);
        return found;
    }

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("Usage: PackageModule <proto-resources.apk> <classes.dex | dex-directory> <output-base.zip> [arm64-v8a-native-library-directory]");
            System.exit(1);
        }

        File protoApk = new File(args[0]);
        File dexInput = new File(args[1]);
        File outputZip = new File(args[2]);

        try (ZipFile zipIn = new ZipFile(protoApk);
             FileOutputStream fos = new FileOutputStream(outputZip);
             BufferedOutputStream bos = new BufferedOutputStream(fos);
             ZipOutputStream zos = new ZipOutputStream(bos)) {

            List<ZipEntry> entries = new ArrayList<>();
            Enumeration<? extends ZipEntry> enumeration = zipIn.entries();
            while (enumeration.hasMoreElements()) {
                entries.add(enumeration.nextElement());
            }
            entries.sort(Comparator.comparing(ZipEntry::getName));

            for (ZipEntry entry : entries) {
                if (entry.isDirectory()) continue;

                String originalName = entry.getName();
                String moduleName;

                if ("AndroidManifest.xml".equals(originalName)) {
                    moduleName = "manifest/AndroidManifest.xml";
                } else if ("resources.pb".equals(originalName)) {
                    moduleName = "resources.pb";
                } else if (originalName.startsWith("res/")) {
                    moduleName = originalName;
                } else if (originalName.startsWith("assets/")) {
                    moduleName = originalName;
                } else {
                    // Other root items can remain or be ignored
                    moduleName = "root/" + originalName;
                }

                byte[] data;
                try (InputStream is = zipIn.getInputStream(entry)) {
                    data = is.readAllBytes();
                }

                putEntry(zos, moduleName, data);
            }

            // Every classes*.dex goes under dex/, every native library under lib/arm64-v8a/.
            for (File dex : dexFiles(dexInput)) putEntry(zos, "dex/" + dex.getName(), Files.readAllBytes(dex.toPath()));
            for (File library : nativeLibraries(args, 3)) putEntry(zos, "lib/arm64-v8a/" + library.getName(), Files.readAllBytes(library.toPath()));
        }

        System.out.println("Packaged base module: " + outputZip.getAbsolutePath() + " (" + outputZip.length() + " bytes)");
    }
}
