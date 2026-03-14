# OllieBot Desktop Sandbox Setup Script
# This script runs inside Windows Sandbox to set up VNC server

$ErrorActionPreference = "Stop"

# Paths: mapped folder (shared with host) vs local sandbox temp (for downloads/installs)
$OllieBotDir = "C:\Users\WDAGUtilityAccount\Desktop\OllieBot"
$LogFile = "$OllieBotDir\setup.log"
$WorkDir = "C:\Temp\olliebot-setup"
New-Item -ItemType Directory -Force -Path $WorkDir | Out-Null

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$timestamp - $Message" | Out-File -FilePath $LogFile -Append
    Write-Host $Message
}

Write-Log "Starting OllieBot Desktop Sandbox setup..."

# ============================================
# Configure Firewall for VNC
# ============================================
function Configure-Firewall {
    Write-Log "Configuring firewall for VNC..."

    try {
        # Allow VNC port 5900
        New-NetFirewallRule -DisplayName "OllieBot VNC" -Direction Inbound -Protocol TCP -LocalPort 5900 -Action Allow -ErrorAction SilentlyContinue | Out-Null

        # Allow VNC HTTP port 5800 (optional web viewer)
        New-NetFirewallRule -DisplayName "OllieBot VNC HTTP" -Direction Inbound -Protocol TCP -LocalPort 5800 -Action Allow -ErrorAction SilentlyContinue | Out-Null

        Write-Log "Firewall configured"
        return $true
    } catch {
        Write-Log "Firewall configuration failed: $_"
        return $false
    }
}

# ============================================
# Option 1: TightVNC (Recommended - lightweight)
# ============================================
function Install-TightVNC {
    Write-Log "Downloading TightVNC..."

    $vncUrl = "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi"
    $vncInstaller = "$WorkDir\tightvnc.msi"

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $vncUrl -OutFile $vncInstaller -UseBasicParsing
        Write-Log "TightVNC downloaded successfully"
    } catch {
        Write-Log "Failed to download TightVNC via Invoke-WebRequest: $_"

        # Fallback: WebClient (different locking behavior)
        try {
            $webClient = New-Object System.Net.WebClient
            $webClient.DownloadFile($vncUrl, $vncInstaller)
            Write-Log "TightVNC downloaded via WebClient"
        } catch {
            Write-Log "All download methods failed: $_"
            return $false
        }
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

        # Copy password settings from HKLM (service mode) to HKCU (application mode).
        # The MSI only configures HKLM, but application mode reads from HKCU.
        Write-Log "Copying VNC settings from HKLM to HKCU for application mode..."
        try {
            $hklmPath = "HKLM:\SOFTWARE\TightVNC\Server"
            $hkcuPath = "HKCU:\SOFTWARE\TightVNC\Server"

            # Create HKCU key if it doesn't exist
            if (-not (Test-Path $hkcuPath)) {
                New-Item -Path $hkcuPath -Force | Out-Null
                Write-Log "Created HKCU TightVNC Server key"
            }

            # Copy all values from HKLM to HKCU
            $hklmKey = Get-Item -Path $hklmPath -ErrorAction SilentlyContinue
            if ($hklmKey) {
                foreach ($valueName in $hklmKey.GetValueNames()) {
                    $value = Get-ItemProperty -Path $hklmPath -Name $valueName -ErrorAction SilentlyContinue
                    $valueData = $value.$valueName
                    $valueKind = $hklmKey.GetValueKind($valueName)
                    Set-ItemProperty -Path $hkcuPath -Name $valueName -Value $valueData -Type $valueKind -ErrorAction SilentlyContinue
                }
                Write-Log "Copied TightVNC settings to HKCU"

                # Verify password was copied
                $pwCheck = Get-ItemProperty -Path $hkcuPath -Name "Password" -ErrorAction SilentlyContinue
                if ($pwCheck -and $pwCheck.Password) {
                    Write-Log "Password setting verified in HKCU (length: $($pwCheck.Password.Length) bytes)"
                } else {
                    Write-Log "WARNING: Password not found in HKCU after copy"
                }

                # Configure additional settings for proper desktop capture in Windows Sandbox
                # Try DISABLING Desktop Duplication - it may not work in sandbox's virtual GPU
                # UseDesktopDuplication=0 forces fallback to older GDI capture method
                Set-ItemProperty -Path $hkcuPath -Name "UseDesktopDuplication" -Value 0 -Type DWord -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $hkcuPath -Name "GrabTransparentWindows" -Value 1 -Type DWord -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $hkcuPath -Name "RemoveWallpaper" -Value 0 -Type DWord -ErrorAction SilentlyContinue
                # Disable hardware cursor (can cause capture issues)
                Set-ItemProperty -Path $hkcuPath -Name "UseHardwareCursor" -Value 0 -Type DWord -ErrorAction SilentlyContinue
                # Poll the display more frequently
                Set-ItemProperty -Path $hkcuPath -Name "PollingInterval" -Value 30 -Type DWord -ErrorAction SilentlyContinue
                # CRITICAL: Disable compression encodings - use Raw encoding only
                # rfb2 library doesn't support Tight/ZRLE encodings, only Raw/CopyRect/Hextile
                # Setting JpegCompressionLevel and CompressionLevel to max disables compression
                Set-ItemProperty -Path $hkcuPath -Name "JpegCompressionLevel" -Value -1 -Type DWord -ErrorAction SilentlyContinue
                Set-ItemProperty -Path $hkcuPath -Name "CompressionLevel" -Value -1 -Type DWord -ErrorAction SilentlyContinue
                Write-Log "Configured GDI capture mode and disabled compression in HKCU"
            } else {
                Write-Log "WARNING: HKLM TightVNC key not found"
            }
        } catch {
            Write-Log "ERROR copying settings to HKCU: $_"
        }

        return $true
    } else {
        Write-Log "TightVNC installation failed with exit code: $($process.ExitCode)"
        return $false
    }
}

# ============================================
# Create Ready Signal File (with sandbox IP for host connection)
# ============================================
function Signal-Ready {
    param([int]$Port = 5900)

    # Discover the sandbox's IP address on the Hyper-V virtual network.
    # Windows Sandbox runs behind a NAT; the host cannot reach it via localhost.
    # The sandbox typically gets a 172.x.x.x address on the Default Switch.
    $sandboxIP = $null
    try {
        $candidates = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" }
        if ($candidates) {
            # Prefer 172.x.x.x (Hyper-V Default Switch range)
            $preferred = $candidates | Where-Object { $_.IPAddress -like "172.*" } | Select-Object -First 1
            if ($preferred) {
                $sandboxIP = $preferred.IPAddress
            } else {
                $sandboxIP = ($candidates | Select-Object -First 1).IPAddress
            }
        }
        Write-Log "Sandbox IP address: $sandboxIP"
    } catch {
        Write-Log "Failed to detect sandbox IP: $_"
    }

    $readyFile = "$OllieBotDir\ready.json"
    $readyData = @{
        status = "ready"
        vnc_port = $Port
        ip = $sandboxIP
        timestamp = (Get-Date -Format "o")
        hostname = $env:COMPUTERNAME
    } | ConvertTo-Json

    $readyData | Out-File -FilePath $readyFile -Encoding UTF8
    Write-Log "Ready signal written to $readyFile"

    # Also write a separate connection.json for the host to discover quickly
    $connFile = "$OllieBotDir\connection.json"
    @{ ip = $sandboxIP; port = $Port } | ConvertTo-Json | Out-File -FilePath $connFile -Encoding UTF8
    Write-Log "Connection info written to $connFile (ip=$sandboxIP, port=$Port)"
}

# ============================================
# Main Setup Flow
# ============================================
Write-Log "=== OllieBot Desktop Sandbox Setup ==="
Write-Log "WorkDir (local): $WorkDir"
Write-Log "OllieBotDir (mapped): $OllieBotDir"

# Configure firewall first
Configure-Firewall

# Try TightVNC
$vncInstalled = Install-TightVNC

if (-not $vncInstalled) {
    Write-Log "FATAL: VNC installation failed. Cannot proceed without VNC."
    Signal-Ready -Port 0
} else {
    # Start VNC server in APPLICATION MODE (not service mode).
    # Service mode fails in Windows Sandbox because the service runs as SYSTEM
    # but there's no interactive console session (-1), so it can't capture the desktop.
    # Application mode runs as the current user and can access the desktop directly.
    Write-Log "Starting VNC server in application mode..."

    # Stop the service if it's running (it was auto-started by MSI install)
    $vncService = Get-Service -Name "tvnserver" -ErrorAction SilentlyContinue
    if ($vncService -and $vncService.Status -eq "Running") {
        Write-Log "Stopping TightVNC service (will use application mode instead)..."
        Stop-Service -Name "tvnserver" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
    }

    # IMPORTANT: Force the desktop to fully render before starting VNC.
    # Windows Sandbox may not have a fully initialized desktop session yet.
    # Opening an application forces the compositor to render the desktop.
    Write-Log "Opening Explorer to force desktop rendering..."
    Start-Process "explorer.exe" -ArgumentList "shell:Desktop"
    Start-Sleep -Seconds 3

    # Start TightVNC in application mode (-run flag runs as current user)
    $vncExe = "C:\Program Files\TightVNC\tvnserver.exe"
    if (Test-Path $vncExe) {
        Write-Log "Launching: $vncExe -run"
        Start-Process -FilePath $vncExe -ArgumentList "-run" -WindowStyle Hidden
        Write-Log "TightVNC started in application mode"

        # Wait for TightVNC to initialize and hook into the desktop
        Write-Log "Waiting for TightVNC to initialize desktop capture..."
        Start-Sleep -Seconds 5
    } else {
        Write-Log "ERROR: TightVNC executable not found at $vncExe"
    }

    Signal-Ready -Port 5900
}

Write-Log "=== Setup Complete ==="
Write-Log "VNC should be available on port 5900"
Write-Log "Password: olliebot"

Write-Log "Sandbox is ready for connections..."
