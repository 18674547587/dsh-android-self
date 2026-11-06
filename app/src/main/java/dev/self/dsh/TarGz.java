package dev.self.dsh;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.zip.GZIPInputStream;

/**
 * 极简 tar.gz 解压器：只依赖 JDK，不引 Apache Commons Compress。
 * 支持：普通文件、目录、符号链接、硬链接、GNU longname('L')、pax('x')、权限位。
 * rootfs 里 /bin -> usr/bin 这类链接必须保留，否则 proot 里全是断链。
 */
final class TarGz {

    interface Progress { void onBytes(long done); }

    private TarGz() {}

    static long extract(InputStream raw, File dest, Progress cb) throws IOException {
        GZIPInputStream gz = new GZIPInputStream(new BufferedInputStream(raw, 1 << 16), 1 << 16);
        byte[] hdr = new byte[512];
        String longName = null, paxPath = null, paxLink = null;
        long total = 0;
        long lastReport = 0;

        while (true) {
            int n = readFully(gz, hdr, 512);
            if (n < 512) break;
            if (isZero(hdr)) {
                // 归档结束（两个全零块）；再读一块容错
                if (readFully(gz, hdr, 512) < 512 || isZero(hdr)) break;
            }

            String name = cstr(hdr, 0, 100);
            int mode = (int) octal(hdr, 100, 8);
            long size = octal(hdr, 124, 12);
            char type = (char) (hdr[156] & 0xff);
            String link = cstr(hdr, 157, 100);
            String prefix = cstr(hdr, 345, 155);
            if (prefix.length() > 0) name = prefix + "/" + name;

            if (longName != null) { name = longName; longName = null; }
            if (paxPath != null) { name = paxPath; paxPath = null; }
            if (paxLink != null) { link = paxLink; paxLink = null; }

            if (type == 'L') {
                byte[] b = readData(gz, size);
                longName = new String(b, StandardCharsets.UTF_8).replace("\0", "").trim();
                skipN(gz, pad(size));
                continue;
            }
            if (type == 'x' || type == 'X') {
                byte[] b = readData(gz, size);
                String[] kv = parsePax(new String(b, StandardCharsets.UTF_8));
                if (kv[0] != null) paxPath = kv[0];
                if (kv[1] != null) paxLink = kv[1];
                skipN(gz, pad(size));
                continue;
            }
            if (type == 'g' || type == 'K') {
                skipN(gz, size + pad(size));
                continue;
            }

            File f = safeResolve(dest, name);
            if (f == null) { skipN(gz, size + pad(size)); continue; }

            switch (type) {
                case '5':
                    f.mkdirs();
                    break;
                case '2': {
                    File parent = f.getParentFile();
                    if (parent != null) parent.mkdirs();
                    try {
                        Path p = f.toPath();
                        Files.deleteIfExists(p);
                        Files.createSymbolicLink(p, Paths.get(link));
                    } catch (Exception ignored) { }
                    break;
                }
                case '1': {
                    File parent = f.getParentFile();
                    if (parent != null) parent.mkdirs();
                    File tgt = safeResolve(dest, link);
                    try {
                        if (tgt != null && tgt.exists() && !f.exists()) {
                            Files.createLink(f.toPath(), tgt.toPath());
                        }
                    } catch (Exception ignored) { }
                    break;
                }
                case '0': case '\0': case '7': {
                    File parent = f.getParentFile();
                    if (parent != null) parent.mkdirs();
                    OutputStream os = new FileOutputStream(f);
                    copyN(gz, os, size);
                    os.close();
                    if ((mode & 0111) != 0) {
                        //noinspection ResultOfMethodCallIgnored
                        f.setExecutable(true, false);
                    }
                    break;
                }
                default:
                    skipN(gz, size);
                    break;
            }

            skipN(gz, pad(size));
            total += size;
            if (cb != null && total - lastReport > (4L << 20)) {
                lastReport = total;
                cb.onBytes(total);
            }
        }
        if (cb != null) cb.onBytes(total);
        return total;
    }

    private static long pad(long size) { return (512 - (size % 512)) % 512; }

    private static boolean isZero(byte[] b) {
        for (byte x : b) if (x != 0) return false;
        return true;
    }

    private static File safeResolve(File dest, String name) throws IOException {
        if (name == null || name.isEmpty()) return null;
        String cleaned = name;
        while (cleaned.startsWith("./")) cleaned = cleaned.substring(2);
        while (cleaned.startsWith("/")) cleaned = cleaned.substring(1);
        if (cleaned.isEmpty() || cleaned.contains("..")) return null;
        File f = new File(dest, cleaned);
        String base = dest.getCanonicalPath();
        String path = f.getCanonicalPath();
        if (!path.equals(base) && !path.startsWith(base + File.separator)) return null;
        return f;
    }

    private static String cstr(byte[] b, int off, int len) {
        int end = off;
        while (end < off + len && b[end] != 0) end++;
        return new String(b, off, end - off, StandardCharsets.UTF_8);
    }

    private static long octal(byte[] b, int off, int len) {
        String s = cstr(b, off, len).trim();
        if (s.isEmpty()) return 0;
        try { return Long.parseLong(s, 8); } catch (NumberFormatException e) { return 0; }
    }

    /** pax 记录格式："<len> path=<value>\n"，返回 [path, linkpath] */
    private static String[] parsePax(String s) {
        String[] out = new String[2];
        int i = 0;
        while (i < s.length()) {
            int sp = s.indexOf(' ', i);
            if (sp < 0) break;
            int len;
            try { len = Integer.parseInt(s.substring(i, sp).trim()); }
            catch (NumberFormatException e) { break; }
            if (len <= 0 || i + len > s.length()) break;
            String rec = s.substring(sp + 1, i + len).trim();
            if (rec.startsWith("path=")) out[0] = rec.substring(5);
            else if (rec.startsWith("linkpath=")) out[1] = rec.substring(9);
            i += len;
        }
        return out;
    }

    private static int readFully(InputStream in, byte[] buf, int len) throws IOException {
        int off = 0;
        while (off < len) {
            int n = in.read(buf, off, len - off);
            if (n < 0) break;
            off += n;
        }
        return off;
    }

    private static byte[] readData(InputStream in, long size) throws IOException {
        if (size > (64L << 20)) throw new IOException("tar 条目过大: " + size);
        byte[] b = new byte[(int) size];
        int off = 0;
        while (off < size) {
            int n = in.read(b, off, (int) size - off);
            if (n < 0) break;
            off += n;
        }
        return b;
    }

    private static void copyN(InputStream in, OutputStream out, long size) throws IOException {
        byte[] buf = new byte[1 << 16];
        long left = size;
        while (left > 0) {
            int n = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (n < 0) break;
            out.write(buf, 0, n);
            left -= n;
        }
    }

    private static void skipN(InputStream in, long n) throws IOException {
        long left = n;
        byte[] buf = new byte[8192];
        while (left > 0) {
            int r = in.read(buf, 0, (int) Math.min(buf.length, left));
            if (r < 0) break;
            left -= r;
        }
    }
}
