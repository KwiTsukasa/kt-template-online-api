param(
  [string]$SshTarget = "root@yd.frp-bag.com",
  [int]$SshPort = 45122,
  [switch]$Cutover
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$localScript = Join-Path $scriptDir "bootstrap.sh"
$remoteScript = "/tmp/kt-fnos-k8s-bootstrap.sh"
$sshOptions = @("-o", "StrictHostKeyChecking=accept-new")
$sshArgs = $sshOptions + @("-p", $SshPort.ToString(), $SshTarget)
$scpArgs = $sshOptions + @("-P", $SshPort.ToString(), $localScript, "${SshTarget}:$remoteScript")
$remoteEnv = ""

if ($Cutover) {
  # Cutover allows the bootstrap script to stop the old Docker API container if 48085 is occupied.
  $remoteEnv = "STOP_OLD_API_CONTAINER=true "
}

Write-Host "Uploading $localScript to ${SshTarget}:$remoteScript"
& scp @scpArgs

Write-Host "Running fnOS k3d bootstrap on $SshTarget"
& ssh @sshArgs "chmod +x '$remoteScript' && ${remoteEnv}bash '$remoteScript'"
