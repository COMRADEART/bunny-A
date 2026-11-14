package com.routeragent.jev.tools;

/** Native libraries must be 16 KB page aligned (Android 15+ 16 KB-page devices); exercised on in-memory ELF images. */
public final class ElfAlignTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }

    /** A minimal ELF64 little-endian image: 64-byte header and one 56-byte PT_LOAD program header. */
    static byte[] elf(long align) {
        byte[] b = new byte[64 + 56];
        b[0] = 0x7f; b[1] = 'E'; b[2] = 'L'; b[3] = 'F'; b[4] = 2; b[5] = 1; b[6] = 1;
        le(b, 32, 64, 8);   // e_phoff
        le(b, 54, 56, 2);   // e_phentsize
        le(b, 56, 1, 2);    // e_phnum
        le(b, 64, 1, 4);    // p_type = PT_LOAD
        le(b, 64 + 48, align, 8);
        return b;
    }
    private static void le(byte[] b, int at, long value, int bytes) { for (int i = 0; i < bytes; i++) b[at + i] = (byte) (value >>> (8 * i)); }

    public static void main(String[] args) {
        check(ElfAlign.minLoadAlign(elf(4096)) == 4096, "reads p_align");
        check(!ElfAlign.ok(elf(4096)), "4 KB alignment is refused");
        check(ElfAlign.ok(elf(16384)), "16 KB alignment passes");
        check(!ElfAlign.ok(new byte[]{1, 2, 3}), "not an ELF file is refused");
        byte[] cut = elf(16384);
        check(!ElfAlign.ok(java.util.Arrays.copyOf(cut, 80)), "truncated program header is refused");
        System.out.println("ElfAlignTest passed: " + checks + " checks");
    }
}
