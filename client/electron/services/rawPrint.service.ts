import { execFile } from 'child_process'

// Sends raw bytes straight to a Windows print queue (winspool, "RAW" data
// type), bypassing the driver's rendering. That's the only way to reach the
// printer's ESC/POS command set — e.g. the cash-drawer pulse — when it's set
// up as a Windows-installed printer rather than a USB/network ESC/POS device.
// Done through PowerShell + P/Invoke so it needs no native Node module.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class BarakaRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFO { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr h, int level, [In] DOCINFO di);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static void Send(string printer, byte[] data) {
    IntPtr h;
    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("OpenPrinter failed: " + Marshal.GetLastWin32Error());
    try {
      var di = new DOCINFO { pDocName = "BarakaPOS raw", pDataType = "RAW" };
      if (StartDocPrinter(h, 1, di) == 0) throw new Exception("StartDocPrinter failed: " + Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(h);
        int w;
        if (!WritePrinter(h, data, data.Length, out w)) throw new Exception("WritePrinter failed: " + Marshal.GetLastWin32Error());
        EndPagePrinter(h);
      } finally { EndDocPrinter(h); }
    } finally { ClosePrinter(h); }
  }
}
"@
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:BARAKA_RAW_PRINTER))
$data = $env:BARAKA_RAW_DATA
if ($env:BARAKA_RAW_DATA_TSPL) {
  # TSC/Seagull label drivers mean the printer runs in label (TSPL) mode,
  # where ESC/POS bytes are silently ignored.
  $drv = Get-PrinterDriver -Name (Get-Printer -Name $name).DriverName
  if ("$($drv.ConfigFile) $($drv.DataFile)" -match 'Seagull|tsc') { $data = $env:BARAKA_RAW_DATA_TSPL }
}
[BarakaRawPrint]::Send($name, [Convert]::FromBase64String($data))
`

/** `tspl` is sent instead of `data` when the queue uses a TSC/Seagull label driver. */
export function sendRawToWindowsPrinter(printerName: string, data: Buffer, tspl?: Buffer): Promise<void> {
  if (process.platform !== 'win32') return Promise.reject(new Error('Raw printing is Windows-only'))
  // Printer name and bytes go in via env vars (base64), never spliced into
  // the script, so no name can break out of the PowerShell source.
  const env = {
    ...process.env,
    BARAKA_RAW_PRINTER: Buffer.from(printerName, 'utf8').toString('base64'),
    BARAKA_RAW_DATA: data.toString('base64'),
    BARAKA_RAW_DATA_TSPL: tspl ? tspl.toString('base64') : '',
  }
  const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64')
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env, windowsHide: true, timeout: 15000 },
      (err, _stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message))
        else resolve()
      }
    )
  })
}

// ESC p m t1 t2 — pulse both drawer connector pins (2 and 5), since which one
// the drawer is wired to varies by cable.
export const CASH_DRAWER_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa])

// The same pulse in TSPL, for label-mode printers (confirmed on the till's
// Xprinter XP-365B with its TSC/Seagull driver).
export const CASH_DRAWER_PULSE_TSPL = Buffer.from('CASHDRAWER 0,25,250\r\nCASHDRAWER 1,25,250\r\n', 'ascii')
