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
    public static readonly Stopwatch Clock = Stopwatch.StartNew();

    public static void Open() { stream = Console.OpenStandardOutput(); }

    // Test-only seam (selftest): swaps the protocol stream and returns the previous one, so a closed-pipe write can be
    // simulated in-process without killing the test runner.
    internal static Stream SwapStreamForTest(Stream s)
    {
        Stream previous = stream;
        stream = s;
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
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
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
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid iid, int clsctx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId(out IntPtr id);
    int GetState(out int state);
}

[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IPropertyStore
{
    int GetCount(out uint count);
    int GetAt(uint index, out PropKey key);
    int GetValue(ref PropKey key, IntPtr value);
    int SetValue(ref PropKey key, IntPtr value);
    int Commit();
}

// Slot order must match the COM vtable exactly; only GetMute and GetMasterVolumeLevelScalar are called.
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioEndpointVolume
{
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float level, IntPtr ctx);
    int SetMasterVolumeLevelScalar(float level, IntPtr ctx);
    int GetMasterVolumeLevel(out float level);
    int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float level, IntPtr ctx);
    int SetChannelVolumeLevelScalar(uint channel, float level, IntPtr ctx);
    int GetChannelVolumeLevel(uint channel, out float level);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioMeterInformation
{
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

    // Peak meter of the default render endpoint. Includes other applications' audio.
    public static double? PollRenderSilence(Stopwatch since)
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
            while (since.ElapsedMilliseconds <= 1000)
            {
                float peak;
                if (meter.GetPeakValue(out peak) != 0) return null;
                if (peak < 0.001f) return since.Elapsed.TotalMilliseconds;
                Thread.Sleep(5);
            }
            return null;
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
        WaveFormatEx fmt = Native.Format();
        IntPtr h;
        uint r = Native.waveOutOpen(out h, device, ref fmt, IntPtr.Zero, IntPtr.Zero, 0);
        if (r != 0)
        {
            string code = r == Native.MMSYSERR_ALLOCATED ? "DEVICE_BUSY" : (r == Native.WAVERR_BADFORMAT ? "FORMAT_UNSUPPORTED" : "DEVICE_UNAVAILABLE");
            throw new VoiceFault(code, "waveOutOpen failed: " + Native.MmErrorName(r));
        }
        return new WaveOut(h, device);
    }

    public void Submit(Chunk c)
    {
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
    public const int None = 0, SpeechStart = 1, SpeechEnd = 2, NoSpeech = 3, NoiseOnly = 4;
    public const int OnsetMs = 120, SilenceEndMs = 900, HypothesisHoldMs = 700, NoSpeechMs = 8000, EvidenceMs = 1500;
    public const double MinThreshold = 0.0006;
    // Live finding (Part B, whisper mode): room noise that rose after the 400 ms calibration stayed above floor*3 between
    // words, so no end of speech was ever seen and turns ran to the 30 s cap. Inside speech, a frame is also silent when it
    // is below EndPeakFraction of the utterance's smoothed speech peak. R4: the cap is 0.002, so soft speech (>= 0.002)
    // after a loud section or a click is never counted as silence, and the peak decays (~7 s half-life) so one loud moment
    // does not set the threshold for the rest of a long turn. Limit (disclosed): a speaker whose peak is less than ~12x the
    // room noise still never reaches an energy end; the turn then ends on release, a second tap, or the 30 s cap.
    public const double EndPeakFraction = 0.08, EndPeakCap = 0.002, PeakDecay = 0.998;
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

    public bool InSpeech { get { return inSpeech; } }
    public bool SawOnset { get { return onset; } }
    public int SpeechMs { get { return speechMs; } }
    public bool HighEnergy { get { return totalMs > 0 && highMs * 2 >= totalMs; } }
    public double Threshold { get { return Math.Max(floor * 3.0, MinThreshold); } }

    // msSinceEvidence: milliseconds since the recognizer last hypothesized or detected speech (int.MaxValue if never).
    public int Feed(double rms, int msSinceEvidence)
    {
        frames++;
        totalMs = frames * Consts.FrameMs;
        if (!onset && rms >= 0.02) highMs += Consts.FrameMs;
        if (frames <= CalibrationFrames)
        {
            // Calibration over the first 400 ms: no onset allowed. The floor is the quietest frame seen.
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
                    smooth = rms;
                    speechPeak = rms;
                    return SpeechStart;
                }
            }
            else
            {
                aboveMs = 0;
                floor = floor * 0.95 + rms * 0.05;
            }
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
        if (rms > endThreshold) silenceMs = 0;
        else silenceMs += Consts.FrameMs;
        if (silenceMs >= SilenceEndMs && msSinceEvidence >= HypothesisHoldMs)
        {
            inSpeech = false;
            aboveMs = 0;
            if (speechMs >= 250) return SpeechEnd;
        }
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

    public void Finish(string reason)
    {
        lock (gate)
        {
            if (closed)
            {
                if (whisper != null && (reason == "abort" || reason == "mute" || reason == "shutdown")) abortRequested = true;
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
        Vad vad = new Vad();
        Agc agc = new Agc();
        bool first = true;
        long bytes = 0;
        double windowSq = 0;
        double windowPeak = 0;
        int windowFrames = 0;
        try
        {
            while (!StopFlag)
            {
                int st = source.Read(frame);
                if (st == 0) { Thread.Sleep(2); continue; }
                if (st < 0)
                {
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
                    Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_start"));
                }
                else if (ev == Vad.SpeechEnd)
                {
                    Out.Emit(Out.Ev("vad", "turn", Turn, "gen", Gen, "state", "speech_end"));
                    if (VadEndpoint) Finish("vad");
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
                    Out.Emit(Out.Ev("level", "turn", Turn, "gen", Gen, "rms", rmsWindow, "peak", windowPeak, "speech", vad.InSpeech));
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
                if (Program.Active == this) Program.Active = null;
                if (whisper != null) Program.Finalizing = this;
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
        long speechMs;
        lock (gate)
        {
            onset = sawOnset;
            high = highEnergy;
            speechMs = speechMsPub;
            stopped = aborted || abortRequested;
        }
        WhisperResult r = null;
        try
        {
            if (!stopped && onset && n > 0 && pcm != null) r = whisper.Transcribe(pcm, n);
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
        Guard.Run(FinalizeBody, FaultFinalize);
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
        bool done = false;
        try
        {
            if (!aborted)
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
            string decision = StopDecision.Terminal(aborted, sawOnset, highEnergy, texts.Count, rejectedSeen, timedOut);
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
                Out.Emit(Out.Ev("playback.error", "turn", turn, "gen", gen, "code", "BUFFER_LIMIT", "message", "chunk exceeds 400 characters"));
                return;
            }
            if (turn == lastTurn && seq <= lastSeq)
            {
                Out.Emit(Out.Ev("playback.error", "turn", turn, "gen", gen, "code", "INTERNAL", "message", "seq is not strictly increasing"));
                return;
            }
            if (queue.Count >= MaxQueued)
            {
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
        lock (gate)
        {
            resetDone = want;
            Monitor.PulseAll(gate);
        }
    }

    // Playback thread only (or Shutdown after that thread exited). Never called with gate held.
    void CloseDevice()
    {
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
        while (sw.Elapsed.TotalMilliseconds < durationMs)
        {
            if (c.Cancelled) return false;
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
        bool timedOut = false;
        while (!DeviceDone(c))
        {
            if (sw.ElapsedMilliseconds > c.AudioMs * 2 + 3000)
            {
                timedOut = true;
                break;
            }
            ApplyPendingReset();
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
            if (c != null) c.Cancelled = true;
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
internal sealed class CancelMeter
{
    public const int MaxPending = 4;
    readonly object gate = new object();
    readonly Queue<MeterJob> pending = new Queue<MeterJob>();
    readonly Func<Stopwatch, double?> poll;
    Thread worker;
    int threadsStarted;

    public CancelMeter(Func<Stopwatch, double?> poll)
    {
        this.poll = poll;
    }

    public int ThreadsStarted
    {
        get { lock (gate) { return threadsStarted; } }
    }

    // False when the queue is full. The caller then reports the receipt without a meter reading.
    public bool TrySubmit(Stopwatch since, Action<double?> done)
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
            double? silent = null;
            try { silent = poll(job.Since); }
            catch (Exception) { silent = null; }
            Guard.Run(() => job.Done(silent), e => { });
        }
    }

    sealed class MeterJob
    {
        public Stopwatch Since;
        public Action<double?> Done;
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
        public void Close() { }
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
        CancelMeter meter = new CancelMeter(sw => { polling.Set(); release.WaitOne(3000); return 5.0; });
        int delivered = 0;
        int accepted = 0;
        object tally = new object();
        Action<double?> done = v => { lock (tally) { delivered++; } };
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

    public static int Run()
    {
        Dictionary<string, object> r = new Dictionary<string, object>();

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

        // Containment: a failed recognizer start, a capture body whose protocol write fails, a timed-out chunk, and the
        // wipe of unmanaged audio. Each runs against fakes or a broken stream; no device or recognizer audio is used.
        ContainmentCheck(r);

        Out.Emit(Out.Ev("selftest", "results", r));
        return 0;
    }
}

internal static class Program
{
    public static readonly object Gate = new object();
    public static CaptureTurn Active;
    // The whisper turn whose final decode is still running. capture.abort reaches it after its capture has ended.
    public static CaptureTurn Finalizing;
    public static bool Muted;
    static Speaker speaker;
    static readonly CancelMeter meter = new CancelMeter(since => Endpoints.PollRenderSilence(since));
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

    static Dictionary<string, object> Ev(string name, params object[] kv) { return Out.Ev(name, kv); }

    public static int Main(string[] args)
    {
        Out.Open();
        for (int i = 0; i < args.Length; i++)
        {
            string a = args[i];
            if (a == "--input-synth" && i + 1 < args.Length) { inputKind = "synth"; synthText = args[++i]; }
            else if (a == "--selftest") return SelfTest.Run();
            else if (a == "--input-silence") inputKind = "silence";
            else if (a == "--input-noise") inputKind = "noise";
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
        speaker.Start();

        Out.Emit(Ev("ready",
            "protocol", "bunny-voice/1",
            "pid", Process.GetCurrentProcess().Id,
            "stt", SttReady(),
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
        CaptureTurn t;
        lock (Gate) { t = Active; }
        if (t != null)
        {
            t.Finish("shutdown");
            t.Join(1500);
        }
        speaker.Shutdown();
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
                        CaptureTurn t;
                        lock (Gate) { t = Active ?? Finalizing; }
                        if (t != null && Num(cmd, "gen", -1) >= t.Gen) t.Finish("abort");
                        return true;
                    }
                case "speak": Speak(cmd); return true;
                case "speak.cancel": CancelSpeech(cmd); return true;
                case "mute":
                    {
                        bool on = Bool(cmd, "on");
                        lock (Gate)
                        {
                            Muted = on;
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
            if (speaker.IsBusy()) { CaptureError(turn, gen, "BUSY_PLAYBACK", "speech playback is active; cancel it before listening"); return; }
            if (!AbandonLedger.HasRoom()) { CaptureError(turn, gen, "STT_UNAVAILABLE", "speech recognizer is still busy with an abandoned turn"); return; }

            IFrameSource source;
            VoiceDevice info;
            try
            {
                OpenInput(device, out source, out info);
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
            Out.Emit(Ev("playback.error", "turn", turn, "gen", gen < 0 ? (object)null : (object)gen, "code", "INTERNAL", "message", "invalid speak"));
            return;
        }
        if (!deviceOk)
        {
            Out.Emit(Ev("playback.error", "turn", turn, "gen", gen, "code", "DEVICE_UNAVAILABLE", "message", "device index is outside the valid range"));
            return;
        }
        speaker.Enqueue(turn, gen, seq, text, device < 0 ? Native.WAVE_MAPPER : (uint)device, voice);
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
        Action<double?> done = silent => EmitCancelled(gen, r, silent);
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
