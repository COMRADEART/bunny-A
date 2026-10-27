using System;
using System.Threading;
using System.Windows;

namespace BunnyA;

public partial class App : Application
{
    private static Mutex? singleInstanceMutex;

    protected override void OnStartup(StartupEventArgs e)
    {
        const string mutexName = @"Global\BunnyA_Workstation_SingleInstance_Mutex";
        singleInstanceMutex = new Mutex(true, mutexName, out bool createdNew);

        if (!createdNew)
        {
            if (Environment.GetEnvironmentVariable("BUNNY_SILENT_SINGLE_INSTANCE") != "1")
            {
                // In non-silent mode, log warning. Avoid blocking modal dialog in automated harnesses.
                Console.WriteLine("Bunny A is already running on this workstation.");
            }
            Current.Shutdown(0);
            return;
        }

        base.OnStartup(e);
    }

    protected override void OnExit(ExitEventArgs e)
    {
        try
        {
            singleInstanceMutex?.ReleaseMutex();
            singleInstanceMutex?.Dispose();
        }
        catch { }
        base.OnExit(e);
    }
}
