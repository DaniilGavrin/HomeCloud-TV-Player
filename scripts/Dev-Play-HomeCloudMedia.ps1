# HomeCloud TV - request actual storage playback using Backend media.rooms.play.
# Does NOT open an arbitrary URL and never forwards a host filesystem path.
# Requires an ONLINE TV, Media Gateway and HC Storage Service on the same Backend.
[CmdletBinding()]
param(
    [string]$Backend = 'ws://100.114.58.74:8080/ws',
    [Parameter(Mandatory)][string]$BackendNodeId,
    [Parameter(Mandatory)][string]$TvDeviceId,
    [Parameter(Mandatory)][string]$StorageNodeId,
    [ValidateSet('disk','folder')][string]$RootKind = 'disk',
    [string]$RootId = 'storage-hdd',
    [Parameter(Mandatory)][string]$FilePath,
    [ValidateSet('lan','tailscale')][string]$Network = 'lan',
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($FilePath.StartsWith('/') -or $FilePath.StartsWith('\') -or
    $FilePath -match '(^|/)\.\.?(/|$)|[\\:]' -or $FilePath.Contains([char]0) -or
    $FilePath.Length -gt 140 -or [string]::IsNullOrWhiteSpace($FilePath)) {
    throw 'FilePath must be a short, relative path inside the selected HC SS root (e.g. demo.mp4).'
}
if ($Backend -notmatch '^wss?://') { throw 'Backend must be a WebSocket endpoint.' }

# Go sourcews.FileID uses JSON in exact field order root(kind,id), path.
$ref = [ordered]@{
    root = [ordered]@{kind = $RootKind; id = $RootId}
    path = $FilePath
}
$json = ConvertTo-Json -InputObject $ref -Depth 6 -Compress
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
$fileId = 'hc1.' + $b64.TrimEnd('=').Replace('+','-').Replace('/','_')
if ($fileId.Length -gt 256) {
    throw 'FileId exceeds the current Backend 256-character limit. Use a shorter relative filename.'
}
$commandId = 'media-demo-' + [Guid]::NewGuid().ToString('N')
$payload = @{
    v = 1
    id = $commandId
    type = 'command'
    action = 'media.rooms.play'
    data = @{
        command_id = $commandId
        network = $Network
        target = @{node_id=$BackendNodeId; device_id=$TvDeviceId}
        source = @{storage_node_id=$StorageNodeId; file_id=$fileId}
    }
}
Write-Host ('[SOURCE] {0}/{1}/{2}' -f $StorageNodeId,$RootKind,$FilePath)
Write-Host ('[TARGET] {0}/{1} network={2}' -f $BackendNodeId,$TvDeviceId,$Network)
if ($DryRun) {
    Write-Host '[DRY RUN] No WS command sent.'
    $payload | ConvertTo-Json -Depth 10
    return
}

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$cts = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(30))
function Send-JSON([object]$message) {
    $body = ConvertTo-Json -InputObject $message -Compress -Depth 12
    $bytes = [Text.Encoding]::UTF8.GetBytes($body)
    $segment = [ArraySegment[byte]]::new($bytes)
    [void]$ws.SendAsync($segment, [Net.WebSockets.WebSocketMessageType]::Text, $true, $cts.Token).GetAwaiter().GetResult()
}
function Receive-JSON {
    $memory = [IO.MemoryStream]::new()
    try {
        do {
            $chunk = New-Object byte[] 16384
            $segment = [ArraySegment[byte]]::new($chunk)
            $response = $ws.ReceiveAsync($segment, $cts.Token).GetAwaiter().GetResult()
            if ($response.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
                throw 'Backend closed the WebSocket'
            }
            if ($response.MessageType -ne [Net.WebSockets.WebSocketMessageType]::Text) {
                throw 'Unexpected non-text reply'
            }
            $memory.Write($chunk,0,$response.Count)
            if ($memory.Length -gt 1048576) { throw 'Backend response larger than 1MiB' }
        } until ($response.EndOfMessage)
        return [Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
    } finally {$memory.Dispose()}
}
try {
    Write-Host "[CONNECT] $Backend"
    [void]$ws.ConnectAsync([Uri]$Backend,$cts.Token).GetAwaiter().GetResult()
    Send-JSON @{
        v = 1; id = 'media-demo-hello'; type = 'hello';
        device_id = ('hc-media-cli-' + [Guid]::NewGuid().ToString('N').Substring(0,12));
        client_type = 'cli'
    }
    $hello = Receive-JSON
    if ($hello.type -ne 'identified') {
        throw ('Backend identification failed: '+($hello | ConvertTo-Json -Depth 8 -Compress))
    }
    Write-Host '[CONNECTED] Backend accepted CLI session.'
    Send-JSON $payload
    do {
        $response = Receive-JSON
    } while ($response.type -eq 'event')
    if ($response.type -ne 'result' -or $response.id -ne $commandId) {
        throw ('Media play failed: '+($response | ConvertTo-Json -Depth 10))
    }
    Write-Host '[SENT] media.rooms.play accepted by Backend.' -ForegroundColor Green
    Write-Host 'Delivery and playback are NOT confirmed until TV/Gateway report their own states.'
    $response | ConvertTo-Json -Depth 12
} finally {
    try { $ws.Dispose() } catch {}
    $cts.Dispose()
}
