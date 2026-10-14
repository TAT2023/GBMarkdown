param([Parameter(Mandatory=$true)][int]$ReaderProcessId,[Parameter(Mandatory=$true)][ValidateSet('dark','light')][string]$Theme,[string]$Screenshot)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ReaderWindow {
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hwnd, IntPtr hdc, uint flags);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
$readerProcess=Get-Process -Id $ReaderProcessId
[ReaderWindow]::SetProcessDPIAware() | Out-Null
$readerWindow=$readerProcess.MainWindowHandle
if($readerWindow -eq [IntPtr]::Zero){throw 'Reader window not found'}
$darkValue=0
$result=[ReaderWindow]::DwmGetWindowAttribute($readerWindow,20,[ref]$darkValue,4)
if($result -ne 0){$result=[ReaderWindow]::DwmGetWindowAttribute($readerWindow,19,[ref]$darkValue,4)}
if($result -ne 0){throw "Cannot inspect native title bar theme: $result"}
$expectedValue=if($Theme -eq 'dark'){1}else{0}
if($darkValue -ne $expectedValue){throw "Native title bar theme mismatch: expected $expectedValue, got $darkValue"}
if($Screenshot){
    $bounds=New-Object ReaderWindow+Rect
    if(![ReaderWindow]::GetWindowRect($readerWindow,[ref]$bounds)){throw 'Cannot inspect window bounds'}
    $bitmap=New-Object System.Drawing.Bitmap(($bounds.Right-$bounds.Left),($bounds.Bottom-$bounds.Top))
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    $dc=$graphics.GetHdc()
    try{if(![ReaderWindow]::PrintWindow($readerWindow,$dc,2)){throw 'Cannot capture reader window'}}finally{$graphics.ReleaseHdc($dc);$graphics.Dispose()}
    try{$bitmap.Save([System.IO.Path]::GetFullPath($Screenshot),[System.Drawing.Imaging.ImageFormat]::Png)}finally{$bitmap.Dispose()}
}
[pscustomobject]@{Process=$ReaderProcessId;Theme=$Theme;NativeTitleBarDark=$darkValue;Screenshot=$Screenshot} | ConvertTo-Json
