// Bunny voice worker (M-A-3 T10). Protocol: src/lib/bunny-host/voice/voice-protocol.ts (bunny-voice/1).
// C# 5 only (csc v4). Local Windows components only: winmm, Core Audio, System.Speech (SAPI), and the optional
// whisper.cpp runtime behind bunny-whisper-shim.dll (--stt whisper). No network.
// Fixture flags (--input-*, --output null, --fixture-pace) are test-only; the Host never passes them.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Speech.AudioFormat;
using System.Speech.Recognition;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using Microsoft.Win32;

internal sealed class VoiceFault : Exception
{
    public readonly string Code;
    public VoiceFault(string code, string message) : base(message) { Code = code; }
}

internal static class Consts
{
    public const int SampleRate = 16000;
    public const int FrameMs = 20;
    public const int FrameBytes = 640; // 20 ms of 16 kHz mono 16-bit
    public const int BytesPerMs = 32;
    public const int MaxLineBytes = 65536;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON (hand-rolled, ASCII-only output).
// ---------------------------------------------------------------------------------------------------------------
internal static class Json
{
    public static string Write(object value)
    {
        StringBuilder sb = new StringBuilder();
        W(sb, value);
        return sb.ToString();
    }

    static void W(StringBuilder sb, object o)
    {
        if (o == null) { sb.Append("null"); return; }
        string s = o as string;
        if (s != null) { Str(sb, s); return; }
        if (o is bool) { sb.Append((bool)o ? "true" : "false"); return; }
        if (o is int || o is long || o is uint) { sb.Append(Convert.ToString(o, CultureInfo.InvariantCulture)); return; }
        if (o is double || o is float)
        {
            double d = Convert.ToDouble(o, CultureInfo.InvariantCulture);
            if (double.IsNaN(d) || double.IsInfinity(d)) sb.Append("null");
            else sb.Append(d.ToString("R", CultureInfo.InvariantCulture));
            return;
        }
        Dictionary<string, object> dict = o as Dictionary<string, object>;
        if (dict != null)
        {
            sb.Append('{');
            bool first = true;
            foreach (KeyValuePair<string, object> kv in dict)
            {
                if (!first) sb.Append(',');
                first = false;
                Str(sb, kv.Key);
                sb.Append(':');
                W(sb, kv.Value);
            }
            sb.Append('}');
            return;
        }
        IList list = o as IList;
        if (list != null)
        {
            sb.Append('[');
            for (int i = 0; i < list.Count; i++)
            {
                if (i > 0) sb.Append(',');
                W(sb, list[i]);
            }
            sb.Append(']');
            return;
        }
        Str(sb, o.ToString());
    }

    static void Str(StringBuilder sb, string s)
    {
        sb.Append('"');
        foreach (char c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < 0x20 || c > 0x7e) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
    }

    public static object Parse(string text)
    {
        int p = 0;
        object v = Value(text, ref p, 0);
        Ws(text, ref p);
        if (p != text.Length) throw new FormatException("trailing characters");
        return v;
    }

    static void Ws(string t, ref int p)
    {
        while (p < t.Length && (t[p] == ' ' || t[p] == '\t' || t[p] == '\r' || t[p] == '\n')) p++;
    }

    static bool Match(string t, int p, string word)
    {
        return p + word.Length <= t.Length && string.CompareOrdinal(t, p, word, 0, word.Length) == 0;
    }

    static object Value(string t, ref int p, int depth)
    {
        if (depth > 32) throw new FormatException("nesting too deep");
        Ws(t, ref p);
        if (p >= t.Length) throw new FormatException("unexpected end");
        char c = t[p];
        if (c == '{')
        {
            p++;
            Dictionary<string, object> d = new Dictionary<string, object>();
            Ws(t, ref p);
            if (p < t.Length && t[p] == '}') { p++; return d; }
            while (true)
            {
                Ws(t, ref p);
                if (p >= t.Length || t[p] != '"') throw new FormatException("expected key");
                string k = ParseStr(t, ref p);
                Ws(t, ref p);
                if (p >= t.Length || t[p] != ':') throw new FormatException("expected colon");
                p++;
                d[k] = Value(t, ref p, depth + 1);
                Ws(t, ref p);
                if (p < t.Length && t[p] == ',') { p++; continue; }
                if (p < t.Length && t[p] == '}') { p++; return d; }
                throw new FormatException("expected , or }");
            }
        }
        if (c == '[')
        {
            p++;
            List<object> l = new List<object>();
            Ws(t, ref p);
            if (p < t.Length && t[p] == ']') { p++; return l; }
            while (true)
            {
                l.Add(Value(t, ref p, depth + 1));
                Ws(t, ref p);
                if (p < t.Length && t[p] == ',') { p++; continue; }
                if (p < t.Length && t[p] == ']') { p++; return l; }
                throw new FormatException("expected , or ]");
            }
        }
        if (c == '"') return ParseStr(t, ref p);
        if (Match(t, p, "true")) { p += 4; return true; }
        if (Match(t, p, "false")) { p += 5; return false; }
        if (Match(t, p, "null")) { p += 4; return null; }
        int s = p;
        while (p < t.Length && "+-0123456789.eE".IndexOf(t[p]) >= 0) p++;
        if (p == s) throw new FormatException("bad token");
        return double.Parse(t.Substring(s, p - s), NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    static string ParseStr(string t, ref int p)
    {
        if (p >= t.Length || t[p] != '"') throw new FormatException("expected string");
        p++;
        StringBuilder sb = new StringBuilder();
        while (true)
        {
            if (p >= t.Length) throw new FormatException("unterminated string");
            char c = t[p++];
            if (c == '"') return sb.ToString();
            if (c != '\\') { sb.Append(c); continue; }
            if (p >= t.Length) throw new FormatException("bad escape");
            char e = t[p++];
            switch (e)
            {
                case '"': sb.Append('"'); break;
                case '\\': sb.Append('\\'); break;
                case '/': sb.Append('/'); break;
                case 'b': sb.Append('\b'); break;
                case 'f': sb.Append('\f'); break;
                case 'n': sb.Append('\n'); break;
                case 'r': sb.Append('\r'); break;
                case 't': sb.Append('\t'); break;
                case 'u':
                    if (p + 4 > t.Length) throw new FormatException("bad unicode escape");
                    sb.Append((char)int.Parse(t.Substring(p, 4), NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                    p += 4;
                    break;
                default: throw new FormatException("bad escape");
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Output: one JSON object per line, serialized under a lock, flushed. Every event carries t and mono.
// ---------------------------------------------------------------------------------------------------------------
internal static class Out
{
    static readonly object Lock = new object();
    static Stream stream;
    static readonly Queue<byte[]> pending = new Queue<byte[]>();
    static Thread writer;
    static bool testStream;
    static bool writing;
    static long writingSince = -1;
    static int queuedBytes;
    public static readonly Stopwatch Clock = Stopwatch.StartNew();
    // T12 bounds: 2048 lines / 1 MiB of queued protocol bytes; overflow or a write stalled past StallExitMs exits contained.
    const int MaxPendingLines = 2048, MaxPendingBytes = 1024 * 1024, StallExitMs = 10000;

    public static void Open()
    {
        stream = Console.OpenStandardOutput();
        writer = new Thread(() => {
            while (true)
            {
                byte[] bytes;
                lock (Lock) { while (pending.Count == 0) Monitor.Wait(Lock); bytes = pending.Dequeue(); queuedBytes -= bytes.Length; writing = true; Interlocked.Exchange(ref writingSince, Clock.ElapsedMilliseconds); }
                try { stream.Write(bytes, 0, bytes.Length); stream.Flush(); }
                catch { Environment.Exit(3); }
                finally { Array.Clear(bytes, 0, bytes.Length); Interlocked.Exchange(ref writingSince, -1); lock (Lock) { writing = false; Monitor.PulseAll(Lock); } }
            }
        });
        writer.IsBackground = true; writer.Start();
        Thread watchdog = new Thread(() => {
            while (true) {
                Thread.Sleep(250);
                long at = Interlocked.Read(ref writingSince);
                // T12: 10 s, not 2 s. A briefly slow Host must not kill a healthy worker; a Host that never reads still
                // exits here, and the queue bounds below keep memory finite while it waits.
                if (at >= 0 && Clock.ElapsedMilliseconds - at > StallExitMs) Environment.Exit(3);
            }
        });
        watchdog.IsBackground = true; watchdog.Start();
    }
    public static void Drain(int ms)
    {
        Stopwatch wait = Stopwatch.StartNew();
        lock (Lock) { while ((pending.Count > 0 || writing) && wait.ElapsedMilliseconds < ms) Monitor.Wait(Lock, 10); }
    }

    internal static int StalledPipeSelfTest()
    {
        SwapStreamForTest(new StalledStream());
        Emit(Ev("test.stalled_pipe"));
        // Must outlast StallExitMs (10 s): the production watchdog has to exit 3 before this sleep returns.
        Thread.Sleep(30000);
        return 9;
    }
    sealed class StalledStream : Stream
    {
        readonly ManualResetEvent block = new ManualResetEvent(false);
        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { return 0; } }
        public override long Position { get { return 0; } set { } }
        public override void Flush() { }
        public override int Read(byte[] b, int o, int n) { throw new NotSupportedException(); }
        public override long Seek(long n, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long n) { throw new NotSupportedException(); }
        public override void Write(byte[] b, int o, int n) { block.WaitOne(); }
    }

    // Test-only seam (selftest): swaps the protocol stream and returns the previous one, so a closed-pipe write can be
    // simulated in-process without killing the test runner.
    internal static Stream SwapStreamForTest(Stream s)
    {
        Drain(500);
        Stream previous = stream;
        stream = s;
        testStream = s != null && s.GetType().Name == "BrokenStream";
        return previous;
    }

    public static void Emit(Dictionary<string, object> d)
    {
        d["t"] = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        d["mono"] = Clock.ElapsedMilliseconds;
        string line = Json.Write(d);
        if (line.Length >= Consts.MaxLineBytes - 1)
        {
            line = Json.Write(Obj("ev", "error", "code", "INTERNAL", "message", "event exceeded line budget", "t", d["t"], "mono", d["mono"]));
        }
        byte[] bytes = Encoding.ASCII.GetBytes(line + "\n");
        lock (Lock)
        {
            if (testStream) { stream.Write(bytes, 0, bytes.Length); return; }
            // A non-reading Host may stall only the writer. Finite protocol memory; overflow ends the contained
            // worker and releases microphone/output at process exit rather than trapping an audio state lock.
            if (pending.Count >= MaxPendingLines || queuedBytes + bytes.Length > MaxPendingBytes) { Environment.Exit(3); return; }
            pending.Enqueue(bytes);
            queuedBytes += bytes.Length;
            Monitor.PulseAll(Lock);
        }
    }

    public static Dictionary<string, object> Obj(params object[] kv)
    {
        Dictionary<string, object> d = new Dictionary<string, object>();
        for (int i = 0; i + 1 < kv.Length; i += 2) d[(string)kv[i]] = kv[i + 1];
        return d;
    }

    public static Dictionary<string, object> Ev(string name, params object[] kv)
    {
        Dictionary<string, object> d = Obj(kv);
        d["ev"] = name;
        return d;
    }

    public static void Error(string code, string message)
    {
        Emit(Ev("error", "code", code, "message", Trunc(message, 300)));
    }

    public static void Diag(string message)
    {
        // Bounded diagnostics only. Never audio, PCM or transcripts.
        try { Console.Error.WriteLine(Trunc(message, 200)); } catch (Exception) { }
    }

    public static string Trunc(string s, int n)
    {
        if (s == null) return null;
        return s.Length > n ? s.Substring(0, n) : s;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Native surface: winmm waveIn/waveOut, ole32 PropVariantClear.
// ---------------------------------------------------------------------------------------------------------------
[StructLayout(LayoutKind.Sequential)]
internal struct WaveFormatEx
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WaveHdr
{
    public IntPtr lpData;
    public uint dwBufferLength;
    public uint dwBytesRecorded;
    public IntPtr dwUser;
    public uint dwFlags;
    public uint dwLoops;
    public IntPtr lpNext;
    public IntPtr reserved;
}

[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
internal struct WaveCaps
{
    public ushort wMid;
    public ushort wPid;
    public uint vDriverVersion;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szPname;
    public uint dwFormats;
    public ushort wChannels;
    public ushort wReserved1;
    public uint dwSupport;
}

internal static class Native
{
    public const uint WAVE_MAPPER = 0xFFFFFFFF;
    public const uint WHDR_DONE = 0x1;
    public const uint MMSYSERR_ALLOCATED = 4;
    public const uint WAVERR_BADFORMAT = 32;
    // waveOutUnprepareHeader result while the driver still owns the header's buffer.
    public const uint WAVERR_STILLPLAYING = 33;

    [DllImport("winmm.dll")] public static extern uint waveInGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint waveInGetDevCapsW(UIntPtr id, ref WaveCaps caps, uint size);
    [DllImport("winmm.dll")] public static extern uint waveInOpen(out IntPtr h, uint dev, ref WaveFormatEx fmt, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] public static extern uint waveInPrepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveInUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveInAddBuffer(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveInStart(IntPtr h);
    [DllImport("winmm.dll")] public static extern uint waveInReset(IntPtr h);
    [DllImport("winmm.dll")] public static extern uint waveInClose(IntPtr h);

    [DllImport("winmm.dll")] public static extern uint waveOutGetNumDevs();
    [DllImport("winmm.dll", CharSet = CharSet.Unicode)] public static extern uint waveOutGetDevCapsW(UIntPtr id, ref WaveCaps caps, uint size);
    [DllImport("winmm.dll")] public static extern uint waveOutOpen(out IntPtr h, uint dev, ref WaveFormatEx fmt, IntPtr cb, IntPtr inst, uint flags);
    [DllImport("winmm.dll")] public static extern uint waveOutPrepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveOutUnprepareHeader(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveOutWrite(IntPtr h, IntPtr hdr, uint size);
    [DllImport("winmm.dll")] public static extern uint waveOutReset(IntPtr h);
    [DllImport("winmm.dll")] public static extern uint waveOutClose(IntPtr h);

    [DllImport("ole32.dll")] public static extern int PropVariantClear(IntPtr pv);

    public static readonly int HdrSize = Marshal.SizeOf(typeof(WaveHdr));
    public static readonly int OffFlags = Marshal.OffsetOf(typeof(WaveHdr), "dwFlags").ToInt32();
    public static readonly int OffBytesRecorded = Marshal.OffsetOf(typeof(WaveHdr), "dwBytesRecorded").ToInt32();

    public static WaveFormatEx Format()
    {
        WaveFormatEx f = new WaveFormatEx();
        f.wFormatTag = 1;
        f.nChannels = 1;
        f.nSamplesPerSec = 16000;
        f.nAvgBytesPerSec = 32000;
        f.nBlockAlign = 2;
        f.wBitsPerSample = 16;
        f.cbSize = 0;
        return f;
    }

    public static bool HeaderDone(IntPtr hdr)
    {
        if (hdr == IntPtr.Zero) return true;
        return ((uint)Marshal.ReadInt32(hdr, OffFlags) & WHDR_DONE) != 0;
    }

    // Overwrites unmanaged audio with zeros before it is freed, so raw microphone samples do not linger in freed heap.
    public static void WipeNative(IntPtr p, int count)
    {
        if (p == IntPtr.Zero || count <= 0) return;
        Marshal.Copy(new byte[count], 0, p, count);
    }

    public static string MmErrorName(uint r) { return "MMRESULT " + r.ToString(CultureInfo.InvariantCulture); }
}

// ---------------------------------------------------------------------------------------------------------------
// Core Audio (read-only observation: endpoint name, mute, volume, peak meter). NEVER SetMute / SetVolume.
// ---------------------------------------------------------------------------------------------------------------
[StructLayout(LayoutKind.Sequential)]
internal struct PropKey
{
    public Guid fmtid;
    public uint pid;
}

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorCom { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    [PreserveSig]
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    [PreserveSig]
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    [PreserveSig]
    int Activate(ref Guid iid, int clsctx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    [PreserveSig]
    int OpenPropertyStore(int access, out IPropertyStore store);
    [PreserveSig]
    int GetId(out IntPtr id);
    [PreserveSig]
    int GetState(out int state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyStore
{
    [PreserveSig]
    int GetCount(out uint count);
    [PreserveSig]
    int GetAt(uint index, out PropKey key);
    [PreserveSig]
    int GetValue(ref PropKey key, IntPtr value);
    [PreserveSig]
    int SetValue(ref PropKey key, IntPtr value);
    [PreserveSig]
    int Commit();
}

// Slot order must match the COM vtable exactly; only GetMute and GetMasterVolumeLevelScalar are called.
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    [PreserveSig]
    int RegisterControlChangeNotify(IntPtr notify);
    [PreserveSig]
    int UnregisterControlChangeNotify(IntPtr notify);
    [PreserveSig]
    int GetChannelCount(out uint count);
    [PreserveSig]
    int SetMasterVolumeLevel(float level, IntPtr ctx);
    [PreserveSig]
    int SetMasterVolumeLevelScalar(float level, IntPtr ctx);
    [PreserveSig]
    int GetMasterVolumeLevel(out float level);
    [PreserveSig]
    int GetMasterVolumeLevelScalar(out float level);
    [PreserveSig]
    int SetChannelVolumeLevel(uint channel, float level, IntPtr ctx);
    [PreserveSig]
    int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr ctx);
    [PreserveSig]
    int GetChannelVolumeLevel(uint channel, out float level);
    [PreserveSig]
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig]
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr ctx);
    [PreserveSig]
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioMeterInformation
{
    [PreserveSig]
    int GetPeakValue(out float peak);
}

internal sealed class EndpointInfo
{
    public string Name;
    public bool? Muted;
    public double? Volume;
    public bool Present;

    public Dictionary<string, object> ToDict()
    {
        return Out.Obj("name", Name, "muted", (object)Muted, "volume", (object)Volume, "present", Present);
    }

    public string Key()
    {
        return (Name ?? "") + "|" + (Muted.HasValue ? (Muted.Value ? "1" : "0") : "?") + "|" + Present;
    }
}

internal static class Endpoints
{
    static readonly Guid IidVolume = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
    static readonly Guid IidMeter = new Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064");
    static readonly PropKey FriendlyName = new PropKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };

    static void Release(object o)
    {
        if (o != null && Marshal.IsComObject(o)) Marshal.ReleaseComObject(o);
    }

    // flow: 1 = capture, 0 = render. Read only.
    public static EndpointInfo Read(int flow)
    {
        EndpointInfo info = new EndpointInfo();
        IMMDeviceEnumerator en = null;
        IMMDevice dev = null;
        IPropertyStore ps = null;
        object vol = null;
        try
        {
            en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
            if (en.GetDefaultAudioEndpoint(flow, 1, out dev) != 0 || dev == null) return info;
            info.Present = true;
            if (dev.OpenPropertyStore(0, out ps) == 0 && ps != null) info.Name = FriendlyNameOf(ps);
            Guid iid = IidVolume;
            if (dev.Activate(ref iid, 23, IntPtr.Zero, out vol) == 0 && vol != null)
            {
                IAudioEndpointVolume aev = (IAudioEndpointVolume)vol;
                bool muted;
                if (aev.GetMute(out muted) == 0) info.Muted = muted;
                float level;
                if (aev.GetMasterVolumeLevelScalar(out level) == 0) info.Volume = level;
            }
        }
        catch (Exception)
        {
            // Partial truth is reported as-is; unknown fields stay null.
        }
        finally
        {
            Release(vol);
            Release(ps);
            Release(dev);
            Release(en);
        }
        return info;
    }

    static string FriendlyNameOf(IPropertyStore ps)
    {
        IntPtr pv = Marshal.AllocCoTaskMem(32);
        try
        {
            for (int i = 0; i < 32; i++) Marshal.WriteByte(pv, i, 0);
            PropKey key = FriendlyName;
            if (ps.GetValue(ref key, pv) != 0) return null;
            if (Marshal.ReadInt16(pv) != 31) return null; // VT_LPWSTR
            return Marshal.PtrToStringUni(Marshal.ReadIntPtr(pv, 8));
        }
        finally
        {
            Native.PropVariantClear(pv);
            Marshal.FreeCoTaskMem(pv);
        }
    }

    // Peak meter of the default render endpoint. Includes other applications' audio. Polled on a meter worker, never on
    // the playback thread. `since` is the caller's clock; the poll gives up once it passes maxMs (SilentMs stays null).
    public static MeterReading PollRender(Stopwatch since, int maxMs)
    {
        IMMDeviceEnumerator en = null;
        IMMDevice dev = null;
        object m = null;
        try
        {
            en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorCom());
            if (en.GetDefaultAudioEndpoint(0, 1, out dev) != 0 || dev == null) return null;
            Guid iid = IidMeter;
            if (dev.Activate(ref iid, 23, IntPtr.Zero, out m) != 0 || m == null) return null;
            IAudioMeterInformation meter = (IAudioMeterInformation)m;
            MeterReading reading = new MeterReading();
            bool first = true;
            while (since.ElapsedMilliseconds <= maxMs)
            {
                float peak;
                if (meter.GetPeakValue(out peak) != 0) return null;
                // Audible at the first reading, taken right after the pause or cancel was applied (endpoint latency is ~ms).
                if (first) { reading.AudibleAtStart = peak >= 0.001f; first = false; }
                if (peak < 0.001f) { reading.SilentMs = since.Elapsed.TotalMilliseconds; return reading; }
                Thread.Sleep(5);
            }
            return reading;
        }
        catch (Exception)
        {
            return null;
        }
        finally
        {
            Release(m);
            Release(dev);
            Release(en);
        }
    }

    // Read-only: HKCU and HKLM ConsentStore microphone values, plus the NonPackaged subkey.
    public static string MicPrivacy()
    {
        bool any = false;
        bool deny = false;
        string[] roots = new string[]
        {
            @"HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone",
            @"HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone"
        };
        foreach (string root in roots)
        {
            string[] paths = new string[] { root, root + @"\NonPackaged" };
            foreach (string path in paths)
            {
                try
                {
                    string v = Registry.GetValue(path, "Value", null) as string;
                    if (v == null) continue;
                    any = true;
                    if (string.Equals(v, "Deny", StringComparison.OrdinalIgnoreCase)) deny = true;
                }
                catch (Exception)
                {
                }
            }
        }
        return deny ? "deny" : (any ? "allow" : "unknown");
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Frame sources. Read returns FrameBytes (a frame was written), 0 (nothing yet) or -1 (device lost).
// ---------------------------------------------------------------------------------------------------------------
internal interface IFrameSource
{
    int Read(byte[] frame);
    void Close();
}

internal sealed class WaveInSource : IFrameSource
{
    const int Buffers = 6;
    IntPtr handle;
    readonly IntPtr[] headers = new IntPtr[Buffers];
    readonly IntPtr[] data = new IntPtr[Buffers];
    int index;
    readonly Stopwatch clock = Stopwatch.StartNew();
    long lastBufferAt;

    public WaveInSource(uint device)
    {
        WaveFormatEx fmt = Native.Format();
        uint r = Native.waveInOpen(out handle, device, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
        if (r != 0)
        {
            handle = IntPtr.Zero;
            throw new VoiceFault(OpenError(r), "waveInOpen failed: " + Native.MmErrorName(r));
        }
        try
        {
            for (int i = 0; i < Buffers; i++)
            {
                data[i] = Marshal.AllocHGlobal(Consts.FrameBytes);
                headers[i] = Marshal.AllocHGlobal(Native.HdrSize);
                WaveHdr h = new WaveHdr();
                h.lpData = data[i];
                h.dwBufferLength = Consts.FrameBytes;
                Marshal.StructureToPtr(h, headers[i], false);
                r = Native.waveInPrepareHeader(handle, headers[i], (uint)Native.HdrSize);
                if (r != 0) throw new VoiceFault("DEVICE_UNAVAILABLE", "waveInPrepareHeader failed: " + Native.MmErrorName(r));
                r = Native.waveInAddBuffer(handle, headers[i], (uint)Native.HdrSize);
                if (r != 0) throw new VoiceFault("DEVICE_UNAVAILABLE", "waveInAddBuffer failed: " + Native.MmErrorName(r));
            }
            r = Native.waveInStart(handle);
            if (r != 0) throw new VoiceFault("DEVICE_UNAVAILABLE", "waveInStart failed: " + Native.MmErrorName(r));
            lastBufferAt = clock.ElapsedMilliseconds;
        }
        catch (Exception)
        {
            Close();
            throw;
        }
    }

    static string OpenError(uint r)
    {
        if (r == Native.MMSYSERR_ALLOCATED) return "DEVICE_BUSY";
        if (r == Native.WAVERR_BADFORMAT) return "FORMAT_UNSUPPORTED";
        return "DEVICE_UNAVAILABLE";
    }

    public int Read(byte[] frame)
    {
        if (handle == IntPtr.Zero) return -1;
        IntPtr hdr = headers[index];
        if (!Native.HeaderDone(hdr))
        {
            if (clock.ElapsedMilliseconds - lastBufferAt > 1500) return -1; // no buffer completed for 1.5 s
            return 0;
        }
        int recorded = Marshal.ReadInt32(hdr, Native.OffBytesRecorded);
        if (recorded < 0 || recorded > Consts.FrameBytes) recorded = 0;
        Array.Clear(frame, 0, Consts.FrameBytes);
        if (recorded > 0) Marshal.Copy(data[index], frame, 0, recorded);
        if (Native.waveInAddBuffer(handle, hdr, (uint)Native.HdrSize) != 0) return -1;
        index = (index + 1) % Buffers;
        lastBufferAt = clock.ElapsedMilliseconds;
        return Consts.FrameBytes;
    }

    public void Close()
    {
        if (handle != IntPtr.Zero)
        {
            Native.waveInReset(handle);
            for (int i = 0; i < Buffers; i++)
            {
                if (headers[i] != IntPtr.Zero) Native.waveInUnprepareHeader(handle, headers[i], (uint)Native.HdrSize);
            }
            Native.waveInClose(handle);
            handle = IntPtr.Zero;
        }
        // The device is reset and the headers unprepared above, so no driver write can race the wipe.
        for (int i = 0; i < Buffers; i++)
        {
            if (headers[i] != IntPtr.Zero) { Marshal.FreeHGlobal(headers[i]); headers[i] = IntPtr.Zero; }
            if (data[i] != IntPtr.Zero)
            {
                Native.WipeNative(data[i], Consts.FrameBytes);
                Marshal.FreeHGlobal(data[i]);
                data[i] = IntPtr.Zero;
            }
        }
    }
}

// Fixture input: deterministic, test-only, paced in real time (or by --fixture-pace).
internal sealed class FixtureSource : IFrameSource
{
    readonly byte[] script;
    readonly bool noise;
    readonly double pace;
    readonly Random rnd = new Random(4242);
    readonly Stopwatch clock = Stopwatch.StartNew();
    double dueMs;
    int position;

    public FixtureSource(byte[] script, bool noise, double pace)
    {
        this.script = script;
        this.noise = noise;
        this.pace = pace;
    }

    public int Read(byte[] frame)
    {
        while (clock.Elapsed.TotalMilliseconds < dueMs) Thread.Sleep(1);
        dueMs += Consts.FrameMs / pace;
        if (noise)
        {
            // White noise at roughly -32 dBFS RMS (0.05).
            for (int i = 0; i < Consts.FrameBytes; i += 2)
            {
                short s = (short)rnd.Next(-2838, 2839);
                frame[i] = (byte)(s & 0xff);
                frame[i + 1] = (byte)((s >> 8) & 0xff);
            }
        }
        else
        {
            for (int i = 0; i < Consts.FrameBytes; i++)
            {
                int at = position + i;
                frame[i] = (script != null && at < script.Length) ? script[at] : (byte)0;
            }
            position += Consts.FrameBytes;
        }
        return Consts.FrameBytes;
    }

    public void Close() { }
}

// ---------------------------------------------------------------------------------------------------------------
internal sealed class StalledFixtureSource : IFrameSource
{
    readonly ManualResetEvent block = new ManualResetEvent(false);
    public int Read(byte[] frame) { block.WaitOne(); return -1; }
    public void Close() { }
}

// Output: waveOut device, or a real-time clocked null sink (test-only).
// ---------------------------------------------------------------------------------------------------------------
// The device surface used by the playback thread. Tests substitute a fake; the worker uses WaveOut.
internal interface IWaveOut
{
    uint Device { get; }
    void Submit(Chunk c);
    bool IsDone(Chunk c);
    void Release(Chunk c);
    void Reset();
    // Pause and restart the output without returning its buffers. Throws VoiceFault(DEVICE_LOST) when the driver refuses.
    void Pause(bool on);
    void Close();
}

internal sealed class WaveOut : IWaveOut
{
    IntPtr handle;
    readonly uint device;
    // Chunks submitted to the driver and not yet released. Close() reclaims them after a reset.
    readonly List<Chunk> submitted = new List<Chunk>();

    public uint Device { get { return device; } }

    WaveOut(IntPtr h, uint device)
    {
        handle = h;
        this.device = device;
    }

    public bool IsDone(Chunk c)
    {
        return Native.HeaderDone(c.Header);
    }

    public static IWaveOut Open(uint device)
    {
        string reference = Program.RenderReference;
        if (reference != null && !AecSource.RenderIdentityMatches(device, reference, AecSource.RenderEndpointId))
            throw new VoiceFault("AEC_UNAVAILABLE", "render index no longer identifies the echo-reference endpoint");
        WaveFormatEx fmt = Native.Format();
        IntPtr h;
        uint r = Native.waveOutOpen(out h, device, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
        if (r != 0)
        {
            string code = r == Native.MMSYSERR_ALLOCATED ? "DEVICE_BUSY" : (r == Native.WAVERR_BADFORMAT ? "FORMAT_UNSUPPORTED" : "DEVICE_UNAVAILABLE");
            throw new VoiceFault(code, "waveOutOpen failed: " + Native.MmErrorName(r));
        }
        // T12 live finding: the endpoint-id query is answered for a device index, not for an opened HWAVEOUT on this driver
        // (it returns no id), so the binding is re-checked by the index the stream was opened on. A reorder still refuses.
        if (reference != null && !AecSource.RenderIdentityMatches(device, reference, AecSource.RenderEndpointId))
        {
            Native.waveOutClose(h);
            throw new VoiceFault("AEC_UNAVAILABLE", "opened output differs from the echo reference");
        }
        return new WaveOut(h, device);
    }

    public void Submit(Chunk c)
    {
        // Review round 3: the identity is verified when the stream is opened (above). An opened HWAVEOUT stays bound to the
        // physical device it was opened on, so a later re-number of the wave list (a device added or removed) does not move
        // it; re-checking the index per chunk only refused a still-correct stream mid-reply. Every new Open re-verifies, and
        // a default-endpoint change stops the duplex lane on its own.
        c.Data = Marshal.AllocHGlobal(c.Pcm.Length);
        Marshal.Copy(c.Pcm, 0, c.Data, c.Pcm.Length);
        c.Header = Marshal.AllocHGlobal(Native.HdrSize);
        WaveHdr h = new WaveHdr();
        h.lpData = c.Data;
        h.dwBufferLength = (uint)c.Pcm.Length;
        Marshal.StructureToPtr(h, c.Header, false);
        uint r = Native.waveOutPrepareHeader(handle, c.Header, (uint)Native.HdrSize);
        if (r != 0)
        {
            FreeChunk(c);
            throw new VoiceFault("DEVICE_LOST", "waveOutPrepareHeader failed: " + Native.MmErrorName(r));
        }
        r = Native.waveOutWrite(handle, c.Header, (uint)Native.HdrSize);
        if (r != 0)
        {
            Native.waveOutUnprepareHeader(handle, c.Header, (uint)Native.HdrSize);
            FreeChunk(c);
            throw new VoiceFault("DEVICE_LOST", "waveOutWrite failed: " + Native.MmErrorName(r));
        }
        submitted.Add(c);
    }

    // Releases a chunk the driver has returned. The buffer is freed only when unprepare succeeds: a header the driver
    // still owns is kept (a bounded leak) rather than freed under a live DMA read.
    public void Release(Chunk c)
    {
        if (handle != IntPtr.Zero && c.Header != IntPtr.Zero)
        {
            uint r = Native.waveOutUnprepareHeader(handle, c.Header, (uint)Native.HdrSize);
            if (r == Native.WAVERR_STILLPLAYING) return;
        }
        submitted.Remove(c);
        FreeChunk(c);
    }

    static void FreeChunk(Chunk c)
    {
        if (c.Header != IntPtr.Zero) { Marshal.FreeHGlobal(c.Header); c.Header = IntPtr.Zero; }
        if (c.Data != IntPtr.Zero) { Marshal.FreeHGlobal(c.Data); c.Data = IntPtr.Zero; }
    }

    public void Reset()
    {
        if (handle != IntPtr.Zero) Native.waveOutReset(handle);
    }

    public void Pause(bool on)
    {
        uint result = on ? waveOutPause(handle) : waveOutRestart(handle);
        if (result != 0) throw new VoiceFault("DEVICE_LOST", "output pause failed");
    }
    [DllImport("winmm.dll")] static extern uint waveOutPause(IntPtr handle);
    [DllImport("winmm.dll")] static extern uint waveOutRestart(IntPtr handle);

    // waveOutReset returns every pending header to the application before it returns, so after the reset the driver
    // owns no chunk. Those chunks are unprepared and freed here, and the handle is closed even if the first
    // waveOutClose fails (it fails with still-playing while headers are prepared): one reset and one retry.
    public void Close()
    {
        if (handle == IntPtr.Zero) return;
        Native.waveOutReset(handle);
        foreach (Chunk c in submitted)
        {
            if (c.Header != IntPtr.Zero && Native.waveOutUnprepareHeader(handle, c.Header, (uint)Native.HdrSize) == Native.WAVERR_STILLPLAYING) continue;
            FreeChunk(c);
        }
        submitted.Clear();
        uint closed = Native.waveOutClose(handle);
        if (closed != 0)
        {
            Native.waveOutReset(handle);
            Native.waveOutClose(handle);
        }
        handle = IntPtr.Zero;
    }
}

// T12: source-mode Windows Voice Capture DSP. Windows captures and synchronizes the selected render reference;
// it is never replaced with a raw-microphone fallback. All COM and keepalive handles belong to one audio thread.
[ComImport, Guid("745057C7-F353-4F2D-A7EE-58434477730E")]
internal class AudioAecCom { }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface AecDeviceCollection
{
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IMMDevice device);
}
[StructLayout(LayoutKind.Sequential)]
internal struct AecMediaType
{
    public Guid major, subtype;
    public int fixedSize, temporal;
    public uint sampleSize;
    public Guid format;
    public IntPtr unknown;
    public uint formatSize;
    public IntPtr formatData;
}
[StructLayout(LayoutKind.Sequential)]
internal struct AecOutput
{
    public IntPtr buffer;
    public uint status;
    public long timestamp, duration;
}
[ComImport, Guid("D8AD0F58-5494-4102-97C5-EC798E59BCF4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface AecMediaObject
{
    [PreserveSig] int GetStreamCount(out uint inputs, out uint outputs);
    [PreserveSig] int GetInputStreamInfo(uint index, out uint flags);
    [PreserveSig] int GetOutputStreamInfo(uint index, out uint flags);
    [PreserveSig] int GetInputType(uint index, uint type, IntPtr result);
    [PreserveSig] int GetOutputType(uint index, uint type, IntPtr result);
    [PreserveSig] int SetInputType(uint index, IntPtr type, uint flags);
    [PreserveSig] int SetOutputType(uint index, ref AecMediaType type, uint flags);
    [PreserveSig] int GetInputCurrentType(uint index, IntPtr type);
    [PreserveSig] int GetOutputCurrentType(uint index, IntPtr type);
    [PreserveSig] int GetInputSizeInfo(uint index, out uint size, out uint lookahead, out uint alignment);
    [PreserveSig] int GetOutputSizeInfo(uint index, out uint size, out uint alignment);
    [PreserveSig] int GetInputMaxLatency(uint index, out long latency);
    [PreserveSig] int SetInputMaxLatency(uint index, long latency);
    [PreserveSig] int Flush();
    [PreserveSig] int Discontinuity(uint index);
    [PreserveSig] int AllocateStreamingResources();
    [PreserveSig] int FreeStreamingResources();
    [PreserveSig] int GetInputStatus(uint index, out uint flags);
    [PreserveSig] int ProcessInput(uint index, IntPtr buffer, uint flags, long timestamp, long duration);
    [PreserveSig] int ProcessOutput(uint flags, uint count, [In, Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 1)] AecOutput[] buffers, out uint status);
    [PreserveSig] int Lock(int locked);
}
[ComVisible(true), Guid("59EFF8B9-938C-4A26-82F2-95CB84CDC837"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface AecBufferPort
{
    [PreserveSig] int SetLength(uint length);
    [PreserveSig] int GetMaxLength(out uint length);
    [PreserveSig] int GetBufferAndLength(out IntPtr data, out uint length);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class AecBuffer : AecBufferPort
{
    public readonly IntPtr Data = Marshal.AllocHGlobal(6400);
    public uint Length;
    public int SetLength(uint length) { if (length > 6400) return unchecked((int)0x80070057); Length = length; return 0; }
    public int GetMaxLength(out uint length) { length = 6400; return 0; }
    public int GetBufferAndLength(out IntPtr data, out uint length) { data = Data; length = Length; return 0; }
    public void Close() { Native.WipeNative(Data, 6400); Marshal.FreeHGlobal(Data); }
}
// Thrown when a cancellation checkpoint fires inside an open/construct path: the caller closes what was opened.
internal sealed class DuplexCancelled : Exception
{
    public DuplexCancelled() : base("full-duplex open cancelled") { }
}

internal sealed class AecSource : IFrameSource
{
    // T12: one second of 16 kHz mono PCM16 is the bound on drained-but-unread AEC output.
    const int PendingBytes = 32000;
    // DMO_OUTPUT_DATA_BUFFERF_INCOMPLETE: more output is waiting behind this ProcessOutput call.
    const uint DmoOutputIncomplete = 0x01000000;
    const int MaxDrainCalls = 16;
    // Three rotating 100 ms silence buffers keep the render endpoint (and so the AEC reference) fed through a stalled poll.
    const int SilenceBuffers = 3;
    object instance;
    AecMediaObject dmo;
    AecBuffer buffer;
    IntPtr bufferInterface;
    IWaveOut keepalive;
    readonly Chunk[] silences = new Chunk[SilenceBuffers];
    byte[] pending = new byte[PendingBytes];
    int offset, length;
    long lastAudio = Out.Clock.ElapsedMilliseconds;
    public readonly string InputId, OutputId;
    public readonly uint RenderDevice;
    public long MediaTimestamp;
    public bool Produced;
    bool closed;
    readonly AecOutput[] output = new AecOutput[1];
    static readonly Guid PropertySet = new Guid("6F52C567-0360-4BD2-9617-CCBF1421C939");
    [DllImport("winmm.dll")] static extern uint waveOutMessage(IntPtr device, uint message, IntPtr arg1, IntPtr arg2);
    static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    static string Id(IMMDevice device)
    {
        IntPtr p;
        Check(device.GetId(out p));
        try { return Marshal.PtrToStringUni(p); } finally { Marshal.FreeCoTaskMem(p); }
    }
    static int DefaultIndex(int flow, out string id)
    {
        IMMDeviceEnumerator en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
        IMMDevice device = null;
        object collection = null;
        IntPtr pointer = IntPtr.Zero;
        try
        {
            Check(en.GetDefaultAudioEndpoint(flow, 1, out device));
            id = Id(device);
            Check(en.EnumAudioEndpoints(flow, 1, out pointer));
            collection = Marshal.GetObjectForIUnknown(pointer);
            AecDeviceCollection list = (AecDeviceCollection)collection;
            uint count;
            Check(list.GetCount(out count));
            for (uint i = 0; i < count && i < 65535; i++)
            {
                IMMDevice item;
                Check(list.Item(i, out item));
                try { if (Id(item) == id) return (int)i; } finally { Release(item); }
            }
            throw new VoiceFault("AEC_UNAVAILABLE", "default endpoint not in the active AEC collection");
        }
        finally { if (pointer != IntPtr.Zero) Marshal.Release(pointer); Release(collection); Release(device); Release(en); }
    }
    static uint RenderIndex(string endpointId)
    {
        for (uint i = 0; i < Native.waveOutGetNumDevs(); i++)
        {
            IntPtr size = Marshal.AllocHGlobal(4);
            IntPtr text = IntPtr.Zero;
            try
            {
                if (waveOutMessage(new IntPtr(i), 0x812, size, IntPtr.Zero) != 0) continue;
                int bytes = Marshal.ReadInt32(size);
                if (bytes < 2 || bytes > 65536) continue;
                text = Marshal.AllocHGlobal(bytes);
                if (waveOutMessage(new IntPtr(i), 0x811, text, new IntPtr(bytes)) == 0 &&
                    string.Equals(Marshal.PtrToStringUni(text), endpointId, StringComparison.OrdinalIgnoreCase)) return i;
            }
            finally { if (text != IntPtr.Zero) Marshal.FreeHGlobal(text); Marshal.FreeHGlobal(size); }
        }
        throw new VoiceFault("AEC_UNAVAILABLE", "speaker endpoint cannot be bound to the echo reference");
    }
    public static string EndpointId(IntPtr device)
    {
        IntPtr size = Marshal.AllocHGlobal(4), text = IntPtr.Zero;
        try
        {
            if (waveOutMessage(device, 0x812, size, IntPtr.Zero) != 0) return null;
            int bytes = Marshal.ReadInt32(size);
            if (bytes < 2 || bytes > 65536) return null;
            text = Marshal.AllocHGlobal(bytes);
            return waveOutMessage(device, 0x811, text, new IntPtr(bytes)) == 0 ? Marshal.PtrToStringUni(text) : null;
        }
        finally { if (text != IntPtr.Zero) Marshal.FreeHGlobal(text); Marshal.FreeHGlobal(size); }
    }
    public static string RenderEndpointId(uint device) { return EndpointId(new IntPtr(device)); }
    internal static bool RenderIdentityMatches(uint device, string reference, Func<uint, string> lookup)
    { return reference != null && string.Equals(lookup(device), reference, StringComparison.OrdinalIgnoreCase); }
    void Property(uint pid, short type, int value)
    {
        PropKey key = new PropKey { fmtid = PropertySet, pid = pid };
        IntPtr variant = Marshal.AllocHGlobal(24);
        try
        {
            Native.WipeNative(variant, 24);
            Marshal.WriteInt16(variant, type);
            if (type == 11) Marshal.WriteInt16(variant, 8, value != 0 ? (short)-1 : (short)0);
            else Marshal.WriteInt32(variant, 8, value);
            Check(((IPropertyStore)instance).SetValue(ref key, variant));
            Native.WipeNative(variant, 24);
            Check(((IPropertyStore)instance).GetValue(ref key, variant));
            int actual = type == 11 ? (Marshal.ReadInt16(variant, 8) == 0 ? 0 : 1) : Marshal.ReadInt32(variant, 8);
            if (Marshal.ReadInt16(variant) != type || actual != value) throw new VoiceFault("AEC_UNAVAILABLE", "AEC property readback differs");
        }
        finally { Native.PropVariantClear(variant); Marshal.FreeHGlobal(variant); }
    }
    // T12: cancelled() is polled between the expensive steps (endpoint enumeration, device open, COM creation, streaming
    // allocation), so a stop or mute during open releases what was opened instead of finishing the whole setup.
    static void Checkpoint(Func<bool> cancelled)
    {
        if (cancelled != null && cancelled()) throw new DuplexCancelled();
    }

    public AecSource(Func<bool> cancelled)
    {
        string step = "privacy and mute";
        try
        {
            Checkpoint(cancelled);
            if (Endpoints.MicPrivacy() == "deny") throw new VoiceFault("PERMISSION_DENIED", "Windows microphone privacy denies capture");
            if (Endpoints.Read(1).Muted == true) throw new VoiceFault("ENDPOINT_MUTED", "Windows microphone is muted");
            Checkpoint(cancelled);
            step = "capture endpoint index"; int mic = DefaultIndex(1, out InputId);
            Checkpoint(cancelled);
            step = "render endpoint index"; int render = DefaultIndex(0, out OutputId);
            Checkpoint(cancelled);
            step = "render waveOut binding"; RenderDevice = RenderIndex(OutputId);
            Checkpoint(cancelled);
            step = "render keepalive open"; keepalive = WaveOut.Open(RenderDevice);
            for (int i = 0; i < SilenceBuffers; i++)
            {
                silences[i] = new Chunk();
                silences[i].Pcm = new byte[Consts.FrameBytes * 5];
                keepalive.Submit(silences[i]);
            }
            Checkpoint(cancelled);
            step = "DSP creation"; instance = new AudioAecCom();
            step = "DSP media object"; dmo = (AecMediaObject)instance;
            step = "system mode property"; Property(2, 3, 0); // VT_I4 SINGLE_CHANNEL_AEC; not NS/AGC-only mode.
            step = "source mode property"; Property(3, 11, 1); // VT_BOOL source mode
            step = "device index property"; Property(4, 3, (render << 16) | mic);
            // Leave proven Windows AEC/AES/noise defaults intact; no registry timestamp statistics are enabled.
            WaveFormatEx wave = Native.Format();
            IntPtr format = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(WaveFormatEx)));
            try
            {
                Marshal.StructureToPtr(wave, format, false);
                AecMediaType media = new AecMediaType {
                    major = new Guid("73647561-0000-0010-8000-00AA00389B71"),
                    subtype = new Guid("00000001-0000-0010-8000-00AA00389B71"),
                    fixedSize = 1, sampleSize = 2, format = new Guid("05589F81-C356-11CE-BF01-00AA0055595A"),
                    formatSize = (uint)Marshal.SizeOf(typeof(WaveFormatEx)), formatData = format };
                step = "output type"; Check(dmo.SetOutputType(0, ref media, 0));
                Checkpoint(cancelled);
                step = "streaming resources"; Check(dmo.AllocateStreamingResources());
            }
            finally { Marshal.FreeHGlobal(format); }
            step = "output buffer"; buffer = new AecBuffer();
            bufferInterface = Marshal.GetComInterfaceForObject(buffer, typeof(AecBufferPort));
            output[0].buffer = bufferInterface;
        }
        catch (VoiceFault) { Close(); throw; }
        // T12: a setup failure names its step and HRESULT, so a live device failure is diagnosable without a debugger.
        catch (Exception e) { Close(); throw new VoiceFault("AEC_UNAVAILABLE", "AEC setup failed at " + step + ": " + e.GetType().Name + " 0x" + e.HResult.ToString("X8")); }
    }
    public int Read(byte[] frame)
    {
        if (closed) return -1;
        // Refill whichever silence buffer the driver has returned, so at least two stay queued while this one is refilled.
        for (int i = 0; i < SilenceBuffers; i++)
        {
            if (keepalive.IsDone(silences[i])) { keepalive.Release(silences[i]); keepalive.Submit(silences[i]); }
        }
        if (length - offset < Consts.FrameBytes)
        {
            int left = length - offset;
            int stale = length;
            if (left > 0) Buffer.BlockCopy(pending, offset, pending, 0, left);
            // The bytes past the moved tail are consumed or stale copies: wipe them so raw microphone audio does not linger.
            if (stale > left) Array.Clear(pending, left, stale - left);
            offset = 0; length = left;
            // Drain every output the DMO has ready. INCOMPLETE means another ProcessOutput call returns the rest of this
            // period; a single call per frame would silently drop it.
            for (int call = 0; ; call++)
            {
                buffer.Length = 0;
                output[0].status = 0;
                uint status;
                int hr = dmo.ProcessOutput(0, 1, output, out status);
                if (hr < 0) throw new VoiceFault("AEC_UNAVAILABLE", "AEC ProcessOutput failed: 0x" + hr.ToString("X8"));
                uint produced = buffer.Length;
                if (produced > 0)
                {
                    if (produced > (uint)(pending.Length - length))
                    {
                        Native.WipeNative(buffer.Data, (int)Math.Min(produced, 6400u));
                        throw new VoiceFault("BUFFER_LIMIT", "AEC output exceeded the one second pending bound");
                    }
                    Marshal.Copy(buffer.Data, pending, length, (int)produced);
                    // The output is copied out of unmanaged memory, so the unmanaged copy is wiped as well.
                    Native.WipeNative(buffer.Data, (int)produced);
                    length += (int)produced;
                    lastAudio = Out.Clock.ElapsedMilliseconds;
                }
                MediaTimestamp = output[0].timestamp;
                if ((output[0].status & DmoOutputIncomplete) == 0 || call + 1 >= MaxDrainCalls) break;
            }
            if (length < Consts.FrameBytes) return Out.Clock.ElapsedMilliseconds - lastAudio > 2000 ? -1 : 0;
        }
        Buffer.BlockCopy(pending, offset, frame, 0, Consts.FrameBytes);
        Array.Clear(pending, offset, Consts.FrameBytes);
        offset += Consts.FrameBytes;
        Produced = true;
        return 1;
    }
    public bool SameEndpoints()
    {
        string mic, render;
        DefaultIndex(1, out mic); DefaultIndex(0, out render);
        return mic == InputId && render == OutputId;
    }
    public void Close()
    {
        if (closed) return;
        closed = true;
        try { if (dmo != null) dmo.FreeStreamingResources(); } catch { }
        if (bufferInterface != IntPtr.Zero) { Marshal.Release(bufferInterface); bufferInterface = IntPtr.Zero; }
        if (buffer != null) { buffer.Close(); buffer = null; }
        Release(instance); instance = null; dmo = null;
        // Keepalive Close reclaims every submitted silence buffer after the reset; the wipe below covers raw output.
        if (keepalive != null) { keepalive.Close(); keepalive = null; }
        for (int i = 0; i < silences.Length; i++) silences[i] = null;
        Array.Clear(pending, 0, pending.Length);
        offset = 0; length = 0;
    }
}

// T12: the ambient model of one duplex session. Carried across input turns (never recalibrated per turn). Every AEC frame
// updates it while no speech is in progress (DuplexInput owns that update; a standalone Vad owns its own instance).
// Floor: a min-follower over the last 500 ms with slow attack and fast release. A single loud event never raises it, while
// stationary ambient above MinThreshold is learned, so stationary noise cannot count as speech forever.
// Residual: a slow EMA of the AEC output RMS while the worker's own speaker is audible, held for ResidualHoldFrames after
// the output is last audible. It is null when nothing of ours is playing. While it is held the onset threshold is also at
// least ResidualGain x the effective residual.
// T12 (AEC-01, AEC-05, AEC-06): the effective residual is never below ResidualFloor, so a quiet first frame cannot seed it
// low, and it is capped at ResidualCap, so a loud user is not absorbed into it. Round 2 (verifier): the residual is seeded
// from the median of the first ResidualSeedFrames output-window frames (never from one frame), and it jumps to the cap when
// the median of the latest frames is above the learning band. So a loud steady echo is learned even after a quiet start.
// The EMA learns only from frames between ResidualLearnLow and ResidualLearnHigh: silence never decays it (a paused chunk
// is silent on the device while still in flight), and user speech above the band never raises it. The threshold is then
// between 0.004 and 0.006 while output is audible or held, so echo at 0.0045 or 0.005 is never an onset, and user speech
// at about 0.008 still starts a turn.
internal sealed class AmbientFloor
{
    public const double MinFloor = 0.0002, MaxFloor = 0.005;
    public const int WindowFrames = 25;
    public const double AttackAlpha = 0.1, ReleaseAlpha = 0.2, ResidualAlpha = 0.05;
    // T12 live calibration (Intel SST array + Realtek speakers, 40% volume): the DSP's own-speech residual measured
    // p95 1.8e-5 and max 8e-5 RMS while human double-talk measured 0.003-0.016 RMS. A 0.002 floor made the output-time
    // threshold 0.004 and absorbed the user's first syllables (1.7 s detection); 0.0003 keeps a >10x margin over the measured
    // residual and stays far below speech. Echo onsets that still happen only pause output: the Host's echo gate drops them.
    public const double ResidualGain = 2.0, ResidualFloor = 0.0003, ResidualCap = 0.003;
    public const double ResidualSilentFraction = 0.5, ResidualAdaptGain = 1.5;
    // Round 2: the band the EMA learns from is absolute (not relative to the floor-based basis). Its upper edge is
    // ResidualAdaptGain x ResidualCap, so the learning band reaches the cap's echo level (AEC-05 verifier round 2).
    public const double ResidualLearnLow = ResidualSilentFraction * ResidualFloor;
    // Absolute ceiling of anything the residual may learn from. The live band is narrower: see LearnHighLocked.
    public const double ResidualLearnHigh = ResidualAdaptGain * ResidualCap;
    public const int ResidualSeedFrames = 5;
    // Round 2: the pre-roll taint ceiling. An output-window frame at or above this level is user speech, not our echo: the
    // onset threshold never exceeds ResidualGain x ResidualCap, so such a frame is above any threshold the echo can set.
    public const double TaintCeiling = ResidualGain * ResidualCap;
    // The reverb tail (260 ms) after our output: frames captured here are echo for pre-roll purposes (see DuplexInput).
    public const int OutputTailFrames = 13;
    // T12 (AEC-01 c): the residual is held across short inter-chunk gaps and pauses (1.5 s after the output was last audible).
    public const int ResidualHoldFrames = 75;
    readonly object gate = new object();
    readonly double[] window = new double[WindowFrames];
    int windowCount;
    int windowNext;
    double floor;
    // Session memory: the learned residual is kept across holds, so a new reply starts from what the session has learned.
    double residual;
    // Round 2 (AEC-01): the residual is seeded once per session, from the median of the first output-window frames.
    bool residualSeeded;
    // T12 review round 3: every later output burst re-samples its first frames once and may only LOWER the residual. A seed
    // taken while the user talked over the very first reply (it pinned the residual at the cap for the session) is undone by
    // the next reply; talking over a later reply can never raise it.
    bool burstSampled;
    readonly double[] seedRing = new double[ResidualSeedFrames];
    readonly double[] seedSort = new double[ResidualSeedFrames];
    int seedCount;
    int seedNext;
    int tail;
    int hold;
    // Set by the owning Vad while a turn is in speech. Read by DuplexInput when it observes frames.
    public volatile bool Speaking;

    public AmbientFloor(double initial) { floor = Clamp(initial); }

    public static double Clamp(double v) { return v < MinFloor ? MinFloor : (v > MaxFloor ? MaxFloor : v); }

    public double Floor { get { lock (gate) { return floor; } } }
    public bool OutputActive { get { lock (gate) { return tail > 0; } } }
    public double? Residual { get { lock (gate) { return hold > 0 ? EffectiveLocked() : (double?)null; } } }
    public double OnsetThreshold { get { lock (gate) { return ThresholdLocked(); } } }
    // Quietest frame of the last WindowFrames (0 before any frame). A turn takes it at onset as its in-speech quiet reference.
    public double WindowMin { get { lock (gate) { if (windowCount == 0) return 0; double quiet = double.MaxValue; for (int i = 0; i < windowCount; i++) if (window[i] < quiet) quiet = window[i]; return quiet; } } }

    // Caller holds gate. The residual the threshold uses: learned, but never below the floor and never above the cap.
    double EffectiveLocked()
    {
        return Math.Min(ResidualCap, Math.Max(ResidualFloor, residual));
    }

    // Caller holds gate. The upper edge of what the residual may learn from: near the current residual, never above the cap band.
    double LearnHighLocked()
    {
        return Math.Min(ResidualLearnHigh, ResidualAdaptGain * Math.Max(ResidualFloor, residual));
    }

    // Caller holds gate.
    double ThresholdLocked()
    {
        double t = Math.Max(floor * 3.0, Vad.MinThreshold);
        if (hold > 0) t = Math.Max(t, EffectiveLocked() * ResidualGain);
        return t;
    }

    // Caller holds gate. Round 2 (AEC-01): the last ResidualSeedFrames output-window frames, for the multi-frame seed.
    void PushSeedLocked(double rms)
    {
        seedRing[seedNext] = rms;
        seedNext = (seedNext + 1) % ResidualSeedFrames;
        if (seedCount < ResidualSeedFrames) seedCount++;
    }

    // Caller holds gate and the ring is full. The median (the middle of five), so one spike or one quiet frame does not seed it.
    double SeedMedianLocked()
    {
        Array.Copy(seedRing, seedSort, ResidualSeedFrames);
        Array.Sort(seedSort);
        return seedSort[ResidualSeedFrames / 2];
    }

    // Session start: the quietest frame of the calibration window becomes the floor (bounded).
    public void Calibrate(double quietest)
    {
        lock (gate) { floor = Clamp(quietest); }
    }

    // One frame. `speaking`: a turn is in speech, so nothing is learned. `output`: our speaker is audible now.
    public void Observe(double rms, bool speaking, bool output)
    {
        lock (gate)
        {
            window[windowNext] = rms;
            windowNext = (windowNext + 1) % WindowFrames;
            if (windowCount < WindowFrames) windowCount++;
            if (output) { tail = OutputTailFrames; hold = ResidualHoldFrames; }
            else
            {
                if (tail > 0) tail--;
                if (hold > 0)
                {
                    hold--;
                    // The burst is over (held 1.5 s past the last audible frame): the next burst samples a fresh seed.
                    if (hold == 0) { seedCount = 0; seedNext = 0; burstSampled = false; }
                }
            }
            if (speaking) return;
            if (hold > 0)
            {
                // Our own output is held: the residual model owns this window and the floor holds, so echo cannot lift the
                // ambient estimate. T12 (AEC-01/05): the residual is never seeded from one frame, silence does not decay it,
                // and only frames inside the learning band are averaged in.
                if (output) PushSeedLocked(rms);
                if (seedCount == ResidualSeedFrames && !residualSeeded)
                {
                    // Round 2: seed once from the multi-frame median of the first output frames.
                    residual = Math.Min(ResidualCap, SeedMedianLocked());
                    residualSeeded = true;
                    burstSampled = true;
                }
                else if (seedCount == ResidualSeedFrames && !burstSampled)
                {
                    // Round 3: a later burst's seed only ever lowers the learned residual (see burstSampled).
                    residual = Math.Min(residual, SeedMedianLocked());
                    burstSampled = true;
                }
                // T12 live calibration: the residual only follows frames close to itself (a relative band), and there is no
                // "jump to the cap". Measured user double-talk passes the DSP at 10-100x the residual, so a jump or a wide band
                // learned the user's own first syllables and hid the barge-in. A louder echo is followed gradually.
                // The lower edge is relative too: a paused (silent) device or a quiet gap can never pull the residual down.
                if (residualSeeded && rms >= ResidualSilentFraction * Math.Max(ResidualFloor, residual) && rms <= LearnHighLocked())
                    residual = Math.Min(ResidualCap, residual + (rms - residual) * ResidualAlpha);
                return;
            }
            double quiet = double.MaxValue;
            for (int i = 0; i < windowCount; i++) if (window[i] < quiet) quiet = window[i];
            floor = Clamp(floor + (quiet - floor) * (quiet > floor ? AttackAlpha : ReleaseAlpha));
        }
    }
}

// Continuous physical capture with bounded per-turn fan-out. Child Close detaches recognition, not the microphone.
// Every AEC frame updates the session AmbientFloor, between turns too. Frames are kept in a 3 s preroll so the next input
// turn starts with the audio that led into it.
internal sealed class DuplexInput
{
    // ~400 ms of measurement before duplex.started. The floor starts from the quietest of these frames.
    const int CalibrationFrames = 20;
    // 3 s of preroll for the next turn.
    const int PrerollFrames = 150;
    readonly object gate = new object();
    readonly string session;
    readonly long maxMs;
    readonly Func<Func<bool>, IFrameSource> open;
    readonly bool fixture;
    readonly Func<bool> outputAudible;
    // T12 (AEC-02): each pre-roll frame keeps its capture time and whether our output was audible (or in its reverb tail)
    // when it was captured. A tainted frame is never replayed into a new turn: it is echo of our own speech.
    struct PreRollFrame { public byte[] Data; public long Mono; public bool Tainted; }
    readonly Queue<PreRollFrame> preRoll = new Queue<PreRollFrame>();
    readonly AmbientFloor ambient = new AmbientFloor(AmbientFloor.MinFloor);
    public volatile bool StopFlag;
    public volatile bool Ready;
    public uint RenderDevice;
    public string ReferenceId;
    TurnFrames active;
    Thread thread;

    // N-10: the DMO poll runs at ~1 ms while a duplex session is live. Always paired: begun in Run, ended in its finally.
    [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
    [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);

    public DuplexInput(string id, long lifetime, Func<Func<bool>, IFrameSource> factory, bool isFixture, Func<bool> outputAudible)
    { session = id; maxMs = lifetime; open = factory; fixture = isFixture; this.outputAudible = outputAudible; }
    public AmbientFloor Ambient { get { return ambient; } }
    // The reason the capture loop ended with (the duplex.stopped reason). Set when the loop has finished; read by the selftest.
    public string EndReason { get; private set; }
    public void Start() { thread = new Thread(Run); thread.IsBackground = true; thread.Start(); }
    // The attached capture is finished first, with the stop's own reason, so closing its frames is never read as a lost device.
    public void Stop(string reason = "abort")
    {
        StopFlag = true;
        CaptureTurn attached;
        lock (Program.Gate) { attached = Program.Active; }
        if (attached != null && attached.Duplex) attached.Finish(reason);
        lock (gate) { if (active != null) active.Close(); }
    }
    public void Join(int ms) { if (thread != null) thread.Join(ms); }
    public bool Alive { get { return thread != null && thread.IsAlive; } }
    // N-01: a stop or a mute is honored before the device opens and after it returns, at each open checkpoint.
    bool Cancelled { get { return StopFlag || Program.Muted; } }

    public IFrameSource Attach()
    {
        lock (gate)
        {
            if (!Ready || StopFlag) throw new VoiceFault("AEC_UNAVAILABLE", "full-duplex capture is not ready");
            if (active != null && !active.Closed) throw new VoiceFault("DEVICE_BUSY", "recognition capture is already attached");
            active = new TurnFrames();
            while (preRoll.Count > 0)
            {
                PreRollFrame old = preRoll.Dequeue();
                // T12 (AEC-02): frames captured while our output was audible, or in its reverb tail, are dropped (zeroed),
                // never replayed. The rest keep their capture time, so onsets are measured from when they were heard.
                if (!old.Tainted) active.Push(old.Data, old.Mono);
                Array.Clear(old.Data, 0, old.Data.Length);
            }
            return active;
        }
    }

    static double FrameRms(byte[] frame)
    {
        double sumSq = 0;
        for (int i = 0; i + 1 < frame.Length; i += 2)
        {
            double s = (short)(frame[i] | (frame[i + 1] << 8)) / 32768.0;
            sumSq += s * s;
        }
        return Math.Sqrt(sumSq / (frame.Length / 2));
    }

    void Run()
    {
        IFrameSource source = null;
        byte[] frame = new byte[Consts.FrameBytes];
        long start = Out.Clock.ElapsedMilliseconds, nextCheck = start + 1000;
        string reason = "stop";
        bool periodBegun = false;
        try
        {
            if (Cancelled) throw new DuplexCancelled();
            timeBeginPeriod(1);
            periodBegun = true;
            source = open(() => Cancelled);
            if (Cancelled) throw new DuplexCancelled();
            AecSource aec = source as AecSource;
            if (!fixture && aec == null) throw new VoiceFault("AEC_UNAVAILABLE", "no acoustic echo canceller");
            int calibrated = 0;
            double quietest = double.MaxValue;
            bool timedOut = false;
            while (true)
            {
                // T12 (PRIV-03, round 2): the exit cause is recorded where the loop ends. The lifetime bound is checked first, so
                // a mute that coincides with an expired bound is reported as the lifetime (the bound ran out; see the selftest).
                if (Out.Clock.ElapsedMilliseconds - start >= maxMs) { timedOut = true; break; }
                if (Cancelled) break;
                int st = source.Read(frame);
                if (st < 0) throw new VoiceFault("DEVICE_LOST", "AEC capture stopped delivering samples");
                if (st == 0) { Thread.Sleep(1); continue; }
                double rms = FrameRms(frame);
                bool output = outputAudible != null && outputAudible();
                lock (gate)
                {
                    bool attached = active != null && !active.Closed;
                    long mono = Out.Clock.ElapsedMilliseconds;
                    // Echo of our own output: audible now, or within the 13-frame reverb tail that ends at this frame. Read before
                    // Observe, so the tail covers exactly OutputTailFrames frames after the last audible one. Round 2 (AEC-02
                    // LOW): a frame at or above TaintCeiling is user speech talking over the output, not echo the threshold can
                    // absorb, so it is kept for a turn armed later (its onset is then timed from its capture time).
                    bool tainted = (output || ambient.OutputActive) && rms < AmbientFloor.TaintCeiling;
                    ambient.Observe(rms, attached && ambient.Speaking, output);
                    if (attached) active.Push(frame, mono);
                    else
                    {
                        PreRollFrame kept = new PreRollFrame { Data = (byte[])frame.Clone(), Mono = mono, Tainted = tainted };
                        preRoll.Enqueue(kept);
                        while (preRoll.Count > PrerollFrames) { PreRollFrame old = preRoll.Dequeue(); Array.Clear(old.Data, 0, old.Data.Length); }
                    }
                }
                if (!Ready)
                {
                    quietest = Math.Min(quietest, rms);
                    if (++calibrated >= CalibrationFrames)
                    {
                        ambient.Calibrate(quietest);
                        RenderDevice = aec != null ? aec.RenderDevice : Native.WAVE_MAPPER;
                        ReferenceId = aec != null ? aec.OutputId : null;
                        Ready = true;
                        Out.Emit(Out.Ev("duplex.started", "session", session, "aec", fixture ? "fixture:no-aec" : "Windows Voice Capture DSP/source",
                            "reference", fixture ? "fixture" : "selected-render-endpoint", "inputId", aec != null ? aec.InputId : null,
                            "outputId", aec != null ? aec.OutputId : null, "renderDevice", (long)RenderDevice, "fixture", fixture,
                            "floor", ambient.Floor));
                    }
                }
                if (aec != null && Out.Clock.ElapsedMilliseconds >= nextCheck)
                {
                    nextCheck = Out.Clock.ElapsedMilliseconds + 1000;
                    if (!aec.SameEndpoints()) throw new VoiceFault("DEVICE_LOST", "audio endpoint changed; explicitly start voice again");
                }
            }
            // T12 (PRIV-03): the loop also ends when the microphone is muted. That is a mute, not the lifetime bound. The cause
            // is the one recorded at the loop's exit, not the live Muted flag, which may have changed since.
            if (!StopFlag) reason = timedOut ? "lifetime" : "mute";
        }
        catch (DuplexCancelled)
        {
            reason = "stop";
        }
        catch (Exception e)
        {
            reason = "error";
            VoiceFault fault = e as VoiceFault;
            Guard.Emit(Out.Ev("duplex.error", "session", session, "code", fault != null ? fault.Code : "AEC_UNAVAILABLE",
                "message", fault != null ? fault.Message : "AEC source failed: " + e.GetType().Name + " in " + (e.TargetSite != null ? e.TargetSite.DeclaringType.Name + "." + e.TargetSite.Name : "?") + " " + (e.Message.Length > 120 ? e.Message.Substring(0, 120) : e.Message)));
        }
        finally
        {
            StopFlag = true; Ready = false;
            Array.Clear(frame, 0, frame.Length);
            // The attached capture finishes before its frames close (see Stop), so a stop is never reported as a lost device.
            CaptureTurn finishing;
            bool captureReleased = true;
            lock (Program.Gate) { finishing = Program.Active; }
            if (finishing != null && finishing.Duplex)
            {
                finishing.Finish("abort");
                lock (gate) { if (active != null) active.Close(); }
                finishing.JoinCapture(500);
                if (finishing.CaptureAliveForTest)
                {
                    Guard.Emit(Out.Ev("duplex.error", "session", session, "code", "DEVICE_BUSY", "message", "capture thread is still releasing; worker cleanup required"));
                    captureReleased = false;
                }
            }
            try { if (source != null) source.Close(); } catch { }
            lock (gate) { if (active != null) active.Close(); while (preRoll.Count > 0) { PreRollFrame old = preRoll.Dequeue(); Array.Clear(old.Data, 0, old.Data.Length); } }
            EndReason = reason;
            if (captureReleased) Guard.Emit(Out.Ev("duplex.stopped", "session", session, "reason", reason));
            if (periodBegun) timeEndPeriod(1);
        }
    }

    // One input turn's view of the continuous frames. Bounded: a consumer that falls more than 5 s behind is a BUFFER_LIMIT.
    internal sealed class TurnFrames : IFrameSource
    {
        const int MaxFrames = 250;
        readonly object gate = new object();
        readonly Queue<PreRollFrame> frames = new Queue<PreRollFrame>();
        public bool Closed;
        bool overflow;
        long lastMono = -1;
        // T12 (AEC-02): the capture time of the frame last read. A replayed pre-roll frame keeps the time it was heard.
        public long LastMono { get { lock (gate) { return lastMono; } } }
        public void Push(byte[] frame, long mono)
        {
            lock (gate)
            {
                if (Closed) return;
                if (frames.Count >= MaxFrames) { overflow = true; return; }
                frames.Enqueue(new PreRollFrame { Data = (byte[])frame.Clone(), Mono = mono, Tainted = false });
            }
        }
        public int Read(byte[] frame)
        {
            lock (gate)
            {
                if (overflow) throw new VoiceFault("BUFFER_LIMIT", "continuous recognition queue exceeded 5 seconds");
                if (frames.Count == 0) return Closed ? -1 : 0;
                PreRollFrame next = frames.Dequeue();
                Buffer.BlockCopy(next.Data, 0, frame, 0, frame.Length);
                Array.Clear(next.Data, 0, next.Data.Length);
                lastMono = next.Mono;
                return 1;
            }
        }
        public void Close() { lock (gate) { Closed = true; while (frames.Count > 0) { PreRollFrame frame = frames.Dequeue(); Array.Clear(frame.Data, 0, frame.Data.Length); } } }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Blocking PCM pipe feeding the recognizer. Read blocks until the full count is available or the pipe is closed.
// ---------------------------------------------------------------------------------------------------------------
internal sealed class PcmPipe : Stream
{
    readonly object gate = new object();
    byte[] buf = new byte[65536];
    int rd;
    int wr;
    bool closed;
    long position;
    long peak;

    public long PeakUnread
    {
        get { lock (gate) { return peak; } }
    }

    public void Push(byte[] src, int offset, int count)
    {
        lock (gate)
        {
            if (closed) return;
            if (wr + count > buf.Length)
            {
                int unread = wr - rd;
                if (rd > 0)
                {
                    Buffer.BlockCopy(buf, rd, buf, 0, unread);
                    wr = unread;
                    rd = 0;
                }
                if (wr + count > buf.Length)
                {
                    byte[] bigger = new byte[Math.Max(buf.Length * 2, wr + count)];
                    Buffer.BlockCopy(buf, 0, bigger, 0, wr);
                    buf = bigger;
                }
            }
            Buffer.BlockCopy(src, offset, buf, wr, count);
            wr += count;
            if (wr - rd > peak) peak = wr - rd;
            Monitor.PulseAll(gate);
        }
    }

    public void CloseWrite()
    {
        lock (gate)
        {
            closed = true;
            Monitor.PulseAll(gate);
        }
    }

    // Releases the buffered raw audio (zeroed first) and ends the stream: later pushes are ignored and reads see EOF.
    public void Wipe()
    {
        lock (gate)
        {
            Array.Clear(buf, 0, buf.Length);
            buf = new byte[0];
            rd = 0;
            wr = 0;
            closed = true;
            Monitor.PulseAll(gate);
        }
    }

    // Test-only: bytes still held (unread) by the pipe.
    internal int UnreadBytes
    {
        get { lock (gate) { return wr - rd; } }
    }

    public override int Read(byte[] b, int offset, int count)
    {
        lock (gate)
        {
            while (wr - rd < count && !closed) Monitor.Wait(gate, 50);
            int n = Math.Min(count, wr - rd);
            if (n > 0)
            {
                Buffer.BlockCopy(buf, rd, b, offset, n);
                rd += n;
                position += n;
            }
            return n;
        }
    }

    public override bool CanRead { get { return true; } }
    public override bool CanSeek { get { return false; } }
    public override bool CanWrite { get { return false; } }
    public override long Length { get { return long.MaxValue; } }
    public override long Position
    {
        get { return position; }
        set { } // SAPI may reset the read position to 0 at start; the pipe is forward-only and ignores it
    }
    public override void Flush() { }
    // SAPI queries the position with Seek(0, Current) during setup; any real seek is refused.
    public override long Seek(long offset, SeekOrigin origin)
    {
        if (offset == 0 && origin == SeekOrigin.Current) return position;
        throw new NotSupportedException("forward-only audio pipe");
    }
    public override void SetLength(long value) { throw new NotSupportedException(); }
    public override void Write(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
}

// ---------------------------------------------------------------------------------------------------------------
// Energy VAD on audio time (not wall time), with a quiet-frame noise floor and a LOW absolute threshold.
// Onset: rms above max(floor * 3, MinThreshold) for OnsetMs consecutive. Endpoint: silence >= SilenceEndMs AND no
// recognizer evidence (hypothesis or speech-detected) for HypothesisHoldMs. Recognizer evidence within EvidenceMs
// keeps the no-speech timer from expiring. Measurements here use the RAW frame only; see Agc for the fed audio.
// ---------------------------------------------------------------------------------------------------------------
internal sealed class Vad
{
    readonly bool duplex;
    // Duplex only. A session's turns share the DuplexInput model (it learns from every frame); a standalone duplex Vad owns one.
    readonly AmbientFloor ambient;
    readonly bool ownsAmbient;
    bool outputNow;
    public int PauseMs = SilenceEndMs;
    public Vad() : this(false) { }
    public Vad(bool continuous) : this(continuous, AmbientFloor.MinFloor, null) { }
    public Vad(bool continuous, double initialFloor) : this(continuous, initialFloor, null) { }
    public Vad(bool continuous, double initialFloor, AmbientFloor shared)
    {
        duplex = continuous;
        if (continuous)
        {
            ambient = shared ?? new AmbientFloor(initialFloor);
            ownsAmbient = shared == null;
            // A turn that was aborted mid-speech leaves the shared flag set; a new turn starts with no speech in progress.
            ambient.Speaking = false;
        }
    }
    public const int None = 0, SpeechStart = 1, SpeechEnd = 2, NoSpeech = 3, NoiseOnly = 4;
    public const int OnsetMs = 120, SilenceEndMs = 900, HypothesisHoldMs = 700, NoSpeechMs = 8000, EvidenceMs = 1500;
    // T12 duplex: speech with no frame above the onset threshold for this long ends the turn (the 30 s cap is still the bound).
    public const int SoftSpeechMaxMs = 4000;
    // Bursts shorter than this are "short": ended without a recognition decode in duplex, ignored in half duplex.
    public const int ShortSpeechMs = 250;
    public const double MinThreshold = 0.0006;
    // Live finding (Part B, whisper mode): room noise that rose after the 400 ms calibration stayed above floor*3 between
    // words, so no end of speech was ever seen and turns ran to the 30 s cap. Inside speech, a frame is also silent when it
    // is below EndPeakFraction of the utterance's smoothed speech peak. R4: the cap is 0.002, so soft speech (>= 0.002)
    // after a loud section or a click is never counted as silence, and the peak decays (~7 s half-life) so one loud moment
    // does not set the threshold for the rest of a long turn. Limit (disclosed): a speaker whose peak is less than ~12x the
    // room noise still never reaches an energy end; the turn then ends on release, a second tap, or the 30 s cap.
    public const double EndPeakFraction = 0.08, EndPeakCap = 0.002, PeakDecay = 0.998;
    // Duplex only. Stationary loud ambient (above the onset threshold, far above the capped floor) never falls under the
    // end threshold, so it could hold a turn open for ever. A frame is therefore also silent when it is within
    // NoiseRefGain of the quietest frame seen just before the onset: a steady level has no quiet part to fall to, and a
    // speaker's pauses still do. Sustained speech after silence is judged against that silence, so it is not silent.
    public const double NoiseRefGain = 1.5;
    const int CalibrationFrames = 20;
    int frames;
    double floor;
    int aboveMs;
    bool inSpeech;
    bool onset;
    int speechMs;
    int silenceMs;
    int totalMs;
    int quietMs;
    long highMs;
    bool noSpeechSent;
    bool noiseSent;
    double smooth;
    double speechPeak;
    int aboveSpeechMs;
    bool endedShort;
    double quietRef; // duplex only: the ambient window's quietest frame at onset

    public bool InSpeech { get { return inSpeech; } }
    public bool SawOnset { get { return onset; } }
    public int SpeechMs { get { return speechMs; } }
    public int AboveMs { get { return aboveMs; } }
    // True when the last speech_end was a burst below ShortSpeechMs (duplex only).
    public bool EndedShort { get { return endedShort; } }
    public bool HighEnergy { get { return totalMs > 0 && highMs * 2 >= totalMs; } }
    public double Threshold { get { return duplex ? ambient.OnsetThreshold : Math.Max(floor * 3.0, MinThreshold); } }
    // Duplex readings for level and vad events. Residual is null when nothing of ours is audible.
    public double Floor { get { return duplex ? ambient.Floor : floor; } }
    public double? Residual { get { return duplex ? ambient.Residual : null; } }
    public bool OutputActive { get { return duplex && ambient.OutputActive; } }
    // Standalone duplex only: whether our speaker is audible for the owned model. Sessions observe output in DuplexInput.
    public void SetOutputActive(bool on) { outputNow = on; }

    // msSinceEvidence: milliseconds since the recognizer last hypothesized or detected speech (int.MaxValue if never).
    public int Feed(double rms, int msSinceEvidence)
    {
        frames++;
        totalMs = frames * Consts.FrameMs;
        if (!onset && rms >= 0.02) highMs += Consts.FrameMs;
        if (!duplex && frames <= CalibrationFrames)
        {
            // Calibration over the first 400 ms: no onset allowed. The floor is the quietest frame seen. Duplex turns do
            // not recalibrate: the session's ambient model was measured before the first turn could start.
            floor = frames == 1 ? rms : Math.Min(floor, rms);
            return None;
        }
        double threshold = Threshold;
        if (!inSpeech)
        {
            if (rms > threshold)
            {
                aboveMs += Consts.FrameMs;
                if (aboveMs >= OnsetMs)
                {
                    inSpeech = true;
                    onset = true;
                    speechMs = aboveMs;
                    silenceMs = 0;
                    quietMs = 0;
                    aboveSpeechMs = 0;
                    smooth = rms;
                    speechPeak = rms;
                    if (duplex) { ambient.Speaking = true; quietRef = ambient.WindowMin; }
                    return SpeechStart;
                }
            }
            else
            {
                aboveMs = 0;
                if (!duplex) floor = floor * 0.95 + rms * 0.05;
            }
            if (ownsAmbient) ambient.Observe(rms, false, outputNow);
            // The no-speech clock only runs while the recognizer has produced no evidence.
            if (msSinceEvidence < EvidenceMs) quietMs = 0;
            else quietMs += Consts.FrameMs;
            if (!onset && !noSpeechSent && quietMs >= NoSpeechMs)
            {
                noSpeechSent = true;
                return NoSpeech;
            }
            if (!onset && !noiseSent && totalMs >= 2000 && HighEnergy)
            {
                noiseSent = true;
                return NoiseOnly;
            }
            return None;
        }
        // ~100 ms exponential smoothing: the peak follows syllables, not single-frame clicks.
        smooth = smooth * 0.8 + rms * 0.2;
        speechPeak = Math.Max(smooth, speechPeak * PeakDecay);
        double endThreshold = Math.Max(threshold, Math.Min(speechPeak * EndPeakFraction, EndPeakCap));
        // R4: speechMs keeps its original meaning (frames above the onset threshold); it feeds the 250 ms end gate and the
        // whisper hallucination guard. Only the silence clock uses the peak-relative end threshold.
        if (rms > threshold) speechMs += Consts.FrameMs;
        // Duplex: stationary ambient above the threshold is silent too (see NoiseRefGain). Half duplex is unchanged.
        double quietBelow = duplex ? Math.Max(endThreshold, quietRef * NoiseRefGain) : endThreshold;
        if (rms > quietBelow) silenceMs = 0;
        else silenceMs += Consts.FrameMs;
        if (rms > threshold) aboveSpeechMs = 0;
        else aboveSpeechMs += Consts.FrameMs;
        bool silenceEnd = silenceMs >= PauseMs && msSinceEvidence >= HypothesisHoldMs;
        // T12 duplex: soft speech that never rises above the onset threshold for SoftSpeechMaxMs ends the turn, whatever the
        // peak logic or recognizer evidence says, so a held-open turn cannot run on until the 30 s cap.
        bool softEnd = duplex && aboveSpeechMs >= SoftSpeechMaxMs;
        if (silenceEnd || softEnd)
        {
            inSpeech = false;
            aboveMs = 0;
            if (duplex)
            {
                // Every duplex onset ends with a speech_end, including bursts below ShortSpeechMs (the caller ends them
                // without a decode). Half duplex keeps its T10 rule: a short burst is dropped silently.
                endedShort = speechMs < ShortSpeechMs;
                ambient.Speaking = false;
                return SpeechEnd;
            }
            if (speechMs >= ShortSpeechMs) return SpeechEnd;
        }
        if (ownsAmbient) ambient.Observe(rms, true, outputNow);
        return None;
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Bounded digital gain for the audio FED TO THE RECOGNIZER only. Levels and the VAD use the raw frame.
// Speech: gain drifts toward Target / speechRms, clamped to 1x..MaxGain. Outside speech: gain is clamped to 1x,
// so the noise floor is never amplified. Smoothed: fast release, slower attack.
// ---------------------------------------------------------------------------------------------------------------
internal sealed class Agc
{
    public const double Target = 0.1, MaxGain = 24.0;
    double gain = 1.0;
    double speechRms;

    public double Gain { get { return gain; } }

    public void Apply(byte[] src, byte[] dst, double rawRms, bool speech)
    {
        if (speech && rawRms >= 0.0005) speechRms = speechRms <= 0 ? rawRms : speechRms * 0.9 + rawRms * 0.1;
        double want = speech && speechRms > 0 ? Math.Min(MaxGain, Math.Max(1.0, Target / speechRms)) : 1.0;
        gain += (want - gain) * (want > gain ? 0.1 : 0.3);
        if (gain < 1.0) gain = 1.0;
        if (gain > MaxGain) gain = MaxGain;
        for (int i = 0; i + 1 < Consts.FrameBytes; i += 2)
        {
            int s = (short)(src[i] | (src[i + 1] << 8));
            double v = s * gain;
            if (v > 32767) v = 32767;
            if (v < -32768) v = -32768;
            short o = (short)Math.Round(v);
            dst[i] = (byte)(o & 0xff);
            dst[i + 1] = (byte)((o >> 8) & 0xff);
        }
    }
}

// Pure terminal decision for one capture turn. Recognizer text is a final only when the VAD saw an onset; rejected
// recognizer text is never promoted to a final.
internal static class StopDecision
{
    public static string Terminal(bool aborted, bool sawOnset, bool highEnergy, int textCount, bool rejectedSeen, bool timedOut)
    {
        if (aborted) return "aborted";
        if (!sawOnset) return highEnergy ? "noise_only" : "no_speech";
        if (textCount > 0) return "final";
        if (rejectedSeen) return "rejected";
        return timedOut ? "timeout" : "rejected";
    }
}

// ---------------------------------------------------------------------------------------------------------------
// whisper.cpp engine (--stt whisper). Native surface: bunny-whisper-shim.dll (native/voice/whisper-shim.c), staged
// next to the pinned whisper.dll, ggml.dll and ggml-base.dll. Local only: no network, no GPU, no file writes.
// ---------------------------------------------------------------------------------------------------------------
internal static class WhisperNative
{
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool SetDllDirectoryW(string path);
    [DllImport("bunny-whisper-shim.dll", CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr bws_init(byte[] modelUtf8, int threads);
    [DllImport("bunny-whisper-shim.dll", CallingConvention = CallingConvention.Cdecl)] public static extern int bws_transcribe(IntPtr ctx, float[] pcm, int nSamples, byte[] outUtf8, int outCap, out float confidence, out float noSpeechProb);
    [DllImport("bunny-whisper-shim.dll", CallingConvention = CallingConvention.Cdecl)] public static extern void bws_free(IntPtr ctx);
    [DllImport("bunny-whisper-shim.dll", CallingConvention = CallingConvention.Cdecl)] public static extern IntPtr bws_version();
}

internal sealed class WhisperResult
{
    public int Code;
    public string Text;
    public float Confidence;
    public float NoSpeechProb;
}

// One loaded model. whisper contexts are not re-entrant, so every decode takes decodeGate (one at a time, process-wide).
internal sealed class WhisperEngine
{
    public const string EngineName = "whisper.cpp v1.9.4";
    public const string ShimName = "bunny-whisper-shim.dll";
    static readonly object decodeGate = new object();
    IntPtr ctx;

    public string Recognizer { get; private set; }
    public long LoadMs { get; private set; }

    WhisperEngine() { }

    // Loads the model once. Returns null with a reason when anything is missing or fails to load (the worker then uses SAPI).
    public static WhisperEngine Load(string runtimeDir, string modelPath, int threads, out string error)
    {
        error = null;
        if (string.IsNullOrEmpty(runtimeDir) || string.IsNullOrEmpty(modelPath)) { error = "runtime directory and model path are required"; return null; }
        if (!Path.IsPathRooted(runtimeDir) || !Path.IsPathRooted(modelPath)) { error = "runtime directory and model path must be absolute"; return null; }
        if (!Directory.Exists(runtimeDir)) { error = "runtime directory is missing"; return null; }
        if (!File.Exists(Path.Combine(runtimeDir, ShimName))) { error = ShimName + " is missing from the runtime directory"; return null; }
        if (!File.Exists(modelPath)) { error = "model file is missing"; return null; }
        try
        {
            // Must run before the first P/Invoke into the shim, so the shim and its whisper/ggml dependencies resolve here.
            if (!WhisperNative.SetDllDirectoryW(runtimeDir)) { error = "runtime directory could not be added to the DLL search path"; return null; }
            byte[] path = Encoding.UTF8.GetBytes(modelPath + "\0");
            Stopwatch sw = Stopwatch.StartNew();
            IntPtr c = WhisperNative.bws_init(path, threads);
            sw.Stop();
            if (c == IntPtr.Zero) { error = "model did not load"; return null; }
            WhisperEngine e = new WhisperEngine();
            e.ctx = c;
            e.Recognizer = Path.GetFileNameWithoutExtension(modelPath);
            e.LoadMs = sw.ElapsedMilliseconds;
            return e;
        }
        catch (DllNotFoundException) { error = "runtime DLL could not be loaded"; }
        catch (EntryPointNotFoundException) { error = "runtime ABI does not match the shim"; }
        catch (BadImageFormatException) { error = "runtime DLL architecture does not match"; }
        catch (Exception ex) { error = "runtime load failed: " + ex.GetType().Name; }
        return null;
    }

    // pcm: 16 kHz mono float32, n samples. Never throws for a native failure: the result carries a negative Code.
    public WhisperResult Transcribe(float[] pcm, int n)
    {
        WhisperResult r = new WhisperResult();
        r.Code = -1;
        r.Text = "";
        r.Confidence = 0f;
        r.NoSpeechProb = 1f;
        if (ctx == IntPtr.Zero || pcm == null || n <= 0) return r;
        byte[] outBuf = new byte[8192];
        try
        {
            lock (decodeGate)
            {
                float conf;
                float nsp;
                int rc = WhisperNative.bws_transcribe(ctx, pcm, n, outBuf, outBuf.Length, out conf, out nsp);
                r.Code = rc;
                r.Confidence = conf;
                r.NoSpeechProb = nsp;
                if (rc >= 0) r.Text = Encoding.UTF8.GetString(outBuf, 0, Math.Min(rc, outBuf.Length - 1));
            }
        }
        finally
        {
            Array.Clear(outBuf, 0, outBuf.Length);
        }
        return r;
    }
}

// Accepts or rejects one whisper decode. Pure: no devices, no native calls.
internal static class WhisperGate
{
    public const float NoSpeechMax = 0.6f;
    public const int HallucinationMaxSpeechMs = 1000;
    // Phrases whisper emits on silence. A short utterance that is only one of these is never a command.
    static readonly string[] Hallucinations = { "you", "thank you", "thanks for watching", "thank you for watching", "bye", "bye bye", "the end" };

    // null: accepted. Otherwise the stt.none reason.
    public static string Reject(WhisperResult r, long speechMs, bool highEnergy)
    {
        if (r == null || r.Code < 0) return "rejected";
        string t = r.Text == null ? "" : r.Text.Trim();
        if (t.Length == 0) return "no_speech";
        if (IsBracketed(t)) return t.IndexOf("BLANK", StringComparison.OrdinalIgnoreCase) >= 0 ? "no_speech" : "noise_only";
        if (r.NoSpeechProb > NoSpeechMax) return "no_speech";
        string n = Normalize(t);
        if (n.Length == 0) return "no_speech";
        if (speechMs < HallucinationMaxSpeechMs && Array.IndexOf(Hallucinations, n) >= 0) return "no_speech";
        return null;
    }

    static bool IsBracketed(string t)
    {
        return (t[0] == '[' && t[t.Length - 1] == ']') || (t[0] == '(' && t[t.Length - 1] == ')');
    }

    public static string Normalize(string text)
    {
        StringBuilder sb = new StringBuilder();
        bool space = false;
        foreach (char ch in text.ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                if (space && sb.Length > 0) sb.Append(' ');
                space = false;
                sb.Append(ch);
            }
            else if (char.IsWhiteSpace(ch) || ch == '-')
            {
                space = true;
            }
        }
        return sb.ToString();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// One capture turn: capture thread (device -> pipe + VAD + level) and a finalize thread (recognizer flush).
// ---------------------------------------------------------------------------------------------------------------
internal sealed class CaptureTurn : IAbandonedRecognizer
{
    public bool Duplex;
    // T12 duplex: the session's ambient model (shared across turns). Null for half-duplex turns.
    public AmbientFloor Ambient;
    public readonly string Turn;
    public readonly long Gen;
    public readonly VoiceDevice Device;
    public readonly bool VadEndpoint;
    public readonly long MaxBytes;
    public readonly PcmPipe Pipe = new PcmPipe();
    readonly ManualResetEvent completed = new ManualResetEvent(false);
    readonly List<string> texts = new List<string>();
    readonly List<double> confidences = new List<double>();
    readonly object gate = new object();
    SpeechRecognitionEngine engine;
    Thread captureThread;
    Thread finalThread;
    public volatile bool StopFlag;
    bool closed;
    bool aborted;
    bool terminal;
    bool terminalEmitted;
    bool sawOnset;
    bool highEnergy;
    // T12: the VAD ended the turn on a burst below ShortSpeechMs (duplex): finalize without a decode, reason too_short.
    bool shortEnded;
    // Guarded by Program.Gate: set when the terminal event is out. See Program.Finalizing.
    bool finalizeDone;
    bool timedOut;
    bool rejectedSeen;
    string stopReason;
    string lastPartial;
    // Monotonic ms of the last recognizer evidence (hypothesis or speech-detected). Read by the capture thread.
    long lastEvidenceMono = long.MinValue;
    readonly object evidenceGate = new object();

    // whisper mode only: the bounded utterance buffer (16 kHz mono float32) and its partial/final bookkeeping.
    // bufGate guards wbuf, wlen, wSealed, wPartialInFlight, wLastPartialLen, wPeakSamples and speechMsPub.
    readonly WhisperEngine whisper;
    readonly object bufGate = new object();
    float[] wbuf;
    int wlen;
    long wPeakSamples;
    bool wSealed;
    bool wPartialInFlight;
    int wLastPartialLen;
    int speechMsPub;
    bool abortRequested;
    const int PartialMinSamples = 16000;   // 1 s of audio before the first interim decode
    const int PartialEverySamples = 19200; // 1.2 s between interim decodes

    public CaptureTurn(string turn, long gen, VoiceDevice device, bool vad, long maxBytes)
    {
        Turn = turn;
        Gen = gen;
        Device = device;
        VadEndpoint = vad;
        MaxBytes = maxBytes;
    }

    // whisper engine: maxBytes is maxMs * 32 bytes, so the sample bound is maxBytes / 2 (maxMs * 16 samples).
    public CaptureTurn(string turn, long gen, VoiceDevice device, bool vad, long maxBytes, WhisperEngine engine)
        : this(turn, gen, device, vad, maxBytes)
    {
        whisper = engine;
        if (engine != null) wbuf = new float[maxBytes / 2];
    }

    // Test seam (selftest only): runs on the new engine before the grammar loads, so a fault here exercises the teardown.
    internal Action<SpeechRecognitionEngine> FaultInjectForTest;

    // Caller is the command loop under Program.Gate. A failure at any step disposes the engine before rethrowing: a
    // recognizer that never started holds no completion the abandon ledger could wait for, so it cannot be ledgered.
    public void StartRecognizer(RecognizerInfo info)
    {
        if (whisper != null) return; // whisper turns decode the buffer at finalize; there is no SAPI engine
        engine = info != null ? new SpeechRecognitionEngine(info) : new SpeechRecognitionEngine(new CultureInfo("en-US"));
        try
        {
            if (FaultInjectForTest != null) FaultInjectForTest(engine);
            engine.LoadGrammar(new DictationGrammar());
            engine.SpeechDetected += (s, e) => MarkEvidence();
            engine.SpeechHypothesized += (s, e) => OnHypothesis(e.Result == null ? null : e.Result.Text);
            engine.SpeechRecognized += (s, e) => { if (e.Result != null) OnRecognized(e.Result.Text, e.Result.Confidence); };
            engine.SpeechRecognitionRejected += (s, e) =>
            {
                if (e.Result != null && !string.IsNullOrWhiteSpace(e.Result.Text))
                {
                    lock (gate) { rejectedSeen = true; }
                }
            };
            engine.RecognizeCompleted += (s, e) => completed.Set();
            engine.SetInputToAudioStream(Pipe, new SpeechAudioFormatInfo(Consts.SampleRate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
            engine.RecognizeAsync(RecognizeMode.Multiple);
        }
        catch (Exception)
        {
            ReleaseEngine();
            throw;
        }
    }

    // Test-only: whether this turn still holds a recognizer engine.
    internal bool EngineHeldForTest { get { return engine != null; } }

    // Test-only: whether the capture thread is still running.
    internal bool CaptureAliveForTest { get { Thread c = captureThread; return c != null && c.IsAlive; } }
    // Test seam (selftest only): the onsetMono of the duplex speech_start this turn emitted (-1 before any).
    long onsetMonoForTest = -1;
    internal long OnsetMonoForTest { get { lock (gate) { return onsetMonoForTest; } } }

    public void StartCapture(IFrameSource source)
    {
        // The whole body is guarded: an exception raised outside the loop's own handlers (for example a failed protocol
        // write) ends this turn as an error and never escapes the thread, which would terminate the worker.
        captureThread = new Thread(() => Guard.Run(() => CaptureLoop(source), FaultCapture));
        captureThread.IsBackground = true;
        captureThread.Start();
    }

    void FaultCapture(Exception e)
    {
        Guard.Emit(Out.Ev("capture.error", "turn", Turn, "gen", Gen, "code", "INTERNAL", "message", "capture fault: " + e.GetType().Name));
        try { Finish("error"); }
        catch (Exception) { }
    }

    public void Join(int ms)
    {
        Thread c = captureThread;
        if (c != null) c.Join(ms);
        Thread f = finalThread;
        if (f != null) f.Join(ms);
    }
    public void JoinCapture(int ms) { Thread c = captureThread; if (c != null) c.Join(ms); }

    public void Finish(string reason)
    {
        lock (gate)
        {
            if (closed)
            {
                // T12: an abort reaches a turn that is only finalizing (its capture ended), for either engine. Its final
                // is then withheld and it reports aborted, so an abort never produces text.
                if (reason == "abort" || reason == "mute" || reason == "shutdown") abortRequested = true;
                return;
            }
            closed = true;
            stopReason = reason;
            aborted = reason != "end" && reason != "max" && reason != "vad";
        }
        StopFlag = true;
        finalThread = new Thread(FinalizeMain);
        finalThread.IsBackground = true;
        finalThread.Start();
    }

    // Never throws: this runs on the fault paths of the capture thread, where a closed host pipe must not escape.
    void EmitCaptureError(string code, string message)
    {
        Guard.Emit(Out.Ev("capture.error", "turn", Turn, "gen", Gen, "code", code, "message", Out.Trunc(message, 300)));
    }

    void CaptureLoop(IFrameSource source)
    {
        byte[] frame = new byte[Consts.FrameBytes];
        byte[] fed = new byte[Consts.FrameBytes];
        Vad vad = Duplex ? new Vad(true, AmbientFloor.MinFloor, Ambient) : new Vad(false);
        Agc agc = new Agc();
        bool first = true;
        long bytes = 0;
        double windowSq = 0;
        double windowPeak = 0;
        int windowFrames = 0;
        // T12 duplex: worker-monotonic time of the first above-threshold frame of the current onset window.
        long onsetWindowMono = -1;
        try
        {
            while (!StopFlag)
            {
                int st = source.Read(frame);
                if (st == 0) { Thread.Sleep(2); continue; }
                // T12 (AEC-02): onsets are timed from when the frame was captured. A replayed pre-roll frame keeps its time.
                long frameMono = Out.Clock.ElapsedMilliseconds;
                DuplexInput.TurnFrames timed = source as DuplexInput.TurnFrames;
                if (timed != null && st > 0) frameMono = timed.LastMono;
                if (st < 0)
                {
                    // A capture already finishing (stop, mute, abort) ends quietly: its reason is the one it was finished with.
                    if (StopFlag) break;
                    EmitCaptureError("DEVICE_LOST", "input device stopped delivering audio");
                    Finish("error");
                    break;
                }
                if (StopFlag) break;
                if (first)
                {
                    first = false;
                    Out.Emit(Out.Ev("capture.first_audio", "turn", Turn, "gen", Gen));
                }
                bytes += Consts.FrameBytes;

                double sumSq = 0;
                double peak = 0;
                for (int i = 0; i + 1 < Consts.FrameBytes; i += 2)
                {
                    double s = (short)(frame[i] | (frame[i + 1] << 8)) / 32768.0;
                    sumSq += s * s;
                    double a = Math.Abs(s);
                    if (a > peak) peak = a;
                }
                double rms = Math.Sqrt(sumSq / (Consts.FrameBytes / 2));
                if (Duplex) vad.PauseMs = EndpointPause();
                if (Duplex && !vad.InSpeech && vad.AboveMs == 0 && rms > vad.Threshold) onsetWindowMono = frameMono;
                int ev = vad.Feed(rms, MsSinceEvidence());
                PublishOnset(vad);
                agc.Apply(frame, fed, rms, vad.InSpeech);
                if (whisper != null)
                {
                    // Live finding: the time-varying AGC (1x before onset, ramping to 24x in speech) made whisper hear only
                    // the amplified tail of each utterance. Whisper normalizes levels itself (log-mel), so it gets the raw,
                    // uniformly scaled frames; the AGC stays only for the SAPI feed.
                    AppendWhisper(frame);
                    MaybeStartPartial(vad);
                }
                else
                {
                    Pipe.Push(fed, 0, Consts.FrameBytes);
                }
                if (ev == Vad.SpeechStart)
                {
                    if (Duplex) lock (gate) { onsetMonoForTest = onsetWindowMono; }
                    if (Duplex) Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_start", "onsetMono", onsetWindowMono, "outputActive", vad.OutputActive));
                    else Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_start"));
                }
                else if (ev == Vad.SpeechEnd)
                {
                    if (Duplex) Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_end", "speechMs", vad.SpeechMs, "short", vad.EndedShort));
                    else Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_end"));
                    if (VadEndpoint)
                    {
                        // A short burst ends the turn without a decode; the flag is read by the finalizer under gate.
                        lock (gate) { shortEnded = Duplex && vad.EndedShort; }
                        Finish("vad");
                    }
                }
                else if (ev == Vad.NoSpeech)
                {
                    Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "no_speech"));
                    if (VadEndpoint) Finish("vad");
                }
                else if (ev == Vad.NoiseOnly)
                {
                    Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "noise_only"));
                }

                windowSq += sumSq;
                if (peak > windowPeak) windowPeak = peak;
                windowFrames++;
                if (windowFrames == 5)
                {
                    double rmsWindow = Math.Sqrt(windowSq / (5.0 * (Consts.FrameBytes / 2)));
                    Dictionary<string, object> lv = Out.Ev("level", "turn", Turn, "gen", Gen, "rms", rmsWindow, "peak", windowPeak, "speech", vad.InSpeech, "speechMs", vad.SpeechMs);
                    if (Duplex)
                    {
                        // T12: the bounded floor, the output residual (null when nothing of ours is audible) and whether it is.
                        double? residual = vad.Residual;
                        lv["floor"] = vad.Floor;
                        lv["residual"] = residual.HasValue ? (object)residual.Value : null;
                        lv["outputActive"] = vad.OutputActive;
                    }
                    Out.Emit(lv);
                    windowSq = 0;
                    windowPeak = 0;
                    windowFrames = 0;
                }
                if (bytes >= MaxBytes)
                {
                    Finish("max");
                    break;
                }
            }
        }
        catch (Exception e)
        {
            EmitCaptureError("INTERNAL", "capture loop failed: " + e.GetType().Name);
            Finish("error");
        }
        finally
        {
            // Raw microphone samples do not outlive the turn in this thread's buffers.
            Array.Clear(frame, 0, frame.Length);
            Array.Clear(fed, 0, fed.Length);
            try { source.Close(); } catch (Exception) { }
            PublishOnset(vad);
            lock (Program.Gate)
            {
                // The turn stops being the active capture here, so the next input turn may attach while this one finalizes.
                // It stays reachable for capture.abort until its final is emitted (Program.Finalizing).
                if (Program.Active == this) Program.Active = null;
                // A finalizer that already finished (the capture thread was slow to exit) must not leave an entry behind.
                if (!finalizeDone) Program.Finalizing.Add(this);
            }
            string reason;
            lock (gate) { reason = stopReason ?? "error"; }
            Guard.Emit(Out.Ev("capture.stopped", "turn", Turn, "gen", Gen, "reason", reason, "bufferedPeakBytes", BufferedPeakBytes()));
        }
    }

    void MarkEvidence()
    {
        lock (evidenceGate) { lastEvidenceMono = Out.Clock.ElapsedMilliseconds; }
    }

    int EndpointPause()
    {
        string text;
        lock (gate) { text = lastPartial; }
        return Endpointing.PauseFor(text);
    }

    int MsSinceEvidence()
    {
        long at;
        lock (evidenceGate) { at = lastEvidenceMono; }
        if (at == long.MinValue) return int.MaxValue;
        long d = Out.Clock.ElapsedMilliseconds - at;
        return d > int.MaxValue ? int.MaxValue : (int)d;
    }

    void OnHypothesis(string text)
    {
        MarkEvidence();
        if (string.IsNullOrEmpty(text)) return;
        lock (gate)
        {
            if (closed || terminal) return;
            if (text == lastPartial) return;
            lastPartial = text;
            Out.Emit(Out.Ev("stt.partial", "turn", Turn, "gen", Gen, "text", Out.Trunc(text, 2000)));
        }
    }

    void OnRecognized(string text, float confidence)
    {
        if (string.IsNullOrEmpty(text) || text.Trim().Length == 0) return;
        lock (gate)
        {
            texts.Add(text.Trim());
            confidences.Add(confidence);
        }
    }

    // Publishes the VAD onset state as each frame is processed, so the finalize decision never reads a stale value
    // when the capture thread is late to exit.
    internal void PublishOnset(Vad v)
    {
        lock (gate)
        {
            sawOnset = v.SawOnset;
            highEnergy = v.HighEnergy;
            speechMsPub = v.SpeechMs;
        }
    }

    // Test-only: what the finalize decision would read right now.
    internal bool[] OnsetSnapshot()
    {
        lock (gate) { return new bool[] { sawOnset, highEnergy }; }
    }

    public bool RecognizerFinished()
    {
        return completed.WaitOne(0);
    }

    // Disposes the recognizer engine. Called only once RecognizerFinished is true, or from the finalize thread itself.
    public void ReleaseEngine()
    {
        SpeechRecognitionEngine e = engine;
        engine = null;
        if (e == null) return;
        try { e.Dispose(); } catch (Exception) { }
    }

    // whisper: appends one fed (AGC'd) frame to the bounded utterance buffer. Samples past the bound are dropped.
    void AppendWhisper(byte[] fedFrame)
    {
        lock (bufGate)
        {
            if (wSealed || wbuf == null) return;
            for (int i = 0; i + 1 < Consts.FrameBytes; i += 2)
            {
                if (wlen >= wbuf.Length) break;
                short s = (short)(fedFrame[i] | (fedFrame[i + 1] << 8));
                wbuf[wlen++] = s / 32768f;
            }
            if (wlen > wPeakSamples) wPeakSamples = wlen;
        }
    }

    // whisper: an interim decode of the utterance so far. Only after a VAD onset, at most one in flight, about every
    // 1.2 s once 1 s of audio exists. Each partial is a genuine decode of the buffered audio, never fabricated.
    void MaybeStartPartial(Vad v)
    {
        float[] copy;
        int n;
        lock (bufGate)
        {
            if (wPartialInFlight || wSealed || wbuf == null || !v.SawOnset || StopFlag) return;
            if (wlen < PartialMinSamples || wlen - wLastPartialLen < PartialEverySamples) return;
            wPartialInFlight = true;
            wLastPartialLen = wlen;
            n = wlen;
            copy = new float[n];
            Array.Copy(wbuf, copy, n);
        }
        Thread t = new Thread(() => Guard.Run(() => PartialDecode(copy, n), e => FinishPartial()));
        t.IsBackground = true;
        t.Start();
    }

    void PartialDecode(float[] pcm, int n)
    {
        try
        {
            WhisperResult r = whisper.Transcribe(pcm, n);
            lock (gate)
            {
                string rej = WhisperGate.Reject(r, speechMsPub, highEnergy);
                string text = r.Text == null ? "" : r.Text.Trim();
                if (closed || terminal || abortRequested) return;
                if (rej != null || text.Length == 0 || text == lastPartial) return;
                lastPartial = text;
                Out.Emit(Out.Ev("stt.partial", "turn", Turn, "gen", Gen, "text", Out.Trunc(text, 2000)));
            }
        }
        finally
        {
            Array.Clear(pcm, 0, pcm.Length);
            FinishPartial();
        }
    }

    void FinishPartial()
    {
        lock (bufGate) { wPartialInFlight = false; }
    }

    long BufferedPeakBytes()
    {
        if (whisper == null) return Pipe.PeakUnread;
        lock (bufGate) { return wPeakSamples * 2; }
    }

    // whisper: the final is one full decode of the bounded utterance, on the finalize thread (never the command loop).
    // The buffer is sealed first, so no audio joins after the decision, and it is zeroed on every path.
    void FinalizeWhisper()
    {
        Thread cap = captureThread;
        if (cap != null) cap.Join(2000);
        float[] pcm;
        int n;
        lock (bufGate)
        {
            wSealed = true;
            pcm = wbuf;
            n = wlen;
            wbuf = null;
            wlen = 0;
        }
        bool onset;
        bool high;
        bool stopped;
        bool quick;
        long speechMs;
        lock (gate)
        {
            onset = sawOnset;
            high = highEnergy;
            speechMs = speechMsPub;
            stopped = aborted || abortRequested;
            quick = shortEnded;
        }
        WhisperResult r = null;
        try
        {
            // T12: a short duplex burst is never decoded (no decode cost, no hallucinated text from a click).
            if (!stopped && onset && !quick && n > 0 && pcm != null) r = whisper.Transcribe(pcm, n);
        }
        catch (Exception e)
        {
            Out.Diag("whisper decode: " + e.GetType().Name);
            r = null;
        }
        finally
        {
            if (pcm != null) Array.Clear(pcm, 0, pcm.Length);
        }

        lock (gate)
        {
            terminal = true;
            string decision;
            if (aborted || abortRequested) decision = "aborted";
            else if (quick) decision = "too_short";
            else if (!onset) decision = high ? "noise_only" : "no_speech";
            else if (r == null) decision = "rejected";
            else decision = WhisperGate.Reject(r, speechMs, high) ?? "final";
            terminalEmitted = true;
            if (decision == "final")
            {
                Out.Emit(Out.Ev("stt.final", "turn", Turn, "gen", Gen, "text", Out.Trunc(r.Text.Trim(), 2000), "confidence", (double)r.Confidence));
            }
            else
            {
                Out.Emit(Out.Ev("stt.none", "turn", Turn, "gen", Gen, "reason", decision));
            }
        }
    }

    void FinalizeMain()
    {
        try
        {
            Guard.Run(FinalizeBody, FaultFinalize);
        }
        finally
        {
            // Terminal event is emitted (or the fault path emitted it): the turn is no longer reachable for abort.
            lock (Program.Gate) { finalizeDone = true; Program.Finalizing.Remove(this); }
        }
    }

    void FinalizeBody()
    {
        if (whisper != null)
        {
            FinalizeWhisper();
            return;
        }
        Thread cap = captureThread;
        if (cap != null) cap.Join(2000);
        bool quick;
        lock (gate) { quick = shortEnded; }
        bool done = false;
        try
        {
            // T12: a short duplex burst skips the recognizer flush entirely (it is ended without a decode).
            if (!aborted && !quick)
            {
                // 300 ms of trailing silence lets the recognizer close the last phrase, then EOF.
                Pipe.Push(new byte[9600], 0, 9600);
                Pipe.CloseWrite();
                if (engine != null) engine.RecognizeAsyncStop();
                done = completed.WaitOne(4000);
                if (!done)
                {
                    timedOut = true;
                    if (engine != null) engine.RecognizeAsyncCancel();
                    done = completed.WaitOne(1000);
                }
            }
            else
            {
                Pipe.CloseWrite();
                if (engine != null) engine.RecognizeAsyncCancel();
                done = completed.WaitOne(500);
            }
        }
        catch (Exception e)
        {
            Out.Diag("recognizer finalize: " + e.GetType().Name);
        }
        finally
        {
            // The raw turn audio is released on every path. An engine that never completed is kept in the ledger
            // (bounded) and disposed once it does; the capture admission check refuses new turns while the ledger is full.
            Pipe.Wipe();
            if (done) ReleaseEngine();
            else if (engine != null) AbandonLedger.Add(this);
        }

        lock (gate)
        {
            terminal = true;
            // Recognizer text without a VAD onset is never trusted; rejected-only text is never promoted.
            // An abort that lands while a short burst finalizes wins, as it does on the whisper path.
            string decision = quick && !(aborted || abortRequested) ? "too_short" : StopDecision.Terminal(aborted || abortRequested, sawOnset, highEnergy, texts.Count, rejectedSeen, timedOut);
            terminalEmitted = true;
            if (decision == "final")
            {
                double conf = 0;
                foreach (double c in confidences) conf += c;
                conf /= confidences.Count;
                Out.Emit(Out.Ev("stt.final", "turn", Turn, "gen", Gen, "text", Out.Trunc(string.Join(" ", texts.ToArray()), 2000), "confidence", conf));
            }
            else
            {
                Out.Emit(Out.Ev("stt.none", "turn", Turn, "gen", Gen, "reason", decision));
            }
        }
    }

    // A fault while finalizing ends the turn exactly once, as aborted. Recognized text is never promoted on a fault.
    void FaultFinalize(Exception e)
    {
        lock (gate)
        {
            terminal = true;
            if (terminalEmitted) return;
            terminalEmitted = true;
            Guard.Emit(Out.Ev("stt.none", "turn", Turn, "gen", Gen, "reason", "aborted"));
        }
    }
}

// A turn whose recognizer did not finish in time. Its engine is kept until the recognizer completes, then disposed.
internal interface IAbandonedRecognizer
{
    bool RecognizerFinished();
    void ReleaseEngine();
}

// Bounds the recognizers that hung turns leave behind. While the ledger is full, capture.start is refused with
// STT_UNAVAILABLE instead of accumulating engines.
internal static class AbandonLedger
{
    public const int Max = 2;
    static readonly List<IAbandonedRecognizer> abandoned = new List<IAbandonedRecognizer>();
    static readonly object gate = new object();

    public static void Add(IAbandonedRecognizer r)
    {
        lock (gate) { abandoned.Add(r); }
    }

    public static int Count
    {
        get { lock (gate) { return abandoned.Count; } }
    }

    // Releases engines whose recognizers have since finished, then reports whether another abandonment fits.
    public static bool HasRoom()
    {
        List<IAbandonedRecognizer> finished = new List<IAbandonedRecognizer>();
        lock (gate)
        {
            for (int i = abandoned.Count - 1; i >= 0; i--)
            {
                if (abandoned[i].RecognizerFinished())
                {
                    finished.Add(abandoned[i]);
                    abandoned.RemoveAt(i);
                }
            }
        }
        foreach (IAbandonedRecognizer r in finished) r.ReleaseEngine();
        lock (gate) { return abandoned.Count < Max; }
    }
}

internal sealed class VoiceDevice
{
    public int Index;
    public string Name;
    public int Channels;

    public Dictionary<string, object> ToDict()
    {
        return Out.Obj("index", Index, "name", Name, "channels", Channels);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Playback: strict per-turn seq order, bounded queue, barge-in with generation cancellation.
// ---------------------------------------------------------------------------------------------------------------
internal sealed class Chunk
{
    public string Turn;
    public long Gen;
    public long Seq;
    public string Text;
    public uint Device;
    public string Voice;
    public byte[] Pcm;
    public int AudioMs;
    public volatile bool Cancelled;
    public bool Synthesizing;
    public bool Submitted;
    public bool Submitting;
    public IntPtr Header;
    public IntPtr Data;
}

internal sealed class CancelResult
{
    public bool WasPlaying;
    public double ResetMs;
    public int Dropped;
    // True when the playback thread had not applied the device reset within Speaker.ResetWaitMs.
    public bool ResetPending;
    // speak commands dropped as stale (gen <= highest cancelled gen) since the previous cancel receipt.
    public long StaleDropped;
}

internal sealed class Speaker
{
    public const int MaxQueued = 24;
    public const int MaxChunkChars = 400;
    // speak.cancel waits at most this long for the playback thread to apply the device reset. Past it the receipt says
    // resetPending: the reset still happens when the driver returns, and the caller is never blocked behind the driver.
    public const int ResetWaitMs = 250;
    readonly object gate = new object();
    readonly List<Chunk> queue = new List<Chunk>();
    readonly bool nullOutput;
    readonly double pace;
    readonly SpeechSynthesizer synth;
    readonly HashSet<string> voices = new HashSet<string>();
    readonly Func<uint, IWaveOut> openDevice;
    string currentVoice;
    bool running = true;
    Chunk inFlight;
    Chunk synthChunk;
    Chunk stepChunk;
    long maxCancelled = long.MinValue;
    long pausedGen = long.MinValue;
    // Worker-monotonic time of the speak.pause request that set pausedGen (receipt requestMono). Guarded by gate.
    long pauseRequestMono;
    // Playback thread state: whether the device is currently paused, and the turn and gen whose chunk paused it.
    bool devicePaused;
    string devicePausedTurn;
    long devicePausedGen;
    string lastTurn;
    long lastSeq = -1;
    long staleSinceCancel;
    // Counters under gate. Cancel bumps resetRequested; the playback thread copies it to resetDone after the reset.
    long resetRequested;
    long resetDone;
    Thread synthThread;
    const int IdleKeepOpenMs = 3000;
    Stopwatch idleClock; // running while the waveOut handle is kept open after playback.idle
    Thread playThread;
    // Only the playback thread (and Shutdown after it has exited) touches the device. No device call runs under gate.
    IWaveOut waveOut;

    public Speaker(SpeechSynthesizer synth, bool nullOutput, double pace, IEnumerable<string> installedVoices)
        : this(synth, nullOutput, pace, installedVoices, d => WaveOut.Open(d))
    {
    }

    public Speaker(SpeechSynthesizer synth, bool nullOutput, double pace, IEnumerable<string> installedVoices, Func<uint, IWaveOut> openDevice)
    {
        this.synth = synth;
        this.nullOutput = nullOutput;
        this.pace = pace;
        this.openDevice = openDevice;
        foreach (string v in installedVoices) voices.Add(v);
    }

    public bool NullOutput { get { return nullOutput; } }

    // T12 pause receipt: the meter worker that measures how long the render endpoint takes to read silent after a pause.
    // Separate from the cancel meter, so a pause never delays a cancel receipt. Null: pause receipts are not measured.
    public CancelMeter PauseMeter;

    // Command-loop side. A pause is requested for one generation at a time; its request time is kept for the receipt.
    public void Pause(long gen, bool on)
    {
        lock (gate)
        {
            if (gen <= maxCancelled) return;
            if (on)
            {
                if (pausedGen != gen)
                {
                    pausedGen = gen;
                    pauseRequestMono = Out.Clock.ElapsedMilliseconds;
                }
            }
            else if (pausedGen == gen) pausedGen = long.MinValue;
            Monitor.PulseAll(gate);
        }
    }

    // True while our own audio is playing (a chunk submitted and not cancelled). The duplex model adds its own reverb tail.
    public bool Audible()
    {
        lock (gate) { return inFlight != null && inFlight.Submitted && !inFlight.Cancelled; }
    }

    // T12 (RC-02): a playback.error for a generation ends that generation's pause request. The Host clears its hold on that
    // error, so the worker must not keep the gen paused: later chunks of the gen would otherwise stall on the device for
    // ever. Caller holds gate.
    void ClearPauseFor(long gen)
    {
        if (pausedGen == gen) pausedGen = long.MinValue;
    }

    // Playback thread only. A cancelled chunk never touches the device here: the pending reset owns its state, and a
    // paused device is never restarted for a cancelled chunk.
    bool ApplyPause(Chunk c)
    {
        bool want;
        long requestMono;
        lock (gate)
        {
            want = !c.Cancelled && pausedGen == c.Gen;
            requestMono = pauseRequestMono;
        }
        if (c.Cancelled) return devicePaused;
        if (want == devicePaused) return want;
        if (!want)
        {
            try { if (waveOut != null) waveOut.Pause(false); }
            catch (VoiceFault f) { PauseDeviceFailed(c, f); return devicePaused; }
            // A real transition back to playing. Only emitted on transitions, never repeated.
            ReleasePaused(c.Turn, c.Gen);
            return false;
        }
        try { if (waveOut != null) waveOut.Pause(true); }
        catch (VoiceFault f) { PauseDeviceFailed(c, f); return false; }
        // The receipt is measured from the moment the device was paused. A request that waited for audio to start is not
        // counted as silence latency; requestMono still reports when the request arrived.
        long appliedMono = Out.Clock.ElapsedMilliseconds;
        Stopwatch clock = Stopwatch.StartNew();
        devicePaused = true;
        devicePausedTurn = c.Turn;
        devicePausedGen = c.Gen;
        EmitPauseReceipt(c, requestMono, appliedMono, clock, waveOut != null);
        return true;
    }

    // Playback thread only. The device left the paused state: announced once, for the turn and gen that paused it.
    void ReleasePaused(string turn, long gen)
    {
        devicePaused = false;
        Out.Emit(Out.Ev("playback.paused", "turn", turn, "gen", gen, "on", false));
    }

    // A device that refuses to pause fails the chunk with the device's own code, as a refused submit does.
    void PauseDeviceFailed(Chunk c, VoiceFault f)
    {
        lock (gate) { FailAndDrop(c, f.Code, f.Message); }
        CloseDevice();
    }

    // The receipt for one applied pause. Measured ones are finished on the meter worker, so the playback thread never polls.
    // silentMono is the worker-monotonic time the render meter read silent (appliedMono + meterSilentMs).
    void EmitPauseReceipt(Chunk c, long requestMono, long appliedMono, Stopwatch clock, bool realDevice)
    {
        Dictionary<string, object> d = Out.Ev("playback.paused", "turn", c.Turn, "gen", c.Gen, "on", true, "requestMono", requestMono);
        if (!realDevice || PauseMeter == null)
        {
            // Null sink (fixtures) or no meter: nothing is measured. The null sink is "audible" while a chunk is submitted.
            d["silentMono"] = null;
            d["meterSilentMs"] = null;
            if (!realDevice) d["wasAudible"] = c.Submitted;
            Out.Emit(d);
            return;
        }
        bool queued = PauseMeter.TrySubmit(clock, reading =>
        {
            double? silent = reading == null ? null : reading.SilentMs;
            d["silentMono"] = silent.HasValue ? (object)(appliedMono + (long)Math.Round(silent.Value)) : null;
            d["meterSilentMs"] = silent.HasValue ? (object)silent.Value : null;
            if (reading != null) d["wasAudible"] = reading.AudibleAtStart;
            Out.Emit(d);
        });
        if (!queued)
        {
            // The meter queue is full: the receipt is still sent, unmeasured.
            d["silentMono"] = null;
            d["meterSilentMs"] = null;
            Out.Emit(d);
        }
    }

    public void Start()
    {
        synthThread = new Thread(SynthLoop);
        synthThread.IsBackground = true;
        synthThread.Start();
        playThread = new Thread(PlayLoop);
        playThread.IsBackground = true;
        playThread.Start();
    }

    public bool IsBusy()
    {
        // Busy means audio that can still be heard. A cancelled in-flight chunk stays in the queue until the playback thread
        // retires it, but Cancel has already reset the device (barge-in): it must not refuse the next capture (live B03).
        lock (gate)
        {
            foreach (Chunk c in queue) if (!c.Cancelled) return true;
            return false;
        }
    }

    public void Enqueue(string turn, long gen, long seq, string text, uint device, string voice)
    {
        lock (gate)
        {
            if (gen <= maxCancelled)
            {
                staleSinceCancel++;
                return;
            }
            if (text == null || text.Length == 0) return;
            if (text.Length > MaxChunkChars)
            {
                ClearPauseFor(gen);
                Out.Emit(Out.Ev("playback.error", "turn", turn, "gen", gen, "code", "BUFFER_LIMIT", "message", "chunk exceeds 400 characters"));
                return;
            }
            if (turn == lastTurn && seq <= lastSeq)
            {
                ClearPauseFor(gen);
                Out.Emit(Out.Ev("playback.error", "turn", turn, "gen", gen, "code", "INTERNAL", "message", "seq is not strictly increasing"));
                return;
            }
            if (queue.Count >= MaxQueued)
            {
                ClearPauseFor(gen);
                Out.Emit(Out.Ev("playback.error", "turn", turn, "gen", gen, "code", "BUFFER_LIMIT", "message", "playback queue is full"));
                return;
            }
            lastTurn = turn;
            lastSeq = seq;
            Chunk c = new Chunk();
            c.Turn = turn;
            c.Gen = gen;
            c.Seq = seq;
            c.Text = text;
            c.Device = device;
            c.Voice = voice;
            queue.Add(c);
            Monitor.PulseAll(gate);
        }
    }

    // Test-only: queues an already-rendered chunk so the playback path can run without the synthesizer.
    internal void AddRenderedForTest(string turn, long gen, long seq, byte[] pcm, uint device)
    {
        lock (gate)
        {
            Chunk c = new Chunk();
            c.Turn = turn;
            c.Gen = gen;
            c.Seq = seq;
            c.Text = "rendered";
            c.Device = device;
            c.Pcm = pcm;
            c.AudioMs = pcm.Length / Consts.BytesPerMs;
            queue.Add(c);
            Monitor.PulseAll(gate);
        }
    }

    // Barge-in. Marks and drops under gate, then waits a bounded time for the playback thread to apply the reset.
    // The driver is never called from the caller's thread, so a stalled driver cannot stall the command loop.
    public CancelResult Cancel(long gen)
    {
        CancelResult r = new CancelResult();
        Stopwatch sw = Stopwatch.StartNew();
        lock (gate)
        {
            if (gen > maxCancelled) maxCancelled = gen;
            // A cancelled generation is never paused again; its pause request is closed.
            if (pausedGen <= gen) pausedGen = long.MinValue;
            Chunk playing = inFlight;
            r.WasPlaying = playing != null && (playing.Submitted || playing.Submitting) && !playing.Cancelled && playing.Gen <= gen;
            foreach (Chunk c in queue)
            {
                if (c.Gen <= gen && !c.Cancelled)
                {
                    c.Cancelled = true;
                    r.Dropped++;
                }
            }
            queue.RemoveAll(c => c.Cancelled && c != inFlight);
            r.StaleDropped = staleSinceCancel;
            staleSinceCancel = 0;
            resetRequested++;
            long want = resetRequested;
            Monitor.PulseAll(gate);
            while (running && resetDone < want)
            {
                long left = ResetWaitMs - sw.ElapsedMilliseconds;
                if (left <= 0) break;
                Monitor.Wait(gate, (int)left);
            }
            r.ResetPending = resetDone < want;
        }
        r.ResetMs = sw.Elapsed.TotalMilliseconds;
        return r;
    }

    public void Shutdown()
    {
        lock (gate)
        {
            running = false;
            foreach (Chunk c in queue) c.Cancelled = true;
            queue.Clear();
            resetRequested++;
            Monitor.PulseAll(gate);
        }
        if (synthThread != null) synthThread.Join(500);
        bool playEnded = true;
        if (playThread != null)
        {
            playThread.Join(1000);
            playEnded = !playThread.IsAlive;
        }
        // The playback thread owns the device. It is released here only after that thread has exited; a thread stuck in
        // a driver call is left to process exit rather than waited for.
        if (playEnded) CloseDevice();
    }

    Chunk FindPendingSynth()
    {
        foreach (Chunk c in queue)
        {
            if (c.Pcm == null && !c.Cancelled && !c.Synthesizing) return c;
        }
        return null;
    }

    void SynthLoop()
    {
        while (true)
        {
            bool go = true;
            Guard.Run(() => { go = SynthStep(); }, FaultSynth);
            if (!go) return;
        }
    }

    // One synthesis step. Returns false when the thread should exit.
    bool SynthStep()
    {
        Chunk c = null;
        lock (gate)
        {
            while (running && (c = FindPendingSynth()) == null) Monitor.Wait(gate, 100);
            if (!running) return false;
            c.Synthesizing = true;
            synthChunk = c;
        }
        byte[] pcm = null;
        string error = null;
        Stopwatch sw = Stopwatch.StartNew();
        try
        {
            pcm = Synthesize(c.Text, c.Voice);
        }
        catch (Exception e)
        {
            error = e.GetType().Name;
        }
        long synthMs = sw.ElapsedMilliseconds;
        lock (gate)
        {
            synthChunk = null;
            c.Synthesizing = false;
            if (c.Cancelled)
            {
                Monitor.PulseAll(gate);
                return true;
            }
            if (pcm == null || pcm.Length == 0)
            {
                c.Cancelled = true;
                ClearPauseFor(c.Gen);
                Out.Emit(Out.Ev("playback.error", "turn", c.Turn, "gen", c.Gen, "code", "TTS_UNAVAILABLE", "message", "speech synthesis failed: " + (error ?? "no audio")));
                Monitor.PulseAll(gate);
                return true;
            }
            c.Pcm = pcm;
            c.AudioMs = pcm.Length / Consts.BytesPerMs;
            Out.Emit(Out.Ev("tts.ready", "turn", c.Turn, "gen", c.Gen, "seq", c.Seq, "audioMs", c.AudioMs, "synthMs", synthMs));
            Monitor.PulseAll(gate);
        }
        return true;
    }

    // A synthesis fault drops only the chunk being rendered and reports it; the thread keeps serving the queue.
    void FaultSynth(Exception e)
    {
        lock (gate)
        {
            Chunk c = synthChunk;
            synthChunk = null;
            if (c != null)
            {
                c.Synthesizing = false;
                c.Cancelled = true;
                ClearPauseFor(c.Gen);
            }
            Guard.Emit(Out.Ev("playback.error", "turn", c != null ? c.Turn : null, "gen", c != null ? (object)c.Gen : null,
                "code", "INTERNAL", "message", "speech synthesis fault: " + e.GetType().Name));
            Monitor.PulseAll(gate);
        }
    }

    byte[] Synthesize(string text, string voice)
    {
        if (voice != null && voice != currentVoice && voices.Contains(voice))
        {
            synth.SelectVoice(voice);
            currentVoice = voice;
        }
        return Tts.Render(synth, text);
    }

    // Caller holds gate.
    bool ResetPendingLocked()
    {
        return resetRequested != resetDone;
    }

    void PlayLoop()
    {
        while (true)
        {
            bool go = true;
            Guard.Run(() => { go = PlayStep(); }, FaultPlayback);
            if (!go) return;
        }
    }

    // One playback step. Returns false when the thread should exit.
    bool PlayStep()
    {
        ApplyPendingReset();
        Chunk c = null;
        bool idleClose = false;
        lock (gate)
        {
            while (running && !ResetPendingLocked() && (queue.Count == 0 || (queue[0].Pcm == null && !queue[0].Cancelled)))
            {
                Monitor.Wait(gate, 25);
                // The output handle stays open across chunks and for IdleKeepOpenMs after playback.idle.
                if (queue.Count == 0 && idleClock != null && idleClock.ElapsedMilliseconds >= IdleKeepOpenMs)
                {
                    idleClose = true;
                    break;
                }
            }
            if (!running) return false;
            if (ResetPendingLocked()) return true;
            if (idleClose)
            {
                idleClock = null;
            }
            else if (queue[0].Cancelled)
            {
                queue.RemoveAt(0);
                return true;
            }
            else
            {
                c = queue[0];
                inFlight = c;
                stepChunk = c;
                idleClock = null;
            }
        }
        if (c == null)
        {
            CloseDevice();
            return true;
        }
        bool ok = nullOutput ? PlayNull(c) : PlayReal(c);
        lock (gate)
        {
            inFlight = null;
            stepChunk = null;
            if (queue.Count > 0 && queue[0] == c) queue.RemoveAt(0);
            if (queue.Count == 0)
            {
                idleClock = Stopwatch.StartNew();
                if (ok) Out.Emit(Out.Ev("playback.idle", "turn", c.Turn, "gen", c.Gen));
            }
            Monitor.PulseAll(gate);
        }
        return true;
    }

    // Playback thread only, called without gate. Applies a reset requested by speak.cancel, then acknowledges it.
    void ApplyPendingReset()
    {
        long want;
        lock (gate)
        {
            want = resetRequested;
            if (resetDone >= want) return;
        }
        IWaveOut h = waveOut;
        if (h != null)
        {
            try
            {
                h.Reset();
            }
            catch (Exception)
            {
                CloseDevice();
            }
        }
        // The reset returns every buffer. A device paused before it is restarted here, with no chunk in it, so the next
        // chunk is never submitted to a device the worker believes is running but the driver still holds paused. The
        // restart is a real transition, announced for the chunk that paused the device.
        if (devicePaused)
        {
            try { if (waveOut != null) waveOut.Pause(false); }
            catch (VoiceFault) { CloseDevice(); }
            if (devicePaused) ReleasePaused(devicePausedTurn, devicePausedGen);
        }
        lock (gate)
        {
            resetDone = want;
            Monitor.PulseAll(gate);
        }
    }

    // Playback thread only (or Shutdown after that thread exited). Never called with gate held.
    void CloseDevice()
    {
        if (devicePaused) ReleasePaused(devicePausedTurn, devicePausedGen);
        IWaveOut h = waveOut;
        waveOut = null;
        idleClock = null;
        if (h == null) return;
        try { h.Reset(); } catch (Exception) { }
        try { h.Close(); } catch (Exception) { }
    }

    // Real-time clocked null sink (test-only). Honors cancellation within 2 ms.
    bool PlayNull(Chunk c)
    {
        lock (gate)
        {
            if (c.Cancelled) return false;
            c.Submitted = true;
            Out.Emit(Out.Ev("playback.started", "turn", c.Turn, "gen", c.Gen, "seq", c.Seq));
        }
        double durationMs = c.AudioMs / pace;
        Stopwatch sw = Stopwatch.StartNew();
        double playedMs = 0;
        long last = sw.ElapsedMilliseconds;
        while (playedMs < durationMs)
        {
            if (c.Cancelled) return false;
            long at = sw.ElapsedMilliseconds;
            if (!ApplyPause(c)) playedMs += at - last;
            last = at;
            Thread.Sleep(2);
        }
        lock (gate)
        {
            if (c.Cancelled) return false;
            Out.Emit(Out.Ev("playback.chunk_done", "turn", c.Turn, "gen", c.Gen, "seq", c.Seq));
            return true;
        }
    }

    bool DeviceDone(Chunk c)
    {
        IWaveOut h = waveOut;
        return h == null || h.IsDone(c);
    }

    bool PlayReal(Chunk c)
    {
        lock (gate)
        {
            if (c.Cancelled) return false;
            c.Submitting = true;
        }
        // Device calls below run without gate: a stalled driver blocks only this thread.
        try
        {
            if (waveOut == null || waveOut.Device != c.Device)
            {
                CloseDevice();
                waveOut = openDevice(c.Device);
            }
            waveOut.Submit(c);
        }
        catch (VoiceFault f)
        {
            lock (gate)
            {
                c.Submitting = false;
                FailAndDrop(c, f.Code, f.Message);
            }
            CloseDevice();
            return false;
        }
        lock (gate)
        {
            c.Submitting = false;
            c.Submitted = true;
            // A cancel that arrived during the device call must never announce a chunk that is not audible.
            if (!c.Cancelled) Out.Emit(Out.Ev("playback.started", "turn", c.Turn, "gen", c.Gen, "seq", c.Seq));
        }

        Stopwatch sw = Stopwatch.StartNew();
        long pausedMs = 0, lastTick = 0;
        bool timedOut = false;
        while (!DeviceDone(c))
        {
            // T12: a pending barge-in reset is applied before any pause decision in the same tick, so a cancelled chunk is
            // never restarted on a device that is about to be reset.
            ApplyPendingReset();
            long tick = sw.ElapsedMilliseconds;
            if (ApplyPause(c)) pausedMs += tick - lastTick;
            lastTick = tick;
            if (tick - pausedMs > c.AudioMs * 2 + 3000)
            {
                timedOut = true;
                break;
            }
            Thread.Sleep(3);
        }
        if (timedOut)
        {
            IWaveOut h = waveOut;
            if (h != null) h.Reset();
            Stopwatch wait = Stopwatch.StartNew();
            while (!DeviceDone(c) && wait.ElapsedMilliseconds < 1000) Thread.Sleep(3);
            // The reset above has returned the chunk to this thread, so its buffers are released here, not leaked
            // when the driver never marks the header done. Release frees nothing the driver still owns.
            if (h != null) h.Release(c);
            CloseDevice();
            lock (gate) { FailAndDrop(c, "DEVICE_LOST", "playback did not complete"); }
            return false;
        }
        ReleaseDone(c);
        lock (gate)
        {
            if (c.Cancelled) return false;
            Out.Emit(Out.Ev("playback.chunk_done", "turn", c.Turn, "gen", c.Gen, "seq", c.Seq));
            return true;
        }
    }

    void ReleaseDone(Chunk c)
    {
        IWaveOut h = waveOut;
        if (h != null && h.IsDone(c)) h.Release(c);
    }

    // Device failure: report, then drop everything queued. Never re-route to another device. Caller holds gate.
    void FailAndDrop(Chunk c, string code, string message)
    {
        ClearPauseFor(c.Gen);
        Out.Emit(Out.Ev("playback.error", "turn", c.Turn, "gen", c.Gen, "code", code, "message", Out.Trunc(message, 300)));
        foreach (Chunk q in queue) q.Cancelled = true;
        queue.RemoveAll(q => q.Cancelled && q != inFlight);
    }

    // Any other fault on the playback thread: one bounded error event, the chunk in hand ends, the queue is dropped.
    void FaultPlayback(Exception e)
    {
        lock (gate)
        {
            Chunk c = stepChunk;
            stepChunk = null;
            inFlight = null;
            if (c != null) { c.Cancelled = true; ClearPauseFor(c.Gen); }
            Guard.Emit(Out.Ev("playback.error", "turn", c != null ? c.Turn : null, "gen", c != null ? (object)c.Gen : null,
                "code", "INTERNAL", "message", "playback fault: " + e.GetType().Name));
            foreach (Chunk q in queue) q.Cancelled = true;
            queue.RemoveAll(q => q.Cancelled);
            Monitor.PulseAll(gate);
        }
        CloseDevice();
    }
}

// Thread-body guard. An exception never leaves a worker thread: onFault turns it into one bounded protocol event instead,
// so a fault ends a turn and never kills the process.
internal static class Guard
{
    public static void Run(Action body, Action<Exception> onFault)
    {
        try
        {
            body();
        }
        catch (Exception e)
        {
            try { onFault(e); }
            catch (Exception) { }
        }
    }

    // Protocol emit that never throws, so a fault path cannot itself escape a thread.
    public static void Emit(Dictionary<string, object> d)
    {
        try { Out.Emit(d); }
        catch (Exception) { }
    }
}

// One background worker answers the speak.cancel receipts that need a render-meter reading. Requests wait in a bounded
// FIFO, so a burst of cancels never starts a thread per cancel. A request that does not fit is answered by the caller
// with meterSilentMs null (not measured).
internal sealed class MeterReading
{
    // Milliseconds from the request until the render meter read silent; null when not reached within the bound.
    public double? SilentMs;
    // The meter was above silence at the first reading (taken just after the request was applied).
    public bool AudibleAtStart;
}

internal sealed class CancelMeter
{
    public const int MaxPending = 4;
    readonly object gate = new object();
    readonly Queue<MeterJob> pending = new Queue<MeterJob>();
    readonly Func<Stopwatch, MeterReading> poll;
    Thread worker;
    int threadsStarted;

    public CancelMeter(Func<Stopwatch, MeterReading> poll)
    {
        this.poll = poll;
    }

    public int ThreadsStarted
    {
        get { lock (gate) { return threadsStarted; } }
    }

    // False when the queue is full. The caller then reports the receipt without a meter reading.
    public bool TrySubmit(Stopwatch since, Action<MeterReading> done)
    {
        lock (gate)
        {
            if (pending.Count >= MaxPending) return false;
            MeterJob job = new MeterJob();
            job.Since = since;
            job.Done = done;
            pending.Enqueue(job);
            if (worker == null)
            {
                worker = new Thread(Work);
                worker.IsBackground = true;
                threadsStarted++;
                worker.Start();
            }
            Monitor.PulseAll(gate);
            return true;
        }
    }

    void Work()
    {
        while (true)
        {
            MeterJob job;
            lock (gate)
            {
                while (pending.Count == 0) Monitor.Wait(gate);
                job = pending.Dequeue();
            }
            MeterReading reading = null;
            try { reading = poll(job.Since); }
            catch (Exception) { reading = null; }
            Guard.Run(() => job.Done(reading), e => { });
        }
    }

    sealed class MeterJob
    {
        public Stopwatch Since;
        public Action<MeterReading> Done;
    }
}

internal static class Tts
{
    public static byte[] Render(SpeechSynthesizer synth, string text)
    {
        MemoryStream ms = new MemoryStream();
        synth.SetOutputToAudioStream(ms, new SpeechAudioFormatInfo(Consts.SampleRate, AudioBitsPerSample.Sixteen, AudioChannel.Mono));
        try
        {
            synth.Speak(text);
        }
        finally
        {
            synth.SetOutputToNull();
        }
        return ms.ToArray();
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Fixtures (test-only input sources) and the process entry point.
// ---------------------------------------------------------------------------------------------------------------
// Test-only deterministic checks of the endpointing, decision and gain rules. No devices, no recognizer, no audio.
// ---------------------------------------------------------------------------------------------------------------
// Duplex end-of-turn pause chosen from the latest partial. T12 live finding: whisper partials always end with a full
// stop, so trailing punctuation is not evidence that the user finished; a hesitation after "Prepare a" split one request
// into two turns 700 ms later. Punctuation is ignored, and a partial ending on a word that cannot end a sentence
// (conjunction, article, preposition, possessive, filler) waits longer.
// ---------------------------------------------------------------------------------------------------------------
internal static class Endpointing
{
    public const int NoTextMs = 900, DefaultMs = 1000, ContinuationMs = 1500;
    static readonly HashSet<string> Continuations = new HashSet<string>(StringComparer.Ordinal)
    {
        "and", "but", "or", "so", "because", "then", "if", "that", "which", "when", "while",
        "a", "an", "the", "my", "your", "our", "their", "his", "her", "its", "this", "these", "those", "some",
        "to", "for", "of", "about", "with", "on", "in", "at", "from", "into", "by", "as",
        "um", "uh", "er", "erm", "hmm", "like", "is", "are", "was", "please"
    };

    public static int PauseFor(string partial)
    {
        if (string.IsNullOrWhiteSpace(partial)) return NoTextMs;
        string trimmed = partial.Trim();
        string normalized = trimmed.ToLowerInvariant().TrimEnd('.', '?', '!', ',', ';', ':', '-', ' ', '…');
        if (normalized.Length == 0) return NoTextMs;
        // Whisper writes a trailing ellipsis when the speaker trailed off mid-sentence.
        if (trimmed.EndsWith("...") || trimmed.EndsWith("…")) return ContinuationMs;
        string[] words = normalized.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
        string last = words.Length > 0 ? words[words.Length - 1].Trim('\'', '"', ',') : "";
        return Continuations.Contains(last) ? ContinuationMs : DefaultMs;
    }
}

// Run: bunny-voice-worker.exe --selftest. Emits one "selftest" event with the measured values.
internal static class SelfTest
{
    static double Rms(byte[] b)
    {
        double sum = 0;
        for (int i = 0; i + 1 < b.Length; i += 2)
        {
            double s = (short)(b[i] | (b[i + 1] << 8)) / 32768.0;
            sum += s * s;
        }
        return Math.Sqrt(sum / (b.Length / 2));
    }

    // A driver whose Open stalls. Only a Reset completes its header, so a cancel is the only way out.
    sealed class StallingWaveOut : IWaveOut
    {
        readonly uint device;
        volatile bool reset;

        public StallingWaveOut(uint device) { this.device = device; }
        public uint Device { get { return device; } }
        public void Submit(Chunk c) { }
        public bool IsDone(Chunk c) { return reset; }
        public void Release(Chunk c) { }
        public void Reset() { reset = true; }
        public void Pause(bool on) { }
        public void Close() { }
    }

    // A driver that records the order of its calls, so the playback thread's pause and reset ordering can be checked.
    sealed class RecordingWaveOut : IWaveOut
    {
        readonly List<string> ops = new List<string>();
        volatile bool reset;
        public uint Device { get { return 0u; } }
        public void Submit(Chunk c) { Record("submit"); }
        public bool IsDone(Chunk c) { return reset; }
        public void Release(Chunk c) { }
        public void Reset() { Record("reset"); reset = true; }
        public void Pause(bool on) { Record(on ? "pause:true" : "pause:false"); }
        public void Close() { Record("close"); }
        void Record(string op) { lock (ops) ops.Add(op); }
        public List<string> Snapshot() { lock (ops) return new List<string>(ops); }
    }

    // A driver whose header never completes on its own. Only a reset completes it, and Release is recorded.
    sealed class SilentWaveOut : IWaveOut
    {
        volatile bool reset;
        public int Released;
        public int Closed;
        public uint Device { get { return 0u; } }
        public void Submit(Chunk c) { }
        public bool IsDone(Chunk c) { return reset; }
        public void Release(Chunk c) { Released++; }
        public void Reset() { reset = true; }
        public void Pause(bool on) { }
        public void Close() { Closed++; }
    }

    // A stream standing in for a closed host pipe: every write fails the way a broken stdout does.
    sealed class BrokenStream : Stream
    {
        public override bool CanRead { get { return false; } }
        public override bool CanSeek { get { return false; } }
        public override bool CanWrite { get { return true; } }
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { throw new NotSupportedException(); }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
        public override void Write(byte[] buffer, int offset, int count) { throw new IOException("host pipe closed"); }
    }

    // A frame source that reports the device lost on its first read, so the loop's fault path emits a capture error.
    sealed class LostSource : IFrameSource
    {
        public int Read(byte[] frame) { return -1; }
        public void Close() { }
    }

    sealed class FakeRecognizer : IAbandonedRecognizer
    {
        public volatile bool Finished;
        public int Released;
        public bool RecognizerFinished() { return Finished; }
        public void ReleaseEngine() { Released++; }
    }

    // Command-loop liveness while the playback thread is stuck in a driver Open. Nothing here plays audio.
    static void StallCheck(Dictionary<string, object> r)
    {
        ManualResetEvent opening = new ManualResetEvent(false);
        Speaker stall = new Speaker(null, false, 1.0, new string[0], d => { opening.Set(); Thread.Sleep(1500); return new StallingWaveOut(d); });
        stall.AddRenderedForTest("stall", 1, 0, new byte[32000], 0u);
        stall.Start();
        bool stalled = opening.WaitOne(3000);
        Stopwatch probe = Stopwatch.StartNew();
        bool busy = stall.IsBusy();
        double probeMs = probe.Elapsed.TotalMilliseconds;
        Stopwatch cs = Stopwatch.StartNew();
        CancelResult first = stall.Cancel(1);
        double cancelMs = cs.Elapsed.TotalMilliseconds;
        Thread.Sleep(1800);
        CancelResult second = stall.Cancel(2);
        Stopwatch sd = Stopwatch.StartNew();
        stall.Shutdown();
        double shutdownMs = sd.Elapsed.TotalMilliseconds;
        r["stallOpened"] = stalled;
        r["stallCommandsNotBlocked"] = busy && probeMs < 200;
        r["stallCancelBounded"] = cancelMs < 1000;
        r["stallCancelPending"] = first.ResetPending;
        r["stallCancelRecovers"] = !second.ResetPending;
        r["stallShutdownBounded"] = shutdownMs < 3000;
    }

    // The ledger releases finished engines and refuses new abandonments past its bound.
    static void LedgerCheck(Dictionary<string, object> r)
    {
        FakeRecognizer a = new FakeRecognizer();
        FakeRecognizer b = new FakeRecognizer();
        FakeRecognizer c = new FakeRecognizer();
        AbandonLedger.Add(a);
        AbandonLedger.Add(b);
        r["abandonRefusedAtMax"] = !AbandonLedger.HasRoom();
        a.Finished = true;
        r["abandonReleasedWhenFinished"] = AbandonLedger.HasRoom() && a.Released == 1 && AbandonLedger.Count == 1;
        AbandonLedger.Add(c);
        r["abandonRefusedAgain"] = !AbandonLedger.HasRoom() && b.Released == 0 && c.Released == 0;
    }

    static void ContainmentCheck(Dictionary<string, object> r)
    {
        // A recognizer whose start throws releases its engine (the turn no longer holds one) and rethrows.
        CaptureTurn rt = new CaptureTurn("selftest-rec", 1, null, false, 0);
        rt.FaultInjectForTest = e => { throw new InvalidOperationException("injected recognizer fault"); };
        bool recThrew = false;
        try { rt.StartRecognizer(null); }
        catch (InvalidOperationException) { recThrew = true; }
        r["recognizerFaultThrew"] = recThrew;
        r["recognizerFaultReleased"] = recThrew && !rt.EngineHeldForTest;

        // A capture body whose protocol writes all fail still ends its thread: the process is not terminated.
        Stream previous = Out.SwapStreamForTest(new BrokenStream());
        CaptureTurn bt = new CaptureTurn("selftest-broken", 2, null, false, 1000000);
        bt.StartCapture(new LostSource());
        bt.Join(5000);
        bool bodyEnded = !bt.CaptureAliveForTest;
        Out.SwapStreamForTest(previous);
        r["captureBodyContained"] = bodyEnded;

        // A playback chunk whose header never completes: after the reset it is released, and the handle is closed.
        SilentWaveOut silent = new SilentWaveOut();
        Speaker timed = new Speaker(null, false, 1.0, new string[0], d => silent);
        timed.AddRenderedForTest("selftest-timeout", 9, 0, new byte[320], 0u);
        timed.Start();
        Stopwatch tw = Stopwatch.StartNew();
        while (silent.Closed == 0 && tw.ElapsedMilliseconds < 9000) Thread.Sleep(20);
        timed.Shutdown();
        r["timedOutChunkReleased"] = silent.Released == 1;
        r["timedOutHandleClosed"] = silent.Closed >= 1;

        // Unmanaged audio is overwritten with zeros before it is freed.
        IntPtr probe = Marshal.AllocHGlobal(64);
        byte[] filled = new byte[64];
        for (int i = 0; i < filled.Length; i++) filled[i] = 0xAB;
        Marshal.Copy(filled, 0, probe, filled.Length);
        Native.WipeNative(probe, 64);
        byte[] after = new byte[64];
        Marshal.Copy(probe, after, 0, after.Length);
        Marshal.FreeHGlobal(probe);
        bool allZero = true;
        foreach (byte b in after) if (b != 0) allZero = false;
        r["nativeWipeZero"] = allZero;
    }

    // One worker serves every receipt. A full queue is refused without starting anything.
    static void MeterCheck(Dictionary<string, object> r)
    {
        ManualResetEvent polling = new ManualResetEvent(false);
        ManualResetEvent release = new ManualResetEvent(false);
        CancelMeter meter = new CancelMeter(sw => { polling.Set(); release.WaitOne(3000); return new MeterReading { SilentMs = 5.0 }; });
        int delivered = 0;
        int accepted = 0;
        object tally = new object();
        Action<MeterReading> done = v => { lock (tally) { delivered++; } };
        if (meter.TrySubmit(Stopwatch.StartNew(), done)) accepted++;
        polling.WaitOne(3000);
        for (int i = 0; i < CancelMeter.MaxPending; i++)
        {
            if (meter.TrySubmit(Stopwatch.StartNew(), done)) accepted++;
        }
        bool refused = !meter.TrySubmit(Stopwatch.StartNew(), done);
        release.Set();
        Stopwatch wait = Stopwatch.StartNew();
        while (wait.ElapsedMilliseconds < 5000)
        {
            int n;
            lock (tally) { n = delivered; }
            if (n >= accepted) break;
            Thread.Sleep(5);
        }
        int total;
        lock (tally) { total = delivered; }
        r["meterThreads"] = meter.ThreadsStarted;
        r["meterAccepted"] = accepted;
        r["meterRefusedWhenFull"] = refused;
        r["meterDelivered"] = total;
    }

    // N-02 behaviour on the playback thread, against a recording driver. A pause is applied before the reset of a cancelled
    // chunk, no restart happens before that reset, and a cancelled chunk is never paused again.
    static void PlaybackOrderCheck(Dictionary<string, object> r)
    {
        RecordingWaveOut rec = new RecordingWaveOut();
        Speaker sp = new Speaker(null, false, 1.0, new string[0], d => rec);
        sp.PauseMeter = new CancelMeter(since => new MeterReading { SilentMs = 5.0, AudibleAtStart = true });
        sp.Start();
        sp.AddRenderedForTest("selftest-order", 11, 0, new byte[32000 * 2], 0u); // 2 s of 16 kHz mono 16-bit
        Stopwatch w = Stopwatch.StartNew();
        while (!rec.Snapshot().Contains("submit") && w.ElapsedMilliseconds < 3000) Thread.Sleep(5);
        sp.Pause(11, true);
        while (!rec.Snapshot().Contains("pause:true") && w.ElapsedMilliseconds < 6000) Thread.Sleep(5);
        CancelResult cancel = sp.Cancel(11);
        Thread.Sleep(150);
        List<string> ops = rec.Snapshot();
        sp.Shutdown();
        int pauseAt = ops.IndexOf("pause:true");
        int resetAt = ops.IndexOf("reset");
        int restartAt = ops.IndexOf("pause:false");
        r["playbackPausedBeforeReset"] = pauseAt >= 0 && resetAt > pauseAt;
        r["playbackNoRestartBeforeReset"] = resetAt >= 0 && (restartAt < 0 || restartAt > resetAt);
        r["playbackNoPauseAfterCancel"] = pauseAt >= 0 && ops.LastIndexOf("pause:true") == pauseAt;
        r["playbackCancelAcknowledged"] = !cancel.ResetPending;
    }

    // T12 cases (a)-(f) of the duplex endpointing contract. Frames are 20 ms; the comments give the expected frame indices.
    static void DuplexVadCheck(Dictionary<string, object> r)
    {
        // (a) quiet, then a 200 ms burst at 0.02: the onset is seen, and the burst ends (short) after the silence clock.
        Vad a = new Vad(true, 0.0002);
        int aStart = -1, aEnd = -1;
        bool aShort = false;
        for (int f = 0; f < 200; f++)
        {
            int ev = a.Feed((f >= 20 && f < 30) ? 0.02 : 0.0002, int.MaxValue);
            if (ev == Vad.SpeechStart && aStart < 0) aStart = f;
            if (ev == Vad.SpeechEnd && aEnd < 0) { aEnd = f; aShort = a.EndedShort; }
        }
        r["duplexBurstStart"] = aStart;
        r["duplexBurstEnd"] = aEnd;
        r["duplexBurstShort"] = aShort;

        // (h) stationary LOUD ambient (about 0.05 RMS with a deterministic +-10% wobble, above the 0.005 floor cap) cannot hold a
        // turn open for ever: an onset is seen at frame 6 and a speech_end follows about 900 ms after it (the silence clock).
        Vad h = new Vad(true, 0.0002);
        int hStart = -1, hEnd = -1;
        uint seed = 12345;
        for (int f = 0; f < 600; f++)
        {
            seed = seed * 1664525u + 1013904223u;
            double level = 0.045 + 0.01 * (((seed >> 8) & 0xFFFF) / 65535.0);
            int ev = h.Feed(level, int.MaxValue);
            if (ev == Vad.SpeechStart && hStart < 0) hStart = f;
            if (ev == Vad.SpeechEnd && hEnd < 0) hEnd = f;
        }
        r["duplexLoudNoiseStart"] = hStart;
        r["duplexLoudNoiseEnd"] = hEnd;

        // (b) stationary ambient at 0.0008 from a quiet start for 10 s: the floor learns it, and no onset is ever seen.
        Vad b = new Vad(true, 0.0002);
        int bStarts = 0;
        for (int f = 0; f < 500; f++) if (b.Feed(0.0008, int.MaxValue) == Vad.SpeechStart) bStarts++;
        r["duplexStationarySpeechStarts"] = bStarts;
        r["duplexStationaryFloor"] = b.Floor;

        // (c) ambient 0.0008 with 1 s of speech at 0.02 (frames 20..69): the turn ends about 900 ms after the speech.
        Vad c = new Vad(true, 0.0008);
        int cStart = -1, cEnd = -1;
        for (int f = 0; f < 200; f++)
        {
            int ev = c.Feed((f >= 20 && f < 70) ? 0.02 : 0.0008, int.MaxValue);
            if (ev == Vad.SpeechStart && cStart < 0) cStart = f;
            if (ev == Vad.SpeechEnd && cEnd < 0) cEnd = f;
        }
        r["duplexNoisySpeechStart"] = cStart;
        r["duplexNoisySpeechEnd"] = cEnd;

        // (d) a loud click at frame 20, then soft speech at 0.002 from frame 25: the click does not suppress the onset.
        Vad d = new Vad(true, 0.0002);
        int dStart = -1;
        for (int f = 0; f < 150; f++)
        {
            double rms = f == 20 ? 0.5 : ((f >= 25 && f < 125) ? 0.002 : 0.0002);
            if (d.Feed(rms, int.MaxValue) == Vad.SpeechStart && dStart < 0) dStart = f;
        }
        r["duplexClickThenSoftStart"] = dStart;

        // (e) our own output is audible and its residual frames sit at 0.003: no onset from the residual. T12 (AEC-06): the
        // output starts on quiet frames (0.0001), so the residual is not seeded from one quiet frame. User speech at 0.03
        // while the output is still audible is an onset.
        Vad e = new Vad(true, 0.0002);
        e.SetOutputActive(true);
        for (int f = 0; f < 5; f++) e.Feed(0.0001, int.MaxValue);
        int eEchoOnsets = 0;
        for (int f = 0; f < 200; f++) if (e.Feed(0.003, int.MaxValue) == Vad.SpeechStart) eEchoOnsets++;
        r["duplexOutputEchoOnsets"] = eEchoOnsets;
        int eUserOnset = -1;
        for (int f = 0; f < 40; f++) if (e.Feed(0.03, int.MaxValue) == Vad.SpeechStart && eUserOnset < 0) eUserOnset = f;
        r["duplexOutputUserOnset"] = eUserOnset;

        // (f) soft tail just below the onset threshold (0.0005 < 0.0006) with recognizer evidence held fresh, so the silence
        // clock cannot end the turn. Only the 4 s soft-speech bound may end it: last above-threshold frame 34, end ~frame 234.
        Vad g = new Vad(true, 0.0002);
        int gStart = -1, gEnd = -1;
        bool gShort = false;
        for (int f = 0; f < 600; f++)
        {
            double rms = f < 20 ? 0.0002 : (f < 35 ? 0.02 : 0.0005);
            int ev = g.Feed(rms, 0);
            if (ev == Vad.SpeechStart && gStart < 0) gStart = f;
            if (ev == Vad.SpeechEnd && gEnd < 0) { gEnd = f; gShort = g.EndedShort; }
        }
        r["duplexSoftWaitStart"] = gStart;
        r["duplexSoftWaitEnd"] = gEnd;
        r["duplexSoftWaitShort"] = gShort;
    }

    // T12 residual model (AEC-01, AEC-05) on standalone duplex Vads. Echo is a steady 0.003 while our output is audible.
    static void DuplexResidualCheck(Dictionary<string, object> r)
    {
        // Paused chunk: the output flag stays on while the device is silent for 1200 ms (60 frames), then the echo resumes.
        // Silence must not decay the residual into a low threshold, so the echo is no onset.
        Vad paused = new Vad(true, 0.0002);
        paused.SetOutputActive(true);
        for (int f = 0; f < 20; f++) paused.Feed(0.003, int.MaxValue);
        for (int f = 0; f < 60; f++) paused.Feed(0.0002, int.MaxValue);
        int pausedOnsets = 0;
        for (int f = 0; f < 100; f++) if (paused.Feed(0.003, int.MaxValue) == Vad.SpeechStart) pausedOnsets++;
        r["aecPausedEchoOnsets"] = pausedOnsets;

        // Inter-chunk gap: the output flag drops for 400 ms (20 frames), while the echo still lingers at 0.003 (AEC latency
        // and reverb). The quiet frames before the reply keep the ambient floor low, so only the residual hold can stop the
        // lingering echo. Then the next chunk starts on quiet AEC frames (0.0001) and the echo resumes at 0.003. Neither the
        // gap nor the restart may be an onset.
        Vad gap = new Vad(true, 0.0002);
        int gapOnsets = 0;
        for (int f = 0; f < 30; f++) gap.Feed(0.0002, int.MaxValue);
        gap.SetOutputActive(true);
        for (int f = 0; f < 5; f++) if (gap.Feed(0.003, int.MaxValue) == Vad.SpeechStart) gapOnsets++;
        gap.SetOutputActive(false);
        for (int f = 0; f < 20; f++) if (gap.Feed(0.003, int.MaxValue) == Vad.SpeechStart) gapOnsets++;
        gap.SetOutputActive(true);
        for (int f = 0; f < 5; f++) if (gap.Feed(0.0001, int.MaxValue) == Vad.SpeechStart) gapOnsets++;
        for (int f = 0; f < 100; f++) if (gap.Feed(0.003, int.MaxValue) == Vad.SpeechStart) gapOnsets++;
        r["aecGapEchoOnsets"] = gapOnsets;

        // User speech at 0.008 for 2 s over the 0.003 echo, with our output still audible: it is an onset, so the residual
        // cannot absorb a sustained talker (AEC-05). The first onset frame is 5 (120 ms of frames above the threshold).
        Vad user = new Vad(true, 0.0002);
        user.SetOutputActive(true);
        for (int f = 0; f < 20; f++) user.Feed(0.003, int.MaxValue);
        int userOverEcho = -1;
        for (int f = 0; f < 100; f++) if (user.Feed(0.008, int.MaxValue) == Vad.SpeechStart && userOverEcho < 0) userOverEcho = f;
        r["aecUserOverEchoOnset"] = userOverEcho;

        // T12 live calibration case, from the measured device (test-results/ma3/t12/probes/human-doubletalk-levels-2.txt):
        // AEC ambient 0.00046, own-speech residual about 0.00005 while output plays, human double-talk 0.003-0.016. The
        // output-time threshold must stay below 0.003 and a 0.003 talker must start a turn within 10 frames; the residual alone
        // must never start one.
        Vad live = new Vad(true, 0.00046);
        live.SetOutputActive(true);
        int liveEchoOnsets = 0;
        for (int f = 0; f < 200; f++) if (live.Feed(f % 7 == 0 ? 0.00008 : 0.00002, int.MaxValue) == Vad.SpeechStart) liveEchoOnsets++;
        r["aecLiveResidualOnsets"] = liveEchoOnsets;
        r["aecLiveOutputThreshold"] = live.Threshold;
        int liveUser = -1;
        for (int f = 0; f < 50; f++) if (live.Feed(0.003, int.MaxValue) == Vad.SpeechStart && liveUser < 0) liveUser = f;
        r["aecLiveUserOnset"] = liveUser;

        // T12 review round 3: the user talks (0.004) over the first frames of the session's first reply, so the seed is the
        // user's voice and the threshold is pinned high. The next reply carries only the measured echo (5e-5): its seed lowers
        // the residual again. Talking over a later reply's first frames never raises it.
        AmbientFloor pin = new AmbientFloor(AmbientFloor.MinFloor);
        for (int f = 0; f < 10; f++) pin.Observe(0.004, false, true);
        r["reseedPinnedThreshold"] = pin.OnsetThreshold;
        for (int f = 0; f < AmbientFloor.ResidualHoldFrames + 5; f++) pin.Observe(0.0001, false, false);
        for (int f = 0; f < 10; f++) pin.Observe(0.00005, false, true);
        r["reseedNextReplyThreshold"] = pin.OnsetThreshold;
        for (int f = 0; f < AmbientFloor.ResidualHoldFrames + 5; f++) pin.Observe(0.0001, false, false);
        for (int f = 0; f < 10; f++) pin.Observe(0.004, false, true);
        r["reseedLaterTalkThreshold"] = pin.OnsetThreshold;

        // T12 live endpointing: the split phrases from the endurance session, plus finished and empty partials.
        string[] endpointProbe = { "Prepare approach and prepare.", "Prepare a.", "Open notes and...", "write about matrix.",
            "How many agents are working?", "Is it for the", "", "Stop.", "Tell me about…" };
        string[] endpointPauses = new string[endpointProbe.Length];
        for (int i = 0; i < endpointProbe.Length; i++) endpointPauses[i] = Endpointing.PauseFor(endpointProbe[i]).ToString(CultureInfo.InvariantCulture);
        r["endpointPauses"] = string.Join(",", endpointPauses);

        // The model itself: 200 frames of user speech at 0.008 that no turn is attached to, under output, must not lift the
        // residual or the threshold above what the echo supports (AEC-05). Standalone Vads stop observing after onset, so
        // this drives the ambient model directly.
        AmbientFloor model = new AmbientFloor(AmbientFloor.MinFloor);
        for (int f = 0; f < 20; f++) model.Observe(0.003, false, true);
        for (int f = 0; f < 200; f++) model.Observe(0.008, false, true);
        r["aecResidualAfterUserSpeech"] = model.Residual.GetValueOrDefault();
        r["aecThresholdAfterUserSpeech"] = model.OnsetThreshold;

        // The learned residual is not decayed by a paused (silent) window: it reads the same after 1200 ms of silence with
        // the output flag on as it did before (AEC-01 b). Echo at 0.0028 is below the 0.004 threshold, so it is no onset.
        Vad held = new Vad(true, 0.0002);
        held.SetOutputActive(true);
        for (int f = 0; f < 150; f++) held.Feed(0.0028, int.MaxValue);
        double residualBefore = held.Residual.GetValueOrDefault();
        for (int f = 0; f < 60; f++) held.Feed(0.0002, int.MaxValue);
        r["aecResidualBeforePause"] = residualBefore;
        r["aecResidualAfterPause"] = held.Residual.GetValueOrDefault();

        // Round 2 (verifier, HIGH): steady echo above the old 0.0045 ceiling, with output on from the first frame, is no onset.
        // Before the fix, echo at 0.0045 and 0.005 re-triggered speech_start on every cycle.
        r["aecSteadyEcho0045Onsets"] = EchoOnsets(0, 0.0, 0.0045, 200);
        r["aecSteadyEcho005Onsets"] = EchoOnsets(0, 0.0, 0.005, 200);
        // A quiet start (AEC latency: five 0.0001 frames), then a loud echo: the multi-frame median jump learns it.
        r["aecQuietStartEcho005Onsets"] = EchoOnsets(5, 0.0001, 0.005, 200);
        // User speech at 0.008 over a steady 0.0045 echo is still an onset (the cap keeps the threshold below it).
        r["aecUserOver0045EchoOnset"] = UserOnsetOverEcho(0.0045, 0.008);
        // The learned ceiling: with output audible, the onset threshold never exceeds 2 x ResidualCap (0.006). This is the
        // disclosed limit that README.md states.
        Vad ceiling = new Vad(true, 0.0002);
        ceiling.SetOutputActive(true);
        for (int f = 0; f < 100; f++) ceiling.Feed(0.003, int.MaxValue);
        r["aecOutputThresholdCeiling"] = ceiling.Threshold;
    }

    // Output on from the first frame: `leadFrames` frames at leadLevel, then `frames` frames at echo. Returns the onsets.
    static int EchoOnsets(int leadFrames, double leadLevel, double echo, int frames)
    {
        Vad v = new Vad(true, 0.0002);
        v.SetOutputActive(true);
        for (int f = 0; f < leadFrames; f++) v.Feed(leadLevel, int.MaxValue);
        int onsets = 0;
        for (int f = 0; f < frames; f++) if (v.Feed(echo, int.MaxValue) == Vad.SpeechStart) onsets++;
        return onsets;
    }

    // Steady echo with output on, then user speech at `user` for 100 frames. Returns the frame of the first onset (-1 if none).
    static int UserOnsetOverEcho(double echo, double user)
    {
        Vad v = new Vad(true, 0.0002);
        v.SetOutputActive(true);
        for (int f = 0; f < 20; f++) v.Feed(echo, int.MaxValue);
        for (int f = 0; f < 100; f++) if (v.Feed(user, int.MaxValue) == Vad.SpeechStart) return f;
        return -1;
    }

    // A scripted AEC stream for the duplex checks: one level per frame, and whether our output was audible for that frame.
    // After the script it delivers nothing (Read returns 0) until the input is stopped.
    sealed class ScriptedFrames : IFrameSource
    {
        readonly double[] levels;
        readonly bool[] output;
        int next;
        public volatile bool OutputNow;
        public volatile int Delivered;
        public ScriptedFrames(double[] levels, bool[] output) { this.levels = levels; this.output = output; }
        public int Read(byte[] frame)
        {
            if (next >= levels.Length) return 0;
            short s = (short)Math.Round(levels[next] * 32768.0);
            for (int i = 0; i + 1 < frame.Length; i += 2) { frame[i] = (byte)(s & 0xFF); frame[i + 1] = (byte)((s >> 8) & 0xFF); }
            OutputNow = output[next];
            next++;
            Delivered = next;
            return 1;
        }
        public void Close() { }
    }

    static byte[] ConstantFrame(double level)
    {
        byte[] frame = new byte[Consts.FrameBytes];
        short s = (short)Math.Round(level * 32768.0);
        for (int i = 0; i + 1 < frame.Length; i += 2) { frame[i] = (byte)(s & 0xFF); frame[i + 1] = (byte)((s >> 8) & 0xFF); }
        return frame;
    }

    // T12 (AEC-02): a duplex onset is timed from the capture time of its first loud frame. Frames replayed now keep the stamp
    // they were captured with: 10 quiet frames stamped 500..680 ms, then loud frames from 700 ms. The onset must read 700.
    static void DuplexOnsetTimeCheck(Dictionary<string, object> r)
    {
        DuplexInput.TurnFrames replayed = new DuplexInput.TurnFrames();
        for (int i = 0; i < 30; i++) replayed.Push(ConstantFrame(i < 10 ? 0.0002 : 0.02), 500 + 20 * i);
        CaptureTurn turn = new CaptureTurn("selftest-onset", 1, null, false, 1000000);
        turn.Duplex = true;
        turn.Ambient = new AmbientFloor(AmbientFloor.MinFloor);
        turn.StartCapture(replayed);
        WaitUntil(() => turn.OnsetMonoForTest >= 0, 3000);
        turn.Finish("abort");
        turn.Join(3000);
        r["onsetMonoFromCapture"] = turn.OnsetMonoForTest;
    }

    static void WaitUntil(Func<bool> condition, int ms)
    {
        Stopwatch w = Stopwatch.StartNew();
        while (!condition() && w.ElapsedMilliseconds < ms) Thread.Sleep(5);
    }

    // T12 pre-roll (AEC-02): frames captured while our output was audible, or in its reverb tail, are never replayed into a
    // turn armed after the output. Quiet frames captured before the output, and quiet frames after the tail, are replayed.
    static void DuplexPrerollCheck(Dictionary<string, object> r)
    {
        // 20 quiet frames (calibration), 30 frames of our echo at 0.003 with output audible, 33 quiet frames. The next 13
        // frames after the echo are its reverb tail.
        List<double> levels = new List<double>();
        List<bool> outputs = new List<bool>();
        for (int i = 0; i < 20; i++) { levels.Add(0.0002); outputs.Add(false); }
        for (int i = 0; i < 30; i++) { levels.Add(0.003); outputs.Add(true); }
        for (int i = 0; i < 33; i++) { levels.Add(0.0002); outputs.Add(false); }
        ScriptedFrames script = new ScriptedFrames(levels.ToArray(), outputs.ToArray());
        DuplexInput input = new DuplexInput("selftest-preroll", 20000, cancelled => script, true, () => script.OutputNow);
        input.Start();
        WaitUntil(() => input.Ready && script.Delivered == levels.Count, 5000);
        DuplexInput.TurnFrames replay = (DuplexInput.TurnFrames)input.Attach();
        int replayed = 0, echoReplayed = 0;
        byte[] buffer = new byte[Consts.FrameBytes];
        while (replay.Read(buffer) > 0)
        {
            replayed++;
            if (Rms(buffer) > 0.002) echoReplayed++;
        }
        input.Stop();
        input.Join(3000);
        r["prerollReplayedFrames"] = replayed;
        r["prerollEchoFrames"] = echoReplayed;

        // The replayed frame keeps the time it was captured at, not the time it is read back.
        DuplexInput.TurnFrames stamped = new DuplexInput.TurnFrames();
        stamped.Push(new byte[Consts.FrameBytes], 4321);
        stamped.Read(new byte[Consts.FrameBytes]);
        r["turnFramesKeepCaptureMono"] = stamped.LastMono == 4321;

        // Round 2 (AEC-02 LOW): user speech at 0.03 captured while our output is audible is not echo, so it is kept in the
        // pre-roll. Its 30 frames are all replayed (the echo frames of the check above are dropped).
        List<double> ul = new List<double>();
        List<bool> uo = new List<bool>();
        for (int i = 0; i < 20; i++) { ul.Add(0.0002); uo.Add(false); }
        for (int i = 0; i < 30; i++) { ul.Add(0.03); uo.Add(true); }
        for (int i = 0; i < 33; i++) { ul.Add(0.0002); uo.Add(false); }
        ScriptedFrames talk = new ScriptedFrames(ul.ToArray(), uo.ToArray());
        DuplexInput over = new DuplexInput("selftest-preroll-talk", 20000, cancelled => talk, true, () => talk.OutputNow);
        over.Start();
        WaitUntil(() => over.Ready && talk.Delivered == ul.Count, 5000);
        DuplexInput.TurnFrames talkReplay = (DuplexInput.TurnFrames)over.Attach();
        int userKept = 0;
        byte[] talkBuffer = new byte[Consts.FrameBytes];
        while (talkReplay.Read(talkBuffer) > 0) if (Rms(talkBuffer) > 0.02) userKept++;
        over.Stop();
        over.Join(3000);
        r["prerollUserFramesKept"] = userKept;
    }

    // T12-PRIV-03: a capture loop that ends because the microphone is muted reports "mute"; the lifetime bound still reports
    // "lifetime".
    static void DuplexStopReasonCheck(Dictionary<string, object> r)
    {
        double[] quiet = new double[40];
        bool[] none = new bool[40];
        for (int i = 0; i < quiet.Length; i++) quiet[i] = 0.0002;
        ScriptedFrames muteSource = new ScriptedFrames(quiet, none);
        DuplexInput muted = new DuplexInput("selftest-mute", 20000, cancelled => muteSource, true, () => false);
        muted.Start();
        WaitUntil(() => muted.Ready, 5000);
        Program.Muted = true;
        muted.Join(3000);
        Program.Muted = false;
        r["duplexStopReasonOnMute"] = muted.EndReason;

        ScriptedFrames lifeSource = new ScriptedFrames(quiet, none);
        DuplexInput lifetime = new DuplexInput("selftest-lifetime", 300, cancelled => lifeSource, true, () => false);
        lifetime.Start();
        lifetime.Join(3000);
        r["duplexStopReasonLifetime"] = lifetime.EndReason;

        // Round 2 (PRIV-03 verifier): the mute and the lifetime bound run out in the same read (the bound is 300 ms, the read
        // holds for 400 ms). The bound is what the loop's next check sees first, so the reason is "lifetime", not "mute".
        DuplexInput coincide = new DuplexInput("selftest-mute-bound", 300, cancelled => new MuteOnRead(0, 400), true, () => false);
        coincide.Start();
        coincide.Join(5000);
        Program.Muted = false;
        r["duplexStopReasonMuteAndBound"] = coincide.EndReason;
    }

    // A frame source that mutes the microphone on read number muteAt, and holds that read for holdMs.
    sealed class MuteOnRead : IFrameSource
    {
        readonly int muteAt;
        readonly int holdMs;
        int calls;
        public MuteOnRead(int muteAt, int holdMs) { this.muteAt = muteAt; this.holdMs = holdMs; }
        public int Read(byte[] frame)
        {
            if (calls++ == muteAt) { Program.Muted = true; Thread.Sleep(holdMs); }
            Buffer.BlockCopy(ConstantFrame(0.0002), 0, frame, 0, frame.Length);
            return 1;
        }
        public void Close() { }
    }

    // RC-02 (worker side): a playback.error for a gen releases that gen's pause, so the next chunk of the gen is not paused.
    // Counts every pause request, every pause the driver applied, and every chunk the device completed.
    sealed class PauseLog
    {
        public int PauseRequests;
        public int PauseApplied;
        public int Completed;
        public bool Refuse;
    }

    // A driver for the pause checks. Seq 0 never completes on its own (it waits for a pause to be applied or refused); later
    // chunks complete 150 ms after their submit. A refusing driver throws on every pause request.
    sealed class PauseDriver : IWaveOut
    {
        readonly PauseLog log;
        readonly Stopwatch sinceSubmit = new Stopwatch();
        public PauseDriver(PauseLog log) { this.log = log; }
        public uint Device { get { return 0u; } }
        public void Submit(Chunk c) { sinceSubmit.Start(); }
        public bool IsDone(Chunk c) { return c.Seq > 0 && sinceSubmit.ElapsedMilliseconds >= 150; }
        public void Release(Chunk c) { lock (log) log.Completed++; }
        public void Reset() { }
        public void Pause(bool on)
        {
            if (!on) return;
            lock (log) log.PauseRequests++;
            if (log.Refuse) throw new VoiceFault("DEVICE_UNAVAILABLE", "device refused pause");
            lock (log) log.PauseApplied++;
        }
        public void Close() { }
    }

    static void PauseReleaseCheck(Dictionary<string, object> r)
    {
        // (b) pause requested for gen 21; its first chunk fails to synthesize (TTS_UNAVAILABLE); the next chunk of gen 21 plays.
        // It must not be paused on the device, and it must complete.
        PauseLog ttsLog = new PauseLog();
        Speaker tts = new Speaker(null, false, 1.0, new string[0], d => new PauseDriver(ttsLog));
        tts.Start();
        tts.Pause(21, true);
        tts.Enqueue("selftest-tts", 21, 0, "a sentence that cannot be rendered", 0u, null);
        tts.AddRenderedForTest("selftest-tts", 21, 1, new byte[320], 0u);
        WaitUntil(() => ttsLog.Completed >= 1, 3000);
        tts.Shutdown();
        r["ttsFailurePauseReleased"] = ttsLog.PauseRequests == 0 && ttsLog.Completed == 1;

        // (c) a device that refuses pause: the first chunk of gen 22 fails with the device's code; the next chunk of gen 22 is
        // not asked to pause, and it completes.
        PauseLog refusedLog = new PauseLog { Refuse = true };
        Speaker refused = new Speaker(null, false, 1.0, new string[0], d => new PauseDriver(refusedLog));
        refused.Start();
        refused.Pause(22, true);
        refused.AddRenderedForTest("selftest-refused", 22, 0, new byte[320], 0u);
        WaitUntil(() => refusedLog.PauseRequests >= 1, 3000);
        Thread.Sleep(100);
        refused.AddRenderedForTest("selftest-refused", 22, 1, new byte[320], 0u);
        WaitUntil(() => refusedLog.Completed >= 1, 3000);
        refused.Shutdown();
        r["pauseRefusalReleased"] = refusedLog.PauseRequests == 1 && refusedLog.Completed == 1;
    }

    public static int Run()
    {
        Dictionary<string, object> r = new Dictionary<string, object>();
        // Render-identity guard only: these two checks prove that a cached render index is refused when the enumeration
        // reorders. They prove nothing about echo cancellation; AEC effectiveness is verified by device evidence, never here.
        string defaultId = "endpoint-A";
        uint mappingIndex = 1;
        Dictionary<uint, string> endpoints = new Dictionary<uint, string>();
        endpoints[0] = "endpoint-B"; endpoints[1] = defaultId;
        r["renderIdentityInitiallyMatches"] = AecSource.RenderIdentityMatches(mappingIndex, defaultId, i => endpoints[i]);
        endpoints[1] = "endpoint-B";
        r["renderIdentityReorderRefused"] = !AecSource.RenderIdentityMatches(mappingIndex, defaultId, i => endpoints[i]);

        // Recognizer evidence every 500 ms through 9 s of quiet: no no_speech may fire.
        Vad alive = new Vad();
        bool noSpeechWithEvidence = false;
        for (int f = 0; f < 450; f++)
        {
            if (alive.Feed(0.00001, 500) == Vad.NoSpeech) noSpeechWithEvidence = true;
        }
        r["noSpeechWithEvidence"] = noSpeechWithEvidence;

        // Evidence stops at frame 100 (no hypothesis): no_speech fires once 8 s of quiet have passed since then.
        Vad quiet = new Vad();
        int noSpeechFrame = -1;
        for (int f = 0; f < 700; f++)
        {
            if (quiet.Feed(0.00001, f < 100 ? 0 : int.MaxValue) == Vad.NoSpeech && noSpeechFrame < 0) noSpeechFrame = f;
        }
        r["noSpeechFrame"] = noSpeechFrame;

        // A 600 ms burst (frames 30..59) then silence. Evidence is fresh through frame 100, then ages 20 ms per frame.
        // Onset needs 120 ms above threshold. The turn ends only when silence >= 900 ms AND evidence >= 700 ms old.
        Vad end = new Vad();
        int startFrame = -1;
        int endFrame = -1;
        for (int f = 0; f < 200; f++)
        {
            double rms = (f >= 30 && f < 60) ? 0.05 : 0.00001;
            int since = f <= 100 ? 0 : (f - 100) * 20;
            int ev = end.Feed(rms, since);
            if (ev == Vad.SpeechStart && startFrame < 0) startFrame = f;
            if (ev == Vad.SpeechEnd && endFrame < 0) endFrame = f;
        }
        r["speechStartFrame"] = startFrame;
        r["speechEndFrame"] = endFrame;

        // Part B: calibration in a quiet room (0.0002), then 1.5 s of speech at 0.02, then room noise at 0.0012 (above the
        // calibrated floor*3 = 0.0006, below 8% of the speech peak). The turn must still end ~900 ms after the speech.
        Vad noisy = new Vad();
        int noisyEnd = -1;
        for (int f = 0; f < 400; f++)
        {
            double rms = f < 30 ? 0.0002 : (f < 105 ? 0.02 : 0.0012);
            if (noisy.Feed(rms, int.MaxValue) == Vad.SpeechEnd && noisyEnd < 0) noisyEnd = f;
        }
        r["noisyTailEndFrame"] = noisyEnd;

        // A single loud click (0.5 for one frame) inside steady soft speech at 0.006 must not end the turn: uncapped, 8% of
        // the clicked smoothed peak would be ~0.0084; the cap holds the end threshold at 0.002, below the speech.
        Vad click = new Vad();
        int clickEnd = -1;
        for (int f = 0; f < 200; f++)
        {
            double rms = f < 25 ? 0.0002 : (f == 60 ? 0.5 : 0.006);
            if (click.Feed(rms, int.MaxValue) == Vad.SpeechEnd && clickEnd < 0) clickEnd = f;
        }
        r["clickEndFrame"] = clickEnd;

        // R4 T10-VAD-1: speech at 0.006, a loud section at 0.08, then 3 s of soft speech at 0.003, then silence. The soft
        // span (frames 75..224) must not end the turn; the end comes ~900 ms into the true silence (from frame 225).
        Vad soft = new Vad();
        int softEnd = -1;
        for (int f = 0; f < 400; f++)
        {
            double rms = f < 25 ? 0.0002 : (f < 50 ? 0.006 : (f < 75 ? 0.08 : (f < 225 ? 0.003 : 0.00001)));
            if (soft.Feed(rms, int.MaxValue) == Vad.SpeechEnd && softEnd < 0) softEnd = f;
        }
        r["softAfterLoudEndFrame"] = softEnd;

        // Terminal decisions.
        r["rejectedOnly"] = StopDecision.Terminal(false, true, false, 0, true, false);
        r["rejectedWithoutOnset"] = StopDecision.Terminal(false, false, false, 0, true, false);
        r["recognizedWithOnset"] = StopDecision.Terminal(false, true, false, 2, true, false);
        r["recognizedWithoutOnset"] = StopDecision.Terminal(false, false, true, 2, false, false);
        r["abortedWins"] = StopDecision.Terminal(true, true, false, 2, false, false);

        // AGC: gain rises to the clamp while speech is active, never leaves 1x..24x, and stays at 1x outside speech.
        byte[] src = new byte[Consts.FrameBytes];
        byte[] dst = new byte[Consts.FrameBytes];
        byte[] keep = new byte[Consts.FrameBytes];
        for (int i = 0; i < Consts.FrameBytes / 2; i++)
        {
            short s = (short)Math.Round(79 * Math.Sin(i * 0.3));
            src[2 * i] = (byte)(s & 0xff);
            src[2 * i + 1] = (byte)((s >> 8) & 0xff);
        }
        Buffer.BlockCopy(src, 0, keep, 0, src.Length);
        double raw = Rms(src);
        Agc speech = new Agc();
        for (int f = 0; f < 200; f++) speech.Apply(src, dst, raw, true);
        bool untouched = true;
        for (int i = 0; i < src.Length; i++) if (src[i] != keep[i]) untouched = false;
        r["agcSourceUntouched"] = untouched;
        r["agcSpeechGain"] = speech.Gain;
        Agc quiet2 = new Agc();
        for (int f = 0; f < 200; f++) quiet2.Apply(src, dst, 0.0002, false);
        r["agcQuietGain"] = quiet2.Gain;
        r["rawRmsUnchanged"] = Rms(src) == raw;

        // Thread-body guard: a thrown fault is handed to the handler and never escapes.
        bool guardCaught = false;
        bool guardReturned = false;
        Guard.Run(() => { throw new InvalidOperationException("selftest fault"); }, e => { guardCaught = true; });
        guardReturned = true;
        r["guardCaught"] = guardCaught;
        r["guardReturned"] = guardReturned;

        // Playback device stall: a driver that never returns from Open must not hold the command loop.
        StallCheck(r);

        // Abandoned recognizers: the raw audio is released and the ledger refuses past its bound.
        PcmPipe wiped = new PcmPipe();
        wiped.Push(new byte[1000], 0, 1000);
        wiped.Wipe();
        wiped.Push(new byte[10], 0, 10);
        byte[] wipeRead = new byte[16];
        r["pipeWipeReadBytes"] = wiped.Read(wipeRead, 0, 16);
        r["pipeWipeUnread"] = wiped.UnreadBytes;
        LedgerCheck(r);

        // Device index: only absent/null, or an integer in [-1, int.MaxValue], is accepted. Verdicts: F or T:<index>.
        string[] deviceCases = { "{\"device\":4294967296}", "{\"device\":-1}", "{\"device\":0}", "{\"device\":2147483648}", "{}", "{\"device\":1.5}", "{\"device\":\"x\"}", "{\"device\":null}", "{\"device\":-2}", "{\"device\":2147483647}" };
        List<string> verdicts = new List<string>();
        foreach (string json in deviceCases)
        {
            Dictionary<string, object> parsed = (Dictionary<string, object>)Json.Parse(json);
            int index;
            verdicts.Add(Program.TryDeviceArg(parsed, out index) ? "T:" + index : "F");
        }
        r["deviceArgs"] = string.Join(",", verdicts.ToArray());

        // Finalize decision: the onset state published while frames are processed is what the decision reads.
        CaptureTurn onsetTurn = new CaptureTurn("selftest", 1, null, false, 0);
        Vad onsetVad = new Vad();
        // Quiet lead-in for the noise floor, then a 30-frame burst (the same shape as the endpointing check above).
        for (int f = 0; f < 60; f++) onsetVad.Feed(f < 30 ? 0.00001 : 0.05, 0);
        onsetTurn.PublishOnset(onsetVad);
        bool[] onsetNow = onsetTurn.OnsetSnapshot();
        r["onsetPublished"] = onsetNow[0] == onsetVad.SawOnset && onsetVad.SawOnset;
        r["onsetDecision"] = StopDecision.Terminal(false, onsetNow[0], onsetNow[1], 1, false, false);

        // Cancel meter: one worker for any number of receipts; a full queue is refused, never a new thread.
        MeterCheck(r);

        // Playback ordering around a pause and a barge-in reset, on a recording driver.
        PlaybackOrderCheck(r);

        // Containment: a failed recognizer start, a capture body whose protocol write fails, a timed-out chunk, and the
        // wipe of unmanaged audio. Each runs against fakes or a broken stream; no device or recognizer audio is used.
        ContainmentCheck(r);

        // T12 duplex endpointing with explicit floors. Standalone duplex Vads: no devices, no recognizer, nothing audible.
        DuplexVadCheck(r);
        // T12 residual model, pre-roll taint and stamps, the mute stop reason, and the pause release on a playback.error.
        DuplexResidualCheck(r);
        DuplexPrerollCheck(r);
        DuplexStopReasonCheck(r);
        PauseReleaseCheck(r);
        DuplexOnsetTimeCheck(r);

        Out.Emit(Out.Ev("selftest", "results", r));
        return 0;
    }
}

internal static class Program
{
    public static string RenderReference { get { DuplexInput input = duplex; return input != null && input.Ready && !input.StopFlag ? input.ReferenceId : null; } }
    public static readonly object Gate = new object();
    public static CaptureTurn Active;
    // Turns whose capture has ended and whose terminal event (final, none or aborted) is still pending. capture.abort
    // reaches them (T12, AUD-04), so the next input turn can attach while one finalizes. Guarded by Gate.
    public static readonly List<CaptureTurn> Finalizing = new List<CaptureTurn>();
    const int MaxFinalizing = 3;
    public static volatile bool Muted;
    static Speaker speaker;
    // Speak.cancel receipts (1 s bound) and speak.pause receipts (1.5 s bound) are measured by separate meter workers, so a
    // pause measurement never delays a cancel receipt.
    static readonly CancelMeter meter = new CancelMeter(since => Endpoints.PollRender(since, 1000));
    static readonly CancelMeter pauseMeter = new CancelMeter(since => Endpoints.PollRender(since, 1500));
    static RecognizerInfo recognizer;
    static byte[] synthFixture;
    static byte[] wavFixture;
    static string inputKind;
    static string synthText = "did the tests pass in my last mission";
    static string wavPath;
    static bool nullOutput;
    static double pace = 1.0;
    static string sttEngine = "sapi";
    static string whisperDir;
    static string whisperModel;
    static int whisperThreads = 4;
    static WhisperEngine whisperEngine;
    static string whisperError;
    static DuplexInput duplex;

    static Dictionary<string, object> Ev(string name, params object[] kv) { return Out.Ev(name, kv); }

    public static int Main(string[] args)
    {
        Out.Open();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--input-synth" && i + 1 < args.Length) { inputKind = "synth"; synthText = args[++i]; }
            else if (a == "--selftest") { int result = SelfTest.Run(); Out.Drain(1000); return result; }
            else if (a == "--selftest-output-stall") return Out.StalledPipeSelfTest();
            else if (a == "--input-silence") inputKind = "silence";
            else if (a == "--input-noise") inputKind = "noise";
            else if (a == "--input-stall") inputKind = "stall";
            else if (a == "--input-wav" && i + 1 < args.Length) { inputKind = "wav"; wavPath = args[++i]; }
            else if (a == "--output" && i + 1 < args.Length) nullOutput = args[++i] == "null";
            else if (a == "--stt" && i + 1 < args.Length)
            {
                sttEngine = args[++i];
                if (sttEngine != "sapi" && sttEngine != "whisper") { Console.Error.WriteLine("unknown --stt engine"); return 2; }
            }
            else if (a == "--whisper-dir" && i + 1 < args.Length) whisperDir = args[++i];
            else if (a == "--whisper-model" && i + 1 < args.Length) whisperModel = args[++i];
            else if (a == "--whisper-threads" && i + 1 < args.Length)
            {
                int th;
                if (!int.TryParse(args[++i], NumberStyles.None, CultureInfo.InvariantCulture, out th) || th < 1 || th > 64)
                {
                    Console.Error.WriteLine("invalid --whisper-threads");
                    return 2;
                }
                whisperThreads = th;
            }
            else if (a == "--fixture-pace" && i + 1 < args.Length)
            {
                pace = double.Parse(args[++i], CultureInfo.InvariantCulture);
                if (pace < 0.1) pace = 0.1;
                if (pace > 20) pace = 20;
            }
            else
            {
                Console.Error.WriteLine("unknown argument");
                return 2;
            }
        }

        SpeechSynthesizer synth = null;
        List<object> voiceNames = new List<object>();
        List<string> installed = new List<string>();
        try
        {
            synth = new SpeechSynthesizer();
            foreach (InstalledVoice v in synth.GetInstalledVoices())
            {
                if (!v.Enabled) continue;
                voiceNames.Add(v.VoiceInfo.Name);
                installed.Add(v.VoiceInfo.Name);
            }
        }
        catch (Exception e)
        {
            Out.Diag("tts unavailable: " + e.GetType().Name);
            synth = null;
        }
        try
        {
            foreach (RecognizerInfo r in SpeechRecognitionEngine.InstalledRecognizers())
            {
                if (r.Culture != null && r.Culture.Name == "en-US") { recognizer = r; break; }
            }
        }
        catch (Exception e)
        {
            Out.Diag("stt inventory: " + e.GetType().Name);
        }

        if (sttEngine == "whisper")
        {
            string err;
            whisperEngine = WhisperEngine.Load(whisperDir, whisperModel, whisperThreads, out err);
            if (whisperEngine == null) whisperError = err;
            else Out.Diag("whisper model loaded in " + whisperEngine.LoadMs + " ms");
        }

        if (inputKind == "synth")
        {
            if (synth == null) { Console.Error.WriteLine("fixture synth requires SAPI"); return 2; }
            try
            {
                foreach (string v in installed) { if (v.IndexOf("Zira", StringComparison.OrdinalIgnoreCase) >= 0) { synth.SelectVoice(v); break; } }
                byte[] speech = Tts.Render(synth, synthText);
                byte[] script = new byte[16000 + speech.Length + 48000]; // 500 ms + speech + 1500 ms
                Buffer.BlockCopy(speech, 0, script, 16000, speech.Length);
                synthFixture = script;
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("fixture synth failed: " + e.GetType().Name);
                return 2;
            }
        }
        else if (inputKind == "wav")
        {
            try { wavFixture = LoadWav(wavPath); }
            catch (Exception e)
            {
                Console.Error.WriteLine("fixture wav rejected: " + e.Message);
                return 2;
            }
        }

        speaker = new Speaker(synth, nullOutput, pace, installed);
        speaker.PauseMeter = pauseMeter;
        speaker.Start();

        Out.Emit(Ev("ready",
            "protocol", "bunny-voice/1",
            "pid", Process.GetCurrentProcess().Id,
            "stt", SttReady(),
            "duplex", Out.Obj("supported", true, "backend", "Windows Voice Capture DSP/source"),
            "tts", Out.Obj("engine", synth != null ? "Windows SAPI 5.4 System.Speech" : null, "voices", voiceNames, "local", true)));

        if (whisperError != null) Out.Error("STT_UNAVAILABLE", "whisper unavailable: " + whisperError + "; using Windows SAPI");

        Thread poll = new Thread(PollDevices);
        poll.IsBackground = true;
        poll.Start();

        Stream stdin = Console.OpenStandardInput();
        byte[] buffer = new byte[8192];
        MemoryStream line = new MemoryStream();
        bool discarding = false;
        bool shutdown = false;
        while (!shutdown)
        {
            int n = stdin.Read(buffer, 0, buffer.Length);
            if (n <= 0) break;
            for (int i = 0; i < n && !shutdown; i++)
            {
                byte b = buffer[i];
                if (b == (byte)'\n')
                {
                    if (!discarding && line.Length > 0)
                    {
                        string text = Encoding.UTF8.GetString(line.ToArray());
                        if (text.EndsWith("\r", StringComparison.Ordinal)) text = text.Substring(0, text.Length - 1);
                        shutdown = !Dispatch(text);
                    }
                    discarding = false;
                    line.SetLength(0);
                    continue;
                }
                if (discarding) continue;
                if (line.Length >= Consts.MaxLineBytes)
                {
                    discarding = true;
                    line.SetLength(0);
                    Out.Error("INTERNAL", "command line exceeds 64 KiB and was rejected");
                    continue;
                }
                line.WriteByte(b);
            }
        }

        Shutdown();
        Out.Emit(Ev("bye"));
        Out.Drain(500);
        return 0;
    }

    static Dictionary<string, object> SttReady()
    {
        if (whisperEngine != null)
        {
            return Out.Obj("engine", WhisperEngine.EngineName, "recognizer", whisperEngine.Recognizer, "culture", "en", "local", true);
        }
        return Out.Obj("engine", recognizer != null ? "Windows SAPI 5.4 System.Speech" : null, "recognizer", recognizer != null ? recognizer.Id : null,
            "culture", recognizer != null ? recognizer.Culture.Name : null, "local", true);
    }

    static void Shutdown()
    {
        DuplexInput input = duplex;
        if (input != null) input.Stop("shutdown");
        CaptureTurn t;
        lock (Gate) { t = Active; }
        if (t != null)
        {
            t.Finish("shutdown");
            t.Join(1500);
        }
        speaker.Shutdown();
        if (input != null) input.Join(1000);
    }

    // Returns false when the process must shut down.
    static bool Dispatch(string text)
    {
        object parsed;
        try
        {
            parsed = Json.Parse(text);
        }
        catch (Exception)
        {
            Out.Error("INTERNAL", "malformed command JSON");
            return true;
        }
        Dictionary<string, object> cmd = parsed as Dictionary<string, object>;
        if (cmd == null)
        {
            Out.Error("INTERNAL", "command must be a JSON object");
            return true;
        }
        string op = Str(cmd, "op");
        try
        {
            switch (op)
            {
                case "devices": EmitDevices(); return true;
                case "duplex.start": StartDuplex(cmd); return true;
                case "duplex.stop":
                    if (duplex != null && Str(cmd, "session") == duplexSession) duplex.Stop();
                    return true;
                case "capture.start": StartCapture(cmd); return true;
                case "capture.end":
                    {
                        CaptureTurn t;
                        lock (Gate) { t = Active; }
                        if (t != null && t.Turn == Str(cmd, "turn") && t.Gen == Num(cmd, "gen", -1)) t.Finish("end");
                        return true;
                    }
                case "capture.abort":
                    {
                        // T12: with a turn id, only the capture (active or finalizing) whose turn AND gen match exactly is aborted.
                        // Without one, the T10 rule: the active capture (or the latest finalizing one) at gen or later.
                        string abortTurn = Str(cmd, "turn");
                        long abortGen = Num(cmd, "gen", -1);
                        if (abortTurn != null)
                        {
                            CaptureTurn exact = FindCapture(abortTurn, abortGen);
                            if (exact != null) exact.Finish("abort");
                            return true;
                        }
                        CaptureTurn t;
                        lock (Gate) { t = Active ?? (Finalizing.Count > 0 ? Finalizing[Finalizing.Count - 1] : null); }
                        if (t != null && abortGen >= t.Gen) t.Finish("abort");
                        return true;
                    }
                case "speak": Speak(cmd); return true;
                case "speak.cancel": CancelSpeech(cmd); return true;
                case "speak.pause": speaker.Pause(Num(cmd, "gen", -1), Bool(cmd, "on")); return true;
                case "mute":
                    {
                        bool on = Bool(cmd, "on");
                        lock (Gate)
                        {
                            Muted = on;
                            if (on && duplex != null) duplex.Stop("mute");
                            if (on && Active != null) Active.Finish("mute");
                        }
                        Out.Emit(Ev("mute", "on", on));
                        return true;
                    }
                case "shutdown": return false;
                default:
                    Out.Error("UNKNOWN_OP", "unknown op");
                    return true;
            }
        }
        catch (Exception e)
        {
            Out.Error("INTERNAL", "command failed: " + e.GetType().Name);
            return true;
        }
    }

    static string Str(Dictionary<string, object> d, string key)
    {
        object o;
        return d.TryGetValue(key, out o) ? o as string : null;
    }

    static long Num(Dictionary<string, object> d, string key, long fallback)
    {
        object o;
        if (d.TryGetValue(key, out o) && o is double)
        {
            double v = (double)o;
            if (v >= long.MinValue && v <= long.MaxValue) return (long)v;
        }
        return fallback;
    }

    static bool Bool(Dictionary<string, object> d, string key)
    {
        object o;
        return d.TryGetValue(key, out o) && o is bool && (bool)o;
    }

    static void EmitDevices()
    {
        List<object> inputs = new List<object>();
        uint n = Native.waveInGetNumDevs();
        for (uint i = 0; i < n; i++)
        {
            WaveCaps caps = new WaveCaps();
            if (Native.waveInGetDevCapsW(new UIntPtr(i), ref caps, (uint)Marshal.SizeOf(typeof(WaveCaps))) == 0)
            {
                inputs.Add(Out.Obj("index", (int)i, "name", caps.szPname ?? "", "channels", (int)caps.wChannels));
            }
        }
        List<object> outputs = new List<object>();
        uint m = Native.waveOutGetNumDevs();
        for (uint i = 0; i < m; i++)
        {
            WaveCaps caps = new WaveCaps();
            if (Native.waveOutGetDevCapsW(new UIntPtr(i), ref caps, (uint)Marshal.SizeOf(typeof(WaveCaps))) == 0)
            {
                outputs.Add(Out.Obj("index", (int)i, "name", caps.szPname ?? "", "channels", (int)caps.wChannels));
            }
        }
        EndpointInfo input = Endpoints.Read(1);
        EndpointInfo output = Endpoints.Read(0);
        Out.Emit(Ev("devices",
            "inputs", inputs,
            "outputs", outputs,
            "defaultInput", input.ToDict(),
            "defaultOutput", output.ToDict(),
            "micPrivacy", Endpoints.MicPrivacy()));
    }

    static void PollDevices()
    {
        string last = null;
        while (true)
        {
            Thread.Sleep(1000);
            try
            {
                EndpointInfo input = Endpoints.Read(1);
                EndpointInfo output = Endpoints.Read(0);
                string key = input.Key() + "#" + output.Key();
                if (last != null && key != last)
                {
                    Out.Emit(Ev("device.changed", "defaultInput", input.ToDict(), "defaultOutput", output.ToDict()));
                }
                last = key;
            }
            catch (Exception)
            {
            }
        }
    }

    static string WaveInName(uint index)
    {
        WaveCaps caps = new WaveCaps();
        if (Native.waveInGetDevCapsW(new UIntPtr(index), ref caps, (uint)Marshal.SizeOf(typeof(WaveCaps))) != 0)
        {
            throw new VoiceFault("DEVICE_UNAVAILABLE", "no such input device");
        }
        return caps.szPname ?? "";
    }

    static bool NameMatches(string endpoint, string device)
    {
        if (string.IsNullOrEmpty(endpoint) || string.IsNullOrEmpty(device)) return false;
        return endpoint.StartsWith(device, StringComparison.OrdinalIgnoreCase) || device.StartsWith(endpoint, StringComparison.OrdinalIgnoreCase);
    }

    static void CaptureError(string turn, long gen, string code, string message)
    {
        Out.Emit(Ev("capture.error", "turn", turn, "gen", gen < 0 ? (object)null : (object)gen, "code", code, "message", message));
    }

    // The capture (active, or finalizing) that carries exactly this turn id and generation, or null.
    static CaptureTurn FindCapture(string turn, long gen)
    {
        lock (Gate)
        {
            if (Active != null && Active.Turn == turn && Active.Gen == gen) return Active;
            foreach (CaptureTurn f in Finalizing) if (f.Turn == turn && f.Gen == gen) return f;
            return null;
        }
    }

    static void StartCapture(Dictionary<string, object> cmd)
    {
        string turn = Str(cmd, "turn");
        long gen = Num(cmd, "gen", -1);
        string endpointing = Str(cmd, "endpointing") ?? "manual";
        long maxMs = Num(cmd, "maxMs", 30000);
        if (maxMs < 1) maxMs = 1;
        if (maxMs > 30000) maxMs = 30000;
        if (turn == null || gen < 0 || (endpointing != "manual" && endpointing != "vad"))
        {
            CaptureError(turn, gen, "INTERNAL", "invalid capture.start");
            return;
        }
        int device;
        if (!TryDeviceArg(cmd, out device))
        {
            CaptureError(turn, gen, "DEVICE_UNAVAILABLE", "device index is outside the valid range");
            return;
        }
        lock (Gate)
        {
            if (Muted) { CaptureError(turn, gen, "MUTED", "microphone is muted"); return; }
            if (Active != null) { CaptureError(turn, gen, "DEVICE_BUSY", "capture already active"); return; }
            // T12: a finished capture does not block the next one; only a bounded number of finalizing turns may be pending.
            if (Finalizing.Count >= MaxFinalizing) { CaptureError(turn, gen, "STT_UNAVAILABLE", "previous turns are still finalizing"); return; }
            bool continuous = Bool(cmd, "duplex");
            if (!continuous && speaker.IsBusy()) { CaptureError(turn, gen, "BUSY_PLAYBACK", "speech playback is active; cancel it before listening"); return; }
            if (!AbandonLedger.HasRoom()) { CaptureError(turn, gen, "STT_UNAVAILABLE", "speech recognizer is still busy with an abandoned turn"); return; }

            IFrameSource source;
            VoiceDevice info;
            try
            {
                if (continuous)
                {
                    if (duplex == null || !duplex.Ready || duplex.StopFlag || Str(cmd, "session") != duplexSession) throw new VoiceFault("AEC_UNAVAILABLE", "full-duplex capture is unavailable");
                    source = duplex.Attach();
                    info = new VoiceDevice { Index = inputKind != null ? -2 : -1, Name = inputKind != null ? "fixture:duplex" : "AEC processed default microphone", Channels = 1 };
                }
                else OpenInput(device, out source, out info);
            }
            catch (VoiceFault f)
            {
                CaptureError(turn, gen, f.Code, f.Message);
                return;
            }
            WhisperEngine engine = whisperEngine;
            CaptureTurn t = engine != null
                ? new CaptureTurn(turn, gen, info, endpointing == "vad", maxMs * Consts.BytesPerMs, engine)
                : new CaptureTurn(turn, gen, info, endpointing == "vad", maxMs * Consts.BytesPerMs);
            t.Duplex = continuous;
            if (continuous) t.Ambient = duplex.Ambient;
            try
            {
                t.StartRecognizer(recognizer);
            }
            catch (Exception e)
            {
                try { source.Close(); } catch (Exception) { }
                CaptureError(turn, gen, "STT_UNAVAILABLE", "speech recognizer unavailable: " + e.GetType().Name);
                return;
            }
            Active = t;
            Out.Emit(Ev("capture.started", "turn", turn, "gen", gen, "device", info.ToDict(), "sampleRate", Consts.SampleRate, "channels", 1));
            t.StartCapture(source);
        }
    }

    static void OpenInput(int device, out IFrameSource source, out VoiceDevice info)
    {
        if (inputKind != null)
        {
            info = new VoiceDevice();
            info.Index = -2;
            info.Name = "fixture:" + inputKind;
            info.Channels = 1;
            if (inputKind == "synth") source = new FixtureSource(synthFixture, false, pace);
            else if (inputKind == "stall") source = new StalledFixtureSource();
            else if (inputKind == "silence") source = new FixtureSource(null, false, pace);
            else if (inputKind == "noise") source = new FixtureSource(null, true, pace);
            else source = new FixtureSource(wavFixture, false, pace);
            return;
        }
        string privacy = Endpoints.MicPrivacy();
        if (privacy == "deny") throw new VoiceFault("PERMISSION_DENIED", "Windows microphone privacy denies desktop apps");
        string name = device < 0 ? "Default input (WAVE_MAPPER)" : WaveInName((uint)device);
        EndpointInfo endpoint = Endpoints.Read(1);
        if (endpoint.Muted == true && (device < 0 || NameMatches(endpoint.Name, name)))
        {
            throw new VoiceFault("ENDPOINT_MUTED", "the Windows capture endpoint is muted");
        }
        if (device >= 0 && device >= Native.waveInGetNumDevs()) throw new VoiceFault("DEVICE_UNAVAILABLE", "no such input device");
        source = new WaveInSource(device < 0 ? Native.WAVE_MAPPER : (uint)device);
        info = new VoiceDevice();
        info.Index = device;
        info.Name = name;
        info.Channels = 1;
    }

    // T12 (RC-02): a refused speak ends any pause request its gen already holds (the Host clears its hold on the error).
    static void ReleaseGenPause(long gen)
    {
        if (speaker != null && gen >= 0) speaker.Pause(gen, false);
    }

    static void Speak(Dictionary<string, object> cmd)
    {
        string turn = Str(cmd, "turn");
        long gen = Num(cmd, "gen", -1);
        long seq = Num(cmd, "seq", -1);
        string text = Str(cmd, "text");
        string voice = Str(cmd, "voice");
        int device;
        bool deviceOk = TryDeviceArg(cmd, out device);
        if (turn == null || gen < 0 || seq < 0 || text == null)
        {
            ReleaseGenPause(gen);
            Out.Emit(Ev("playback.error", "turn", turn, "gen", gen < 0 ? (object)null : (object)gen, "code", "INTERNAL", "message", "invalid speak"));
            return;
        }
        if (!deviceOk)
        {
            ReleaseGenPause(gen);
            Out.Emit(Ev("playback.error", "turn", turn, "gen", gen, "code", "DEVICE_UNAVAILABLE", "message", "device index is outside the valid range"));
            return;
        }
        if (duplex != null && !duplex.StopFlag && !duplex.Ready)
        {
            // T12: while the echo reference is still being measured, output has no bound endpoint. Refuse, never play on
            // an unbound device that the echo canceller cannot see.
            ReleaseGenPause(gen);
            Out.Emit(Ev("playback.error", "turn", turn, "gen", gen, "code", "AEC_UNAVAILABLE", "message", "full-duplex reference is not ready"));
            return;
        }
        if (duplex != null && duplex.Ready && !duplex.StopFlag)
        {
            if (device >= 0 && (uint)device != duplex.RenderDevice) { ReleaseGenPause(gen); Out.Emit(Ev("playback.error", "turn", turn, "gen", gen, "code", "AEC_UNAVAILABLE", "message", "output differs from AEC reference")); return; }
            speaker.Enqueue(turn, gen, seq, text, duplex.RenderDevice, voice);
        }
        else speaker.Enqueue(turn, gen, seq, text, device < 0 ? Native.WAVE_MAPPER : (uint)device, voice);
    }

    static string duplexSession;
    static void StartDuplex(Dictionary<string, object> cmd)
    {
        string session = Str(cmd, "session");
        if (string.IsNullOrEmpty(session) || session.Length > 80 || Muted)
        { Out.Emit(Ev("duplex.error", "session", session, "code", Muted ? "MUTED" : "INTERNAL", "message", "duplex start refused")); return; }
        if (duplex != null && !duplex.StopFlag)
        { if (session != duplexSession) Out.Emit(Ev("duplex.error", "session", session, "code", "DEVICE_BUSY", "message", "another duplex session is active")); return; }
        if (duplex != null)
        {
            duplex.Join(1000);
            if (duplex.Alive) { Out.Emit(Ev("duplex.error", "session", session, "code", "DEVICE_BUSY", "message", "previous audio session is still releasing")); return; }
        }
        long lifetime = Math.Max(1000, Math.Min(1800000, Num(cmd, "maxMs", 1800000)));
        duplexSession = session;
        duplex = new DuplexInput(session, lifetime, cancelled => {
            if (inputKind == null) return (IFrameSource)new AecSource(cancelled);
            IFrameSource source; VoiceDevice info; OpenInput(-1, out source, out info); return source;
        }, inputKind != null, () => speaker != null && speaker.Audible());
        duplex.Start();
    }

    // Device argument: absent or null is the default device (-1). Otherwise it must be an integer in [-1, int.MaxValue];
    // anything else is refused, never truncated or wrapped into a different device.
    internal static bool TryDeviceArg(Dictionary<string, object> d, out int device)
    {
        device = -1;
        object o;
        if (!d.TryGetValue("device", out o) || o == null) return true;
        if (!(o is double)) return false;
        double v = (double)o;
        if (v != Math.Floor(v) || v < -1 || v > int.MaxValue) return false;
        device = (int)v;
        return true;
    }

    static void EmitCancelled(long gen, CancelResult r, double? silent)
    {
        Dictionary<string, object> d = Ev("speak.cancelled", "gen", gen, "wasPlaying", r.WasPlaying, "resetMs", r.ResetMs,
            "meterSilentMs", silent.HasValue ? (object)silent.Value : null, "droppedChunks", r.Dropped, "staleDropped", r.StaleDropped);
        if (r.ResetPending) d["resetPending"] = true;
        Out.Emit(d);
    }

    static void CancelSpeech(Dictionary<string, object> cmd)
    {
        long gen = Num(cmd, "gen", -1);
        if (gen < 0)
        {
            Out.Error("INTERNAL", "invalid speak.cancel");
            return;
        }
        Stopwatch since = Stopwatch.StartNew();
        CancelResult r = speaker.Cancel(gen);
        if (speaker.NullOutput)
        {
            EmitCancelled(gen, r, null);
            return;
        }
        // The receipt is answered by the shared meter worker. When its queue is full the receipt is still sent, unmeasured.
        Action<MeterReading> done = m => EmitCancelled(gen, r, m == null ? (double?)null : m.SilentMs);
        if (!meter.TrySubmit(since, done)) done(null);
    }

    static byte[] LoadWav(string path)
    {
        byte[] b = File.ReadAllBytes(path);
        if (b.Length < 44 || Encoding.ASCII.GetString(b, 0, 4) != "RIFF" || Encoding.ASCII.GetString(b, 8, 4) != "WAVE")
        {
            throw new FormatException("not a RIFF WAVE file");
        }
        int p = 12;
        int tag = 0, channels = 0, rate = 0, bits = 0;
        while (p + 8 <= b.Length)
        {
            string id = Encoding.ASCII.GetString(b, p, 4);
            int size = BitConverter.ToInt32(b, p + 4);
            if (size < 0) throw new FormatException("bad chunk size");
            if (id == "fmt ")
            {
                tag = BitConverter.ToInt16(b, p + 8);
                channels = BitConverter.ToInt16(b, p + 10);
                rate = BitConverter.ToInt32(b, p + 12);
                bits = BitConverter.ToInt16(b, p + 22);
            }
            else if (id == "data")
            {
                if (tag != 1 || rate != Consts.SampleRate || channels != 1 || bits != 16) throw new FormatException("wav must be 16 kHz mono 16-bit PCM");
                int len = Math.Min(size, b.Length - (p + 8));
                byte[] data = new byte[len];
                Buffer.BlockCopy(b, p + 8, data, 0, len);
                return data;
            }
            p += 8 + size + (size & 1);
        }
        throw new FormatException("no data chunk");
    }
}
