# Creates (or updates) the DNS record for the game, e.g. vistr.memoryq.com, in Cloudflare.
#
#   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
#   & "$([Environment]::GetFolderPath('MyDocuments'))\vistr\deploy\cloudflare-dns.ps1"
#
# It asks for a Cloudflare API token (Cloudflare -> My Profile -> API Tokens -> Create Token
# -> template "Edit zone DNS" -> Zone Resources: memoryq.com). The token is not saved.
# By default the new name points at the same server as memoryq.com itself; use -Ip to
# choose another server. The record is "DNS only" (grey cloud) so the server can get its
# own HTTPS certificate; add -Proxied for the orange cloud.
param(
  [string]$Domain = 'memoryq.com',
  [string]$Name = 'vistr',
  [string]$Ip = '',
  [switch]$Proxied
)
$ErrorActionPreference = 'Stop'
$fqdn = "$Name.$Domain"
$api = 'https://api.cloudflare.com/client/v4'

$secure = Read-Host "Cloudflare API token for $Domain" -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
function CF($method, $path, $body) {
  $req = @{ Method = $method; Uri = "$api$path"; Headers = $headers }
  if ($body) { $req.Body = ($body | ConvertTo-Json -Compress) }
  try { $r = Invoke-RestMethod @req }
  catch {
    $msg = $_.ErrorDetails.Message
    if (-not $msg) { $msg = $_.Exception.Message }
    throw "Cloudflare said: $msg"
  }
  if (-not $r.success) { throw "Cloudflare said: $(($r.errors | ForEach-Object { $_.message }) -join '; ')" }
  return $r.result
}

Write-Host "Finding $Domain in your Cloudflare account..."
$zone = @(CF GET "/zones?name=$Domain")[0]
if (-not $zone) { throw "$Domain is not in the Cloudflare account this token belongs to (or the token cannot see it)." }

if (-not $Ip) {
  $root = @(CF GET "/zones/$($zone.id)/dns_records?type=A&name=$Domain")[0]
  if (-not $root) { throw "$Domain has no A record to copy. Run again with -Ip <your server's IP address>." }
  $Ip = $root.content
  Write-Host "$Domain points at server $Ip (the real address behind Cloudflare). Using the same server."
}

$record = @{ type = 'A'; name = $fqdn; content = $Ip; ttl = 1; proxied = [bool]$Proxied; comment = 'Vistr game server' }
$existing = @(CF GET "/zones/$($zone.id)/dns_records?name=$fqdn")[0]
if ($existing) {
  if ($existing.type -ne 'A') { throw "$fqdn already exists as a $($existing.type) record. Remove it in Cloudflare first." }
  CF PUT "/zones/$($zone.id)/dns_records/$($existing.id)" $record | Out-Null
  Write-Host "Updated $fqdn -> $Ip" -ForegroundColor Green
} else {
  CF POST "/zones/$($zone.id)/dns_records" $record | Out-Null
  Write-Host "Created $fqdn -> $Ip" -ForegroundColor Green
}
Write-Host ("Cloudflare proxy: " + $(if ($Proxied) { 'on (orange cloud)' } else { 'off (DNS only), so the server can get its HTTPS certificate' }))

Write-Host "Checking that the name works (can take a minute)..."
foreach ($i in 1..12) {
  try {
    $a = Resolve-DnsName $fqdn -Server 1.1.1.1 -Type A -ErrorAction Stop | Where-Object { $_.IPAddress } | Select-Object -First 1
    if ($a) { Write-Host "$fqdn resolves to $($a.IPAddress). Next: run setup-server.sh on that server." -ForegroundColor Green; return }
  } catch {}
  Start-Sleep -Seconds 5
}
Write-Host "Not visible yet; that is normal for a few minutes. Check later with: Resolve-DnsName $fqdn" -ForegroundColor Yellow
