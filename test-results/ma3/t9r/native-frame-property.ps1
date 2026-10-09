param([string]$OutputPath)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential)] public struct T9RPropertyKey {public Guid format;public uint id;}
[StructLayout(LayoutKind.Explicit)] public struct T9RPropertyVariant {[FieldOffset(0)]public ushort type;[FieldOffset(8)]public IntPtr value;[FieldOffset(16)]public IntPtr extra;}
[ComImport,Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface T9RPropertyStore {
 [PreserveSig]int GetCount(out uint count);[PreserveSig]int GetAt(uint index,out T9RPropertyKey key);[PreserveSig]int GetValue(ref T9RPropertyKey key,out T9RPropertyVariant value);[PreserveSig]int SetValue(ref T9RPropertyKey key,ref T9RPropertyVariant value);[PreserveSig]int Commit();
}
public class T9RFrameProperty {
 [DllImport("shell32.dll")]static extern int SHGetPropertyStoreForWindow(IntPtr window,ref Guid iid,out T9RPropertyStore store);
 [DllImport("ole32.dll")]static extern int PropVariantClear(ref T9RPropertyVariant value);
 public static string AppId(IntPtr window){var iid=new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");T9RPropertyStore store;Marshal.ThrowExceptionForHR(SHGetPropertyStoreForWindow(window,ref iid,out store));try{var key=new T9RPropertyKey{format=new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"),id=5};T9RPropertyVariant value;Marshal.ThrowExceptionForHR(store.GetValue(ref key,out value));try{return value.type==31?Marshal.PtrToStringUni(value.value):null;}finally{PropVariantClear(ref value);}}finally{Marshal.ReleaseComObject(store);}}
}
'@
$roots=[System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children,[System.Windows.Automation.Condition]::TrueCondition)
$rows=@();foreach($root in $roots){if($root.Current.Name -eq 'Calculator'){$rows += [ordered]@{handle=[string]$root.Current.NativeWindowHandle;processId=$root.Current.ProcessId;className=$root.Current.ClassName;appUserModelId=[T9RFrameProperty]::AppId([IntPtr]$root.Current.NativeWindowHandle)}}}
$rows | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Output 'Read-only native Calculator AppUserModelID captured.'
