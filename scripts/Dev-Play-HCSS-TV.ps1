# KAN-59 DEV ONLY: Play a real HC SS file on ONE identified Android TV.
# Requires HC SS HCS1 and Media Gateway source_nodes configured, plus a TV
# running a build with the authorized HTTP Range attachment.
# Sample:
# .\scripts\Dev-Play-HCSS-TV.ps1 -TargetNodeId 'node-...' -StorageNodeId 'storage-...' -FileId 'hc1....'
param(
    [string]$Backend = 'ws://127.0.0.1:8080/ws',
    [Parameter(Mandatory=$true)][string]$TargetNodeId,
    [Parameter(Mandatory=$true)][string]$StorageNodeId,
    [Parameter(Mandatory=$true)][string]$FileId,
    [string]$TvDeviceId = '',
    [ValidateSet('lan','tailscale')][string]$Network = 'lan'
)
$ErrorActionPreference = 'Stop'
$ws = [Net.WebSockets.ClientWebSocket]::new()
$token = [Threading.CancellationToken]::None
$clientId = 'hc-media-smoke-' + [Guid]::NewGuid().ToString('N')
$cmdId = 'hc-play-' + [Guid]::NewGuid().ToString('N')

function Send-HC([hashtable]$packet) {
    $payload = [Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject $packet -Depth 15 -Compress))
    $ws.SendAsync([ArraySegment[byte]]::new($payload), [Net.WebSockets.WebSocketMessageType]::Text, $true, $token).GetAwaiter().GetResult()
}
function Read-Reply([string]$id) {
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(20))
    $ms = [IO.MemoryStream]::new()
    try {
        while ($true) {
            $ms.SetLength(0)
            do {
                $chunk = New-Object byte[] 65536
                $result = $ws.ReceiveAsync([ArraySegment[byte]]::new($chunk), $cancel.Token).GetAwaiter().GetResult()
                if ($result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw 'Backend closed WebSocket' }
                if ($result.MessageType -ne [Net.WebSockets.WebSocketMessageType]::Text) { throw 'Unexpected binary frame' }
                $ms.Write($chunk,0,$result.Count)
                if ($ms.Length -gt 1048576) { throw 'Reply exceeds 1 MiB' }
            } until ($result.EndOfMessage)
            $parsed = ConvertFrom-Json -InputObject ([Text.Encoding]::UTF8.GetString($ms.ToArray()))
            if ($parsed.type -eq 'event') { continue }
            if ($parsed.id -ne $id) { throw "Unexpected request id '$($parsed.id)'" }
            if ($parsed.type -eq 'error') { throw "Backend error: $($parsed.error)" }
            return $parsed
        }
    }
    finally { $ms.Dispose(); $cancel.Dispose() }
}
try {
    Write-Host "[CONNECT] $Backend"
    $timeout = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds(10))
    try { $ws.ConnectAsync([Uri]$Backend,$timeout.Token).GetAwaiter().GetResult() }
    finally { $timeout.Dispose() }
    Send-HC @{v=1;id='hello';type='hello';device_id=$clientId;client_type='cli'}
    $hello = Read-Reply 'hello'
    if ($hello.type -ne 'identified') { throw 'Backend did not identify the CLI' }
    Send-HC @{v=1;id='list';type='command';action='clients.list';data=@{}}
    $res = Read-Reply 'list'
    if ($res.type -ne 'result') { throw 'clients.list failed' }
    $tvs = @($res.data | Where-Object { $_.client_type -eq 'tv' })
    if ($TvDeviceId) { $tvs = @($tvs | Where-Object { $_.device_id -eq $TvDeviceId }) }
    if ($tvs.Count -ne 1) {
        Write-Host ('Connected TVs: ' + (@($res.data | Where-Object { $_.client_type -eq 'tv' } | ForEach-Object { $_.device_id }) -join ', '))
        throw 'Expected one connected TV. Supply -TvDeviceId if multiple.'
    }
    $tv = [string]$tvs[0].device_id
    Write-Host "[TV] $tv"
    Write-Host "[SOURCE] Node: $StorageNodeId; file ID supplied"
    Send-HC @{
        v=1;id='play';type='command';action='media.rooms.play'
        data=@{
            command_id=$cmdId
            network=$Network
            target=@{node_id=$TargetNodeId;device_id=$tv}
            source=@{storage_node_id=$StorageNodeId;file_id=$FileId}
        }
    }
    $result = Read-Reply 'play'
    if ($result.type -ne 'result' -or $result.action -ne 'media.rooms.play' -or -not $result.data.room_id) {
        throw 'Backend did not return a room ID'
    }
    Write-Host "[ROOM] $($result.data.room_id)"
    Write-Host "[STATUS] $($result.data.command_status), delivered=$($result.data.delivered)"
    Write-Host 'The request being accepted does NOT prove TV playback.'
    Write-Host 'Check the TV: it should attach directly to Gateway and open the real media URL.'
}
finally { $ws.Dispose() }
