import java.io.*;
import java.util.*;
import java.util.zip.*;
public final class CompareApk {
  static Map<String, byte[]> entries(String path) throws IOException {
    Map<String, byte[]> result = new TreeMap<>();
    try (ZipFile zip = new ZipFile(path)) {
      for (ZipEntry entry : Collections.list(zip.entries())) {
        if (!entry.isDirectory() && !entry.getName().startsWith("META-INF/")) {
          try (InputStream input = zip.getInputStream(entry)) { result.put(entry.getName(), input.readAllBytes()); }
        }
      }
    }
    return result;
  }
  public static void main(String[] args) throws Exception {
    Map<String, byte[]> signed = entries(args[0]), rebuilt = entries(args[1]);
    Set<String> names = new TreeSet<>(signed.keySet()); names.addAll(rebuilt.keySet());
    int mismatches = 0;
    for (String name : names) {
      boolean same = Arrays.equals(signed.get(name), rebuilt.get(name));
      System.out.println((same ? "MATCH " : "MISMATCH ") + name);
      if (!same) mismatches++;
    }
    System.out.println("Unsigned entry comparison: entries=" + names.size() + " mismatches=" + mismatches);
    if (mismatches != 0) System.exit(1);
  }
}
