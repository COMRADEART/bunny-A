using System;
using System.Collections.Generic;
using System.IO;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Security.Cryptography;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Reflection;
using System.Diagnostics;
using System.Windows.Threading;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

[assembly: AssemblyTitle("Bunny-A")]
[assembly: AssemblyProduct("Bunny-A")]
[assembly: AssemblyVersion("17.0.0.0")]
[assembly: AssemblyFileVersion("17.0.0.0")]

// Per-user native Windows entry. The independently pinned release launcher owns
// Host identity, all state paths, startup and the existing native WPF interface.
// There is one invocation, no process supervisor or executable-name termination.
internal static class BunnyWindowsApplication
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInformation
    {
        public uint Attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle file, out FileInformation information);

    private static void WriteInstalledEvidence(string path, string value, bool append, long limit)
    {
        string parent = Path.GetDirectoryName(Path.GetFullPath(path));
        for (string folder = parent; folder != null; folder = Path.GetDirectoryName(folder))
        {
            if (Directory.Exists(Path.Combine(folder, ".git")) || File.Exists(Path.Combine(folder, ".git")))
                throw new InvalidOperationException("Installed evidence cannot use a Git checkout.");
            if (Directory.Exists(folder) && (File.GetAttributes(folder) & FileAttributes.ReparsePoint) != 0)
                throw new InvalidOperationException("Installed evidence cannot use a directory link.");
        }
        Directory.CreateDirectory(parent);
        if (File.Exists(path) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
            throw new InvalidOperationException("Installed evidence cannot use a file link.");
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        if (bytes.Length > limit) return;
        using (var stream = new FileStream(path, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            FileInformation information;
            if (!GetFileInformationByHandle(stream.SafeFileHandle, out information) || information.Links != 1)
                throw new InvalidOperationException("Installed evidence cannot use a hard link.");
            if (append && stream.Length + bytes.Length > limit) return;
            if (append) stream.Seek(0, SeekOrigin.End); else stream.SetLength(0);
            stream.Write(bytes, 0, bytes.Length);
        }
    }

    [STAThread]
    private static int Main()
    {
        string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Bunny-A");
        try
        {
            if (!String.Equals(Path.GetFullPath(Path.GetDirectoryName(Application.ExecutablePath)), Path.GetFullPath(root), StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The native entry must run from the installed application directory.");
            string configPath = Path.Combine(root, "install.json");
            var json = new JavaScriptSerializer();
            json.MaxJsonLength = 1024 * 1024;
            var config = json.Deserialize<Dictionary<string, object>>(File.ReadAllText(configPath));
            var release = (Dictionary<string, object>)config["currentRelease"];
            string folder = Path.GetFullPath((string)release["folder"]);
            string releasesRoot = Path.GetFullPath(Path.Combine(root, "releases")) + Path.DirectorySeparatorChar;
            if (!folder.StartsWith(releasesRoot, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("The pinned release is outside the installed releases directory.");
            string manifest = Path.Combine(folder, "release-manifest.json");
            string expected = (string)release["manifestSha256"];
            using (var hash = SHA256.Create())
            {
                string actual = BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(manifest))).Replace("-", "").ToLowerInvariant();
                if (!String.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("The installed release manifest changed. Startup was refused.");
            }
            Environment.SetEnvironmentVariable("PSModulePath", Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "Modules"));
            Environment.SetEnvironmentVariable("DATABASE_URL", null);
            var initial = InitialSessionState.CreateDefault();
            initial.ExecutionPolicy = Microsoft.PowerShell.ExecutionPolicy.Bypass;
            using (var runspace = RunspaceFactory.CreateRunspace(initial))
            {
                runspace.ApartmentState = ApartmentState.STA;
                runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
                runspace.Open();
                Runspace.DefaultRunspace = runspace;
                using (var shell = PowerShell.Create())
                {
                    shell.Runspace = runspace;
                    // This is the application's own WPF readiness signal. A
                    // tool window intentionally has no taskbar MainWindowHandle.
                    var readyTimer = new DispatcherTimer();
                    readyTimer.Interval = TimeSpan.FromMilliseconds(500);
                    int readyAttempts = 0;
                    readyTimer.Tick += delegate
                    {
                        try
                        {
                            if (++readyAttempts > 60) { readyTimer.Stop(); return; }
                            foreach (System.Windows.PresentationSource source in System.Windows.PresentationSource.CurrentSources)
                            {
                                if (source.RootVisual == null) continue;
                                var window = System.Windows.Window.GetWindow(source.RootVisual);
                                if (window == null || window.Title != "Bunny Island" || !window.IsVisible || !window.IsLoaded) continue;
                                var status = new Dictionary<string, object>();
                                status["schema"] = "bunny-windows-application/1";
                                status["at"] = DateTime.UtcNow.ToString("o");
                                status["pid"] = Process.GetCurrentProcess().Id;
                                status["sourceCommit"] = release["sourceCommit"];
                                status["manifestSha256"] = expected;
                                status["title"] = window.Title;
                                status["visible"] = window.IsVisible;
                                status["loaded"] = window.IsLoaded;
                                status["width"] = window.ActualWidth;
                                status["height"] = window.ActualHeight;
                                string runtime = Path.Combine(root, "state", "runtime");
                                string statusFile = Path.Combine(runtime, "windows-application.json");
                                WriteInstalledEvidence(statusFile, json.Serialize(status), false, 4096);
                                readyTimer.Stop();
                                break;
                            }
                        }
                        catch { readyTimer.Stop(); }
                    };
                    readyTimer.Start();
                    shell.AddCommand(Path.Combine(folder, "Start-Bunny-Release.ps1"));
                    shell.AddParameter("InstallConfig", configPath);
                    shell.AddParameter("NoRemote", true);
                    shell.Invoke();
                    readyTimer.Stop();
                    if (shell.HadErrors)
                        throw new InvalidOperationException("The pinned Bunny-A launcher failed. Inspect the installed launch log.");
                }
            }
            return 0;
        }
        catch (Exception error)
        {
            // Persist the error type only. PowerShell exceptions can contain
            // credentials or private payloads, so neither their text nor stacks
            // belong in bootstrap evidence or a dialog.
            try
            {
                string logs = Path.Combine(root, "state", "logs");
                string file = Path.Combine(logs, "windows-application.jsonl");
                WriteInstalledEvidence(file, "{\"at\":\"" + DateTime.UtcNow.ToString("o") + "\",\"type\":\"windows.application_failed\",\"errorType\":\"" + error.GetType().Name + "\"}\n", true, 65536);
            }
            catch { }
            MessageBox.Show("Bunny-A could not start its pinned Windows application. The installed state was kept. Inspect the installed launch log.", "Bunny-A", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
