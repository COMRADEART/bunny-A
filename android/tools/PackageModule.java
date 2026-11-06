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

    public static void main(String[] args) throws Exception {
        if (args.length < 3) {
            System.err.println("Usage: PackageModule <proto-resources.apk> <classes.dex> <output-base.zip>");
            System.exit(1);
        }

        File protoApk = new File(args[0]);
        File classesDex = new File(args[1]);
        File outputZip = new File(args[2]);

        byte[] dexBytes = Files.readAllBytes(classesDex.toPath());

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

            // Put classes.dex into dex/classes.dex
            putEntry(zos, "dex/classes.dex", dexBytes);
        }

        System.out.println("Packaged base module: " + outputZip.getAbsolutePath() + " (" + outputZip.length() + " bytes)");
    }
}
