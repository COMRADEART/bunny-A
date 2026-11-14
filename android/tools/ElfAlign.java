package com.routeragent.jev.tools;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Paths;

/** Fails the build when a packaged native library is not 16 KB page aligned (every PT_LOAD p_align must be >= 16384). */
public final class ElfAlign {
    private static final int PT_LOAD = 1;

    /** Smallest p_align over the PT_LOAD program headers; -1 when the bytes are not a well-formed ELF64 little-endian file. */
    public static long minLoadAlign(byte[] elf) {
        if (elf.length < 64 || elf[0] != 0x7f || elf[1] != 'E' || elf[2] != 'L' || elf[3] != 'F' || elf[4] != 2 || elf[5] != 1) return -1;
        ByteBuffer b = ByteBuffer.wrap(elf).order(ByteOrder.LITTLE_ENDIAN);
        long phoff = b.getLong(32);
        int size = b.getShort(54) & 0xffff, count = b.getShort(56) & 0xffff;
        long min = -1;
        for (int i = 0; i < count; i++) {
            long at = phoff + (long) i * size;
            if (size < 56 || at < 0 || at + 56 > elf.length) return -1;
            if (b.getInt((int) at) == PT_LOAD) {
                long align = b.getLong((int) at + 48);
                if (min < 0 || align < min) min = align;
            }
        }
        return min;
    }

    public static boolean ok(byte[] elf) { return minLoadAlign(elf) >= 16384; }

    public static void main(String[] files) throws Exception {
        boolean failed = false;
        for (String file : files) {
            long align = minLoadAlign(Files.readAllBytes(Paths.get(file)));
            System.out.println("ELF " + file + " min PT_LOAD alignment " + align);
            if (align < 16384) { System.err.println("Native library is not 16 KB aligned: " + file); failed = true; }
        }
        if (failed) System.exit(1);
    }
}
