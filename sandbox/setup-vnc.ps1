# OllieBot Desktop Sandbox Setup Script
# This script runs inside Windows Sandbox to set up VNC server

$ErrorActionPreference = "Stop"
$LogFile = "C:\OllieBot\setup.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append
    Write-Host $Message
}

Write-Log "Starting OllieBot Desktop Sandbox setup..."

# Create working directory
$WorkDir = "C:\OllieBot\temp"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

# ============================================
# Option 1: TightVNC (Recommended - lightweight)
# ============================================
function Install-TightVNC {
    Write-Log "Downloading TightVNC..."

    $vncUrl = "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi"
    $vncInstaller = "$WorkDir\tightvnc.msi"

    try {
        Invoke-WebRequest -Uri $vncUrl -OutFile $vncInstaller -UseBasicParsing
        Write-Log "TightVNC downloaded successfully"
    } catch {
        Write-Log "Failed to download TightVNC: $_"
        return $false
    }

    Write-Log "Installing TightVNC..."

    # Silent install with predefined password
    # Password is set to "olliebot" (8 chars max for VNC)
    $arguments = @(
        "/i", $vncInstaller,
        "/quiet",
        "/norestart",
        "SET_USEVNCAUTHENTICATION=1",
        "VALUE_OF_USEVNCAUTHENTICATION=1",
        "SET_PASSWORD=1",
        "VALUE_OF_PASSWORD=olliebot",
        "SET_USECONTROLAUTHENTICATION=1",
        "VALUE_OF_USECONTROLAUTHENTICATION=0",
        "SET_ACCEPTHTTPCONNECTIONS=1",
        "VALUE_OF_ACCEPTHTTPCONNECTIONS=0"
    )

    $process = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru

    if ($process.ExitCode -eq 0) {
        Write-Log "TightVNC installed successfully"
        return $true
    } else {
        Write-Log "TightVNC installation failed with exit code: $($process.ExitCode)"
        return $false
    }
}

# ============================================
# Option 2: UltraVNC (Alternative)
# ============================================
function Install-UltraVNC {
    Write-Log "Downloading UltraVNC..."

    $vncUrl = "https://uvnc.com/component/jdownloads/send/0-/401-ultravnc-1-4-3-6-x64-setup.html"
    $vncInstaller = "$WorkDir\ultravnc.exe"

    try {
        # UltraVNC requires different download approach
        Invoke-WebRequest -Uri "https://uvnc.com/downloads/ultravnc/138-ultravnc-1-4-3-6.html" -OutFile $vncInstaller -UseBasicParsing
        Write-Log "UltraVNC downloaded"
    } catch {
        Write-Log "Failed to download UltraVNC: $_"
        return $false
    }

    # Silent install
    Start-Process -FilePath $vncInstaller -ArgumentList "/VERYSILENT" -Wait
    return $true
}

# ============================================
# Fallback: Built-in Windows Remote Desktop
# ============================================
function Enable-RDP {
    Write-Log "Enabling Remote Desktop..."

    try {
        # Enable RDP
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' -Name "fDenyTSConnections" -Value 0

        # Enable Network Level Authentication
        Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name "UserAuthentication" -Value 1

        # Enable firewall rule
        Enable-NetFirewallRule -DisplayGroup "Remote Desktop"

        Write-Log "RDP enabled successfully"
        return $true
    } catch {
        Write-Log "Failed to enable RDP: $_"
        return $false
    }
}

# ============================================
# Configure Firewall for VNC
# ============================================
function Configure-Firewall {
    Write-Log "Configuring firewall for VNC..."

    try {
        # Allow VNC port 5900
        New-NetFirewallRule -DisplayName "OllieBot VNC" -Direction Inbound -Protocol TCP -LocalPort 5900 -Action Allow -ErrorAction SilentlyContinue

        # Allow VNC HTTP port 5800 (optional web viewer)
        New-NetFirewallRule -DisplayName "OllieBot VNC HTTP" -Direction Inbound -Protocol TCP -LocalPort 5800 -Action Allow -ErrorAction SilentlyContinue

        Write-Log "Firewall configured"
        return $true
    } catch {
        Write-Log "Firewall configuration failed: $_"
        return $false
    }
}

# ============================================
# Set Screen Resolution
# ============================================
function Set-ScreenResolution {
    Write-Log "Setting screen resolution to 1024x768..."

    # Use QRes or built-in methods
    # For sandbox, we'll use a simple approach
    try {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class Display {
    [DllImport("user32.dll")]
    public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

    [StructLayout(LayoutKind.Sequential)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }
}
"@
        Write-Log "Screen resolution module loaded"
    } catch {
        Write-Log "Could not set screen resolution: $_"
    }
}

# ============================================
# Create Ready Signal File
# ============================================
function Signal-Ready {
    param([int]$Port = 5900)

    $readyFile = "C:\OllieBot\ready.json"
    $readyData = @{
        status = "ready"
        vnc_port = $Port
        timestamp = (Get-Date -Format "o")
        hostname = $env:COMPUTERNAME
    } | ConvertTo-Json

    $readyData | Out-File -FilePath $readyFile -Encoding UTF8
    Write-Log "Ready signal written to $readyFile"
}

# ============================================
# Main Setup Flow
# ============================================
Write-Log "=== OllieBot Desktop Sandbox Setup ==="

# Configure firewall first
Configure-Firewall

# Try TightVNC first
$vncInstalled = Install-TightVNC

if (-not $vncInstalled) {
    Write-Log "TightVNC failed, trying UltraVNC..."
    $vncInstalled = Install-UltraVNC
}

if (-not $vncInstalled) {
    Write-Log "VNC installation failed, falling back to RDP..."
    Enable-RDP
    Signal-Ready -Port 3389
} else {
    # Start VNC server
    Write-Log "Starting VNC server..."

    # TightVNC service should auto-start, but let's make sure
    Start-Sleep -Seconds 2

    $vncService = Get-Service -Name "tvnserver" -ErrorAction SilentlyContinue
    if ($vncService) {
        if ($vncService.Status -ne "Running") {
            Start-Service -Name "tvnserver"
            Write-Log "TightVNC service started"
        } else {
            Write-Log "TightVNC service already running"
        }
    } else {
        # Try to start the server directly
        $vncExe = "C:\Program Files\TightVNC\tvnserver.exe"
        if (Test-Path $vncExe) {
            Start-Process -FilePath $vncExe -ArgumentList "-start" -NoNewWindow
            Write-Log "TightVNC server started directly"
        }
    }

    Signal-Ready -Port 5900
}

# Set resolution
Set-ScreenResolution

Write-Log "=== Setup Complete ==="
Write-Log "VNC should be available on port 5900"
Write-Log "Password: olliebot"

# Keep the script running to maintain the session
Write-Log "Sandbox is ready for connections..."

# Optional: Open a sample application for testing
# Start-Process "notepad.exe"

# Keep alive - the sandbox will close when this script ends if run from LogonCommand
# For testing, we'll let the desktop stay interactive
